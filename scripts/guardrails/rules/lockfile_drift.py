"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

A manifest change must arrive with its lockfile change.

Builds in Actions install from the lockfile; a dependency added to a manifest
and forgotten in the lockfile produces a green local run and a red deploy —
except nobody runs anything locally here, so the red deploy is the first sign.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from lib import Finding, read, relative, walk

DEPENDENCY_SECTIONS = ("dependencies", "devDependencies", "optionalDependencies")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    lockfile = root / "pnpm-lock.yaml"
    if not lockfile.is_file():
        return findings
    lock = read(lockfile)

    for path in walk(root, None):
        if path.name != "package.json":
            continue
        rel = relative(path, root)
        if rel.startswith("docs/"):
            continue
        try:
            manifest = json.loads(read(path))
        except json.JSONDecodeError:
            continue
        names: list[str] = []
        for section in DEPENDENCY_SECTIONS:
            names.extend((manifest.get(section) or {}).keys())
        for name in names:
            if re.search(rf"(?m)^\s+'?{re.escape(name)}'?:", lock) is None:
                findings.append(
                    Finding("lockfile-drift", rel, 0, f"'{name}' is in a manifest but absent from pnpm-lock.yaml")
                )
    return findings
