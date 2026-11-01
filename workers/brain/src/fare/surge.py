"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Supply, demand, and the surge multiplier — `10 §4`.

The brief specifies three bands. Taken literally they are discontinuous at 0.5 and 1.0, and a
discontinuity in a pricing function is a cliff: a rider who can see the zone counters is
rewarded for staying offline just under the boundary, and a customer refreshing at it watches
the fee flicker. Each boundary is therefore bridged over ±0.05 SDR, which preserves the brief's
bands everywhere they matter and removes both incentives.

This is the only float in the fare engine. It is quantised to integer basis points here, and
nothing downstream sees it again.
"""

from __future__ import annotations

from typing import Optional

SURGE_SEVERE_MAX = 22_000  # 2.2x
SURGE_SEVERE_MIN = 15_000  # 1.5x
SURGE_MODERATE_MAX = 14_000  # 1.4x
SURGE_MODERATE_MIN = 12_000  # 1.2x
SURGE_NONE = 10_000  # 1.0x

#: Half-width of the ramp that bridges each band boundary, in SDR.
BRIDGE_HALF_WIDTH = 0.05


def supply_demand_ratio(riders: int, orders: int) -> float:
    """Riders per waiting order; infinite supply when nothing is waiting.

    A float, and deliberately the only one: riders and orders are counts, the ratio is not
    money, and quantising it here is what keeps the multiplier integral.
    """
    if orders <= 0:
        return float("inf")
    if riders < 0:
        raise ValueError(f"supply_demand_ratio: negative riders {riders}")
    return riders / orders


def surge_bps(sdr: float, cap_bps: int = SURGE_SEVERE_MAX) -> int:
    """Map the supply–demand ratio to a surge multiplier in basis points.

    Piecewise linear, continuous, monotonically non-increasing in SDR, and bounded by
    `[SURGE_NONE, cap_bps]` — the three properties the property tests assert over a hundred
    thousand points.
    """
    if sdr != sdr:  # NaN: an unknown ratio must never produce a discount or a cliff
        raise ValueError("surge_bps: supply-demand ratio is not a number")
    if sdr == float("inf") or sdr >= 1.0 + BRIDGE_HALF_WIDTH:
        return SURGE_NONE

    if sdr <= 0.5 - BRIDGE_HALF_WIDTH:
        raw = SURGE_SEVERE_MIN + (0.5 - sdr) / 0.5 * (SURGE_SEVERE_MAX - SURGE_SEVERE_MIN)
        return min(cap_bps, int(round(raw)))

    if sdr < 0.5 + BRIDGE_HALF_WIDTH:
        low = SURGE_SEVERE_MIN + (0.5 - (0.5 - BRIDGE_HALF_WIDTH)) / 0.5 * (SURGE_SEVERE_MAX - SURGE_SEVERE_MIN)
        high = SURGE_MODERATE_MIN + (1.0 - (0.5 + BRIDGE_HALF_WIDTH)) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)
        t = (sdr - (0.5 - BRIDGE_HALF_WIDTH)) / (2 * BRIDGE_HALF_WIDTH)
        return int(round(low + t * (high - low)))

    if sdr <= 1.0 - BRIDGE_HALF_WIDTH:
        raw = SURGE_MODERATE_MIN + (1.0 - sdr) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)
        return int(round(raw))

    low = SURGE_MODERATE_MIN + (1.0 - (1.0 - BRIDGE_HALF_WIDTH)) / 0.5 * (SURGE_MODERATE_MAX - SURGE_MODERATE_MIN)
    t = (sdr - (1.0 - BRIDGE_HALF_WIDTH)) / (2 * BRIDGE_HALF_WIDTH)
    return int(round(low + t * (SURGE_NONE - low)))


def published_surge_bps(
    previous_bps: Optional[int],
    next_bps: int,
    *,
    seconds_since_publish: Optional[int],
    hysteresis_bps: int = 500,
    publish_interval_s: int = 90,
) -> int:
    """What actually goes out to clients, given hysteresis (`10 §4.4`).

    A change smaller than 500 bps is suppressed, and nothing is published more often than
    every 90 seconds. Without this a zone near a boundary would broadcast a new fee every few
    seconds and every open cart would re-quote, which is both a thundering herd and a customer
    experience that looks like a bug.
    """
    if previous_bps is None or seconds_since_publish is None:
        return next_bps
    if abs(next_bps - previous_bps) < hysteresis_bps:
        return previous_bps
    if seconds_since_publish < publish_interval_s:
        return previous_bps
    return next_bps
