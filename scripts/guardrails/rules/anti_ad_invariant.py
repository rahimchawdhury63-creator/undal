"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Ranking may never see money.

The anti-ad invariant is the promise that a vendor cannot buy a better position:
rank inputs are the fourteen weighted factors of `12 §4`, none of which is
revenue, commission, spend or payout. The mechanical half of that promise is
this rule — no module under `rank/` may import a money module, and no rank input
type may declare a money-named field.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, walk

MONEY_IMPORTS = re.compile(r"from\s+['\"][^'\"]*(money|pricing|billing|ledger|invoice|payout)[^'\"]*['\"]")
MONEY_FIELDS = re.compile(
    r"(?i)\b(revenue|spend|commission|payout|price|gmv|ad_?budget|promoted|paid_?boost|fee)\w*\s*[?]?\s*:"
)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".ts", ".tsx", ".kt", ".kts", ".py"}):
        rel = relative(path, root)
        if "/rank/" not in rel and not rel.startswith("rank/"):
            continue
        text = read(path)
        for number, line in enumerate(text.splitlines(), start=1):
            if MONEY_IMPORTS.search(line):
                findings.append(Finding("anti-ad-invariant", rel, number, "rank module imports a money module"))
            if MONEY_FIELDS.search(line) and not line.strip().startswith("*"):
                findings.append(
                    Finding("anti-ad-invariant", rel, number, f"rank input declares a money-named field: {line.strip()[:80]}")
                )
    return findings
