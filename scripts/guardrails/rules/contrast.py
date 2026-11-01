"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Every declared token pair clears WCAG contrast: 4.5:1 for text, 3:1 for large
text and UI boundaries.

Contrast is computed here rather than trusted to a design review because the
brand greens are close in luminance, and `#1B5E20` on `#FFF8E1` is comfortable
while the same green on the brand pink is unreadable.
"""

from __future__ import annotations

import json
from pathlib import Path

from lib import Finding, read


def _channel(value: int) -> float:
    """Linearise one sRGB channel, per WCAG 2.1 relative luminance."""
    scaled = value / 255
    return scaled / 12.92 if scaled <= 0.03928 else ((scaled + 0.055) / 1.055) ** 2.4


def _luminance(hex_colour: str) -> float:
    digits = hex_colour.lstrip("#")
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    red, green, blue = (int(digits[index : index + 2], 16) for index in (0, 2, 4))
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def contrast_ratio(foreground: str, background: str) -> float:
    """The WCAG ratio between two hex colours, between 1 and 21."""
    first, second = _luminance(foreground), _luminance(background)
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def check(root: Path) -> list[Finding]:
    tokens = root / "packages" / "tokens" / "tokens.json"
    if not tokens.is_file():
        return []
    findings: list[Finding] = []
    rel = tokens.relative_to(root).as_posix()
    document = json.loads(read(tokens))
    for pair in document.get("contrast_pairs", []):
        ratio = contrast_ratio(pair["foreground"], pair["background"])
        floor = 3.0 if pair.get("large_or_ui") else 4.5
        if ratio < floor:
            findings.append(
                Finding(
                    "contrast",
                    rel,
                    0,
                    f"{pair['foreground']} on {pair['background']} is {ratio:.2f}:1, below {floor}:1",
                )
            )
    return findings
