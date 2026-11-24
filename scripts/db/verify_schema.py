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
import re
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


def live_schema(connection) -> dict[str, dict[str, str]]:
    """Table name to `{column: type}`, from the server's own catalogue."""
    schema: dict[str, dict[str, str]] = {}
    with connection.cursor() as cursor:
        cursor.execute(TABLE_QUERY)
        for table, column, column_type in cursor.fetchall():
            schema.setdefault(str(table), {})[str(column)] = " ".join(str(column_type).upper().split())
    return schema


def canonical_type(value: str) -> str:
    """Normalize cosmetic MySQL/TiDB integer display widths, never signedness or sizes."""
    value = " ".join(value.upper().split())
    value = re.sub(r"\s*\(\s*", "(", value)
    value = re.sub(r"\s*\)", ")", value)
    value = re.sub(r"\s*,\s*", ",", value)
    value = re.sub(r"^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\(\d+\)", r"\1", value)
    value = re.sub(r"^INTEGER\b", "INT", value)
    value = re.sub(r"^(BOOLEAN|BOOL)\b", "TINYINT", value)
    return value


def compare(expected: dict[str, object], live: dict[str, dict[str, str]]) -> list[str]:
    """Report missing, unexpected and type-mismatched tables/columns; not full schema parity."""
    problems: list[str] = []
    tables = expected["tables"]  # type: ignore[index]
    for table_name, table in tables.items():  # type: ignore[union-attr]
        columns = table["columns"]
        if not columns:
            problems.append(f"invalid expectation: `{table_name}` has no columns")
            continue
        if table_name not in live:
            problems.append(f"missing table `{table_name}`")
            continue
        live_columns = live[table_name]
        expected_columns = {column["name"]: column["type"] for column in columns}
        for name, kind in expected_columns.items():
            if name not in live_columns:
                problems.append(f"missing column `{table_name}`.`{name}`")
            elif canonical_type(live_columns[name]) != canonical_type(kind):
                problems.append(f"type drift `{table_name}`.`{name}`: expected {kind}, found {live_columns[name]}")
        for name in live_columns:
            if name not in expected_columns:
                problems.append(f"unexpected column `{table_name}`.`{name}`")
    infrastructure = {"schema_migrations", "_smoke"}
    for table_name in live:
        if table_name not in tables and table_name not in infrastructure:
            problems.append(f"unexpected table `{table_name}` in the database")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Verify the live schema")
    parser.add_argument("--expected", default=str(EXPECTED))
    parser.add_argument("--url-env", default="TIDB_READONLY_URL", help="environment variable holding a read-only database URL")
    args = parser.parse_args(argv)

    expected = json.loads(Path(args.expected).read_text(encoding="utf-8"))
    url = os.environ.get(args.url_env)
    if not url:
        raise SystemExit(f"{args.url_env} is not set")
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
    print(f"verify-schema: {expected['table_count']} tables and column types match; indexes, constraints and other properties are not checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
