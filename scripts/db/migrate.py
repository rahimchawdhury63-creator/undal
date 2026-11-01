"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Apply forward-only migrations, one statement at a time, with a resumable ledger.

TiDB auto-commits DDL, so there is no rollback: the only recovery from a failure
halfway through a file is to fix the statement and re-run, which is why every
statement is idempotent and why the ledger records *statement indices* rather
than whole files. A file whose checksum changed after any of its statements were
applied is refused outright — that is the difference between a migration system
and a suggestion.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlsplit import migration_files, read_migration  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LEDGER = "schema_migrations"


@dataclass
class Plan:
    """What the run intends to do, so `--dry-run` can print exactly the same thing."""

    version: str
    statement_index: int
    statement: str
    checksum: bytes
    reason: str


def _checksum_bytes(checksum_hex: str) -> bytes:
    return bytes.fromhex(checksum_hex)


def build_plan(
    directory: Path,
    applied: dict[str, dict[int, bytes]],
    dry_run: bool,
) -> list[Plan]:
    """Work out which statements still need to run, and refuse a tampered file."""
    plan: list[Plan] = []
    for path in migration_files(directory):
        version = path.stem
        checksum_hex, statements = read_migration(path)
        checksum = _checksum_bytes(checksum_hex)
        done = applied.get(version, {})

        for index, recorded in done.items():
            if recorded != checksum:
                raise SystemExit(
                    f"{path.name}: statement {index} was applied with a different checksum. "
                    "Migrations are immutable once applied — add a new file instead."
                )

        for index, statement in enumerate(statements, start=1):
            if index in done:
                continue
            plan.append(Plan(version, index, statement, checksum, "pending"))
    if dry_run:
        return plan
    return plan


def record(connection: Any, plan: Plan, applied_by: str) -> None:
    """Add one statement to the ledger, in the same breath as running it."""
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO `{LEDGER}` (`version`, `statement_index`, `checksum`, `applied_by`) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE `checksum` = VALUES(`checksum`)",
            (plan.version, plan.statement_index, plan.checksum, applied_by),
        )


def apply(connection: Any, plan: Iterable[Plan], applied_by: str, connection_pin: bool = True) -> int:
    """Execute the plan; every statement gets its own ledger row.

    The `time_zone` pin is set on the connection rather than assumed: a session
    that inherits the server's zone silently writes Dhaka wall-clock times into
    `DATETIME(6)` columns that the whole platform reads as UTC.
    """
    count = 0
    with connection.cursor() as cursor:
        if connection_pin:
            cursor.execute("SET time_zone = '+00:00'")
    for step in plan:
        with connection.cursor() as cursor:
            cursor.execute(step.statement)
        record(connection, step, applied_by)
        connection.commit()
        count += 1
    return count


def read_ledger(connection: Any) -> dict[str, dict[int, bytes]]:
    """The applied statements, or an empty map when the ledger does not exist yet."""
    applied: dict[str, dict[int, bytes]] = {}
    with connection.cursor() as cursor:
        try:
            cursor.execute(f"SELECT `version`, `statement_index`, `checksum` FROM `{LEDGER}`")
        except Exception:  # noqa: BLE001 — the ledger is created by 000_smoke.sql
            return applied
        for version, index, checksum in cursor.fetchall():
            applied.setdefault(str(version), {})[int(index)] = bytes(checksum)
    return applied


def connect(url: str) -> Any:
    """Open a MySQL-protocol connection to TiDB Cloud Starter."""
    import pymysql  # imported here so `--dry-run` needs no driver

    from urllib.parse import unquote, urlparse

    parsed = urlparse(url)
    if parsed.scheme not in {"mysql", "tidb"}:
        raise SystemExit(f"unsupported database URL scheme: {parsed.scheme}")
    return pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 4000,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=(parsed.path or "/").lstrip("/") or None,
        autocommit=False,
        charset="utf8mb4",
        ssl={"ca": None},
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Apply Undal migrations")
    parser.add_argument("--dir", default=str(ROOT / "db" / "migrations"))
    parser.add_argument("--ledger", default=LEDGER)
    parser.add_argument("--url-env", default="TIDB_MIGRATION_URL")
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("DRY_RUN") == "true")
    args = parser.parse_args(argv)

    directory = Path(args.dir)
    applied_by = os.environ.get("GITHUB_SERVER_URL", "") + "/" + os.environ.get("GITHUB_RUN_ID", "local")

    if args.dry_run:
        plan = build_plan(directory, {}, dry_run=True)
        for step in plan:
            print(f"-- {step.version} #{step.statement_index}\n{step.statement[:200]};")
        print(f"dry run: {len(plan)} statements would run")
        return 0

    url = os.environ.get(args.url_env)
    if not url:
        raise SystemExit(f"{args.url_env} is not set")
    connection = connect(url)
    try:
        applied = read_ledger(connection)
        plan = build_plan(directory, applied, dry_run=False)
        if not plan:
            print("nothing to apply")
            return 0
        count = apply(connection, plan, applied_by)
        print(f"applied {count} statements across {len(migration_files(directory))} files")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
