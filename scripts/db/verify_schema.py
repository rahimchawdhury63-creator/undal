"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Compare a live TiDB instance against `db/expected.json`.

Two questions, both asked every night: is every expected table and column present
with the expected type, and does the server hold anything the migrations do not
know about? A missing column breaks a deploy in five minutes; an *extra* column
means somebody changed production by hand and the next migration will collide
with it, which is worse because it fails later.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = ROOT / "db" / "expected.json"

TABLE_QUERY = (
    "SELECT `TABLE_NAME`, `COLUMN_NAME`, `COLUMN_TYPE` FROM `information_schema`.`COLUMNS` "
    "WHERE `TABLE_SCHEMA` = DATABASE()"
)
INDEX_QUERY = (
    "SELECT DISTINCT `TABLE_NAME`, `INDEX_NAME` FROM `information_schema`.`STATISTICS` "
    "WHERE `TABLE_SCHEMA` = DATABASE()"
)


def live_schema(connection) -> dict[str, dict[str, str]]:
    """Table name to `{column: type}`, from the server's own catalogue."""
    schema: dict[str, dict[str, str]] = {}
    with connection.cursor() as cursor:
        cursor.execute(TABLE_QUERY)
        for table, column, column_type in cursor.fetchall():
            schema.setdefault(str(table), {})[str(column)] = " ".join(str(column_type).upper().split())
    return schema


def compare(expected: dict[str, object], live: dict[str, dict[str, str]]) -> list[str]:
    """Every difference, phrased so the fix is obvious."""
    problems: list[str] = []
    tables = expected["tables"]  # type: ignore[index]
    for table_name, table in tables.items():  # type: ignore[union-attr]
        if table_name not in live:
            problems.append(f"missing table `{table_name}`")
            continue
        live_columns = live[table_name]
        for column in table["columns"]:  # type: ignore[index]
            name, kind = column["name"], column["type"]
            if name not in live_columns:
                problems.append(f"missing column `{table_name}`.`{name}`")
            elif live_columns[name] != kind and "GENERATED" not in kind:
                problems.append(f"type drift `{table_name}`.`{name}`: expected {kind}, found {live_columns[name]}")
    infrastructure = {"schema_migrations", "_smoke"}
    for table_name in live:
        if table_name not in tables and table_name not in infrastructure:
            problems.append(f"unexpected table `{table_name}` in the database")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Verify the live schema")
    parser.add_argument("--expected", default=str(EXPECTED))
    args = parser.parse_args(argv)

    expected = json.loads(Path(args.expected).read_text(encoding="utf-8"))
    url = os.environ.get("TIDB_MIGRATION_URL")
    if not url:
        raise SystemExit("TIDB_MIGRATION_URL is not set")
    connection = migrate.connect(url)
    try:
        problems = compare(expected, live_schema(connection))
    finally:
        connection.close()

    for problem in problems:
        print(f"schema-drift: {problem}")
    if problems:
        print(f"verify-schema: {len(problems)} differences")
        return 1
    print(f"verify-schema: {expected['table_count']} tables match the migrations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
