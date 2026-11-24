"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Shared machinery for the thirty-one repository guardrails.

Why a framework at all: thirty-one rules that each walk the tree their own way
would take ninety seconds instead of forty, and would disagree about what counts
as source. One walker, one definition of "shipped code", one reporting format —
so a rule author writes only the rule.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence


@dataclass(frozen=True)
class Finding:
    """One violation: where it is, which rule caught it, and severity.

    Severity exists because the line budget warns at 600 and fails at 700, and a
    warning that silently fails the build gets deleted by the first person it
    inconveniences.
    """

    rule: str
    path: str
    line: int
    message: str
    severity: str = "error"

    def render(self) -> str:
        location = f"{self.path}:{self.line}" if self.line > 0 else self.path
        return f"{location} [{self.rule}] {self.severity}: {self.message}"


#: Directories that are never shipped and never scanned by source rules.
SKIP_DIRS = frozenset(
    {
        ".git",
        "node_modules",
        ".turbo",
        "dist",
        "build",
        "out",
        "coverage",
        ".gradle",
        ".idea",
        ".venv",
        "__pycache__",
        ".pytest_cache",
        ".ruff_cache",
        ".wrangler",
        # Fixtures exist to be wrong on purpose; scanning them would make every
        # rule fail on the repository that proves the rule can fail.
        "fixtures",
    }
)

#: Extensions that count as shipped source for the source-wide rules.
SOURCE_EXTS = frozenset(
    {
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".kt",
        ".kts",
        ".py",
        ".sql",
        ".css",
        ".sh",
        ".yml",
        ".yaml",
    }
)

#: Files that carry the licence header. YAML and JSON manifests do not.
HEADER_EXTS = frozenset({".ts", ".tsx", ".js", ".mjs", ".cjs", ".kt", ".kts", ".py", ".sql", ".css", ".sh"})

#: The header every source file must carry, matched as a substring.
LICENCE_MARKER = "Licensed under PASVL-1.0"


def repo_root() -> Path:
    """The repository root, resolved from this file rather than the cwd."""
    return Path(__file__).resolve().parents[2]


def walk(root: Path, exts: Iterable[str] | None = None) -> list[Path]:
    """Every candidate file under `root`, deterministically ordered."""
    wanted = frozenset(exts) if exts is not None else None
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if wanted is not None and path.suffix not in wanted:
                continue
            found.append(path)
    return found


def read(path: Path) -> str:
    """Read a text file, replacing undecodable bytes rather than crashing the build."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def relative(path: Path, root: Path) -> str:
    """Path as CI should print it."""
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def is_test_path(path: str) -> bool:
    """True for test and fixture code, where different rules apply."""
    lowered = path.lower()
    return (
        "/test/" in lowered
        or "/tests/" in lowered
        or "/androidtest/" in lowered
        or "test/" in lowered.split("/")[0:1]
        or lowered.endswith(".test.ts")
        or lowered.endswith(".test.tsx")
        or lowered.endswith("_test.py")
        or lowered.endswith(".spec.ts")
        or lowered.endswith(".spec.tsx")
    )


def rel_is_guardrails(rel: str) -> bool:
    """True for the guardrail tooling itself, which names the words it forbids."""
    return rel.startswith("scripts/guardrails/") or rel == "scripts/guardrails"


def rel_is_generated(rel: str) -> bool:
    """True for machine-written code, which is checked by regenerating it instead."""
    lowered = rel.lower()
    return (
        "/generated/" in lowered
        or lowered.endswith(".generated.ts")
        or lowered.endswith(".generated.kt")
        # A `generated.ts` written by a committed generator: its length is the
        # number of rules in the schema, so a 700-line cap would be a cap on how
        # many invariants the database is allowed to declare.
        or lowered.endswith("/generated.ts")
        or lowered.startswith("packages/contracts/openapi.json")
    )


def strip_ts_comments(text: str) -> str:
    """Remove block and line comments from TypeScript-ish source, preserving newlines."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"(?m)(?<!:)//.*$", "", text)


def strip_sql_comments(text: str) -> str:
    """Remove `--` and `/* */` comments from SQL, preserving newlines."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"(?m)--.*$", "", text)


def sql_blocks(markdown: str) -> list[tuple[int, str]]:
    """Every ```sql fenced block in a document, with the line it starts on.

    Only fenced SQL is checked in the corpus: prose that *names* a forbidden
    construct (the guardrail table itself, for instance) is documentation about
    the rule, not code that could ever run.
    """
    blocks: list[tuple[int, str]] = []
    lines = markdown.splitlines()
    start: int | None = None
    buffer: list[str] = []
    for index, line in enumerate(lines, start=1):
        if start is None and re.match(r"^\s*```sql\s*$", line):
            start = index
            buffer = []
            continue
        if start is not None and re.match(r"^\s*```\s*$", line):
            blocks.append((start, "\n".join(buffer)))
            start = None
            buffer = []
            continue
        if start is not None:
            buffer.append(line)
    return blocks


def git(root: Path, *args: str) -> str:
    """Run git, returning stdout, or the empty string when git cannot answer."""
    try:
        completed = subprocess.run(
            ("git", *args), cwd=root, capture_output=True, text=True, check=False, timeout=60
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return completed.stdout if completed.returncode == 0 else ""


Rule = Callable[[Path], Sequence[Finding]]
