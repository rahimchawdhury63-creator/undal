"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Feature modules use tokens, never raw values.

A hard-coded `#1B5E20` in one screen and a token in another is how a brand
becomes four greens. The tokens are generated from `tokens.json`, so changing the
brand is one file and a build — but only if nothing has bypassed it.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, is_test_path, read, relative, walk

HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RAW_DURATION = re.compile(r"\b(?:transition|animation)[^;\n]*:\s*[^;\n]*\b\d+(?:\.\d+)?m?s\b")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".css", ".tsx", ".ts"}):
        rel = relative(path, root)
        if is_test_path(rel) or "/features/" not in rel:
            continue
        for number, line in enumerate(read(path).splitlines(), start=1):
            if HEX.search(line):
                findings.append(Finding("token-purity", rel, number, f"hard-coded colour: {line.strip()[:80]}"))
            elif RAW_DURATION.search(line):
                findings.append(Finding("token-purity", rel, number, f"hard-coded duration: {line.strip()[:80]}"))
    return findings
