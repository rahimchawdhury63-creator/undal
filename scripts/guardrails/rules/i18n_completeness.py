"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every error code speaks both languages, and every catalogue file has the same
keys in both.

Bangla is the default language of this product, not a translation layer bolted
on later. A code that only has English copy is a code that will show English to
a customer in Sylhet at the moment something has gone wrong.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from lib import Finding, read, relative, walk

BENGALI = re.compile(r"[\u0980-\u09FF]")
ROW = re.compile(r'^\s*\["([A-Z_0-9]+)",\s*(\d+),\s*"(.*?)",\s*"(.*?)",\s*(true|false),\s*"(.*?)"\],\s*$')
CATALOGUE_PAIRS = (("en", "bn"),)


def _check_registry(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    directory = root / "packages" / "contracts" / "src" / "errors" / "rows"
    if not directory.is_dir():
        return findings
    for path in sorted(directory.glob("*.ts")):
        rel = relative(path, root)
        for number, line in enumerate(read(path).splitlines(), start=1):
            if not line.strip().startswith('["'):
                continue
            match = ROW.match(line)
            if not match:
                findings.append(Finding("i18n-completeness", rel, number, "row is not [code, status, en, bn, retryable, details]"))
                continue
            code, en, bn = match.group(1), match.group(3), match.group(4)
            if not en.strip():
                findings.append(Finding("i18n-completeness", rel, number, f"{code} has no English message"))
            if not bn.strip() or not BENGALI.search(bn):
                findings.append(Finding("i18n-completeness", rel, number, f"{code} has no Bangla message"))
    return findings


def _check_catalogues(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for directory in walk(root, None):
        if directory.name != "locales" or not directory.is_dir():
            continue
        for left, right in CATALOGUE_PAIRS:
            left_file = directory / f"{left}.json"
            right_file = directory / f"{right}.json"
            if not (left_file.is_file() and right_file.is_file()):
                continue
            left_keys = set(json.loads(read(left_file)))
            right_keys = set(json.loads(read(right_file)))
            for missing in sorted(left_keys - right_keys):
                findings.append(Finding("i18n-completeness", relative(right_file, root), 0, f"missing {right} key '{missing}'"))
            for missing in sorted(right_keys - left_keys):
                findings.append(Finding("i18n-completeness", relative(left_file, root), 0, f"missing {left} key '{missing}'"))
    return findings


def check(root: Path) -> list[Finding]:
    return _check_registry(root) + _check_catalogues(root)
