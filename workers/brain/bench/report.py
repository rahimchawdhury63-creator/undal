"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The benchmark's report: eight numbers, one table, and a CI artifact nobody has to take on trust.

`11 §12.1` asserts that Undal's dispatch beats nearest-rider. This module is how that assertion is
checked: it aggregates the simulation into metrics, compares them in the direction each metric should
move, and writes a Markdown table plus JSON under `.artifacts/`. The gate is deliberately narrow — the
build fails when Undal is *not better than the baseline on every gated metric*, not when a synthetic
number misses a target printed for a real city. Targets are shown beside the result, because hiding
them would be worse than missing them.

Usage:

    PYTHONPATH=src python3 -m bench.report --days 100
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from bench.adversarial import Attack, failed, run_all
from bench.city_sim import NEAREST, POLICIES, UNDAL, Tally, gini, simulate_day
from bench.world import DAYS, make_day

#: The metrics the gate checks, in the document's order. `11 §12.1` prints eight; `30 §4.1` adds the
#: on-time rate, which is reported and gated here because a dispatch that is fast and late is not good.
GATED_METRICS = (
    "mean_time_to_assignment_s",
    "mean_rider_wait_s",
    "mean_customer_wait_s",
    "deliveries_per_rider_hour",
    "earnings_gini",
    "offer_acceptance_rate",
    "no_rider_rate",
    "batch_rate",
    "on_time_rate",
)

#: Which direction each metric should move.
HIGHER_IS_BETTER = frozenset(
    {"deliveries_per_rider_hour", "offer_acceptance_rate", "batch_rate", "on_time_rate"}
)

#: The document's targets (`30 §4.1`), shown in the report rather than enforced by it.
TARGETS: dict[str, tuple[str, float | tuple[float, float]]] = {
    "mean_time_to_assignment_s": ("<", 45.0),
    "mean_rider_wait_s": ("<", 240.0),
    "mean_customer_wait_s": ("<", 2_100.0),
    "deliveries_per_rider_hour": (">", 2.5),
    "earnings_gini": ("<", 0.25),
    "offer_acceptance_rate": (">", 0.70),
    "no_rider_rate": ("<", 0.015),
    "batch_rate": ("between", (0.15, 0.30)),
    "on_time_rate": (">", 0.92),
}


@dataclass(frozen=True)
class Metrics:
    """The gated metrics, plus the denominators that explain them."""

    orders: int
    assigned: int
    mean_time_to_assignment_s: float
    mean_rider_wait_s: float
    mean_customer_wait_s: float
    deliveries_per_rider_hour: float
    earnings_gini: float
    offer_acceptance_rate: float
    no_rider_rate: float
    batch_rate: float
    on_time_rate: float


@dataclass(frozen=True)
class Benchmark:
    """Both policies measured over the same generated days."""

    days: int
    orders: int
    undal: Metrics
    nearest: Metrics

    def better_on(self, metric: str) -> bool:
        """Whether Undal is better on one metric, in the direction that metric should improve."""
        ours, theirs = getattr(self.undal, metric), getattr(self.nearest, metric)
        return ours > theirs if metric in HIGHER_IS_BETTER else ours < theirs

    def regressions(self) -> tuple[str, ...]:
        """Every gated metric on which Undal did not beat the baseline."""
        return tuple(metric for metric in GATED_METRICS if not self.better_on(metric))


def measure(days: range | tuple[int, ...] | None = None) -> Benchmark:
    """Run both policies over the same days and produce the report's numbers."""
    indices = range(DAYS) if days is None else days
    tallies = {policy: Tally() for policy in POLICIES}
    orders = 0
    day_count = 0
    for day_index in indices:
        day = make_day(day_index)
        orders += len(day.orders)
        day_count += 1
        for policy in POLICIES:
            _, tally = simulate_day(day, policy)
            target = tallies[policy]
            target.orders += tally.orders
            target.assigned += tally.assigned
            target.offers += tally.offers
            target.acceptances += tally.acceptances
            target.assignment_time_s += tally.assignment_time_s
            target.rider_wait_s += tally.rider_wait_s
            target.customer_wait_s += tally.customer_wait_s
            target.on_time += tally.on_time
            target.batched += tally.batched
            target.deliveries += tally.deliveries
            target.ladder_offers += tally.ladder_offers
            target.gini_sum += tally.gini_sum
            target.gini_days += tally.gini_days
            target.rider_hours += tally.rider_hours
    return Benchmark(
        days=day_count,
        orders=orders,
        undal=_metrics(tallies[UNDAL]),
        nearest=_metrics(tallies[NEAREST]),
    )


def _metrics(tally: Tally) -> Metrics:
    assigned = max(1, tally.assigned)
    orders = max(1, tally.orders)
    return Metrics(
        orders=tally.orders,
        assigned=tally.assigned,
        mean_time_to_assignment_s=tally.assignment_time_s / assigned,
        mean_rider_wait_s=tally.rider_wait_s / assigned,
        mean_customer_wait_s=tally.customer_wait_s / assigned,
        deliveries_per_rider_hour=tally.deliveries / max(1e-9, tally.rider_hours),
        earnings_gini=tally.gini_sum / max(1, tally.gini_days),
        offer_acceptance_rate=tally.acceptances / max(1, tally.offers),
        no_rider_rate=1.0 - tally.assigned / orders,
        batch_rate=tally.batched / orders,
        on_time_rate=tally.on_time / assigned,
    )


def _change(metric: str, ours: float, theirs: float) -> str:
    """Percent change against the baseline, signed so that negative always means "more"."""
    if theirs == 0:
        return "n/a" if ours == 0 else "new"
    delta = (ours - theirs) / abs(theirs) * 100.0
    return f"{delta:+.1f}%"


def _target(metric: str, value: float) -> str:
    operator, bound = TARGETS[metric]
    if operator == "between":
        low, high = bound  # type: ignore[misc]
        ok = low <= value <= high
        return ("met" if ok else "missed") + f" ({low:g}-{high:g})"
    ok = value < bound if operator == "<" else value > bound
    return ("met" if ok else "missed") + f" ({operator} {bound:g})"


def render_attacks(attacks: tuple[Attack, ...]) -> str:
    """Render the seven adversarial scenarios as a second table."""
    lines = [
        "## Adversarial scenarios",
        "",
        "| Attack | Before | After | Attacker loses? | What happened |",
        "| --- | --- | --- | --- | --- |",
    ]
    for attack in attacks:
        lines.append(
            f"| `{attack.name}` | {attack.before:,.4f} | {attack.after:,.4f} "
            f"| {'yes' if attack.net_negative else '**NO**'} | {attack.description} |"
        )
    lines.append("")
    return "\n".join(lines)


def render(benchmark: Benchmark) -> str:
    """Render the report as Markdown, one row per gated metric."""
    lines = [
        "# Dispatch benchmark",
        "",
        f"{benchmark.orders:,} orders over {benchmark.days:,} simulated days, one seed, both policies.",
        "Travel is Euclidean distance x 1.35 at the vehicle's speed; acceptance is a per-rider",
        "propensity that updates as offers are answered. The gate is the comparison, not the target.",
        "",
        "| Metric | Nearest-rider | Undal | Change | Verdict | Target |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for metric in GATED_METRICS:
        ours = getattr(benchmark.undal, metric)
        theirs = getattr(benchmark.nearest, metric)
        verdict = "better" if benchmark.better_on(metric) else "**worse**"
        lines.append(
            f"| `{metric}` | {theirs:,.3f} | {ours:,.3f} | {_change(metric, ours, theirs)} "
            f"| {verdict} | {_target(metric, ours)} |"
        )
    lines += [
        "",
        f"Assigned: Undal {benchmark.undal.assigned:,} / {benchmark.undal.orders:,}, "
        f"nearest {benchmark.nearest.assigned:,} / {benchmark.nearest.orders:,}.",
        "",
        render_attacks(run_all()),
        "The nearest-rider baseline uses the same five-wave cascade and the same 90% confidence",
        "target; it differs in ranking (distance only), and it has neither the expansion ladder nor",
        "same-vendor batching. That is the decision the engine makes, isolated.",
        "",
    ]
    return "\n".join(lines)


def as_json(benchmark: Benchmark) -> dict:
    """The machine-readable report, for the CI artifact and for comparing runs over time."""
    return {
        "days": benchmark.days,
        "orders": benchmark.orders,
        "passed": not benchmark.regressions(),
        "regressions": list(benchmark.regressions()),
        "policies": {"undal": asdict(benchmark.undal), "nearest": asdict(benchmark.nearest)},
        "adversarial": [
            {
                "name": attack.name,
                "before": attack.before,
                "after": attack.after,
                "net_negative": attack.net_negative,
                "description": attack.description,
            }
            for attack in run_all()
        ],
        "gated": [
            {
                "metric": metric,
                "undal": getattr(benchmark.undal, metric),
                "nearest": getattr(benchmark.nearest, metric),
                "better": benchmark.better_on(metric),
                "target": _target(metric, getattr(benchmark.undal, metric)),
            }
            for metric in GATED_METRICS
        ],
    }


def write(benchmark: Benchmark, out_dir: Path | None = None) -> tuple[Path, Path]:
    """Write the Markdown and JSON artifacts, returning their paths."""
    directory = out_dir or Path(__file__).resolve().parent.parent / ".artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    markdown = directory / "dispatch_report.md"
    payload = directory / "dispatch_report.json"
    markdown.write_text(render(benchmark), encoding="utf-8")
    payload.write_text(json.dumps(as_json(benchmark), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return markdown, payload


def main(argv: list[str] | None = None) -> int:
    """Run the benchmark, print the table, write the artifacts and fail on a regression."""
    parser = argparse.ArgumentParser(description="Dispatch benchmark: Undal against nearest-rider.")
    parser.add_argument("--days", type=int, default=DAYS, help=f"simulated days (default {DAYS})")
    parser.add_argument("--out", type=Path, default=None, help="artifact directory")
    arguments = parser.parse_args(argv)
    if arguments.days < 1:
        parser.error("--days must be at least 1")
    benchmark = measure(range(arguments.days))
    print(render(benchmark))
    markdown, payload = write(benchmark, arguments.out)
    print(f"artifacts: {markdown} {payload}")
    regressions = benchmark.regressions()
    cheats = failed(run_all())
    if regressions:
        print(f"REGRESSION: {', '.join(regressions)}", file=sys.stderr)
    if cheats:
        print(f"ATTACK SUCCEEDED: {', '.join(cheats)}", file=sys.stderr)
    return 1 if regressions or cheats else 0


if __name__ == "__main__":
    raise SystemExit(main())
