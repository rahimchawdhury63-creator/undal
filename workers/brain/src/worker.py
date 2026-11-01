"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

undal-brain: the Python Worker that answers dispatch questions.

The brain is deliberately read-only. It scores riders, estimates travel time and
publishes a demand surface; it never writes an order, because a decision that can
change the ledger belongs in the TypeScript core where the state machine lives.
"""

from __future__ import annotations

import json
from typing import Any

from workers import Response


def health_payload(engine_version: str, api_base: str) -> dict[str, Any]:
    """The health body, kept pure so it can be asserted without a Worker runtime.

    It reports the engine version and the API base the brain will call, which are
    the two facts an operator needs when a dispatch decision looks wrong: which
    weights were running, and which deployment they ranked against.
    """
    return {
        "ok": True,
        "data": {
            "worker": "undal-brain",
            "status": "ok",
            "engineVersion": engine_version,
            "apiBase": api_base,
        },
        "meta": {"requestId": "brain-local", "ts": "1970-01-01T00:00:00.000Z"},
    }


def not_served(path: str) -> dict[str, Any]:
    """The envelope a path outside this Worker's surface receives.

    Mirrors the TypeScript Workers so a client parsing a Brain response never has
    to special-case a different shape, and so an unbuilt endpoint is a code
    (`NOT_IMPLEMENTED`) rather than an HTML page.
    """
    return {
        "ok": False,
        "error": {
            "code": "NOT_IMPLEMENTED",
            "message": "This feature is not available in this build.",
            "messageBn": "এই সংস্করণে এই সুবিধাটি নেই।",
            "field": None,
            "retryable": False,
            "details": {"path": path},
        },
        "meta": {"requestId": "brain-local", "ts": "1970-01-01T00:00:00.000Z"},
    }


async def on_fetch(request, env):
    """Serve the Brain's HTTP surface: health today, scoring as it lands."""
    url = str(request.url)
    path = url.split("/", 3)[3] if url.count("/") >= 3 else ""

    if path == "health":
        payload = health_payload(str(env.BRAIN_ENGINE_VERSION), str(env.PUBLIC_API_BASE))
        return Response(json.dumps(payload), headers={"content-type": "application/json; charset=utf-8"})

    body = not_served("/" + path)
    return Response(
        json.dumps(body),
        status=501,
        headers={"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
    )
