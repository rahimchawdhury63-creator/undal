"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No fixed width above 64 px outside the allowlist.

The storefront is tested at 50 widths from 200 px to 3840 px. A fixed 320 px card
is fine on a phone and a horizontal scrollbar on a 200 px split view; the rule
makes that mistake impossible to introduce quietly, while still allowing the
small fixed sizes (icons, taps, borders) where a pixel really is a pixel.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, walk

FIXED = re.compile(r"(?<!min-)(?<!max-)\bwidth\s*:\s*(\d+(?:\.\d+)?)px")
ALLOWLIST = re.compile(r"/\*\s*fixed-width-ok:\s*\S")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".css", ".scss", ".tsx"}):
        rel = relative(path, root)
        lines = read(path).splitlines()
        for index, line in enumerate(lines, start=1):
            match = FIXED.search(line)
            if not match:
                continue
            value = float(match.group(1))
            if value <= 64:
                continue
            if ALLOWLIST.search(line) or (index > 1 and ALLOWLIST.search(lines[index - 2])):
                continue
            findings.append(
                Finding("no-fixed-width", rel, index, f"fixed width {value}px above the 64 px allowance")
            )
    return findings
