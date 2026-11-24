"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

No dependency that cannot be used on a free tier, and none that drags in a
licence the platform cannot honour.

The build's constraint is not "cheap" but "no card on file": a package that
expects a paid account, a trial that expires, or a per-seat licence turns a
green repository into a red balance a month later.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from lib import Finding, read, relative, walk

FORBIDDEN = (
    (re.compile(r"^@aws-sdk/"), "AWS SDK — paid beyond the free trial"),
    (re.compile(r"^aws-sdk$"), "AWS SDK — paid beyond the free trial"),
    (re.compile(r"^twilio"), "Twilio — paid per message"),
    (re.compile(r"^@sendgrid/"), "SendGrid — paid tier after 100 emails/day"),
    (re.compile(r"^stripe$"), "Stripe — not available for this business"),
    (re.compile(r"^@googlemaps/"), "Google Maps Platform — requires billing"),
    (re.compile(r"^mapbox-gl$"), "Mapbox GL — requires an access token and a card"),
    (re.compile(r"^(bull|bullmq|ioredis|redis)$"), "requires a paid Redis service"),
    (re.compile(r"^(node-cron|node-schedule)$"), "scheduling belongs in GitHub Actions"),
    (re.compile(r"^@sentry/"), "Sentry — paid tier; the platform logs to D1 and Actions"),
    (re.compile(r"^(newrelic|datadog-ci)$"), "paid observability"),
    (re.compile(r"^(puppeteer|playwright)$"), "only the Playwright test runner is allowed, not the library"),
)

COPYLEFT = re.compile(r"^(gpl|agpl|sspl|cc-by-nc|osl|eupl)", re.I)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in walk(root, None):
        if path.name != "package.json":
            continue
        rel = relative(path, root)
        if rel.startswith("docs/"):
            continue
        try:
            manifest = json.loads(read(path))
        except json.JSONDecodeError as error:
            findings.append(Finding("dependency-licence-and-cost", rel, 0, f"manifest is not valid JSON: {error}"))
            continue
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name, spec in (manifest.get(section) or {}).items():
                for pattern, why in FORBIDDEN:
                    if pattern.search(name):
                        findings.append(Finding("dependency-licence-and-cost", rel, 0, f"'{name}' {why}"))
                if isinstance(spec, str) and COPYLEFT.search(spec):
                    findings.append(Finding("dependency-licence-and-cost", rel, 0, f"'{name}' requests a copyleft licence"))
    return findings
