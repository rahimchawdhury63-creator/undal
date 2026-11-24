"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The integration harness: the schema, the queries and the seed, against a real TiDB.

Everything else in this repository is verified without a database. The migrations are checked for
policy, the Worker's statements are checked for names, the handlers are driven against a stub — and
none of that has ever seen a server decide whether a statement runs. This file is the missing
layer, and it is deliberately the last one to be written, because a harness that cannot be run is
worth less than the checks that can.

Two modes, and the difference between them is the point:

  --self-check   runs here, with no server. Parses every allowlisted query in `db/queries` and every
                 statement in the seed against the schema the migrations produce. It proves the SQL
                 an operator runs by hand names columns that exist — nothing more.
  --run          needs `UNDAL_TEST_DATABASE_URL`. Applies the migrations to that database, then
                 executes every allowlisted query and reports what came back. With no URL it exits
                 1 and says so: a harness that skips quietly is a harness that never runs.

What --run still does not prove, plainly: it does not drive the HTTP surface. Quote, place, accept
and deliver are handler paths, and reaching them needs `wrangler dev` bound to the same database —
a run that has to happen on a machine with a Cloudflare account, not here.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lint_sql  # noqa: E402
import seed_local  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
QUERIES = ROOT / "db" / "queries"
EXPECTED = ROOT / "db" / "expected.json"
URL_ENV = "UNDAL_TEST_DATABASE_URL"


def statements_of(path: Path) -> list[str]:
    """The statements in a `.sql` file, comments removed and semi-colons respected."""
    text = path.read_text(encoding="utf-8")
    body = "\n".join(
        line for line in text.split("\n") if not line.lstrip().startswith("--")
    )
    return [chunk.strip() for chunk in body.split(";") if chunk.strip() != ""]


def self_check() -> int:
    """Parse everything against the schema. No server, no pretence of one."""
    try:
        from sqlglot.schema import MappingSchema
    except ImportError:
        print("integration: sqlglot is not installed (pip install sqlglot)", file=sys.stderr)
        return 1

    schema = lint_sql.schema_of(json.loads(EXPECTED.read_text(encoding="utf-8")))
    mapping = MappingSchema(schema, dialect="mysql")

    checked = 0
    findings = 0

    def inspect(source: str, label: str, statement: str) -> None:
        nonlocal checked, findings
        checked += 1
        try:
            problems = lint_sql.findings_for(statement, schema, mapping)
        except Exception as error:  # noqa: BLE001 — an unparseable statement is a finding
            problems = [f"could not parse: {error}"]
        for problem in problems:
            findings += 1
            print(f"integration: {label}: {problem}", file=sys.stderr)

    files = sorted(QUERIES.glob("*.sql"))
    for path in files:
        for statement in statements_of(path):
            inspect("query", lint_sql.label(path), statement)
    for label, statement in seed_local.STATEMENTS:
        inspect("seed", f"seed: {label}", statement)

    print(
        f"integration: self-check over {len(files)} queries and {len(seed_local.STATEMENTS)} seed "
        f"statements — {checked} checked, {findings} findings (names only; nothing executed)"
    )
    return 1 if findings else 0


def run() -> int:
    """Apply the migrations and execute every allowlisted query against a real database."""
    url = os.environ.get(URL_ENV, "").strip()
    if url == "":
        print(
            f"integration: {URL_ENV} is not set.\n"
            "integration: this harness applies migrations to a real TiDB and runs every allowlisted\n"
            "integration: query against it. It needs a database; it will not pretend to have one.\n"
            "integration: set the variable to a TiDB/mysql URL, or run --self-check for the offline half.",
            file=sys.stderr,
        )
        return 1

    applied = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "db" / "migrate.py"), "--url-env", URL_ENV],
        cwd=ROOT,
        check=False,
    )
    if applied.returncode != 0:
        print("integration: migrations failed; nothing after this point means anything", file=sys.stderr)
        return 1

    try:
        import pymysql
    except ImportError:
        print("integration: PyMySQL is not installed (pip install -r db/requirements.txt)", file=sys.stderr)
        return 1

    from urllib.parse import unquote, urlparse

    parsed = urlparse(url)
    connection = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 4000,
        user=unquote(parsed.username or "root"),
        password=unquote(parsed.password or ""),
        database=(parsed.path or "/test").lstrip("/"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )

    try:
        with connection.cursor() as cursor:
            for label, statement in seed_local.STATEMENTS:
                cursor.execute(statement)
                print(f"  ok   seed: {label}")
        connection.commit()
    except Exception as error:  # noqa: BLE001 — a seed that fails is the finding
        print(f"integration: seed failed: {error}", file=sys.stderr)
        connection.close()
        return 1

    failures = 0
    with connection.cursor() as cursor:
        for path in sorted(QUERIES.glob("*.sql")):
            for statement in statements_of(path):
                try:
                    cursor.execute(statement)
                    rows = cursor.fetchall()
                    print(f"  ok   {path.name:<38} {len(rows):>5} row(s)")
                except Exception as error:  # noqa: BLE001 — a query that fails is the finding
                    failures += 1
                    print(f"  FAIL {path.name:<38} {str(error)[:90]}", file=sys.stderr)
    connection.close()

    print(f"integration: {len(list(QUERIES.glob('*.sql')))} queries, {failures} failed")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the platform against a real database.")
    parser.add_argument("--self-check", action="store_true", help="parse everything, execute nothing")
    parser.add_argument("--run", action="store_true", help=f"apply migrations and run queries ({URL_ENV})")
    arguments = parser.parse_args()
    if arguments.run:
        return run()
    if arguments.self_check:
        return self_check()
    parser.error("choose --self-check or --run")


if __name__ == "__main__":
    raise SystemExit(main())
