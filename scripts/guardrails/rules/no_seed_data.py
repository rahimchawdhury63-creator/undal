"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No business data is ever inserted by a migration.

Undal boots empty: no sample vendors, no demo riders, no invented orders. The
allowlist is schema, not data — RBAC permissions, roles and the platform's own
feature flags are reference rows the code cannot run without, and they are
marked by a `-- schema-data:` comment on the statement so the exception is
visible in the diff rather than buried in this file.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, walk

INSERT = re.compile(r"(?i)\bINSERT\s+INTO\s+`?([a-z0-9_]+)`?")
SCHEMA_DATA_MARKER = re.compile(r"--\s*schema-data:")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".sql"}):
        rel = relative(path, root)
        text = read(path)
        if not (rel.startswith("db/") or "/migrations/" in rel):
            continue
        lines = text.splitlines()
        for index, line in enumerate(lines):
            match = INSERT.search(line)
            if not match:
                continue
            context = "\n".join(lines[max(0, index - 2) : index + 1])
            if SCHEMA_DATA_MARKER.search(context):
                continue
            findings.append(
                Finding("no-seed-data", rel, index + 1, f"migration inserts business data into '{match.group(1)}'")
            )
    return findings
