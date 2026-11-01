"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Writes the forty fare vectors. Run with --check in CI to prove the file still matches the engine.

The ten vectors `10 §12` works in full are reproduced here as inputs only: their printed figures
are asserted *by hand* in `test_fare_vectors.py`, which is where the document is the authority.
The other thirty exist to pin the engine at every boundary the document lists — each surge band
edge, both bridges, four weather conditions on both vehicles, six traffic delays, the subtotal
threshold either side, both fee clamps, zero distance, max radius, bundles of two and three,
three tip sizes, four discount levels and four rounding ties. Their numbers are regression pins:
they do not derive from the document, and the file says so.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "workers" / "brain" / "src"))

from fare.constants import BICYCLE, LAUNCH_PRICING, MOTORBIKE  # noqa: E402
from fare.engine import compute_fare  # noqa: E402
from fare.inputs import FareInput  # noqa: E402

TARGET = Path(__file__).resolve().parent / "vectors" / "fare_vectors.json"

DELIVERY, PICKUP = "DELIVERY", "PICKUP"


def case(cid, vehicle, metres, traffic, riders, orders, weather, subtotal, tip=0, fulfilment=DELIVERY,
         position=0, marginal=0, confidence=0.95, discount=0):
    return {
        "id": cid,
        "vehicle": vehicle,
        "routed_distance_m": metres,
        "traffic_delay_s": traffic,
        "riders": riders,
        "orders": orders,
        "weather": weather,
        "weather_confidence": confidence,
        "item_subtotal_paisa": subtotal,
        "tip_paisa": tip,
        "fulfilment": fulfilment,
        "batch_position": position,
        "batch_marginal_distance_m": marginal,
        "discount_percent": discount,
    }


def cases():
    out = [
        case("01", MOTORBIKE, 3_800, 0, 14, 11, "CLEAR", 45_000),
        case("02", BICYCLE, 2_400, 0, 30, 20, "CLEAR", 18_000),
        case("03", MOTORBIKE, 6_200, 720, 3, 10, "RAIN", 32_000),
        case("04", MOTORBIKE, 0, 0, 5, 5, "CLEAR", 13_000, fulfilment=PICKUP),
        case("05", MOTORBIKE, 2_000, 0, 20, 10, "CLEAR", 8_500),
        case("06", MOTORBIKE, 4_000, 0, 10, 12, "CLEAR", 26_000, position=1, marginal=2_400),
        case("07", MOTORBIKE, 4_500, 0, 7, 10, "CLEAR", 26_000),
        case("08", BICYCLE, 3_900, 0, 45, 100, "CLEAR", 15_000),
        case("09", MOTORBIKE, 5_000, 1_200, 3, 20, "STORM", 21_000),
        case("10", MOTORBIKE, 800, 0, 30, 10, "CLEAR", 11_000),
        # surge band edges: 0.00, 0.45, 0.475, 0.50, 0.525, 0.55, 0.95, 1.00, 1.05
        case("11", MOTORBIKE, 3_000, 0, 0, 10, "CLEAR", 20_000),
        case("12", MOTORBIKE, 3_000, 0, 45, 100, "CLEAR", 20_000),
        case("13", MOTORBIKE, 3_000, 0, 475, 1_000, "CLEAR", 20_000),
        case("14", MOTORBIKE, 3_000, 0, 5, 10, "CLEAR", 20_000),
        case("15", MOTORBIKE, 3_000, 0, 525, 1_000, "CLEAR", 20_000),
        case("16", MOTORBIKE, 3_000, 0, 55, 100, "CLEAR", 20_000),
        case("17", MOTORBIKE, 3_000, 0, 95, 100, "CLEAR", 20_000),
        case("18", MOTORBIKE, 3_000, 0, 10, 10, "CLEAR", 20_000),
        case("19", MOTORBIKE, 3_000, 0, 105, 100, "CLEAR", 20_000),
        # weather on both vehicles
        case("20", BICYCLE, 2_500, 0, 20, 20, "RAIN", 12_000),
        case("21", BICYCLE, 2_500, 0, 20, 20, "STORM", 12_000),
        case("22", BICYCLE, 2_500, 0, 20, 20, "EXTREME_HEAT", 12_000),
        case("23", MOTORBIKE, 4_000, 300, 10, 10, "EXTREME_HEAT", 25_000),
        case("24", MOTORBIKE, 4_000, 300, 10, 10, "STORM", 25_000, confidence=0.4),
        # traffic delays 4 / 5 / 9 / 10 / 22 minutes
        case("25", MOTORBIKE, 4_000, 240, 10, 10, "CLEAR", 25_000),
        case("26", MOTORBIKE, 4_000, 300, 10, 10, "CLEAR", 25_000),
        case("27", MOTORBIKE, 4_000, 540, 10, 10, "CLEAR", 25_000),
        case("28", MOTORBIKE, 4_000, 600, 10, 10, "CLEAR", 25_000),
        case("29", MOTORBIKE, 4_000, 1_320, 10, 10, "CLEAR", 25_000),
        # subtotal threshold either side
        case("30", MOTORBIKE, 3_500, 0, 10, 10, "CLEAR", 9_999),
        case("31", MOTORBIKE, 3_500, 0, 10, 10, "CLEAR", 10_001),
        # clamps
        case("32", BICYCLE, 200, 0, 10, 10, "CLEAR", 20_000),
        case("33", MOTORBIKE, 12_000, 1_320, 0, 10, "CLEAR", 40_000),
        # zero distance, max radius
        case("34", MOTORBIKE, 0, 0, 10, 10, "CLEAR", 30_000),
        case("35", BICYCLE, 4_000, 0, 10, 10, "CLEAR", 30_000),
        # bundles of two and three
        case("36", MOTORBIKE, 4_500, 0, 10, 10, "CLEAR", 30_000, position=2, marginal=3_000),
        case("37", MOTORBIKE, 4_500, 0, 10, 10, "CLEAR", 30_000, position=3, marginal=3_600),
        # tips
        case("38", MOTORBIKE, 3_000, 0, 10, 10, "CLEAR", 20_000, tip=1),
        case("39", MOTORBIKE, 3_000, 0, 10, 10, "CLEAR", 20_000, tip=50_000),
        case("40", BICYCLE, 2_000, 0, 10, 10, "CLEAR", 10_000, tip=10_001, discount=25),
    ]
    return out


def build():
    pricing = {MOTORBIKE: LAUNCH_PRICING[MOTORBIKE], BICYCLE: LAUNCH_PRICING[BICYCLE]}
    entries = []
    for raw in cases():
        inp = FareInput(
            pricing=pricing[raw["vehicle"]],
            routed_distance_m=raw["routed_distance_m"],
            traffic_delay_s=raw["traffic_delay_s"],
            riders=raw["riders"],
            orders=raw["orders"],
            weather=raw["weather"],
            weather_confidence=raw["weather_confidence"],
            item_subtotal_paisa=raw["item_subtotal_paisa"],
            tip_paisa=raw["tip_paisa"],
            fulfilment=raw["fulfilment"],
            batch_position=raw["batch_position"],
            batch_marginal_distance_m=raw["batch_marginal_distance_m"],
        )
        quote = compute_fare(inp)
        b = quote.breakdown
        entries.append({
            "id": raw["id"],
            "input": raw,
            "surge_bps": quote.surge_bps,
            "expected": asdict(b),
        })
    return entries


def main(argv):
    rendered = json.dumps({"_comment": "Generated by workers/brain/test/generate_fare_vectors.py",
                           "vectors": build()}, indent=1) + "\n"
    if "--check" in argv:
        if not TARGET.is_file() or TARGET.read_text() != rendered:
            print("fare vectors have drifted from the engine: regenerate")
            return 1
        print("fare vectors: 40, in step with the engine")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(rendered)
    print(f"wrote {TARGET}: 40 vectors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
