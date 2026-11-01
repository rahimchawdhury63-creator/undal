"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Push payloads are data-only, high-priority where it matters, and never use the
legacy endpoint.

A `notification` key lets the OS draw the alert, which on several Android builds
means the full-screen alarm never appears and a rider misses an order worth
৳1 800. Undal builds every notification itself from the data payload, and this
rule is the reason the eleventh such bug cannot happen.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, rel_is_guardrails, walk

LEGACY = re.compile(r"fcm/send\b")
NOTIFICATION_KEY = re.compile(r"\bnotification\s*:")
PRIORITY = re.compile(r"\bpriority\b")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".ts", ".py", ".kt"}):
        rel = relative(path, root)
        if rel_is_guardrails(rel):
            continue
        text = read(path)
        markers = ("fcm", "push", "firebase", "notification")
        if not any(marker in rel.lower() or marker in text.lower() for marker in markers):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if LEGACY.search(line):
                findings.append(Finding("fcm-payload-purity", rel, number, "legacy FCM endpoint"))
            stripped = line.strip()
            if stripped.startswith(("*", "//", "#")):
                continue
            if NOTIFICATION_KEY.search(stripped) and "notification_" not in stripped:
                findings.append(
                    Finding("fcm-payload-purity", rel, number, f"payload declares a notification block: {stripped[:80]}")
                )
    return findings
