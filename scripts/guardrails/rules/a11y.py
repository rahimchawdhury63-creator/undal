"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No serious or critical accessibility violation on any route or screen.

Accessibility is a correctness property here: the customer app is used outdoors,
one-handed, by people with varying eyesight, and a screen reader label is often
the only text on an icon-only control. The axe run writes its report; this rule
refuses any `serious` or `critical` impact.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read

BLOCKING = frozenset({"serious", "critical"})


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "a11y" / "report.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for page in document.get("pages", []):
        for violation in page.get("violations", []):
            if violation.get("impact") in BLOCKING:
                findings.append(
                    Finding(
                        "a11y",
                        rel,
                        0,
                        f"{page.get('route')}: {violation.get('id')} ({violation.get('impact')})",
                    )
                )
    return findings
