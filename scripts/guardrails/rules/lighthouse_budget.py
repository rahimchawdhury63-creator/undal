"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every Lighthouse category stays at or above 95.

Mobile-first, on a throttled 4G profile: a storefront that scores 82 on
performance is a storefront where a customer on Sylhet's mobile network waits
four seconds for a menu. The audit runs in Actions and this rule reads its
summary.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read

FLOOR = 95


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "lighthouse" / "summary.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for route in document.get("routes", []):
        for category, score in (route.get("categories") or {}).items():
            if score < FLOOR:
                findings.append(
                    Finding("lighthouse-budget", rel, 0, f"{route.get('route')} {category} score {score} is below {FLOOR}")
                )
    return findings
