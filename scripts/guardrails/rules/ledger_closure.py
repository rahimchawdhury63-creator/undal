"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every posting set in the committed fare vectors sums to zero.

Double-entry is only double-entry if it closes. The vectors under
`packages/pricing/fixtures/` are the arithmetic the platform is tested against,
so they are also the cheapest place to catch a posting that lost a paisa.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read, relative, walk


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, None):
        if path.suffix != ".json" or "postings" not in path.name:
            continue
        rel = relative(path, root)
        try:
            document = json.loads(read(path))
        except json.JSONDecodeError as error:
            findings.append(Finding("ledger-closure", rel, 0, f"unreadable vector: {error}"))
            continue
        vectors = document if isinstance(document, list) else [document]
        for index, vector in enumerate(vectors):
            postings = vector.get("postings") if isinstance(vector, dict) else None
            if not isinstance(postings, list):
                continue
            total = sum(int(posting.get("amount_paisa", 0)) for posting in postings if isinstance(posting, dict))
            if total != 0:
                findings.append(
                    Finding("ledger-closure", rel, index + 1, f"postings sum to {total} paisa, not zero")
                )
    return findings
