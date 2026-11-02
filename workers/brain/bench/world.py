"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The synthetic city: riders, vendors, orders and the seed that makes them reproducible.

`city_sim.py` runs policies over these days; this module only builds them. The split matters for the
benchmark's credibility: the world is generated from one seed and does not know which policy will run
on it, so neither policy can be handed a kinder city. Vendors sit at fixed coordinates every day — a
city does not move its restaurants overnight — while riders' homes, speeds and propensities, and the
demand pattern, are drawn per day.

Distances are Euclidean metres times a road factor. Coordinates here are metres from an arbitrary
origin, not latitude and longitude, because nothing in the benchmark needs geography and a planar
model makes the arithmetic checkable by hand.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

#: The artefact's seed. Changing it changes every number in the report, deliberately.
SEED = 20_261_102

#: Simulated days. 250 days x 60 orders is 15 000 order-days, beyond the document's 10 000.
DAYS = 250

#: Orders per simulated day: a busy zone, with meal-time bursts from the vendor-repetition rule.
ORDERS_PER_DAY = 60

#: The fleet: eight riders on staggered six-hour shifts, so demand and capacity are close.
RIDERS = 8

#: Vendors at fixed coordinates. The real city has 43; eight is enough to create co-arrival pressure.
VENDORS = 8

#: The road factor: a straight line underestimates a rickshaw city by roughly a third.
ROAD_FACTOR = 1.35

#: Shift boundaries, in seconds after midnight. Demand runs 10:00-22:00.
DAY_START_S = 36_000
DAY_END_S = 79_200

#: The promise a customer sees, after the food is ready. Tight enough that lateness happens.
PROMISE_S = 1_800

#: The handover a bundle pays at the first doorstep (`12 §4.1`).
HANDOVER_S = 165

Point = tuple[float, float]


@dataclass(frozen=True)
class RiderProfile:
    """One rider: what they ride, how fast, when they work, and how readily they say yes."""

    rider_id: str
    vehicle: str
    speed_mps: float
    base_acceptance: float
    on_time_rate: float
    completion_rate: float
    home: Point
    shift_start_s: int
    shift_end_s: int


@dataclass(frozen=True)
class VendorProfile:
    """One vendor: where they are and how long the kitchen really takes."""

    vendor_id: str
    point: Point
    prep_s: int


@dataclass(frozen=True)
class OrderSpec:
    """One order as the benchmark generates it — before any policy touches it."""

    order_id: str
    vendor_id: str
    drop: Point
    placed_at_s: int
    ready_at_s: int
    promise_at_s: int
    items: int
    subtotal_paisa: int


@dataclass(frozen=True)
class Day:
    """One generated day: a fleet, the city's vendors, and the orders that arrive."""

    day: int
    riders: tuple[RiderProfile, ...]
    vendors: tuple[VendorProfile, ...]
    orders: tuple[OrderSpec, ...]


def metres(a: Point, b: Point) -> float:
    """Straight-line metres between two points, before the road factor."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def routed_metres(a: Point, b: Point) -> int:
    """Routed metres: the straight line with the city's road factor, as an integer."""
    return int(round(metres(a, b) * ROAD_FACTOR))


def _point(rng: random.Random, centre: Point, spread_m: float) -> Point:
    return (centre[0] + rng.uniform(-spread_m, spread_m), centre[1] + rng.uniform(-spread_m, spread_m))


#: The city centre, in metres from an arbitrary origin. Sylhet's shape, not its coordinates.
CENTRE: Point = (0.0, 0.0)

#: Vendors are the same every day: a city does not move its restaurants overnight.
_VENDORS: tuple[VendorProfile, ...] = ()


def vendors() -> tuple[VendorProfile, ...]:
    """The city's vendors, generated once from the fixed seed."""
    global _VENDORS
    if not _VENDORS:
        rng = random.Random(SEED)
        _VENDORS = tuple(
            VendorProfile(
                vendor_id=f"v{index:02d}",
                point=_point(rng, CENTRE, 4_000),
                prep_s=rng.randrange(420, 1_501, 30),
            )
            for index in range(VENDORS)
        )
    return _VENDORS


def make_day(day: int) -> Day:
    """Generate one day, deterministically from the day index alone."""
    rng = random.Random(SEED * 1_000_003 + day)
    riders = tuple(
        RiderProfile(
            rider_id=f"r{index:02d}",
            vehicle="BICYCLE" if index % 4 == 3 else "MOTORBIKE",
            speed_mps=rng.uniform(3.8, 4.6) if index % 4 == 3 else rng.uniform(6.8, 8.6),
            base_acceptance=rng.uniform(0.45, 0.92),
            on_time_rate=rng.uniform(0.80, 0.97),
            completion_rate=rng.uniform(0.90, 0.99),
            home=_point(rng, CENTRE, 3_200),
            shift_start_s=DAY_START_S + (index // 3) * 14_400,
            shift_end_s=DAY_START_S + (index // 3) * 14_400 + 21_600,
        )
        for index in range(RIDERS)
    )

    orders: list[OrderSpec] = []
    placed = DAY_START_S + rng.randrange(0, 1_800)
    previous_vendor: str | None = None
    for index in range(ORDERS_PER_DAY):
        city = vendors()
        if previous_vendor is not None and rng.random() < 0.35:
            vendor_id = previous_vendor
            placed += rng.randrange(60, 421)
        else:
            vendor_id = rng.choice(city).vendor_id
            placed += rng.randrange(180, 901)
        placed = min(placed, DAY_END_S - 1_800)
        vendor = next(item for item in city if item.vendor_id == vendor_id)
        drop = _point(rng, vendor.point, 3_000)
        ready_at = placed + vendor.prep_s + rng.randrange(0, 301)
        orders.append(
            OrderSpec(
                order_id=f"UND-{day:05d}-{index:02d}",
                vendor_id=vendor_id,
                drop=drop,
                placed_at_s=placed,
                ready_at_s=ready_at,
                promise_at_s=ready_at + PROMISE_S,
                items=rng.randint(1, 3),
                subtotal_paisa=rng.randrange(18_000, 90_001, 500),
            )
        )
        previous_vendor = vendor_id
    return Day(day=day, riders=riders, vendors=vendors(), orders=tuple(orders))


def payout_paisa(route_m: int, orders: int = 1) -> int:
    """The rider's payout for a route, in whole paisa — the same shape as `10`'s delivery fee."""
    base = 2_500 + (route_m // 500) * 250
    return base + (orders - 1) * 800
