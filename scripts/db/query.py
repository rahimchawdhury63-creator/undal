"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Run one allowlisted read-only statement and print it as a Markdown table.

This is the browser-only maintainer's way to look at production data, so the
narrowness is the feature: a single statement, starting with SELECT, no
semicolon-separated second statement, a hard row cap, and a read-only credential
that has no write privilege to exercise in the first place.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402

MAX_ROWS = 200
FORBIDDEN = re.compile(
    r"(?i)\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|LOAD|INTO\s+OUTFILE)\b"
)


def validate(statement: str) -> str:
    """Refuse anything that is not one plain SELECT."""
    text = statement.strip().rstrip(";")
    if not re.match(r"(?is)^\s*(SELECT|WITH)\b", text):
        raise SystemExit("only SELECT statements are allowed")
    if FORBIDDEN.search(text):
        raise SystemExit("the statement contains a write or DDL keyword")
    if ";" in text:
        raise SystemExit("one statement per run")
    return text


def as_markdown(columns: list[str], rows: list[tuple]) -> str:
    """Render rows as a Markdown table for the job summary."""
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    for row in rows:
        lines.append("| " + " | ".join("" if value is None else str(value) for value in row) + " |")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Read-only query")
    parser.add_argument("--statement", required=True)
    parser.add_argument("--max-rows", type=int, default=MAX_ROWS)
    args = parser.parse_args(argv)

    statement = validate(args.statement)
    url = os.environ.get("TIDB_READONLY_URL")
    if not url:
        raise SystemExit("TIDB_READONLY_URL is not set")
    connection = migrate.connect(url)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION MAX_EXECUTION_TIME = 15000")
            cursor.execute(statement)
            columns = [description[0] for description in cursor.description or []]
            rows = cursor.fetchmany(min(args.max_rows, MAX_ROWS))
    finally:
        connection.close()

    print(as_markdown(columns, rows))
    print(f"\n{len(rows)} row(s), capped at {min(args.max_rows, MAX_ROWS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
