"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The cascade (`11 §2` step 6, `§7.1`, `§7.3`): fire a wave, wait, fire the next.

This module is the *plan* and its arithmetic, not the alarm. Core owns the Durable Object that rings
phones; the Brain owns the question "given this wave plan and these answers, what happens, and when
does the ladder take over". Modelling it as a pure simulation is what makes `D3`, `D4`, `D5`, `D6` and
`D10` assertable without a runtime: every event is stamped with the second it happened, so a trace can
show an operator the four seconds between the offer and the claim.

Two timing decisions are load-bearing and are stated here rather than discovered later:

- **A wave that everybody rejects advances immediately.** Waiting out a 25-second TTL for phones that
  have already answered is pure delay. The rest of the schedule does not shift — the ladder's clock is
  absolute from T+0 — so an early wave 2 leaves a gap before wave 3 rather than pushing the fallback
  later.
- **A wave offers only riders it has not already asked.** A rider who rejected is never re-offered the
  same order (`D4`), and wave membership is disjoint by construction (`D5`). The filter list refuses
  them again as a second line, not as the first.
"""

from __future__ import annotations

from dataclasses import dataclass

from dispatch.waves import FALLBACK_AT_S, Wave

#: The outcome strings, spelled once so the trace, the API and the tests cannot disagree.
ASSIGNED = "ASSIGNED"
FALLBACK = "FALLBACK"

#: The claim verdicts of `11 §7.3`, in the order the Durable Object checks them.
CLAIM_OK = "OK"
CLAIM_TAKEN = "OFFER_CLAIMED"
CLAIM_EXPIRED = "OFFER_EXPIRED"
CLAIM_NOT_YOURS = "OFFER_NOT_YOURS"

#: Event kinds written by the simulation. `WAVE_FIRED`, `OFFER_EXPIRED`, `OFFER_WITHDRAWN`,
#: `REJECT_RECORDED`, `CLAIM_REFUSED`, `ASSIGNED`, `FALLBACK`, `WAVE_SKIPPED`.
EVENT_KINDS = (
    "WAVE_FIRED",
    "OFFER_EXPIRED",
    "OFFER_WITHDRAWN",
    "REJECT_RECORDED",
    "CLAIM_REFUSED",
    "WAVE_SKIPPED",
    ASSIGNED,
    FALLBACK,
)


@dataclass(frozen=True)
class Offer:
    """One rider's live offer: which wave asked, from when, until when."""

    rider_id: str
    wave: int
    starts_at_s: int
    expires_at_s: int

    def live_at(self, at_s: int) -> bool:
        """Whether the offer is claimable at `at_s` — entered, and not yet expired."""
        return self.starts_at_s <= at_s < self.expires_at_s


@dataclass(frozen=True)
class CascadeEvent:
    """One line of the cascade's history, stamped in seconds since the order became assignable."""

    at_s: int
    kind: str
    rider_id: str | None = None
    wave: int | None = None
    detail: str = ""


@dataclass(frozen=True)
class ClaimResult:
    """The answer to "may this rider take this offer", with the code the app shows."""

    ok: bool
    code: str
    claimed_by: str | None = None


@dataclass(frozen=True)
class CascadeResult:
    """What the cascade did, for the trace and for the order's state event log."""

    order_id: str
    outcome: str
    claimed_by: str | None
    claimed_at_s: int | None
    offers: tuple[Offer, ...]
    events: tuple[CascadeEvent, ...]
    waves_fired: tuple[int, ...]
    fallback_at_s: int

    @property
    def assigned(self) -> bool:
        """Whether a rider won the cascade."""
        return self.outcome == ASSIGNED

    def event_kinds(self, kind: str) -> tuple[CascadeEvent, ...]:
        """Every event of one kind, for a test or an admin filter."""
        return tuple(event for event in self.events if event.kind == kind)


def plan_offers(waves: list[Wave], start_s: int = 0) -> tuple[Offer, ...]:
    """Turn the wave plan into offers, refusing a plan that could ring one rider twice.

    Disjointness and ascending wave numbers are checked here because this is the only place that sees
    the whole plan; a violation is a bug in wave sizing, not a runtime condition to be tolerated.
    """
    seen: set[str] = set()
    previous_number = 0
    offers: list[Offer] = []
    for wave in waves:
        if wave.wave <= previous_number:
            raise ValueError(f"wave numbers must ascend, got {wave.wave} after {previous_number}")
        if not wave.rider_ids:
            raise ValueError(f"wave {wave.wave} has no riders")
        for rider_id in wave.rider_ids:
            if rider_id in seen:
                raise ValueError(f"{rider_id} appears in two waves; wave membership must be disjoint")
            seen.add(rider_id)
            offers.append(
                Offer(
                    rider_id=rider_id,
                    wave=wave.wave,
                    starts_at_s=start_s + wave.starts_at_s,
                    expires_at_s=start_s + wave.starts_at_s + wave.ttl_s,
                )
            )
        previous_number = wave.wave
    return tuple(offers)


def claim(
    offers: tuple[Offer, ...],
    rider_id: str,
    at_s: int,
    claimed_by: str | None = None,
) -> ClaimResult:
    """The pure form of `11 §7.3`: exactly one rider may win, whoever asks first.

    `claimed_by` is the state the Durable Object already holds. Passing it in — rather than mutating a
    shared object — is what lets a 50-way simultaneous claim be tested as 50 ordinary function calls
    and still produce one winner.
    """
    if claimed_by is not None:
        return ClaimResult(ok=False, code=CLAIM_TAKEN, claimed_by=claimed_by)
    mine = next((offer for offer in offers if offer.rider_id == rider_id), None)
    if mine is None:
        return ClaimResult(ok=False, code=CLAIM_NOT_YOURS)
    if not mine.live_at(at_s):
        return ClaimResult(ok=False, code=CLAIM_EXPIRED)
    return ClaimResult(ok=True, code=CLAIM_OK, claimed_by=rider_id)


def run_cascade(
    order_id: str,
    waves: list[Wave],
    claims: tuple[tuple[str, int], ...] = (),
    rejects: tuple[tuple[str, int], ...] = (),
    start_s: int = 0,
) -> CascadeResult:
    """Simulate a wave plan against the riders' answers, and end in an assignment or the ladder.

    `claims` and `rejects` are `(rider_id, at_s)` pairs. Ordering is deterministic: by time, then
    claims before rejects, then rider id. A claim and a rejection in the same second must not depend on
    which list the caller built first, and an acceptance should never lose to a same-second refusal.
    """
    offers = plan_offers(waves, start_s=start_s)
    by_rider: dict[str, list[Offer]] = {}
    for offer in offers:
        by_rider.setdefault(offer.rider_id, []).append(offer)

    events: list[CascadeEvent] = []
    live: dict[str, Offer] = {}
    rejected: set[str] = set()
    fired: list[int] = []
    cursor = 0
    claimed_by: str | None = None
    claimed_at_s: int | None = None

    def scheduled_start(index: int) -> int:
        return start_s + waves[index].starts_at_s

    def withdraw(at_s: int, kind: str, detail: str) -> None:
        for offer in list(live.values()):
            events.append(CascadeEvent(at_s, kind, offer.rider_id, offer.wave, detail))
        live.clear()

    def fire(index: int, at_s: int) -> None:
        nonlocal cursor
        wave = waves[index]
        withdraw(at_s, "OFFER_WITHDRAWN", "superseded")
        wanted = [rider_id for rider_id in wave.rider_ids if rider_id not in rejected]
        cursor = index + 1
        if not wanted:
            events.append(CascadeEvent(at_s, "WAVE_SKIPPED", None, wave.wave, "every rider had rejected"))
            if cursor < len(waves):
                fire(cursor, at_s)
            return
        fired.append(wave.wave)
        for rider_id in wanted:
            live[rider_id] = Offer(rider_id, wave.wave, at_s, at_s + wave.ttl_s)
        events.append(CascadeEvent(at_s, "WAVE_FIRED", None, wave.wave, f"{len(wanted)} offer(s)"))

    def fire_due(at_s: int) -> None:
        while cursor < len(waves) and scheduled_start(cursor) <= at_s:
            fire(cursor, scheduled_start(cursor))

    for rider_id, at_s in tuple(claims) + tuple(rejects):
        if at_s < 0:
            raise ValueError(f"{rider_id} answered at a negative second ({at_s})")
    timeline = sorted(
        [(at_s, 0, rider_id) for rider_id, at_s in claims] + [(at_s, 1, rider_id) for rider_id, at_s in rejects],
        key=lambda item: (item[0], item[1], item[2]),
    )

    for at_s, kind_rank, rider_id in timeline:
        if claimed_by is not None or at_s >= start_s + FALLBACK_AT_S:
            break
        fire_due(at_s)
        if kind_rank == 0:
            verdict = claim(tuple(live.values()), rider_id, at_s, claimed_by)
            if not verdict.ok:
                events.append(CascadeEvent(at_s, "CLAIM_REFUSED", rider_id, None, verdict.code))
                continue
            wave_number = live[rider_id].wave
            claimed_by, claimed_at_s = rider_id, at_s
            withdraw(at_s, "OFFER_WITHDRAWN", "taken")
            events.append(CascadeEvent(at_s, ASSIGNED, rider_id, wave_number, "claimed"))
            continue
        if rider_id not in live:
            events.append(CascadeEvent(at_s, "REJECT_RECORDED", rider_id, None, "no live offer"))
            continue
        wave_number = live[rider_id].wave
        del live[rider_id]
        rejected.add(rider_id)
        events.append(CascadeEvent(at_s, "OFFER_WITHDRAWN", rider_id, wave_number, "rejected"))
        events.append(CascadeEvent(at_s, "REJECT_RECORDED", rider_id, wave_number, "rider said no"))
        if not live and cursor < len(waves):
            fire(cursor, at_s)

    if claimed_by is None:
        fire_due(start_s + FALLBACK_AT_S)
        withdraw(start_s + FALLBACK_AT_S, "OFFER_EXPIRED", "wave ended")
        events.append(CascadeEvent(start_s + FALLBACK_AT_S, FALLBACK, None, None, "no acceptance before the ladder"))

    return CascadeResult(
        order_id=order_id,
        outcome=ASSIGNED if claimed_by is not None else FALLBACK,
        claimed_by=claimed_by,
        claimed_at_s=claimed_at_s,
        offers=offers,
        events=tuple(events),
        waves_fired=tuple(fired),
        fallback_at_s=start_s + FALLBACK_AT_S,
    )
