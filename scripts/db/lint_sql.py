"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Check every SQL statement the Workers build against the migrated schema.

There is no TiDB in the build sandbox, so the unit tests drive handlers against a stub
database that answers whatever they are told. That arrangement tests the handler and proves
nothing about the SQL: a statement can name a column no migration ever created and every
test stays green, because the stub never looks at the statement.

This closes that gap without a server. It reads `db/expected.json` — the schema derived from
`db/migrations` by `expected.py` — extracts the statements out of the TypeScript that builds
them, parses each one as MySQL with `sqlglot`, and resolves every qualifier against the real
column list. A statement naming a column that does not exist fails here instead of at 02:00
in production, which is the whole point of a linter.

What it cannot do is honest: it does not run the statement, so it cannot see a wrong join
predicate, a missing index, or a value that violates a CHECK. It is a spelling check with a
schema, and it says so.

`sqlglot` is a development tool, not a runtime dependency. If it is missing the script says
so and exits 0, unless `--strict` is passed, which is what CI does.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = ROOT / "db" / "expected.json"
#: Where the statements live. Overridable so the linter can be pointed at a fixture in a test:
#: a gate nobody has watched fail is a gate nobody should trust.
SOURCES = os.environ.get("UNDAL_LINT_SOURCES", "workers/core/src").split(":")

STATEMENT_START = ("SELECT", "UPDATE", "INSERT", "DELETE", "WITH", "REPLACE")

#: Words a literal may begin with and still be the continuation of the statement before it.
#: Anything else — an error code, a sentence, a variable name — ends the statement instead of
#: being glued onto it, which is what produced findings like `LIMIT 1AUTH_TOKEN_MISSING`.
CONTINUATION = (
    "FROM", "WHERE", "AND", "OR", "ORDER", "GROUP", "BY", "LIMIT", "OFFSET", "JOIN", "LEFT",
    "INNER", "RIGHT", "CROSS", "ON", "HAVING", "VALUES", "SET", "USING", "UNION", "CASE",
    "WHEN", "THEN", "ELSE", "END", "AS", "IN", "NOT", "IS", "NULL", "FOR", "LOCK", "SELECT",
    "UPDATE", "DELETE", "INSERT", "REPLACE", "WITH",
)


def strip_to_literals(text: str) -> list[tuple[str, str, int, int]]:
    """Every string literal in a TypeScript file, as `(kind, content)`.

    Comments are skipped rather than removed first, because removing `//` naively cuts the
    tail off any string containing a URL — and there are a few of those.
    """
    out: list[tuple[str, str, int, int]] = []
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if text.startswith("//", index):
            newline = text.find("\n", index)
            index = length if newline == -1 else newline + 1
            continue
        if text.startswith("/*", index):
            close = text.find("*/", index + 2)
            index = length if close == -1 else close + 2
            continue
        if char in "\"'`":
            quote = char
            start = index
            index += 1
            buffer: list[str] = []
            while index < length:
                current = text[index]
                if current == "\\" and index + 1 < length:
                    buffer.append(text[index + 1])
                    index += 2
                    continue
                if current == quote:
                    index += 1
                    break
                if current == "\n" and quote != "`":
                    break
                buffer.append(current)
                index += 1
            out.append((quote, "".join(buffer), start, index))
            continue
        index += 1
    return out


def constants(text: str) -> dict[str, str]:
    """Named string constants that hold SQL, so `${ADMIN_ZONE_COLUMNS}` can be resolved.

    A repository that builds `SELECT ${COLUMNS} FROM ...` is a statement this linter would
    otherwise have to skip, and skipping the longest statements in the file is exactly the
    wrong place to be blind.
    """
    found: dict[str, str] = {}
    # Only upper-case names: those are the SQL fragments. A lower-case local holding a piece of
    # a WHERE clause is read in the statement that uses it, not substituted into another one.
    for match in re.finditer(r"\bconst\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=;]+)?=\s*", text):
        window = text[match.end(): match.end() + 4000]
        collected: list[str] = []
        previous_end = match.end()
        for kind, content, start, stop in strip_to_literals(window):
            if collected and re.fullmatch(r"\s*\+\s*", window[previous_end:start]) is None:
                break
            collected.append(content)
            previous_end = stop
            if content.rstrip().endswith(";"):
                break
        if not collected:
            continue
        joined = "".join(collected)
        if not joined.upper().lstrip().startswith(STATEMENT_START) and "`" not in joined:
            continue
        found[match.group(1)] = joined
    return found


def resolve_interpolations(content: str, known: dict[str, str]) -> str | None:
    """Substitute `${NAME}` with that constant; `None` when the name is decided at run time."""
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        return known.get(name, "\x00")

    resolved = re.sub(r"\$\{([A-Za-z_]\w*)\}", replace, content)
    # `\x00` marks a name nobody declared; a `${` that survived was never a bare name at all,
    # and in both cases the statement is decided at run time.
    return None if "\x00" in resolved or "${" in resolved else resolved


def statements(path: Path) -> list[str]:
    """The SQL statements a file builds, with concatenated literals joined.

    Two literals belong to the same statement only when nothing but `+` and whitespace sits
    between them in the source. That is what `"a" + "b"` and a template broken over three lines
    look like, and it is not what a statement followed by an error code looks like — the gap
    there holds a `)`, a `,`, or a whole expression, and gluing those together is how a linter
    invents findings instead of finding them.
    """
    text = path.read_text(encoding="utf-8")
    known = constants(text)
    literals = strip_to_literals(text)
    groups: list[list[str]] = []
    complete: list[bool] = []
    current: list[str] = []
    truncated = False
    previous_end: int | None = None

    for kind, content, start, stop in literals:
        joins = previous_end is not None and re.fullmatch(r"\s*\+\s*", text[previous_end:start]) is not None
        if current and not joins:
            groups.append(current)
            complete.append(not truncated)
            current = []
            truncated = False
        previous_end = stop
        if kind == "`" and "${" in content:
            resolved = resolve_interpolations(content, known)
            if resolved is not None:
                current.append(resolved)
                continue
            # The rest of this statement is decided at run time. What has been read so far is a
            # fragment — a SELECT list with no FROM — and checking it would invent a finding.
            if current:
                groups.append(current)
                complete.append(False)
                current = []
            truncated = True
            continue
        # A group that starts here is a group of its own: the cut flag belongs to what came before,
        # and letting it leak forward silently dropped every statement after an interpolated one.
        if not current:
            truncated = False
        current.append(content)
    if current:
        groups.append(current)
        complete.append(not truncated)

    found: list[str] = []
    for group, is_complete in zip(groups, complete, strict=True):
        joined = "".join(group).lstrip()
        words = joined.split()
        # `DELETE` on its own is a word in a list of permission names, not a statement.
        if len(words) < 3 or not joined.upper().startswith(STATEMENT_START):
            continue
        if not is_complete:
            continue
        found.append(joined[:-1] if joined.rstrip().endswith(";") else joined)
    return found


def continues(stripped: str) -> bool:
    """Whether a literal can be the next piece of the statement already being built."""
    if stripped == "":
        return False
    head = stripped.split(None, 1)[0].upper().strip(",")
    if head in CONTINUATION:
        return True
    return stripped[0] in "`(,)?0-9"


def literals_with_interpolation(text: str) -> list[tuple[str | None, str]]:
    """As `strip_to_literals`, but a template literal holding `${` is marked `None`."""
    marked: list[tuple[str | None, str]] = []
    for kind, content in strip_to_literals(text):
        if kind == "`" and "${" in content:
            marked.append((None, ""))
            continue
        marked.append((kind, content))
    return marked


def label(path: Path) -> str:
    """A short name for a file, whether or not it lives inside the repository."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def schema_of(document: dict[str, object]) -> dict[str, dict[str, str]]:
    """The catalog sqlglot resolves against: table -> column -> a type it need not read."""
    tables = document["tables"]
    assert isinstance(tables, dict)
    return {
        table: {column["name"]: "TEXT" for column in body["columns"]}  # type: ignore[index]
        for table, body in tables.items()
    }


def findings_for(statement: str, schema: dict[str, dict[str, str]], mapping: object) -> list[str]:
    """Every way a statement disagrees with the schema: an unknown table, an unknown column.

    Separated from `main` so the linter can be pointed at a statement in a test — a checker
    nobody has seen fail is a checker nobody should trust.
    """
    import sqlglot
    from sqlglot import exp
    from sqlglot.optimizer.qualify import qualify

    # `?` is a bind marker and sqlglot wants a value in the slot. The literal `IDS` is swapped
    # by the repository for a list of bind markers; it becomes one here, so the statement is
    # checked as the shape it will really have.
    prepared = statement.replace("?", "NULL").replace("(IDS)", "(NULL)")
    tree = sqlglot.parse_one(prepared, read="mysql")
    problems: list[str] = []
    for table in tree.find_all(exp.Table):
        name = table.name.lower()
        if name != "" and name not in schema:
            problems.append(f"unknown table `{table.name}`")
    try:
        qualify(tree, schema=mapping, dialect="mysql", validate_qualify_columns=True)
    except Exception as error:  # noqa: BLE001
        problems.append(str(error))
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint the Workers' SQL against the migrations.")
    parser.add_argument("--strict", action="store_true", help="fail when sqlglot is absent")
    parser.add_argument("--verbose", action="store_true", help="list every statement checked")
    parser.add_argument(
        "--allow-unparsed",
        action="store_true",
        help="do not fail on a statement the parser could not read (a statement nobody checked)",
    )
    arguments = parser.parse_args()

    try:
        import sqlglot
        from sqlglot import exp
        from sqlglot.optimizer.qualify import qualify
        from sqlglot.schema import MappingSchema
    except ImportError:
        message = "lint-sql: sqlglot is not installed (pip install sqlglot)"
        if arguments.strict:
            print(message, file=sys.stderr)
            return 1
        print(f"{message} — skipping")
        return 0

    schema = schema_of(json.loads(EXPECTED.read_text(encoding="utf-8")))
    mapping = MappingSchema(schema, dialect="mysql")

    checked = 0
    problems: list[str] = []
    unparsed: list[str] = []

    for source in SOURCES:
        directory = ROOT / source
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.ts")):
            if path.name.endswith(".test.ts") or "/test/" in str(path):
                continue
            for statement in statements(path):
                # `?` is a bind marker and sqlglot wants a value in the slot; see `findings_for`.
                prepared = statement.replace("?", "NULL").replace("(IDS)", "(NULL)")
                try:
                    tree = sqlglot.parse_one(prepared, read="mysql")
                except Exception:  # noqa: BLE001 - a parse failure is a finding, not a crash
                    unparsed.append(f"{label(path)}: {statement[:90]}")
                    continue
                checked += 1
                if arguments.verbose:
                    print(f"  {label(path)}: {statement[:90]}")
                for problem in findings_for(statement, schema, mapping):
                    problems.append(f"{label(path)}: {problem} :: {statement[:110]}")

    for problem in sorted(set(problems)):
        print(f"lint-sql: {problem}", file=sys.stderr)
    for unparsed_statement in unparsed:
        print(f"lint-sql: could not parse {unparsed_statement}", file=sys.stderr)

    print(
        f"lint-sql: {checked} statements checked against {len(schema)} tables, "
        f"{len(set(problems))} findings, {len(unparsed)} unparseable"
    )
    # An unparseable statement is not a statement that passed; it is one nobody read. The gate
    # fails on it unless the caller says out loud that they are exploring rather than verifying.
    if unparsed and not arguments.allow_unparsed:
        return 1
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
