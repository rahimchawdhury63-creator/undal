"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The differential: 110 000 amount/rate pairs must produce identical results in
TypeScript and Python, and in Kotlin when its results are present.

Why 110 000: the interesting failures are the ties (exactly half a paisa) and
the carries at 10^5 and 10^7 taka, which a hand-written table covers once and a
seeded sweep covers thousands of times. The seed is fixed, so a failure can be
replayed exactly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / ".artifacts" / "money"
sys.path.insert(0, str(ROOT / "packages" / "money" / "python"))

from undal_money import apply_rate, floor_to_taka, group_bdt  # noqa: E402

MIN_VECTORS = 110_000


def load(name: str):
    """Read one artifact, failing with a readable message when CI skipped a step."""
    path = ARTIFACTS / name
    if not path.is_file():
        raise SystemExit(f"missing {path}: run the generator step first")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    vectors = load("vectors.json")
    if len(vectors) < MIN_VECTORS:
        raise SystemExit(f"only {len(vectors)} vectors, expected at least {MIN_VECTORS}")

    ts_answers = load("ts.json")
    kotlin_path = ARTIFACTS / "kotlin.json"
    kotlin_answers = json.loads(kotlin_path.read_text(encoding="utf-8")) if kotlin_path.is_file() else None

    py_answers = []
    for vector in vectors:
        amount, rate_bps = vector["amount"], vector["rateBps"]
        rate = apply_rate(amount, rate_bps)
        total, delta = floor_to_taka(amount)
        py_answers.append(
            [rate, total, delta, group_bdt(amount)["amount"], group_bdt(rate)["withSymbol"]]
        )

    mismatches: list[str] = []
    for index, (py, ts) in enumerate(zip(py_answers, ts_answers, strict=True)):
        if py != ts:
            amount, rate_bps = vectors[index]["amount"], vectors[index]["rateBps"]
            mismatches.append(f"vector {index} amount={amount} bps={rate_bps}: python={py} ts={ts}")
            if len(mismatches) >= 20:
                break

    kotlin_checked = 0
    if kotlin_answers is not None:
        for index, (ts, kt) in enumerate(zip(ts_answers, kotlin_answers, strict=True)):
            kotlin_checked += 1
            if ts != kt:
                amount, rate_bps = vectors[index]["amount"], vectors[index]["rateBps"]
                mismatches.append(f"vector {index} amount={amount} bps={rate_bps}: ts={ts} kotlin={kt}")
                if len(mismatches) >= 40:
                    break

    if mismatches:
        for line in mismatches:
            print(f"MISMATCH {line}")
        print(f"money differential: {len(mismatches)} mismatches")
        return 1

    print(
        f"money differential: {len(vectors)} vectors identical in TS and Python"
        + (f", and in Kotlin ({kotlin_checked} vectors)" if kotlin_answers is not None else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
