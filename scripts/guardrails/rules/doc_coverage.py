"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every exported TypeScript symbol carries a doc comment.

The comment requirement is "why, not what" — and the only mechanical part of
that is presence. Presence is enough to change behaviour: an author who has to
write a sentence about why a function exists usually discovers it should not.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, is_test_path, relative, rel_is_generated, walk

DECLARATION = re.compile(
    r"^export\s+(?:async\s+)?(?:declare\s+)?(?:const|let|function|class|interface|type|enum|abstract class)\s+([A-Za-z0-9_$]+)"
)
LOOKBACK = 12


def _has_doc_above(lines: list[str], index: int) -> bool:
    """True when a `/** ... */` block that is not the licence header sits above."""
    window = [candidate for candidate in lines[max(0, index - LOOKBACK) : index]]
    for position in range(len(window) - 1, -1, -1):
        if window[position].strip().endswith("*/"):
            start = position
            while start >= 0 and "/**" not in window[start] and "/*" not in window[start]:
                start -= 1
            block = "\n".join(window[start : position + 1])
            if "Licensed under PASVL-1.0" in block or "SPDX-License-Identifier" in block:
                return False
            return True
        if window[position].strip() and not window[position].strip().startswith(("*", "//")):
            return False
    return False


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".ts", ".tsx"}):
        rel = relative(path, root)
        if is_test_path(rel) or rel_is_generated(rel):
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for index, line in enumerate(lines):
            match = DECLARATION.match(line)
            if not match:
                continue
            if not _has_doc_above(lines, index):
                findings.append(
                    Finding("doc-coverage", rel, index + 1, f"exported '{match.group(1)}' has no doc comment")
                )
    return findings
