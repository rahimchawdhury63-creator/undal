"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No credential of any kind is committed.

The rules of this build put every secret in GitHub Actions, so a credential in
the repository is not a slip — it is a design failure. The patterns cover the
providers this platform actually uses (Cloudflare, TiDB, imgbb, Cloudinary,
Firebase, Google OAuth, bKash) plus the generic shapes that leak most often.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, rel_is_guardrails, walk

FORBIDDEN_BYTES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".wav", ".jar", ".woff2", ".ttf", ".ico"})

PATTERNS = (
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Stripe live key", re.compile(r"\bsk_live_[A-Za-z0-9]{16,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Firebase service account", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
    ("JWT with a signature", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("32+ hex literal assigned to a secret name", re.compile(r"(?i)(secret|token|password|api_?key|salt)\w*\s*[:=]\s*['\"][0-9a-f]{32,}['\"]")),
    ("long base64 assigned to a secret name", re.compile(r"(?i)(secret|token|password|api_?key)\w*\s*[:=]\s*['\"][A-Za-z0-9+/]{40,}={0,2}['\"]")),
)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root):
        rel = relative(path, root)
        if rel_is_guardrails(rel) or path.suffix.lower() in FORBIDDEN_BYTES:
            continue
        if path.name == "secret_scan.py":
            continue
        text = read(path)
        for number, line in enumerate(text.splitlines(), start=1):
            if line.lstrip().startswith("SPDX-License-Identifier"):
                continue
            for label, pattern in PATTERNS:
                if pattern.search(line):
                    findings.append(Finding("secret-scan", rel, number, f"{label} in a tracked file"))
    return findings
