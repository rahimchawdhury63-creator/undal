"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

A pre-rendered route contains its content with JavaScript disabled.

The storefront is SEO-first: every public route ships HTML that a crawler can
read. If the pre-render silently falls back to the SPA shell, the page still
renders in a browser and is invisible to Google — the failure mode this rule
exists to make loud.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "prerender" / "report.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for route in document.get("routes", []):
        if not route.get("has_content_without_js"):
            findings.append(
                Finding("prerender-verify", rel, 0, f"{route.get('route')} renders an empty shell without JavaScript")
            )
    return findings
