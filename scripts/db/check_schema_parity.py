"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The inventory in `06 §2` and the migrations must name the same tables.

The specification says 99 tables and lists 109 names; the names are what the code
queries, so the names win (D43) and this check makes the discrepancy a build
failure instead of a document that quietly disagrees with the schema.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "06-data-model-tidb.md"
MIGRATIONS = ROOT / "db" / "migrations"
CREATE = re.compile(r"CREATE TABLE IF NOT EXISTS `([a-z_0-9]+)`")
INFRASTRUCTURE = {"schema_migrations", "_smoke"}


def inventory() -> list[str]:
    """The 109 table names `06 §2` lists, in document order."""
    lines = DOC.read_text(encoding="utf-8").splitlines()
    start = next(index for index, line in enumerate(lines) if line.strip() == "## 2. Table inventory")
    names: list[str] = []
    for line in lines[start:]:
        if line.startswith("## ") and not line.startswith("## 2."):
            break
        if line.startswith("| ") and "`" in line:
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) >= 3 and cells[2].isdigit():
                names += re.findall(r"`([a-z_0-9]+)`", cells[1])
    return names


def migrated() -> list[str]:
    """Every table the migrations create, excluding the ledger and the canary."""
    names: list[str] = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        for match in CREATE.finditer(path.read_text(encoding="utf-8")):
            if match.group(1) not in INFRASTRUCTURE:
                names.append(match.group(1))
    return names


def main() -> int:
    expected, actual = inventory(), migrated()
    duplicates = {name for name in actual if actual.count(name) > 1}
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))

    for name in sorted(duplicates):
        print(f"schema-parity: `{name}` is created more than once")
    for name in missing:
        print(f"schema-parity: `{name}` is in the inventory but no migration creates it")
    for name in extra:
        print(f"schema-parity: `{name}` is created but not in the inventory")

    if duplicates or missing or extra:
        return 1
    print(f"schema-parity: {len(actual)} tables, inventory and migrations agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
