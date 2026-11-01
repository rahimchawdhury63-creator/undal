"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The integer geospatial layer agrees with the reference geometry.

Undal stores coordinates as `lat_e7`/`lon_e7` integers and answers "is this
address deliverable" with haversine distance and ray-casting in the Worker. Both
are approximations, and both are load-bearing: a 90-metre error is the
difference between a delivery fee and a refusal. The parity job compares the
implementation against point-in-polygon computed a second way and this rule
refuses any mismatch.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "geo" / "parity.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for mismatch in document.get("mismatches", []):
        findings.append(
            Finding(
                "geo-parity",
                rel,
                0,
                f"{mismatch.get('case')}: expected {mismatch.get('expected')}, got {mismatch.get('actual')}",
            )
        )
    return findings
