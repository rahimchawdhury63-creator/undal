"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Read-only operational diagnostics for audit links, orphan rows and retention candidates.
Legacy audit payloads are not reconstructible reliably. An audit link diagnostic cannot
certify integrity and always exits nonzero until a reviewed, versioned verifier exists.
Retention deletion is disabled; candidate counts do not delete rows.
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
    """Legacy fixture helper, not a proven cross-language canonical serializer."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_input(entry: dict) -> str:
    """Legacy fixture helper; stored rows do not preserve every original input."""
    before = entry.get("before")
    after = entry.get("after")
    return SEPARATOR.join(
        [
            str(entry["seq"]),
            entry["occurredAt"],
            entry.get("actorId") or "",
            entry["actorType"],
            entry.get("actorRole") or "",
            entry.get("ip") or "",
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


def _audit_sequence(value: object) -> int:
    """Reject malformed or JavaScript-unsafe sequence values."""
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.fullmatch(r"[1-9][0-9]*", str(value)):
        raise ValueError("invalid audit sequence")
    result = int(value)
    if result >= 9_007_199_254_740_991:
        raise ValueError("audit sequence outside supported range")
    return result


def _audit_hash(value: object, nullable: bool) -> bytes | None:
    if value is None and nullable:
        return None
    if not isinstance(value, (bytes, bytearray, memoryview)) or len(value) != 32:
        raise ValueError("invalid audit hash")
    return bytes(value)


def audit_chain(connection) -> dict[str, object]:
    """Inspect sequence and stored links only; payload integrity remains unverified."""
    cursor_seq = 1
    previous: bytes | None = None
    rows_seen = 0
    last_seq: int | None = None
    broken: list[dict[str, object]] = []
    while True:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT `seq`, `prev_hash`, `hash` FROM `audit_log` "
                "WHERE `seq` >= %s ORDER BY `seq` ASC LIMIT %s", (cursor_seq, BATCH),
            )
            page = cursor.fetchall()
        if len(page) > BATCH:
            raise ValueError("audit page exceeds requested limit")
        if not page:
            break
        for raw_seq, raw_prev, raw_hash in page:
            seq = _audit_sequence(raw_seq)
            if seq < cursor_seq:
                raise ValueError("audit rows are not strictly increasing")
            if seq != cursor_seq:
                broken.append({"seq": seq, "expected": str(cursor_seq), "actual": str(seq), "reason": "SEQUENCE"})
            prev = _audit_hash(raw_prev, True)
            current = _audit_hash(raw_hash, False)
            if previous is not None and prev != previous:
                broken.append({"seq": seq, "expected": previous.hex(), "actual": prev.hex() if prev is not None else "null", "reason": "LINK"})
            elif rows_seen == 0 and seq == 1 and prev is not None:
                broken.append({"seq": seq, "expected": "null", "actual": prev.hex(), "reason": "LINK"})
            previous = current
            last_seq = seq
            rows_seen += 1
            cursor_seq = seq + 1
        if len(page) < BATCH:
            break
    return {"status": "BREAK" if broken else "INCOMPLETE", "rows": rows_seen, "last_seq": last_seq,
            "broken": broken, "payloads_verified": False, "last_hash_hex": previous.hex() if previous else None}


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
    """Count bounded candidates; destructive retention is disabled until policy review."""
    if apply:
        raise RuntimeError("retention deletion is disabled pending policy and safety review")
    candidates: dict[str, int] = {}
    for table, window in RETENTION:
        if not isinstance(window, int):
            candidates[table] = 0
            continue
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT COUNT(*) FROM (SELECT 1 FROM `{table}` "
                f"WHERE `created_at` < NOW() - INTERVAL %s DAY LIMIT {BATCH}) AS candidates",
                (window,),
            )
            candidates[table] = int(cursor.fetchone()[0])
    return candidates


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
            # A link-only walk is always incomplete, even when no structural break appears.
            failed = True
        elif args.command == "orphans":
            report = orphans(connection)
            failed = any(count > 0 for count in report.values())  # type: ignore[union-attr]
        else:
            # Always read-only, including scheduled runs and invocations without --dry-run.
            report = retention(connection, apply=False)
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
