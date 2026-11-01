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


SEPARATOR = "\u001f"


def canonical_json(value: object) -> str:
    """JSON with sorted keys and no spaces: the form `audit/chain.ts` hashes."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_input(entry: dict) -> str:
    """The fields the chain commits to, in the order both implementations agree on."""
    before = entry.get("before")
    after = entry.get("after")
    return SEPARATOR.join(
        [
            str(entry["seq"]),
            entry["occurredAt"],
            entry.get("actorId") or "",
            entry["actorType"],
            entry.get("actorRole") or "",
            "",  # ip: not part of the digest, kept for symmetry with the TypeScript builder
            entry["requestId"],
            entry["action"],
            entry["resourceType"],
            entry.get("resourceId") or "",
            entry.get("subjectId") or "",
            canonical_json(before) if before is not None else "",
            canonical_json(after) if after is not None else "",
            entry.get("reason") or "",
            entry["severity"],
        ]
    )


def audit_chain(connection) -> dict[str, object]:
    """Recompute the whole chain; the first break is reported with its sequence.

    The digest is recomputed from the row's own fields rather than read from a column:
    a stored digest proves only that somebody wrote the column, while a recomputed one
    proves the row has not changed since it was chained.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT `seq`, `occurred_at`, `actor_id`, `actor_type`, `actor_role`, `request_id`, `action`, "
            "`resource_type`, `resource_id`, `subject_id`, `before`, `after`, `reason`, `severity`, "
            "`prev_hash`, `hash` FROM `audit_log` ORDER BY `seq` ASC"
        )
        rows = cursor.fetchall()

    previous = b"\x00" * 32
    broken: list[dict[str, object]] = []
    for row in rows:
        (seq, occurred_at, actor_id, actor_type, actor_role, request_id, action, resource_type,
         resource_id, subject_id, before, after, reason, severity, prev_hash, row_hash) = row
        entry = {
            "seq": int(seq),
            "occurredAt": str(occurred_at),
            "actorId": _hex_uuid(actor_id),
            "actorType": str(actor_type),
            "actorRole": actor_role,
            "requestId": _hex_uuid(request_id),
            "action": str(action),
            "resourceType": str(resource_type),
            "resourceId": resource_id,
            "subjectId": _hex_uuid(subject_id),
            "before": _json_value(before),
            "after": _json_value(after),
            "reason": reason,
            "severity": str(severity),
        }
        digest = hashlib.sha256(digest_input(entry).encode("utf-8")).digest()
        expected = hashlib.sha256(previous + digest).hexdigest()
        stored_prev = bytes(prev_hash) if prev_hash is not None else b"\x00" * 32
        if stored_prev != previous or bytes(row_hash).hex() != expected:
            broken.append({"seq": int(seq), "expected": expected, "actual": bytes(row_hash).hex()})
        previous = bytes(row_hash)
    return {"rows": len(rows), "broken": broken}


def _hex_uuid(value: object) -> str | None:
    """The 16 stored bytes as the dashed UUID string the digest writes."""
    if value is None:
        return None
    raw = bytes(value).hex()
    return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"


def _json_value(value: object) -> object:
    """A JSON column as the value the app wrote, whether the driver parsed it or not."""
    if value is None or not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


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
