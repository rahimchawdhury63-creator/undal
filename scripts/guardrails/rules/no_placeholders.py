"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No placeholders may ship. Every marker below is a promise somebody made to
themselves and did not keep; in a cash-handling system the promise is the
feature, so the marker is a build failure.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, SOURCE_EXTS, is_test_path, relative, rel_is_guardrails, walk

PATTERNS = (
    (re.compile(r"\bTODO\b"), "unfinished-work marker"),
    (re.compile(r"\bFIXME\b"), "known-broken marker"),
    (re.compile(r"\bXXX\b"), "unresolved marker"),
    (re.compile(r"lorem ipsum", re.I), "lorem ipsum filler"),
    (re.compile(r"coming soon", re.I), "future-promise copy"),
    (re.compile(r"not implemented", re.I), "unimplemented branch"),
    (re.compile(r"\bplaceholder\b", re.I), "placeholder value"),
    (re.compile(r"\bdummy\b", re.I), "dummy data"),
)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, SOURCE_EXTS):
        rel = relative(path, root)
        if rel_is_guardrails(rel) or is_test_path(rel):
            # Tests are not shipped, and a test that asserts the registry contains
            # no TODO must be allowed to spell the word it is looking for.
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), start=1):
            for pattern, why in PATTERNS:
                if pattern.search(line):
                    findings.append(Finding("no-placeholders", rel, number, f"{why}: {line.strip()[:80]}"))
    return findings
