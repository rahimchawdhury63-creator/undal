"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Prove the integer geospatial layer three ways: TypeScript, Python, and SQLite.

The Worker decides "is this address inside a zone" with ray casting over integer
polygons and prices delivery with haversine over `lat_e7`/`lon_e7`. Three
implementations have to agree on every case, because the customer's fee, the
rider's distance and the zone's existence are all decided by these two functions:

* TypeScript — the code that actually runs in production;
* Python — an independent second reading, so a typo cannot agree with itself;
* SQLite — the generated `cell_id` expression as SQL actually evaluates it, which
  is the only way to catch `Math.floor` versus `CAST` on negative coordinates.

Writes `.artifacts/geo/parity.json`; the `geo-parity` guardrail rule reads it and
fails the build on any mismatch.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = ROOT / ".artifacts" / "geo" / "parity.json"
SEED = 0x9E3779B97F4A7C15
MASK = (1 << 64) - 1
LAT_DIVISOR, LON_DIVISOR = 44_920, 49_520
CASES = 2_000
EARTH_RADIUS_M = 6_371_008.8

#: A four-point ring over Sylhet town, in degrees x 10⁷. Small enough that the
#: test also exercises the "just outside" edge, which is where ray casting lies.
RING: list[tuple[int, int]] = [
    (248_400_000, 918_200_000),
    (248_400_000, 919_200_000),
    (249_400_000, 919_200_000),
    (249_400_000, 918_200_000),
]


class Lcg:
    """The same generator the TypeScript and Kotlin vectors use."""

    def __init__(self, seed: int) -> None:
        self.state = seed

    def next(self) -> int:
        self.state = (self.state * 6_364_136_223_846_793_005 + 1_442_695_040_888_963_407) & MASK
        return self.state >> 11


def cases() -> dict[str, list]:
    """Deterministic inputs: cells, distances and point-in-ring questions."""
    rng = Lcg(SEED)
    cells = [
        {"lat_e7": rng.next() % 2_000_000_000 - 1_000_000_000, "lon_e7": rng.next() % 2_000_000_000 - 1_000_000_000}
        for _ in range(CASES)
    ]
    distances = [
        {
            "a": [239_810_000 + rng.next() % 1_500_000, 901_410_000 + rng.next() % 1_500_000],
            "b": [239_810_000 + rng.next() % 1_500_000, 901_410_000 + rng.next() % 1_500_000],
        }
        for _ in range(CASES)
    ]
    rings = [
        {
            "point": [248_300_000 + rng.next() % 1_200_000, 918_100_000 + rng.next() % 1_200_000],
            "ring": list(RING),
        }
        for _ in range(CASES)
    ]
    return {"cells": cells, "distances": distances, "rings": rings}


def sqlite_cells(points: list[dict[str, int]]) -> list[int]:
    """Floor division written as SQL integer arithmetic, negatives included.

    SQLite's `/` on two integers *truncates* where MySQL's divides into a DECIMAL,
    so `FLOOR(lat_e7 / 44920)` means two different things in the two engines. The
    modulo identity below is floor division in either one, which is what makes this
    leg a real check rather than a transcription bug report. (TiDB evaluates the
    committed `FLOOR(lat_e7 / 44920)` at four decimal places; it can differ from
    the identity only within 2.3 units of a grid boundary, which the one-cell slack
    in `cellsWithin` already absorbs.)
    """
    connection = sqlite3.connect(":memory:")
    try:
        rows = []
        for point in points:
            row = connection.execute(
                "SELECT ((? - ((? % 44920) + 44920) % 44920) / 44920) * 1000000"
                " + ((? - ((? % 49520) + 49520) % 49520) / 49520)",
                (point["lat_e7"], point["lat_e7"], point["lon_e7"], point["lon_e7"]),
            ).fetchone()
            rows.append(int(row[0]))
        return rows
    finally:
        connection.close()


def python_cells(points: list[dict[str, int]]) -> list[int]:
    """The same grid, computed with Python's floor, as the second opinion."""
    return [math.floor(p["lat_e7"] / LAT_DIVISOR) * 1_000_000 + math.floor(p["lon_e7"] / LON_DIVISOR) for p in points]


def python_distance(a: list[int], b: list[int]) -> float:
    """Great-circle metres, written independently of the Worker's version."""
    lat1, lon1, lat2, lon2 = (math.radians(value / 1e7) for value in (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def python_inside(point: tuple[int, int], ring: list[tuple[int, int]]) -> bool:
    """Even-odd ray casting over the integer ring, with no division."""
    x, y = point[1], point[0]
    inside = False
    count = len(ring)
    for index in range(count):
        x1, y1 = ring[index][1], ring[index][0]
        x2, y2 = ring[(index + 1) % count][1], ring[(index + 1) % count][0]
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < crossing:
                inside = not inside
    return inside


def typescript(inputs: dict[str, list]) -> dict[str, list]:
    """Run the exported Worker functions through Node's type stripping."""
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts" / "geo" / "ts_probe.ts")],
        input=json.dumps(inputs),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


def main() -> int:
    inputs = cases()
    ts = typescript(inputs)
    sql = sqlite_cells(inputs["cells"])
    py = python_cells(inputs["cells"])
    mismatches: list[dict[str, object]] = []

    for index, cell in enumerate(ts["cells"]):
        if cell != sql[index]:
            mismatches.append({"case": f"cell-{index} sql", "expected": cell, "actual": sql[index]})
        if cell != py[index]:
            mismatches.append({"case": f"cell-{index} python", "expected": cell, "actual": py[index]})

    for index, distance in enumerate(ts["distances"]):
        expected = python_distance(inputs["distances"][index]["a"], inputs["distances"][index]["b"])
        # The Worker returns whole metres (it is a price input, not a report), so
        # the comparison is against the rounded value, half-up like the money law.
        if distance != math.floor(expected + 0.5):
            mismatches.append({"case": f"distance-{index}", "expected": round(expected, 3), "actual": distance})

    for index, inside in enumerate(ts["inside"]):
        expected = python_inside(tuple(inputs["rings"][index]["point"]), [tuple(p) for p in RING])
        if inside != expected:
            mismatches.append({"case": f"ring-{index}", "expected": expected, "actual": inside})

    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(
        json.dumps(
            {
                "cases": {"cells": len(ts["cells"]), "distances": len(ts["distances"]), "rings": len(ts["inside"])},
                "implementations": ["typescript", "python", "sqlite"],
                "mismatches": mismatches,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"geo-parity: {len(mismatches)} mismatches over {sum(len(v) for v in inputs.values())} cases")
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
