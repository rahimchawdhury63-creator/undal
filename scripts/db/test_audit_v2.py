"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Independent reference tests for the proposed, not-yet-deployed audit v2 format.
"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

import audit_v2

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "db" / "fixtures" / "audit_v2_vectors.json").read_text(encoding="utf-8"))["vectors"]


def record_of(vector: dict) -> dict:
    record = copy.deepcopy(vector["record"])
    for key in ("id", "actorId", "ip", "requestId", "subjectId"):
        if record[key] is not None:
            record[key] = bytes.fromhex(record[key])
    return record


class AuditV2Test(unittest.TestCase):
    def test_payload_and_hash_vectors(self) -> None:
        for vector in VECTORS:
            with self.subTest(vector=vector["name"]):
                record = record_of(vector)
                previous = None if vector["previousHex"] is None else bytes.fromhex(vector["previousHex"])
                self.assertEqual(audit_v2.payload(record).hex(), vector["payloadHex"])
                digest, hashed = audit_v2.hashes(record, previous)
                self.assertEqual(digest.hex(), vector["payloadHashHex"])
                self.assertEqual(hashed.hex(), vector["hashHex"])
        self.assertEqual(VECTORS[1]["previousHex"], VECTORS[0]["hashHex"])

    def test_byte_order_and_unambiguous_framing(self) -> None:
        left = {"𐀀": 1, "\ue000": 2, "a": "x"}
        right = {"a": "x", "\ue000": 2, "𐀀": 1}
        self.assertEqual(audit_v2.encode_value(left), audit_v2.encode_value(right))
        text = audit_v2.encode_value(left).decode("utf-8")
        self.assertLess(text.index("\ue000"), text.index("𐀀"))
        values = [None, False, True, 0, "0", [1, 2], [2, 1], {"a": "bc"}, {"ab": "c"}, "a\x1fb", ["a", "b"]]
        self.assertEqual(len({audit_v2.encode_value(value) for value in values}), len(values))

    def test_invalid_values_are_not_silently_coerced(self) -> None:
        cycle = []
        cycle.append(cycle)
        nested = None
        for _ in range(18):
            nested = [nested]
        for value in (1.5, -0.0, float("nan"), 9_007_199_254_740_992, b"raw", "\ud800", "x" * 8193,
                      [0] * 2049, cycle, nested, ["x" * 8192] * 10, {1: "non-string key"}):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                audit_v2.encode_value(value)
        child = {"a": 1}
        self.assertTrue(audit_v2.encode_value([child, child]))

    def test_invalid_record_fields_and_links(self) -> None:
        base = record_of(VECTORS[0])
        changes = ({"id": bytes(15)}, {"actorId": bytes(3)}, {"ip": bytes(5)}, {"seq": 0}, {"seq": True},
                   {"occurredAt": "2026-02-29 00:00:00.000000"}, {"actorType": []}, {"severity": "bad"},
                   {"action": "x" * 65}, {"userAgent": "x" * 513}, {"after": 1.5})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                audit_v2.payload({**base, **change})
        with self.assertRaises(ValueError):
            audit_v2.payload({**base, "extra": 1})
        with self.assertRaises(ValueError):
            audit_v2.hashes(base, bytes(32))
        with self.assertRaises(ValueError):
            audit_v2.hashes({**base, "seq": 2}, None)
        with self.assertRaises(ValueError):
            audit_v2.hashes({**base, "seq": 2}, bytes(31))


if __name__ == "__main__":
    unittest.main()
