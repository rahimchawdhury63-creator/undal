"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Derive what the live schema should look like from the migrations themselves.

The expectation is read from the files that create the schema, never from a
snapshot of a database that happened to exist when someone ran a dump: a snapshot
records drift as if it were intent. `verify_schema.py` then compares a live TiDB
instance against this file, so the answer to "is production the schema we
committed?" does not depend on anyone remembering.
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

CREATE = re.compile(r"CREATE TABLE IF NOT EXISTS `([a-z_0-9]+)`\s*\((.*)\)\s*ENGINE", re.S)
COLUMN = re.compile(r"^\s*`([a-z_0-9]+)`\s+([A-Za-z]+(?:\s*\([^)]*\))?)", re.M)
GENERATED = re.compile(r"^\s*`([a-z_0-9]+)`.*\bAS\s*\(", re.M)
KEY = re.compile(r"^\s*(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`([a-z_0-9]+)`", re.M)
CHECK = re.compile(r"CHECK\s*\(")
#: A later migration adding a column to an existing table. Without this, a column that
#: arrives by `ALTER` is invisible to the expectation and `verify_schema.py` never looks
#: for it — the schema would drift with the commit that changed it.
ALTER = re.compile(r"ALTER TABLE\s+`([a-z_0-9]+)`\s+(.*)", re.S)
ADD_COLUMN = re.compile(r"\bADD COLUMN\s+`([a-z_0-9]+)`\s+([A-Za-z]+(?:\s*\([^)]*\))?)", re.I)


def build() -> dict[str, object]:
    """The expected schema, keyed by table, in a stable order."""
    tables: dict[str, dict[str, object]] = {}
    for path in migration_files(MIGRATIONS):
        for statement in split_statements(path.read_text(encoding="utf-8")):
            altered = ALTER.search(statement)
            if altered is not None:
                name, body = altered.group(1), altered.group(2)
                if name not in tables:
                    raise SystemExit(f"{name} is altered before it is created")
                columns = tables[name]["columns"]
                for column, kind in ADD_COLUMN.findall(body):
                    if any(existing["name"] == column for existing in columns):
                        raise SystemExit(f"{name}.{column} is added twice")
                    columns.append({"name": column, "type": " ".join(kind.upper().split())})
                continue
            match = CREATE.search(statement)
            if not match:
                continue
            name, body = match.group(1), match.group(2)
            if name in tables:
                raise SystemExit(f"{name} is created twice")
            tables[name] = {
                "columns": [
                    {"name": column, "type": " ".join(kind.upper().split())}
                    for column, kind in COLUMN.findall(body)
                ],
                "generated": GENERATED.findall(body),
                "indexes": KEY.findall(body),
                "inline_checks": len(CHECK.findall(body)),
                "source": path.name,
            }
    return {
        "note": "Derived from db/migrations by scripts/db/expected.py — do not edit by hand.",
        "table_count": len(tables),
        "tables": tables,
    }


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
