"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

`db/constraints.json` and the `CHECK` declarations in the corpus agree exactly.

TiDB does not enforce `CHECK`. That makes the generated validators the only
enforcement the platform has, and makes drift between the two the single most
dangerous silent defect in the data layer: a rule removed from the extraction
script keeps being enforced in the DDL and stops being enforced at runtime, or
the reverse. Both directions fail the build.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from lib import Finding, read, sql_blocks, walk

CHECK_DECLARATION = re.compile(r"(?i)^\s*(?:CONSTRAINT\s+`?(\w+)`?\s+)?CHECK\s*\((.*)\)\s*,?\s*$")


def check(root: Path) -> list[Finding]:
    constraints_file = root / "db" / "constraints.json"
    if not constraints_file.is_file():
        return []
    findings: list[Finding] = []
    rel = constraints_file.relative_to(root).as_posix()
    declared = json.loads(read(constraints_file))
    declared_names = {entry["name"] for entry in declared.get("constraints", [])}

    found: set[str] = set()
    for path in walk(root, {".sql", ".md"}):
        text = read(path)
        blocks = [(0, text)] if path.suffix == ".sql" else sql_blocks(text)
        for _, block in blocks:
            for line in block.splitlines():
                match = CHECK_DECLARATION.match(line)
                if match and match.group(1):
                    found.add(match.group(1))

    for name in sorted(declared_names - found):
        findings.append(Finding("check-constraint-parity", rel, 0, f"'{name}' is extracted but not declared in the DDL"))
    for name in sorted(found - declared_names):
        findings.append(Finding("check-constraint-parity", rel, 0, f"'{name}' is declared in the DDL but not extracted"))
    return findings
