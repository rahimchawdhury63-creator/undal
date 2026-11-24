"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The Brain's envelope shape, tested without a Worker runtime.

`workers` is a Pyodide module that only exists inside the Worker, so the test
stubs it: what matters here is that the body the Brain emits is the same envelope
shape every other Worker emits, because the Android clients parse both.
"""

from __future__ import annotations

import json
import sys
import types
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

stub = types.ModuleType("workers")


class _Response:
    """A minimal stand-in for the runtime's Response, capturing body and status."""

    def __init__(self, body: str, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.body = body
        self.status = status
        self.headers = headers or {}


stub.Response = _Response
sys.modules.setdefault("workers", stub)

import worker  # noqa: E402


class HealthTest(unittest.TestCase):
    def test_health_envelope_names_the_worker_and_version(self) -> None:
        payload = worker.health_payload("1.2.3", "https://api.undal.app")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["worker"], "undal-brain")
        self.assertEqual(payload["data"]["engineVersion"], "1.2.3")

    def test_unserved_path_is_the_standard_failure_envelope(self) -> None:
        body = worker.not_served("/brain/forecast")
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "NOT_IMPLEMENTED")
        self.assertEqual(body["error"]["details"]["path"], "/brain/forecast")
        self.assertIn("meta", body)

    def test_body_serialises_to_json(self) -> None:
        text = json.dumps(worker.not_served("/x"))
        self.assertEqual(json.loads(text)["error"]["code"], "NOT_IMPLEMENTED")


if __name__ == "__main__":
    unittest.main()
