"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Extract every declared CHECK into data and into validators.

TiDB parses `CHECK` and does not enforce it, so the DDL's constraints are a
statement of intent and this script turns that intent into something that runs.
Two artifacts come out of one pass, so they cannot drift from each other:

  packages/contracts/src/constraints.json      the registry `check-constraint-parity` compares
  packages/contracts/src/constraints/generated.ts  one validator per constraint

The rewrite from SQL to JavaScript is deliberately small and strict. Anything it
does not understand is a hard failure naming the constraint, because a validator
that silently skipped a rule would be worse than no validator at all — the schema
would look guarded and enforce nothing.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "db" / "migrations"
OUT_JSON = ROOT / "packages" / "contracts" / "src" / "constraints.json"
OUT_TS = ROOT / "packages" / "contracts" / "src" / "constraints" / "generated.ts"

CREATE = re.compile(r"CREATE TABLE IF NOT EXISTS `([a-z_]+)`\s*\(")
INLINE_CHECK = re.compile(r"CHECK\s*\(")
ADD_CONSTRAINT = re.compile(
    r"ALTER TABLE `([a-z_]+)`\s+ADD CONSTRAINT `([a-z_0-9]+)`\s+CHECK \((.*?)\)\s*$", re.S
)


def split_statements(text: str) -> list[str]:
    """Split on semicolons that are not inside a string literal or a comment."""
    statements: list[str] = []
    buffer: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(text):
        char = text[index]
        pair = text[index : index + 2]
        if quote is None and pair == "--":
            newline = text.find("\n", index)
            index = len(text) if newline == -1 else newline + 1
            buffer.append("\n")
            continue
        if quote is None and char in "'\"":
            quote = char
        elif quote is not None and char == quote:
            quote = None
        if char == ";" and quote is None:
            statements.append("".join(buffer))
            buffer = []
            index += 1
            continue
        buffer.append(char)
        index += 1
    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)
    return [statement.strip() for statement in statements if statement.strip()]


def balanced(expression: str) -> bool:
    depth = 0
    for char in expression:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def extract_check(statement: str, start: int) -> str:
    """Read a CHECK body starting at the open paren, respecting nesting and strings."""
    depth = 0
    quote: str | None = None
    index = start
    while index < len(statement):
        char = statement[index]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return statement[start + 1 : index]
        index += 1
    raise SystemExit("unterminated CHECK")


TOKEN = re.compile(
    r"""\s*(?:
        (?P<string>'(?:[^']|'')*')
      | (?P<backtick>`[a-z_][a-z_0-9]*`)
      | (?P<number>-?\d+(?:\.\d+)?)
      | (?P<identifier>[A-Za-z_][A-Za-z_0-9]*)
      | (?P<operator><>|!=|<=|>=|=|<|>|\+|\-|\*|/)
      | (?P<punct>[(),])
    )""",
    re.X,
)

KEYWORDS = {"AND", "OR", "NOT", "IS", "NULL", "IN", "BETWEEN", "MOD", "OCTET_LENGTH", "TRUE", "FALSE"}
FUNCTIONS = {"MOD": "mod", "OCTET_LENGTH": "lengthBytes"}


def tokenise(expression: str) -> list[tuple[str, str]]:
    """Tokenise a CHECK body; anything unrecognised is a hard failure."""
    tokens: list[tuple[str, str]] = []
    position = 0
    while position < len(expression):
        match = TOKEN.match(expression, position)
        if not match:
            if expression[position:].strip() == "":
                break
            raise SystemExit(f"cannot tokenise at {position}: {expression[position:position + 40]!r}")
        kind = match.lastgroup or ""
        value = match.group(kind)
        if kind == "identifier" and value.upper() in KEYWORDS:
            kind = "keyword"
        tokens.append((kind, value))
        position = match.end()
    return tokens


class Parser:
    """Recursive descent over the small predicate grammar the corpus uses."""

    def __init__(self, tokens: list[tuple[str, str]], name: str) -> None:
        self.tokens = tokens
        self.index = 0
        self.name = name

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def take(self, expected: str | None = None) -> tuple[str, str]:
        token = self.peek()
        if token is None:
            raise SystemExit(f"{self.name}: unexpected end of expression")
        if expected is not None and token[1].upper() != expected:
            raise SystemExit(f"{self.name}: expected {expected}, found {token[1]!r}")
        self.index += 1
        return token

    def parse(self) -> str:
        result = self.or_expression()
        if self.peek() is not None:
            raise SystemExit(f"{self.name}: trailing tokens starting {self.peek()!r}")
        return result

    def or_expression(self) -> str:
        parts = [self.and_expression()]
        while self.peek() and self.peek()[1].upper() == "OR":
            self.take("OR")
            parts.append(self.and_expression())
        return "(" + " || ".join(parts) + ")" if len(parts) > 1 else parts[0]

    def and_expression(self) -> str:
        parts = [self.not_expression()]
        while self.peek() and self.peek()[1].upper() == "AND":
            self.take("AND")
            parts.append(self.not_expression())
        return "(" + " && ".join(parts) + ")" if len(parts) > 1 else parts[0]

    def not_expression(self) -> str:
        token = self.peek()
        if token and token[1].upper() == "NOT":
            self.take("NOT")
            return "!" + self.not_expression()
        return self.comparison()

    def comparison(self) -> str:
        left = self.arithmetic()
        token = self.peek()
        if token is None:
            return left
        word = token[1].upper()
        if word == "IS":
            self.take("IS")
            negated = False
            if self.peek() and self.peek()[1].upper() == "NOT":
                self.take("NOT")
                negated = True
            self.take("NULL")
            return f"({left} {'!==' if negated else '==='} null)"
        if word == "NOT" and self.index + 1 < len(self.tokens) and self.tokens[self.index + 1][1].upper() == "IN":
            self.take("NOT")
            self.take("IN")
            self.take("(")
            values = [self.arithmetic()]
            while self.peek() and self.peek()[1] == ",":
                self.take(",")
                values.append(self.arithmetic())
            self.take(")")
            return f"![{', '.join(values)}].includes({left})"
        if word == "IN":
            self.take("IN")
            self.take("(")
            values = [self.arithmetic()]
            while self.peek() and self.peek()[1] == ",":
                self.take(",")
                values.append(self.arithmetic())
            self.take(")")
            return f"[{', '.join(values)}].includes({left})"
        if word == "BETWEEN":
            self.take("BETWEEN")
            low = self.arithmetic()
            self.take("AND")
            high = self.arithmetic()
            return f"({left} >= {low} && {left} <= {high})"
        if token[0] == "operator":
            operator = self.take()[1]
            right = self.arithmetic()
            javascript = {"=": "===", "<>": "!==", "!=": "!=="}.get(operator, operator)
            return f"({left} {javascript} {right})"
        # A bare column used as a predicate (`NOT is_required`), or the end of a
        # parenthesised group: both are legal SQL and both are plain truthiness here.
        return left

    def arithmetic(self) -> str:
        """Additive level: the CHECK bodies subtract a discount from a subtotal."""
        left = self.multiplicative()
        while self.peek() and self.peek()[0] == "operator" and self.peek()[1] in {"+", "-"}:
            operator = self.take()[1]
            right = self.multiplicative()
            left = f"({left} {operator} {right})"
        return left

    def multiplicative(self) -> str:
        """Multiplicative level: `line_total = unit_price * quantity` needs it."""
        left = self.atom()
        while self.peek() and self.peek()[0] == "operator" and self.peek()[1] in {"*", "/"}:
            operator = self.take()[1]
            right = self.atom()
            left = f"({left} {operator} {right})"
        return left

    def atom(self) -> str:
        token = self.peek()
        if token == ("punct", "("):
            self.take("(")
            inner = self.or_expression()
            self.take(")")
            return inner
        kind, value = self.take()
        if kind == "backtick":
            return f'row["{value.strip(chr(96))}"]'
        if kind in {"identifier", "keyword"}:
            upper = value.upper()
            if upper in FUNCTIONS:
                self.take("(")
                arguments = [self.atom()]
                while self.peek() and self.peek()[1] == ",":
                    self.take(",")
                    arguments.append(self.atom())
                self.take(")")
                return f"{FUNCTIONS[upper]}({', '.join(arguments)})"
            if upper in {"NULL"}:
                return "null"
            if upper in {"TRUE", "FALSE"}:
                return upper.lower()
            return f'row["{value}"]'
        if kind == "string":
            return value.replace("''", "'")
        if kind == "number":
            return value
        raise SystemExit(f"{self.name}: unexpected atom {value!r}")


def rewrite(expression: str, name: str = "constraint") -> str:
    """SQL predicate -> JavaScript expression over `row`, via a real parser."""
    return Parser(tokenise(expression), name).parse()


def check_javascript(expression: str, name: str) -> None:
    """Prove the generated expression is valid JavaScript before writing it."""
    prefix = "const lengthBytes = (v) => (v == null ? 0 : v.length);\nconst row = {{}};\n("
    source = prefix.format() + expression + ");\n"
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as handle:
        handle.write(source)
        path = handle.name
    result = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    Path(path).unlink()
    if result.returncode != 0:
        raise SystemExit(f"{name}: generated JavaScript does not parse\n{expression}\n{result.stderr}")


def main() -> int:
    constraints: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        for statement in split_statements(text):
            create = CREATE.search(statement)
            if create:
                table = create.group(1)
                for match in INLINE_CHECK.finditer(statement):
                    body = extract_check(statement, match.end() - 1)
                    name = f"chk_{table}_inline_{len([c for c in constraints if c['table'] == table]) + 1}"
                    constraints.append(
                        {
                            "table": table,
                            "name": name,
                            "expression": " ".join(body.split()),
                            "source": path.name,
                            "origin": "inline",
                        }
                    )
                continue
            for match in ADD_CONSTRAINT.finditer(statement):
                table, name, body = match.group(1), match.group(2), match.group(3).strip()
                constraints.append(
                    {"table": table, "name": name, "expression": " ".join(body.split()), "source": path.name, "origin": "deferred"}
                )

    for constraint in constraints:
        if constraint["name"] in seen:
            raise SystemExit(f"duplicate constraint name: {constraint['name']}")
        seen.add(constraint["name"])
        constraint["javascript"] = rewrite(constraint["expression"], constraint["name"])
        check_javascript(constraint["javascript"], constraint["name"])

    OUT_JSON.write_text(
        json.dumps(
            {
                "generated_by": "scripts/db/extract_constraints.py",
                "note": "TiDB does not enforce CHECK; these validators are the enforcement (06 §1.2).",
                "count": len(constraints),
                "constraints": [
                    {key: value for key, value in c.items() if key != "javascript"} for c in constraints
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    lines = [
        "/*",
        " * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.",
        " * SPDX-License-Identifier: LicenseRef-PASVL-1.0",
        " *",
        " * GENERATED by scripts/db/extract_constraints.py — do not edit by hand.",
        " *",
        f" * {len(constraints)} validators, one per declared CHECK. TiDB does not enforce CHECK;",
        " * these functions are what enforcement means here, and `check-constraint-parity` fails",
        " * the build if this file and the DDL disagree by one entry.",
        " */",
        "",
        'import type { Constraint } from "./types.ts";',
        "",
        "/** Length of a bytea-ish value, or 0 when it is null. */",
        "const lengthBytes = (value: Uint8Array | null | undefined): number => (value == null ? 0 : value.length);",
        "",
        "/** SQL MOD, which keeps the sign of the dividend exactly as JavaScript does. */",
        "const mod = (value: number, divisor: number): number => value % divisor;",
        "",
        "/** The validators, keyed by table, each carrying the SQL it was generated from. */",
        "export const CONSTRAINTS: Readonly<Record<string, readonly Constraint[]>> = {",
    ]
    by_table: dict[str, list[dict[str, Any]]] = {}
    for constraint in constraints:
        by_table.setdefault(constraint["table"], []).append(constraint)
    for table, items in by_table.items():
        lines.append(f"  {table}: [")
        for item in items:
            body_line = f'      validate: (row) => Boolean({item["javascript"]}),'
            lines.append("    {")
            lines.append(f'      name: "{item["name"]}",')
            lines.append(f'      table: "{table}",')
            lines.append(f'      sql: "{item["expression"].replace(chr(34), chr(92) + chr(34))}",')
            lines.append(body_line)
            lines.append("    },")
        lines.append("  ],")
    lines.append("};")
    lines.append("")
    OUT_TS.write_text("\n".join(lines), encoding="utf-8")
    print(f"constraints: {len(constraints)} across {len(by_table)} tables")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
