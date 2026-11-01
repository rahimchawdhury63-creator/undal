"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No floating-point arithmetic anywhere a monetary value can reach.

A `0.1 + 0.2` that lands a paisa away from the expected total is the kind of
defect that surfaces as a rider handing over the wrong change three weeks later.
The rule is mechanical: in a money path, a decimal literal or a float function
is a failure — amounts are integers and ratios are basis points.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, is_test_path, relative, strip_ts_comments, walk

MONEY_DIRECTORIES = ("money", "paisa", "pricing", "fare", "ledger", "billing", "invoice", "settlement")

FLOAT_OPERATIONS = (
    (re.compile(r"\bNumber\.parseFloat\b"), "parses a float into a money path"),
    (re.compile(r"\bparseFloat\b"), "parses a float into a money path"),
    (re.compile(r"\.toFixed\s*\("), "formats via float rounding"),
    (re.compile(r"\bMath\.round\b"), "rounds via float, bypassing apply_rate"),
    (re.compile(r"\bMath\.ceil\b"), "rounds via float, bypassing apply_rate"),
)

DECIMAL_LITERAL = re.compile(r"(?<![\w.$])\d+\.\d+(?![\w.])")


def _is_money_path(rel: str) -> bool:
    lowered = rel.lower()
    return any(f"/{name}/" in lowered or f"/{name}." in lowered or f"{name}/" in lowered for name in MONEY_DIRECTORIES)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".ts", ".tsx"}):
        rel = relative(path, root)
        if is_test_path(rel) or not _is_money_path(rel):
            continue
        source = strip_ts_comments(path.read_text(encoding="utf-8", errors="replace"))
        for number, line in enumerate(source.splitlines(), start=1):
            for pattern, why in FLOAT_OPERATIONS:
                if pattern.search(line):
                    findings.append(Finding("money-integrity", rel, number, f"{why}: {line.strip()[:80]}"))
            for match in DECIMAL_LITERAL.finditer(line):
                findings.append(
                    Finding("money-integrity", rel, number, f"decimal literal {match.group(0)} in a money path")
                )
    return findings
