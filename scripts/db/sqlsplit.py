"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Split a migration file into statements, exactly once, for everyone.

The migration runner, the constraint extractor and the schema expectations all
need the same answer to "what is one statement here?", and three splitters that
disagree would resume at different points after a failure — the one thing
statement-level resume cannot survive.
"""

from __future__ import annotations

from pathlib import Path


def split_statements(text: str) -> list[str]:
    """Split on semicolons that are outside string literals and comments."""
    statements: list[str] = []
    buffer: list[str] = []
    quote: str | None = None
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        pair = text[index : index + 2]
        if quote is None and pair == "--":
            newline = text.find("\n", index)
            index = length if newline == -1 else newline + 1
            buffer.append("\n")
            continue
        if quote is None and pair == "/*":
            end = text.find("*/", index + 2)
            index = length if end == -1 else end + 2
            continue
        if quote is None and char in "'\"":
            quote = char
        elif quote is not None and char == quote:
            quote = None
        if char == ";" and quote is None:
            statements.append("".join(buffer))
            buffer = []
            index += 1
            continue
        buffer.append(char)
        index += 1
    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)
    return [statement.strip() for statement in statements if statement.strip()]


def read_migration(path: Path) -> tuple[str, list[str]]:
    """A migration file's checksum and its statements, in order."""
    import hashlib

    raw = path.read_text(encoding="utf-8")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest(), split_statements(raw)


def migration_files(directory: Path) -> list[Path]:
    """Migration files in filename order, which is the only order allowed."""
    return sorted(directory.glob("*.sql"), key=lambda path: path.name)
