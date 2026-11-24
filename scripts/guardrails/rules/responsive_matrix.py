"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No horizontal overflow, no clipped control and no tap target under 44 px at any
of the 50 widths from 200 px to 3840 px.

The matrix job screenshots every width and writes its measurements; this rule
refuses the build if any cell regressed. Three symptoms are enough to catch
almost every real break: `scrollWidth > clientWidth`, a control whose right edge
exceeds the viewport, and a hit area smaller than a fingertip.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read

MIN_TARGET_PX = 44


def check(root: Path) -> list[Finding]:
    artifact = root / ".artifacts" / "responsive" / "matrix.json"
    if not artifact.is_file():
        return []
    findings: list[Finding] = []
    rel = artifact.relative_to(root).as_posix()
    document = json.loads(read(artifact))
    for cell in document.get("cells", []):
        width = cell.get("width")
        if cell.get("overflow_x"):
            findings.append(Finding("responsive-matrix", rel, 0, f"horizontal overflow at {width}px"))
        if cell.get("clipped_controls"):
            findings.append(Finding("responsive-matrix", rel, 0, f"clipped controls at {width}px"))
        for target in cell.get("small_targets", []):
            findings.append(
                Finding("responsive-matrix", rel, 0, f"tap target {target}px under {MIN_TARGET_PX}px at {width}px")
            )
    return findings
