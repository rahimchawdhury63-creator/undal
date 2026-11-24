"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No CockroachDB or PostgreSQL construct may appear in SQL, or in a fenced SQL
block of the corpus.

The database is TiDB Cloud Starter — MySQL. Every construct below either does
not exist in MySQL or silently means something else: `INT8` is a four-byte
integer that caps at 2 147 483 647 paisa (৳21 474 836), and `ON CONFLICT` simply
will not parse. Catching them in review is not a plan; catching them here is.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, sql_blocks, strip_sql_comments, walk

FORBIDDEN = tuple(
    (token, re.compile(pattern))
    for token, pattern in (
        ("INT8", r"\bINT8\b"),
        ("STRING(", r"\bSTRING\s*\("),
        ("TIMESTAMPTZ", r"\bTIMESTAMPTZ\b"),
        ("JSONB", r"\bJSONB\b"),
        ("BYTES", r"\bBYTES\b"),
        ("gen_random_uuid", r"\bgen_random_uuid\b"),
        ("ON CONFLICT", r"\bON\s+CONFLICT\b"),
        ("RETURNING", r"\bRETURNING\b"),
        ("ST_", r"\bST_[A-Za-z]+\s*\("),
        ("GEOGRAPHY", r"\bGEOGRAPHY\b"),
        ("GEOMETRY", r"\bGEOMETRY\b"),
        ("INVERTED", r"\bINVERTED\s+INDEX\b"),
        ("pg_", r"\bpg_[a-z_]+\b"),
        (":: cast", r"::\s*[a-zA-Z_]"),
        ("partial index", r"\bINDEX\b[^;\n]*\bWHERE\b"),
        ("ILIKE", r"\bILIKE\b"),
        ("string_agg", r"\bstring_agg\b"),
        ("INSERT IGNORE-as-conflict", r"\bINSERT\s+IGNORE\b"),
        ("SERIALIZABLE", r"\bSERIALIZABLE\b"),
        ("UUID column type", r"\bUUID\b(?!\s*\()"),
    )
)


def _scan(text: str, rel: str, line_offset: int) -> list[Finding]:
    findings: list[Finding] = []
    stripped = strip_sql_comments(text)
    for number, line in enumerate(stripped.splitlines(), start=1):
        for token, pattern in FORBIDDEN:
            if pattern.search(line):
                findings.append(
                    Finding(
                        "no-postgres-dialect",
                        rel,
                        number + line_offset,
                        f"{token} is not valid in TiDB: {line.strip()[:80]}",
                    )
                )
    return findings


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".sql"}):
        findings.extend(_scan(read(path), relative(path, root), 0))
    for path in walk(root, {".md"}):
        rel = relative(path, root)
        for start, block in sql_blocks(read(path)):
            findings.extend(_scan(block, rel, start))
    return findings
