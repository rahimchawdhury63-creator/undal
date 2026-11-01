"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No file over 700 lines; a warning from 600.

The cap is not about taste. A 700-line Kotlin screen cannot be exercised at 50
breakpoints on a mid-range phone without the build slowing to the point where
people stop running it, and a 900-line Worker module cannot be read in one
sitting by the person on call. Markdown is exempt: the specification corpus is
one document per subject, and splitting `06-data-model-tidb.md` at line 700
would separate a table from the paragraph that explains it.
"""

from __future__ import annotations

from pathlib import Path

from lib import Finding, HEADER_EXTS, relative, rel_is_generated, walk

HARD_LIMIT = 700
WARN_LIMIT = 600


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, HEADER_EXTS):
        rel = relative(path, root)
        if rel_is_generated(rel):
            continue
        count = len(path.read_text(encoding="utf-8", errors="replace").splitlines())
        if count > HARD_LIMIT:
            findings.append(Finding("line-budget", rel, count, f"{count} lines exceeds the {HARD_LIMIT}-line cap"))
        elif count > WARN_LIMIT:
            findings.append(
                Finding("line-budget", rel, count, f"{count} lines is over the {WARN_LIMIT}-line warning", "warn")
            )
    return findings
