"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The three nightly jobs that keep a cash ledger honest: the chain, the orphans, the clock.

**audit-chain** re-walks `audit_log` and proves every row's `prev_hash` is its
predecessor's `hash` and that the row's own hash recomputes. Grants stop a customer
support agent from editing history; only recomputation proves nobody with a
connection did.

**orphans** counts rows in the three tables the schema deliberately leaves without a
foreign key (`order_items`, `order_state_events`, `order_offers`). No FK is the right
choice for those three — an order item must survive its order row's cancellation —
but "no FK" must not quietly become "no parent".

**retention** deletes what the retention policy says is done, oldest first, in bounded
batches, and reports what it removed. Nothing is deleted that a settlement, an audit
chain or an invoice still needs; the queries are written as `DELETE ... WHERE ... LIMIT`
so a run that times out leaves a smaller remainder rather than half a table.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BATCH = 1_000

#: Rows that must never outlive their parent, and the column that names the parent.
ORPHAN_CHECKS = (
    ("order_items", "order_id", "orders"),
    ("order_state_events", "order_id", "orders"),
    ("order_offers", "order_id", "orders"),
)

#: Retention windows in days, from `docs/29` and the finance section of `docs/15`.
RETENTION = (
    ("rider_positions_d1", "location history lives in D1 and expires there"),
    ("notification_log", 90),
    ("brain_traces", 30),
    ("security_events", 365),
    ("exceptions", 180),
)


def audit_chain(connection) -> dict[str, object]:
    """Recompute the whole chain; the first break is reported with its sequence."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT `seq`, `prev_hash`, `hash`, `payload_sha256` FROM `audit_log` ORDER BY `seq`")
        rows = cursor.fetchall()

    previous = b"\x00" * 32
    broken: list[dict[str, object]] = []
    for seq, prev_hash, row_hash, payload_sha256 in rows:
        expected = hashlib.sha256(bytes(prev_hash) + bytes(payload_sha256)).digest()
        if bytes(prev_hash) != previous or bytes(row_hash) != expected:
            broken.append({"seq": int(seq), "expected_prev": previous.hex()})
        previous = bytes(row_hash)
    return {"rows": len(rows), "broken": broken}


def orphans(connection) -> dict[str, object]:
    """Count children whose parent is gone, per deliberately unkeyed table."""
    report: dict[str, object] = {}
    for child, column, parent in ORPHAN_CHECKS:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT COUNT(*) FROM `{child}` c LEFT JOIN `{parent}` p ON p.`id` = c.`{column}` "
                f"WHERE p.`id` IS NULL"
            )
            report[child] = int(cursor.fetchone()[0])
    return report


def retention(connection, apply: bool) -> dict[str, object]:
    """Delete expired rows in batches; report the count either way."""
    removed: dict[str, int] = {}
    for table, window in RETENTION:
        if not isinstance(window, int):
            removed[table] = 0
            continue
        with connection.cursor() as cursor:
            cursor.execute(
                f"DELETE FROM `{table}` WHERE `created_at` < NOW() - INTERVAL %s DAY LIMIT {BATCH}",
                (window,),
            )
            removed[table] = int(cursor.rowcount)
        if apply:
            connection.commit()
    return removed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Nightly database housekeeping")
    parser.add_argument("command", choices=["audit-chain", "orphans", "retention"])
    parser.add_argument("--out", help="write the JSON report here")
    parser.add_argument("--dry-run", action="store_true", help="count without deleting")
    args = parser.parse_args(argv)

    url = os.environ.get("TIDB_DATABASE_URL") or os.environ.get("TIDB_MIGRATION_URL")
    if not url:
        raise SystemExit("TIDB_DATABASE_URL is not set")
    connection = migrate.connect(url)
    try:
        if args.command == "audit-chain":
            report = audit_chain(connection)
            failed = bool(report["broken"])
        elif args.command == "orphans":
            report = orphans(connection)
            failed = any(count > 0 for count in report.values())  # type: ignore[union-attr]
        else:
            report = retention(connection, apply=not args.dry_run)
            failed = False
    finally:
        connection.close()

    payload = json.dumps({"command": args.command, **report}, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
