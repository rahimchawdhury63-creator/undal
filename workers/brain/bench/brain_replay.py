"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

`brain-replay`: feed a recorded dispatch request back through the current engine and demand the same
answer.

`09 §6.1` describes the nightly job: take the last 500 production traces, replay their recorded inputs
and features against today's engine, and fail when a decision changed. This is that harness. A fixture
carries the **whole** request — order context, every candidate, every rider history, the zone features
and the weights version — and the answer it produced when it was recorded: the ranking, the scores and
the wave plan. A change that alters any of them must be deliberate, and a deliberate change regenerates
the fixtures and bumps the engine version.

The harness is deliberately strict about equality: the ranking and the wave membership must match
exactly, and scores compare at 1e-12, not at a tolerance that would hide a reordered factor. The
production wiring reads from `brain_traces`; until that table has live rows, the committed fixtures are
the record, and they are ordinary JSON so a reviewer can read one without running anything.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from dispatch import DEFAULT_WEIGHTS, Candidate, OrderContext, filter_candidates, score_candidates, size_waves
from dispatch.scoring import RiderHistory, ZoneFeatures

#: Where the committed fixtures live, relative to the Brain worker.
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "replay"

#: Scores are compared at this tolerance: floating point, but tight enough that a factor reorder fails.
SCORE_TOLERANCE = 1e-12

#: The weights version a fixture was recorded with. A fixture naming another version is not replayed:
#: the comparison would be against a different engine, which is a migration, not a regression.
WEIGHTS_VERSION = "r10.3.1"


@dataclass(frozen=True)
class ReplayCase:
    """One recorded decision: the request, and the answer the engine gave at the time."""

    name: str
    request: dict
    expected: dict


def _order(request: dict) -> OrderContext:
    return OrderContext(
        zone_id=request["zone_id"],
        vendor_id=request["vendor_id"],
        total_paisa=int(request["total_paisa"]),
        drop_cell=request.get("drop_cell", ""),
    )


def replay(case: ReplayCase) -> dict:
    """Run one recorded request through the current engine and return the answer."""
    if case.request.get("weights_version", WEIGHTS_VERSION) != WEIGHTS_VERSION:
        raise ValueError(
            f"{case.name}: recorded with {case.request['weights_version']}, engine is {WEIGHTS_VERSION}"
        )
    order = _order(case.request["order"])
    candidates = [
        Candidate(**{**row, "rejected_waves": tuple(row.get("rejected_waves", ()))})
        for row in case.request["candidates"]
    ]
    histories = {
        rider_id: RiderHistory(**row) for rider_id, row in case.request.get("histories", {}).items()
    }
    zone = ZoneFeatures(**case.request.get("zone", {}))
    survivors = list(filter_candidates(candidates, order).candidates)
    ranked = score_candidates(
        order,
        survivors,
        DEFAULT_WEIGHTS,
        zone,
        histories,
        ready_in_s=int(case.request.get("ready_in_s", 540)),
    )
    probabilities = [histories[entry.rider_id].acceptance_probability for entry in ranked]
    waves = size_waves(ranked, probabilities)
    return {
        "ranking": [entry.rider_id for entry in ranked],
        "scores": [round(entry.total, 12) for entry in ranked],
        "waves": [list(wave.rider_ids) for wave in waves],
        "ttls": [wave.ttl_s for wave in waves],
    }


def differences(case: ReplayCase) -> tuple[str, ...]:
    """Every field on which the recorded answer and today's engine disagree."""
    actual = replay(case)
    expected = case.expected
    problems: list[str] = []
    if actual["ranking"] != expected["ranking"]:
        problems.append(f"ranking {actual['ranking']} != {expected['ranking']}")
    if len(actual["scores"]) != len(expected["scores"]):
        problems.append("score count differs")
    else:
        for index, (ours, theirs) in enumerate(zip(actual["scores"], expected["scores"])):
            if abs(ours - theirs) > SCORE_TOLERANCE:
                problems.append(f"score[{index}] {ours} != {theirs}")
    if actual["waves"] != expected["waves"]:
        problems.append(f"waves {actual['waves']} != {expected['waves']}")
    if actual["ttls"] != expected["ttls"]:
        problems.append(f"ttls {actual['ttls']} != {expected['ttls']}")
    return tuple(problems)


def load(directory: Path = FIXTURE_DIR) -> tuple[ReplayCase, ...]:
    """Load every `.json` fixture in a directory, in name order."""
    cases: list[ReplayCase] = []
    for path in sorted(directory.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        cases.append(ReplayCase(name=payload["name"], request=payload["request"], expected=payload["expected"]))
    return tuple(cases)


def record(case: ReplayCase) -> ReplayCase:
    """Re-record a case's expected answer from the current engine."""
    return ReplayCase(name=case.name, request=case.request, expected=replay(case))


def write(cases: tuple[ReplayCase, ...], directory: Path = FIXTURE_DIR) -> list[Path]:
    """Write fixtures as pretty JSON, one file per case, deterministically ordered."""
    directory.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for case in cases:
        path = directory / f"{case.name}.json"
        payload = {"name": case.name, "request": case.request, "expected": case.expected}
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


def _candidate(rider_id: str, distance_m: int, **overrides) -> Candidate:
    values = {"rider_id": rider_id, "routed_to_vendor_m": distance_m}
    values.update(overrides)
    return Candidate(**values)


def seed_cases() -> tuple[ReplayCase, ...]:
    """The three committed cases: a normal dispatch, a filtered rider, and a tie.

    They are ordinary dispatches, not hand-tuned numbers, so a regeneration after an intentional change
    is a two-line diff rather than an argument.
    """
    office = OrderContext("sylhet-1", "v01", 45_000)
    zone = ZoneFeatures(median_pickup_m=1_100.0, median_deliveries_today=6.0)
    normal = ReplayCase(
        name="sylhet-evening",
        request={
            "weights_version": WEIGHTS_VERSION,
            "order": asdict(office),
            "candidates": [
                asdict(_candidate("rider-a", 820, cash_in_hand_paisa=18_400)),
                asdict(_candidate("rider-b", 1_450, cash_in_hand_paisa=4_200)),
                asdict(_candidate("rider-c", 2_600, cash_in_hand_paisa=31_000)),
            ],
            "histories": {
                "rider-a": asdict(RiderHistory(deliveries_today=7, idle_s=420, acceptance_probability=0.84, eta_to_vendor_s=150)),
                "rider-b": asdict(RiderHistory(deliveries_today=4, idle_s=900, acceptance_probability=0.62, eta_to_vendor_s=260)),
                "rider-c": asdict(RiderHistory(deliveries_today=9, idle_s=120, acceptance_probability=0.91, eta_to_vendor_s=470)),
            },
            "zone": asdict(zone),
            "ready_in_s": 540,
        },
        expected={},
    )
    filtered = ReplayCase(
        name="cash-locked",
        request={
            "weights_version": WEIGHTS_VERSION,
            "order": asdict(OrderContext("sylhet-1", "v02", 61_000)),
            "candidates": [
                asdict(_candidate("rider-d", 700, cash_locked=True)),
                asdict(_candidate("rider-e", 1_900, cash_in_hand_paisa=330_000)),
            ],
            "histories": {
                "rider-e": asdict(RiderHistory(deliveries_today=2, idle_s=1_500, acceptance_probability=0.55)),
            },
            "zone": asdict(zone),
        },
        expected={},
    )
    tie = ReplayCase(
        name="identical-twins",
        request={
            "weights_version": WEIGHTS_VERSION,
            "order": asdict(OrderContext("sylhet-2", "v03", 32_000)),
            "candidates": [
                asdict(_candidate("rider-z", 1_200)),
                asdict(_candidate("rider-y", 1_200)),
            ],
            "histories": {
                "rider-z": asdict(RiderHistory(acceptance_probability=0.7)),
                "rider-y": asdict(RiderHistory(acceptance_probability=0.7)),
            },
            "zone": asdict(ZoneFeatures(median_pickup_m=1_200.0)),
        },
        expected={},
    )
    return tuple(record(case) for case in (normal, filtered, tie))


def main(argv: list[str] | None = None) -> int:
    """Replay every fixture, print failures, and optionally re-record the set."""
    parser = argparse.ArgumentParser(description="Replay recorded dispatch decisions.")
    parser.add_argument("--fixtures", type=Path, default=FIXTURE_DIR)
    parser.add_argument("--out", type=Path, default=None, help="write a JSON report here")
    parser.add_argument(
        "--record",
        action="store_true",
        help="re-record the fixture set from the current engine (a deliberate change)",
    )
    arguments = parser.parse_args(argv)
    if arguments.record:
        paths = write(seed_cases(), arguments.fixtures)
        print(f"recorded {len(paths)} fixtures in {arguments.fixtures}")
        return 0
    cases = load(arguments.fixtures)
    if not cases:
        print(f"no fixtures in {arguments.fixtures}", file=sys.stderr)
        return 1
    results = []
    failures = 0
    for case in cases:
        problems = differences(case)
        if problems:
            failures += 1
            print(f"FAIL {case.name}: {'; '.join(problems)}", file=sys.stderr)
        results.append({"name": case.name, "ok": not problems, "problems": list(problems)})
    report = {
        "fixtures": len(cases),
        "passed": failures == 0,
        "cases": results,
        "weightsVersion": WEIGHTS_VERSION,
    }
    if arguments.out is not None:
        arguments.out.parent.mkdir(parents=True, exist_ok=True)
        arguments.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"brain-replay: {len(cases) - failures}/{len(cases)} fixtures reproduce exactly")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
