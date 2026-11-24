"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Regression tests for the final housekeeping workflow outcome gate.
"""

from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts" / "db" / "check_housekeeping_outcomes.sh"
OUTCOMES = ("DRIVER_OUTCOME", "AUDIT_CHAIN_OUTCOME", "ORPHANS_OUTCOME", "RETENTION_OUTCOME")


class HousekeepingWorkflowOutcomeTest(unittest.TestCase):
    def run_checker(self, overrides: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update({name: "success" for name in OUTCOMES})
        environment.update(overrides or {})
        return subprocess.run(
            ["bash", str(CHECKER)],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )

    def test_all_successful_steps_produce_a_successful_job_gate(self) -> None:
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_every_failed_or_skipped_step_fails_the_job_gate(self) -> None:
        for name in OUTCOMES:
            for outcome in ("failure", "skipped"):
                with self.subTest(name=name, outcome=outcome):
                    result = self.run_checker({name: outcome})
                    self.assertEqual(result.returncode, 1)
                    if name == "AUDIT_CHAIN_OUTCOME":
                        self.assertIn("Audit chain remains incomplete", result.stdout)


if __name__ == "__main__":
    unittest.main()
