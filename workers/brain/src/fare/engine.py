"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The engine: one entry point from input to a quote, and nothing else.

`compute_fare` is the only function the Worker calls. It quantises the supply–demand ratio to a
surge, runs the ride core, assembles the breakdown, asserts closure, and returns the quote with
an explanation attached. No clock, no I/O, no configuration read: the 400 ms budget is spent on
arithmetic, not on waiting for something.
"""

from __future__ import annotations

from dataclasses import dataclass

from fare.assemble import FareBreakdown, assemble
from fare.explain import explain
from fare.inputs import FareInput, validate
from fare.ride_core import ride_core
from fare.surge import surge_bps, supply_demand_ratio


@dataclass(frozen=True)
class FareQuote:
    """A quote: the breakdown, the surge that produced it, and the lines that explain it."""

    surge_bps: int
    supply_demand_ratio: float
    breakdown: FareBreakdown
    explanation: tuple


def compute_fare(inp: FareInput) -> FareQuote:
    """Price one order.

    The surge comes from the zone's published value when the caller supplies one, because
    `10 §4.4` makes the surge in force at placement binding: re-deriving it on a retry would
    let a quote change under a customer who is already looking at it.
    """
    validate(inp)

    ratio = supply_demand_ratio(inp.riders, inp.orders)
    surge = inp.surge_bps_override if inp.surge_bps_override is not None else surge_bps(ratio, inp.pricing.surge_cap_bps)

    core = ride_core(inp.routed_distance_m, inp.traffic_delay_s, surge, inp.pricing)
    breakdown = assemble(inp, core, surge)

    return FareQuote(
        surge_bps=surge,
        supply_demand_ratio=ratio,
        breakdown=breakdown,
        explanation=explain(breakdown, surge, inp),
    )
