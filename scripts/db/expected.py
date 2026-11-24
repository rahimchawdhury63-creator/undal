"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Derive a column inventory from the migration DDL. This is a deliberately limited
parser: unsupported DDL fails rather than silently producing an incomplete inventory.
It does not prove indexes, constraints, nullability, defaults, or generated expressions.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sqlsplit import migration_files, split_statements  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "db" / "migrations"
OUT = ROOT / "db" / "expected.json"

IDENT = r"(?:`([a-z_0-9]+)`|([a-z_0-9]+))"
CREATE = re.compile(r"^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+" + IDENT + r"\s*\((.*)\)\s*ENGINE\b", re.I | re.S)
ALTER = re.compile(r"^ALTER\s+TABLE\s+" + IDENT + r"\s+(.*)$", re.I | re.S)
COLUMN = re.compile(r"^\s*" + IDENT + r"\s+([a-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)(?=\s|$)", re.I | re.S)
# Supported types are explicit so a malformed definition cannot masquerade as a column.
TYPES = {"BIGINT", "INT", "INTEGER", "SMALLINT", "TINYINT", "MEDIUMINT", "DOUBLE", "FLOAT", "DECIMAL",
         "NUMERIC", "CHAR", "VARCHAR", "TEXT", "LONGTEXT", "MEDIUMTEXT", "BINARY", "VARBINARY",
         "JSON", "DATETIME", "TIMESTAMP", "DATE", "TIME", "BIT", "BLOB", "BOOLEAN", "BOOL"}
TABLE_CLAUSE = re.compile(r"^(?:PRIMARY\s+KEY|UNIQUE|INDEX|KEY|CONSTRAINT|FOREIGN\s+KEY|CHECK|FULLTEXT|SPATIAL)\b", re.I)
ADD_COLUMN = re.compile(r"^ADD\s+COLUMN\s+", re.I)
ADD_OTHER = re.compile(r"^ADD\s+(?:CONSTRAINT|INDEX|KEY|UNIQUE|PRIMARY|FOREIGN|CHECK)\b", re.I)
KEY = re.compile(r"^\s*(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`([a-z_0-9]+)`", re.M | re.I)
CHECK = re.compile(r"CHECK\s*\(", re.I)


def split_items(body: str) -> list[str]:
    """Split top-level commas, preserving commas inside expressions and quoted literals."""
    parts: list[str] = []
    start = depth = i = 0
    quote: str | None = None
    while i < len(body):
        char = body[i]
        if quote:
            if char == "\\" and quote != "`":
                i += 2
                continue
            if char == quote:
                if i + 1 < len(body) and body[i + 1] == quote:
                    i += 2
                    continue
                quote = None
        elif char in "'\"`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise ValueError("unbalanced DDL parentheses")
        elif char == "," and depth == 0:
            parts.append(body[start:i].strip())
            start = i + 1
        i += 1
    if quote or depth:
        raise ValueError("unbalanced DDL expression or quote")
    parts.append(body[start:].strip())
    if any(not part for part in parts):
        raise ValueError("empty DDL definition")
    return parts


def column(item: str) -> tuple[str, str, bool]:
    """Parse one supported quoted or unquoted column, failing on unknown syntax."""
    match = COLUMN.match(item)
    if not match:
        raise ValueError(f"unsupported column definition: {item[:100]}")
    name = (match.group(1) or match.group(2)).lower()
    kind = re.sub(r"\s*\(\s*", "(", match.group(3).upper())
    kind = re.sub(r"\s*\)", ")", kind)
    kind = re.sub(r"\s*,\s*", ",", kind)
    kind = " ".join(kind.split())
    base = kind.split("(", 1)[0].split()[0]
    if base not in TYPES:
        raise ValueError(f"unsupported type {kind} for {name}")
    return name, kind, bool(re.search(r"\bAS\s*\(", item, re.I))


def build(directory: Path = MIGRATIONS) -> dict[str, object]:
    """Build column expectations in migration order, refusing unsupported changes."""
    tables: dict[str, dict[str, object]] = {}
    for path in migration_files(directory):
        for statement in split_statements(path.read_text(encoding="utf-8")):
            try:
                match = CREATE.match(statement)
                if match:
                    name, body = (match.group(1) or match.group(2)).lower(), match.group(3)
                    if name in tables:
                        raise ValueError(f"{name} is created twice")
                    columns: list[dict[str, str]] = []
                    generated: list[str] = []
                    for item in split_items(body):
                        if TABLE_CLAUSE.match(item):
                            continue
                        col, kind, is_generated = column(item)
                        if any(existing["name"] == col for existing in columns):
                            raise ValueError(f"{name}.{col} is defined twice")
                        columns.append({"name": col, "type": kind})
                        if is_generated:
                            generated.append(col)
                    if not columns:
                        raise ValueError(f"{name} has no recognized columns")
                    tables[name] = {"columns": columns, "generated": generated, "indexes": KEY.findall(body),
                                    "inline_checks": len(CHECK.findall(body)), "source": path.name}
                    continue
                match = ALTER.match(statement)
                if match:
                    name, body = (match.group(1) or match.group(2)).lower(), match.group(3)
                    if name not in tables:
                        raise ValueError(f"{name} is altered before it is created")
                    columns = tables[name]["columns"]
                    generated = tables[name]["generated"]
                    for item in split_items(body):
                        add = ADD_COLUMN.match(item)
                        if add:
                            col, kind, is_generated = column(item[add.end():])
                            if any(existing["name"] == col for existing in columns):  # type: ignore[union-attr]
                                raise ValueError(f"{name}.{col} is added twice")
                            columns.append({"name": col, "type": kind})  # type: ignore[union-attr]
                            if is_generated:
                                generated.append(col)  # type: ignore[union-attr]
                        elif not ADD_OTHER.match(item):
                            raise ValueError(f"unsupported ALTER TABLE action: {item[:100]}")
                    continue
                if re.match(r"^(?:CREATE|ALTER|DROP|RENAME|TRUNCATE)\s+(?:TABLE|INDEX)\b", statement, re.I):
                    raise ValueError("unsupported schema-changing statement")
            except ValueError as error:
                raise SystemExit(f"{path.name}: {error}") from error
    return {"note": "Derived from db/migrations by scripts/db/expected.py — do not edit by hand.",
            "table_count": len(tables), "tables": tables}


def main() -> int:
    document = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    total_columns = sum(len(table["columns"]) for table in document["tables"].values())
    total_checks = sum(table["inline_checks"] for table in document["tables"].values())
    print(f"expected: {document['table_count']} tables, {total_columns} columns, {total_checks} inline checks -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
