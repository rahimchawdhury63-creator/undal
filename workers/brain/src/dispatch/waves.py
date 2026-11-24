"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Wave sizing (`11 §7`): how many phones ring, in what order, for how long.

One offer at a time is slow; everyone at once wastes the alarm and teaches riders that losing races is
normal. Undal sizes each wave from the predicted acceptance probability of the candidates in it, and
stops adding riders as soon as the chance that *nobody* accepts falls below one in ten. The wave size
therefore follows the crowd: three strong candidates, or eight weak ones.

The waves are data — `(rider_ids, ttl_s, starts_at_s)` — because Core consumes the plan and decides
the claim (`11 §7.3`); the Brain decides who to ask, and never phones anybody itself.
"""

from __future__ import annotations

from dataclasses import dataclass

#: How many waves before the fallback ladder takes over (`11 §11`).
MAX_WAVES = 5

#: The most riders in one wave, so a small zone does not ring eight phones for one biryani.
MAX_WAVE_SIZE = 8

#: The chance that nobody in a wave accepts, below which the wave is good enough to send.
WAVE_CONFIDENCE_TARGET = 0.1

#: The offer TTL and start time of each wave, exactly as `11 §7.1` prints them.
WAVE_SCHEDULE = (
    (1, 25, 0),
    (2, 25, 25),
    (3, 22, 50),
    (4, 20, 72),
    (5, 20, 92),
)

#: When the fallback ladder takes over, in seconds after the order became assignable.
FALLBACK_AT_S = 112


@dataclass(frozen=True)
class Wave:
    """One wave: who is asked, when, for how long, and the chance it produces nobody."""

    wave: int
    rider_ids: tuple[str, ...]
    ttl_s: int
    starts_at_s: int
    p_none: float


def size_waves(scored: list, p_accept: list[float], target: float = 0.90, max_waves: int = MAX_WAVES) -> list[Wave]:
    """Choose wave membership so each wave has at least `target` chance of an acceptance.

    `P(no acceptance in wave) = prod(1 - p_i)`, and the candidate that crosses the threshold is
    *included*: stopping one short sends a wave the model has already judged worse than acceptable.

    The input order is the ranking from `scoring.score_candidates`, and it is preserved: a wave that
    reshuffled between retries would ring one rider twice and skip another entirely.
    """
    if len(scored) != len(p_accept):
        raise ValueError("every scored candidate needs an acceptance probability")
    if not 0.0 < target < 1.0:
        raise ValueError(f"target must be between 0 and 1, got {target}")
    threshold = 1.0 - target

    riders = [entry.rider_id if hasattr(entry, "rider_id") else str(entry) for entry in scored]
    probabilities = [float(p) for p in p_accept]
    for probability in probabilities:
        if not 0.0 <= probability <= 1.0:
            raise ValueError(f"acceptance probability must be 0..1, got {probability}")

    waves: list[Wave] = []
    cursor = 0
    for index in range(min(max_waves, len(WAVE_SCHEDULE))):
        if cursor >= len(riders):
            break
        number, ttl_s, starts_at_s = WAVE_SCHEDULE[index]
        chosen: list[str] = []
        p_none = 1.0
        while len(chosen) < MAX_WAVE_SIZE and cursor < len(riders):
            rider_id = riders[cursor]
            probability = probabilities[cursor]
            chosen.append(rider_id)
            p_none *= 1.0 - probability
            cursor += 1
            if p_none < threshold:
                break
        if chosen:
            waves.append(Wave(wave=number, rider_ids=tuple(chosen), ttl_s=ttl_s, starts_at_s=starts_at_s, p_none=p_none))
    return waves


def wave_expiry_s(wave: Wave) -> int:
    """When this wave's offers expire, in seconds after the order became assignable."""
    return wave.starts_at_s + wave.ttl_s


def fallback_due(assignable_since_s: int, now_s: int) -> bool:
    """Whether dispatch should move to the fallback ladder."""
    return now_s - assignable_since_s >= FALLBACK_AT_S
