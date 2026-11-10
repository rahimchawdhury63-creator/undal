"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Cross-language link diagnostic vectors and fail-closed behavior.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import housekeeping
import migrate

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "db" / "fixtures" / "audit_link_vectors.json").read_text(encoding="utf-8"))


class Cursor:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows
        self.filtered: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, sql, params=None):
        if not sql.startswith("SELECT `seq`, `prev_hash`, `hash`"):
            raise AssertionError("unexpected statement")
        self.filtered = [row for row in self.rows if int(row[0]) >= params[0]][:params[1]]

    def fetchall(self):
        return self.filtered


class Connection:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows
        self.closed = False

    def cursor(self):
        return Cursor(self.rows)

    def close(self):
        self.closed = True


def decode(row: dict) -> tuple:
    return (row["seq"], None if row["prev"] is None else bytes.fromhex(row["prev"]), bytes.fromhex(row["hash"]))


class AuditLinkDiagnosticTest(unittest.TestCase):
    def test_shared_vectors_across_paged_reads(self) -> None:
        for case in VECTORS["cases"]:
            with self.subTest(case=case["name"]), patch.object(housekeeping, "BATCH", 1):
                report = housekeeping.audit_chain(Connection([decode(row) for row in case["rows"]]))
                self.assertEqual(report["status"], case["status"])
                self.assertEqual([item["reason"] for item in report["broken"]], case["reasons"])
                self.assertEqual(report["rows"], len(case["rows"]))
                self.assertIs(report["payloads_verified"], False)

    def test_bad_sequence_hashes_and_order_are_errors(self) -> None:
        for value in (0, -1, True, "1.0", "abc", 9_007_199_254_740_991):
            with self.subTest(value=value), self.assertRaises(ValueError):
                housekeeping._audit_sequence(value)
        for value in (None, b"short", "not bytes"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                housekeeping.audit_chain(Connection([(1, None, value)]))
        for rows in ([(2, None, bytes(32)), (1, None, bytes(32))], [(1, None, bytes(32)), (1, None, bytes(32))]):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, "strictly increasing"):
                housekeeping.audit_chain(Connection(rows))

    def test_even_a_clean_or_empty_link_walk_exits_nonzero(self) -> None:
        for rows in ([], [decode(row) for row in VECTORS["cases"][1]["rows"]]):
            connection = Connection(rows)
            with patch.dict(os.environ, {"TIDB_DATABASE_URL": "mysql://test:secret@db.test/test"}), \
                 patch.object(migrate, "connect", return_value=connection), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                status = housekeeping.main(["audit-chain"])
            self.assertEqual(status, 1)
            self.assertTrue(connection.closed)
            report = json.loads(output.getvalue())
            self.assertEqual(report["status"], "INCOMPLETE")
            self.assertIs(report["payloads_verified"], False)

    def test_shared_legacy_digest_includes_ip_when_provided(self) -> None:
        source = json.loads((ROOT / "db" / "fixtures" / "audit_chain_vectors.json").read_text(encoding="utf-8"))
        entry = {**source["vectors"][0]["entry"], "ip": "203.0.113.4"}
        actual = hashlib.sha256(housekeeping.digest_input(entry).encode("utf-8")).hexdigest()
        self.assertEqual(actual, "d4f369fa998390fdc7aa00cdbe437269c6c54434fe03ba8965f8ff384c1c3583")


if __name__ == "__main__":
    unittest.main()
