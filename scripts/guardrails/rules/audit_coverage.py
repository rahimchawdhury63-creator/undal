"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every mutating route writes an audit row.

Undal moves cash between parties who will disagree about it later. The audit log
is what turns "the vendor says they were paid" into a settled question, so a
route that mutates state without an audit write is a route that cannot answer
it. The check is deliberately crude — presence of an `audit` call in a file that
declares a mutation — because a precise check would need the whole middleware
graph and would still be fooled.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, is_test_path, read, relative, walk

MUTATION = re.compile(r"['\"](POST|PATCH|PUT|DELETE)['\"]")
#: A call into the audit module. `audit.appendAudit` is the name the module actually
#: exports, so the pattern allows the noun after the verb — matching only `audit.append`
#: would have failed a file that does write an audit row, which is the one false
#: positive a rule like this cannot afford.
#: A route that declares itself non-mutating. A `POST` that changes no rows has nothing to audit —
#: quoting is the example — and the declaration is one line a reviewer can check against a handler
#: that only reads. Without it the rule would either miss real mutations or fill the audit log with
#: thirty quotes a minute.
READ_ONLY = re.compile(r"\breadOnly:\s*true\b")

AUDIT_CALL = re.compile(
    r"\baudit\.(write|record|append)(Audit|Row|Entry)?\b|\brecordAudit\b|\bauditWrite\b"
)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".ts"}):
        rel = relative(path, root)
        if is_test_path(rel) or "/routes/" not in rel or not rel.startswith("workers/"):
            continue
        text = read(path)
        if MUTATION.search(text) and not AUDIT_CALL.search(text) and not READ_ONLY.search(text):
            findings.append(
                Finding("audit-coverage", rel, 0, "declares a mutating route but writes no audit row")
            )
    return findings
