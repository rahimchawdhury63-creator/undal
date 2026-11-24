"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

A customer only ever pays for something the customer caused.

The purity invariant: every line in the customer's bill maps to an item, a
delivery they asked for, a tax the state requires, or a platform fee disclosed
before payment. Marketing spend, surge the platform decided to absorb, or a
vendor's own promotion never appear on the customer's side. The rule reads the
pricing fixtures, where each line declares whether the customer caused it.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read, relative, walk

CUSTOMER_VIEWS = ("customer", "customer_payable")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, None):
        if path.suffix != ".json" or "bill" not in path.name:
            continue
        rel = relative(path, root)
        try:
            document = json.loads(read(path))
        except json.JSONDecodeError as error:
            findings.append(Finding("customer-bill-purity", rel, 0, f"unreadable fixture: {error}"))
            continue
        vectors = document if isinstance(document, list) else [document]
        for index, vector in enumerate(vectors):
            if not isinstance(vector, dict):
                continue
            for view in CUSTOMER_VIEWS:
                lines = vector.get(view)
                if not isinstance(lines, list):
                    continue
                for line in lines:
                    if isinstance(line, dict) and line.get("customer_caused") is False:
                        findings.append(
                            Finding(
                                "customer-bill-purity",
                                rel,
                                index + 1,
                                f"line '{line.get('kind', '?')}' is charged to the customer but was not caused by them",
                            )
                        )
    return findings
