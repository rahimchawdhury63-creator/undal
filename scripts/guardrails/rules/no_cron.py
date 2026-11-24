"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No Worker may own a schedule.

Cloudflare's free plan charges nothing for a `scheduled` event but charges the
request that follows it, and — worse — a cron that silently stops firing is
invisible until cash is missing. Every periodic job in Undal is a
`workflow_dispatch` workflow with a GitHub Actions cron expression, where a
skipped run is a red X in a place somebody looks at.
"""

from __future__ import annotations

from pathlib import Path

from lib import Finding, read, relative, walk

CRON_KEYS = ("crons", "[triggers]")


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, {".toml"}):
        if path.name != "wrangler.toml" and not path.name.startswith("wrangler."):
            continue
        rel = relative(path, root)
        for number, line in enumerate(read(path).splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if any(key in stripped for key in CRON_KEYS):
                findings.append(Finding("no-cron", rel, number, f"Worker configuration declares a schedule: {stripped[:80]}"))
    for path in walk(root, {".ts", ".tsx"}):
        rel = relative(path, root)
        if not rel.startswith("workers/"):
            continue
        for number, line in enumerate(read(path).splitlines(), start=1):
            if "scheduled(" in line.replace(" ", "") or "scheduled:" in line:
                findings.append(Finding("no-cron", rel, number, "Worker exports a scheduled handler"))
    return findings
