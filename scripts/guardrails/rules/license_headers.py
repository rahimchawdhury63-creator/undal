"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every source file carries the licence header.

The licence (PASVL-1.0) lets anyone read the source and requires a licence to
deploy it. That only means something if a file, once copied out of the
repository, still says so — hence a header on each file rather than a single
LICENSE at the root.
"""

from __future__ import annotations

from pathlib import Path

from lib import Finding, HEADER_EXTS, LICENCE_MARKER, relative, rel_is_generated, walk

HEADER_WINDOW = 400


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, HEADER_EXTS):
        rel = relative(path, root)
        if rel_is_generated(rel):
            continue
        head = path.read_text(encoding="utf-8", errors="replace")[:HEADER_WINDOW]
        if LICENCE_MARKER not in head:
            findings.append(
                Finding("license-headers", rel, 1, f"missing '{LICENCE_MARKER}' in the first {HEADER_WINDOW} characters")
            )
    return findings
