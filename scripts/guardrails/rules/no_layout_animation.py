"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Animations move `transform` and `opacity`, never layout.

Animating width, height, top or margin forces a re-layout on every frame, which
on the mid-range Android phones this product targets is the difference between a
60 fps sheet and a stuttering one. Three exemptions are documented in
`02 §11`; each is marked inline with `layout-animation-exempt:` and the reason.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, walk

LAYOUT_PROPERTY = re.compile(r"\b(width|height|top|bottom|left|right|margin|padding)\b")
TRANSITION_OR_KEYFRAME = re.compile(r"\b(transition|animation)\b|@keyframes|animate\(")
EXEMPT = re.compile(r"layout-animation-exempt:\s*\S")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".css", ".tsx", ".ts"}):
        rel = relative(path, root)
        lines = read(path).splitlines()
        for index, line in enumerate(lines, start=1):
            if not TRANSITION_OR_KEYFRAME.search(line) or not LAYOUT_PROPERTY.search(line):
                continue
            context = "\n".join(lines[max(0, index - 2) : index + 1])
            if EXEMPT.search(context):
                continue
            findings.append(
                Finding("no-layout-animation", rel, index, f"animation drives a layout property: {line.strip()[:80]}")
            )
    return findings
