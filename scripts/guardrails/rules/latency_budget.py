"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every endpoint keeps the latency budget the contract published.

A p95 that drifts from 180 ms to 400 ms is invisible in review and obvious to a
rider waiting for an offer, so the benchmark writes its measurements to an
artifact and this rule compares each one against the budget declared beside it.
`10 §14` and `08 §1` own the numbers; this file owns nothing.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "bench" / "latency.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for entry in document.get("endpoints", []):
        measured = entry.get("p95_ms")
        budget = entry.get("budget_ms")
        if measured is None or budget is None:
            findings.append(Finding("latency-budget", rel, 0, f"entry lacks p95 or budget: {entry}"))
            continue
        if measured > budget:
            findings.append(
                Finding("latency-budget", rel, 0, f"{entry.get('endpoint')} p95 {measured} ms exceeds {budget} ms")
            )
    return findings
