"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Nothing in this repository may ask a human to run a command.

The maintainer works from an Android tablet in a browser. Every operation is a
`workflow_dispatch` button; a document that says `npm install` is a document
that assumes a laptop, and a script that no workflow invokes is dead code that
looks alive.
"""

from __future__ import annotations

import re
from pathlib import Path

from lib import Finding, read, relative, walk

INSTALL_COMMANDS = re.compile(
    r"(?i)\b(npm|pnpm|yarn)\s+(i|install|add|dlx)\b|\bpip3?\s+install\b|\bbrew\s+install\b|"
    r"\bapt(-get)?\s+install\b|\bsdkmanager\b|\bchoco\s+install\b|\./gradlew\b|\bgit\s+clone\b"
)
PROMPT_LINE = re.compile(r"^\s*(\$|sudo)\s+\S")

#: Fences whose contents a reader is meant to type. A `yml` fence is a workflow
#: that runs on a GitHub runner, and a `text` fence is usually a transcript or a
#: comparison table — neither is an instruction to the maintainer.
LOCAL_FENCES = frozenset({"bash", "sh", "shell", "console", "zsh", "terminal", "cmd", "powershell"})


def _local_fences(markdown: str) -> list[tuple[int, str]]:
    """Every fenced block a reader is meant to type into a shell."""
    blocks: list[tuple[int, str]] = []
    start: int | None = None
    buffer: list[str] = []
    for index, line in enumerate(markdown.splitlines(), start=1):
        opening = re.match(r"^\s*```(\w+)\s*$", line)
        if start is None and opening and opening.group(1).lower() in LOCAL_FENCES:
            start = index
            buffer = []
            continue
        if start is None and opening:
            # Some other fence: skip it entirely so its contents are not read.
            start = -1
            buffer = []
            continue
        if start is not None and re.match(r"^\s*```\s*$", line):
            if start > 0:
                blocks.append((start, "\n".join(buffer)))
            start = None
            buffer = []
            continue
        if start is not None and start > 0:
            buffer.append(line)
    return blocks


def _reference_corpus(root: Path) -> str:
    """Every place a script path may legitimately be mentioned."""
    parts: list[str] = []
    workflows = root / ".github" / "workflows"
    if workflows.is_dir():
        for path in workflows.glob("*.yml"):
            parts.append(read(path))
    for name in ("package.json", "turbo.json", "pnpm-workspace.yaml"):
        candidate = root / name
        if candidate.is_file():
            parts.append(read(candidate))
    return "\n".join(parts)


def check(root: Path) -> list[Finding]:
    findings: list[Finding] = []

    for path in walk(root, {".md"}):
        rel = relative(path, root)
        for start, block in _local_fences(read(path)):
            for offset, line in enumerate(block.splitlines()):
                if INSTALL_COMMANDS.search(line):
                    findings.append(
                        Finding(
                            "no-local-tooling",
                            rel,
                            start + offset,
                            f"document tells the reader to install something: {line.strip()[:80]}",
                        )
                    )
                elif PROMPT_LINE.match(line):
                    findings.append(
                        Finding(
                            "no-local-tooling",
                            rel,
                            start + offset,
                            f"document shows a shell prompt: {line.strip()[:80]}",
                        )
                    )

    corpus = _reference_corpus(root)
    scripts = [p for p in walk(root / "scripts", {".py", ".mjs", ".sh"}) if read(p)]
    sources = {relative(path, root): read(path) for path in scripts}
    for rel, text in sources.items():
        if rel.startswith("scripts/guardrails/") and rel != "scripts/guardrails/run.py":
            # The runner imports these; the runner itself must be referenced.
            continue
        if rel in corpus:
            continue
        module = rel.rsplit(".", 1)[0].replace("/", ".")
        imported_elsewhere = any(
            module in body or module.rsplit(".", 1)[-1] in body
            for other, body in sources.items()
            if other != rel
        )
        discovered_as_test = "/test_" in rel and "unittest" in corpus
        if imported_elsewhere or discovered_as_test:
            continue
        findings.append(Finding("no-local-tooling", rel, 0, "no workflow or manifest invokes this script"))
    return findings
