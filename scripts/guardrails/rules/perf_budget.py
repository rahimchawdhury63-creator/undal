"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Startup time, frame time and bundle size stay inside their budgets.

The Android apps are used by riders on 2 GB phones in traffic; a 3 MB bundle and
a 4-second cold start are not regressions in a chart, they are riders going
offline. The measurement job writes the numbers, this rule refuses them.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "perf" / "budgets.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for entry in document.get("metrics", []):
        value = entry.get("value")
        budget = entry.get("budget")
        if value is None or budget is None:
            findings.append(Finding("perf-budget", rel, 0, f"metric lacks value or budget: {entry}"))
            continue
        if value > budget:
            findings.append(
                Finding("perf-budget", rel, 0, f"{entry.get('metric')} is {value} {entry.get('unit', '')}, budget {budget}")
            )
    return findings
