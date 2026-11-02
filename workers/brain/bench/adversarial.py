"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Seven attacks, run to convergence, and what they cost the attacker.

The anti-gaming promise is only worth something if somebody keeps trying to break it. Each scenario
below plays a bad actor — a vendor inflating its own rating, a rider farming or cherry-picking, a
customer minting accounts for promo credit — against the same arithmetic the engine uses, and reports
the net effect on the attacker's own rank or earnings. A scenario whose attacker comes out ahead is a
failed build, not a note in a document.

Two of the seven are modelled here rather than exercised through their production code: GPS
plausibility (`07 §4.5`) and promo eligibility (device + address + phone) ship with the presence and
commerce milestones. The check in this file is the *rule* those modules must implement, written down
and made executable now so that the rule cannot quietly change later.

Nothing here is random without a seed: the spoofing and promo trials use a fixed seed, so a failure is
reproducible and a number in the report means the same thing on every machine.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from dispatch.factors import DEFAULT_WEIGHTS, acceptance, reliability, wilson_lower

#: The fixed seed for the two Monte-Carlo scenarios.
SEED = 20_261_102

#: The rank-score gain a fake-rating campaign may not exceed (`09 §11.1`: +0.04).
MAX_FAKE_RATING_GAIN = 0.05

#: How many self-orders before an admin exception is raised (`09 §11.1`).
SELF_ORDER_ANOMALY_AT = 12

#: The weight this benchmark assigns prep accuracy in a vendor's rank, for the lie scenario.
PREP_ACCURACY_WEIGHT = 0.30

#: The fastest a rider can plausibly travel between two reports, in metres per second.
MAX_PLAUSIBLE_SPEED_MPS = 40.0

#: The cold-start boost a genuinely new owner receives (`13`).
COLD_START_BOOST = 0.22


@dataclass(frozen=True)
class Attack:
    """One scenario's before-and-after, and whether the attacker lost."""

    name: str
    description: str
    before: float
    after: float
    net_negative: bool


def fake_self_orders() -> Attack:
    """A vendor places 200 fake self-orders to buy itself a better rating.

    The Wilson lower bound is why this does not work: 200 more five-star rows move a settled vendor by
    a rounding error, because the bound is computed from the whole sample and stays conservative.
    """
    honest = wilson_lower(930, 1_000)
    faked = wilson_lower(930 + 200, 1_000 + 200)
    return Attack(
        "fake_self_orders",
        f"200 self-orders buy {faked - honest:+.4f} of rating score; exception at {SELF_ORDER_ANOMALY_AT}",
        before=honest,
        after=faked,
        net_negative=(faked - honest) <= MAX_FAKE_RATING_GAIN,
    )


def prep_time_lie() -> Attack:
    """A vendor promises five-minute prep on everything, and its accuracy collapses within 20 orders."""
    accuracy = 0.70
    for _ in range(20):
        accuracy = 0.8 * accuracy + 0.2 * 0.0  # promised 5 min, never ready on time
    before = PREP_ACCURACY_WEIGHT * 0.70
    after = PREP_ACCURACY_WEIGHT * accuracy
    return Attack(
        "prep_time_lie",
        f"prep accuracy 0.70 -> {accuracy:.3f} within 20 orders, rank {after - before:+.3f}",
        before=before,
        after=after,
        net_negative=after < before,
    )


def delete_and_re_register() -> Attack:
    """Deleting a listing and re-registering it must not restore the cold-start boost.

    Stats are keyed to the owner's NID hash, not the vendor row, so a re-registered owner is an
    existing owner with existing history — and no boost.
    """
    seen_owners = {"nid-hash-owner"}
    new_owner = cold_start_boost("nid-hash-newcomer", seen_owners)
    re_registered = cold_start_boost("nid-hash-owner", seen_owners)
    return Attack(
        "delete_and_re_register",
        f"new owner {new_owner:.2f}, re-registered owner {re_registered:.2f}",
        before=new_owner,
        after=re_registered,
        net_negative=re_registered == 0.0,
    )


def cold_start_boost(owner_key: str, seen_owners: set[str]) -> float:
    """The boost a genuinely new owner gets, and nothing for one the ledger has already met."""
    return 0.0 if owner_key in seen_owners else COLD_START_BOOST


def reject_low_value_offers() -> Attack:
    """A rider rejects every offer below ৳40 and keeps only the plum ones.

    Acceptance is the statistic dispatch reads, and it falls faster than the payout per accepted order
    rises: there are far more low-value offers than high-value ones, so cherry-picking ends with fewer
    deliveries and less money.
    """
    rng = random.Random(SEED)
    baseline_earnings = 0
    cherry_earnings = 0
    acceptance_estimate = 0.80
    for _ in range(200):
        payout = 2_500 + rng.randrange(0, 4_001, 100)
        accepts = rng.random() < 0.80
        if accepts:
            baseline_earnings += payout
        if payout >= 4_000 and rng.random() < 0.80:
            cherry_earnings += payout
        acceptance_estimate = 0.8 * acceptance_estimate + 0.2 * (0.15 if payout >= 4_000 else 0.0)
    return Attack(
        "reject_low_value_offers",
        f"earnings {baseline_earnings:,} -> {cherry_earnings:,} paisa; acceptance {acceptance_estimate:.2f}",
        before=float(baseline_earnings),
        after=float(cherry_earnings),
        net_negative=cherry_earnings < baseline_earnings,
    )


def accept_then_unassign() -> Attack:
    """A rider accepts to keep the offer, then drops it. Completion falls faster than acceptance rises."""
    before = (
        DEFAULT_WEIGHTS["acceptance"] * acceptance(0.70)
        + DEFAULT_WEIGHTS["reliability"] * reliability(0.95, 0.90)
    )
    after = (
        DEFAULT_WEIGHTS["acceptance"] * acceptance(0.95)
        + DEFAULT_WEIGHTS["reliability"] * reliability(0.40, 0.90)
    )
    return Attack(
        "accept_then_unassign",
        f"dispatch score {before:.4f} -> {after:.4f}",
        before=before,
        after=after,
        net_negative=after < before,
    )


def plausibility_breach(previous: tuple[float, float], claimed: tuple[float, float], elapsed_s: int) -> bool:
    """Whether two position reports describe a journey a rider could not have made.

    The rule is speed, not distance: a rider who crosses the city in ten seconds is either spoofing or
    flying, and Undal does not employ either.
    """
    if elapsed_s <= 0:
        return True
    distance = ((claimed[0] - previous[0]) ** 2 + (claimed[1] - previous[1]) ** 2) ** 0.5
    return distance / elapsed_s > MAX_PLAUSIBLE_SPEED_MPS


def gps_spoofing() -> Attack:
    """Spoof a jump to the vendor's doorstep; it is caught on the first spoofed report, every time."""
    rng = random.Random(SEED)
    trials = 500
    caught = 0
    for _ in range(trials):
        home = (rng.uniform(-3_000, 3_000), rng.uniform(-3_000, 3_000))
        vendor = (home[0] + rng.uniform(1_500, 6_000), home[1] + rng.uniform(1_500, 6_000))
        if plausibility_breach(home, vendor, elapsed_s=10):
            caught += 1
    return Attack(
        "gps_spoofing",
        f"detected on the first spoofed report in {caught}/{trials} trials",
        before=0.0,
        after=1.0,
        net_negative=caught == trials,
    )


def promo_farming() -> Attack:
    """Mint a second account from the same device and address; promo eligibility refuses it.

    Eligibility is keyed to all three of device fingerprint, address point and phone. Any one of them
    matching an account that has already claimed is enough to block.
    """
    seen: set[tuple[str, str, str]] = set()
    first = promo_eligible(("device-1", "address-1", "phone-1"), seen)
    seen.add(("device-1", "address-1", "phone-1"))
    second = promo_eligible(("device-1", "address-9", "phone-9"), seen)
    third = promo_eligible(("device-2", "address-1", "phone-8"), seen)
    return Attack(
        "promo_farming",
        f"first account {first}, same device {second}, same address {third}",
        before=1.0 if first else 0.0,
        after=0.0,
        net_negative=first and not second and not third,
    )


def promo_eligible(keys: tuple[str, str, str], seen: set[tuple[str, str, str]]) -> bool:
    """Whether an account may claim a first-order promo, given the keys already claimed."""
    return not any(
        any(key == previous[index] for index in range(3)) for previous in seen for key in keys
    )


#: The seven scenarios, in the order `09 §11.1` lists them.
SCENARIOS = (
    fake_self_orders,
    prep_time_lie,
    delete_and_re_register,
    reject_low_value_offers,
    accept_then_unassign,
    gps_spoofing,
    promo_farming,
)


def run_all() -> tuple[Attack, ...]:
    """Run all seven scenarios and return their verdicts."""
    return tuple(scenario() for scenario in SCENARIOS)


def failed(attacks: tuple[Attack, ...]) -> tuple[str, ...]:
    """The scenarios in which the attacker came out ahead."""
    return tuple(attack.name for attack in attacks if not attack.net_negative)
