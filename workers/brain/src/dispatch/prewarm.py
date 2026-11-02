"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The pre-warm cache (`11 §2.1`): score the order while the vendor is still deciding.

Steps 1, 2 and 4 — filters, enrichment and scoring — run speculatively when the order is *placed*,
and the result waits in `OrderHub` for the accept. When the vendor accepts, the cascade begins from a
warm cache instead of a fresh 400 ms round trip, which is the difference between an offer at 310 ms
and an offer at half a second.

A cache that is wrong is worse than a cache that is cold, so two things invalidate it: age (60 s) and
a changed crowd (more than 20% of the zone's rider set, by symmetric difference). A cache also dies at
180 s regardless, because a score from three minutes ago is not evidence about now. The invalidation
is a pure function of the entry and the current world, which is why it can be tested at 60/61 s and at
20%/21% drift without a clock or a Durable Object.
"""

from __future__ import annotations

from dataclasses import dataclass

from dispatch.scoring import Scored
from dispatch.waves import Wave

#: How long a warm entry may sit in `OrderHub`.
PREWARM_TTL_S = 180

#: The age past which the scores are recomputed even though the entry is still cached.
PREWARM_MAX_AGE_S = 60

#: The fraction of the rider set that may change before the whole entry is discarded.
RIDER_SET_DRIFT = 0.20

#: The KV prefix, so a pre-warm entry is never mistaken for dispatch state.
CACHE_PREFIX = "dispatch:prewarm:"

#: The recompute reasons, and the absence of one. `FRESH` is a successful cache hit.
FRESH = "FRESH"
EXPIRED = "EXPIRED"
STALE_AGE = "STALE_AGE"
RIDER_SET_CHANGED = "RIDER_SET_CHANGED"
CONFIG_CHANGED = "CONFIG_CHANGED"

#: The document's observed warm-hit rate (`11 §2.1`), recorded so a regression has a baseline.
DOCUMENTED_HIT_RATE = 0.78


@dataclass(frozen=True)
class PrewarmEntry:
    """A dispatch decision frozen at `computed_at_s`, ready to be serialised into KV."""

    order_id: str
    computed_at_s: int
    rider_ids: tuple[str, ...]
    scored: tuple[Scored, ...]
    waves: tuple[Wave, ...]
    weights_version: str = "r10.3.1"
    engine_version: str = "d7.2.0"

    @property
    def cache_key(self) -> str:
        """The KV key this entry lives under."""
        return f"{CACHE_PREFIX}{self.order_id}"

    def age_s(self, now_s: int) -> int:
        """Seconds since the scores were computed; negative if the clock went backwards."""
        return now_s - self.computed_at_s

    def to_json(self) -> dict:
        """A JSON-safe payload for `OrderHub` storage — tuples become lists, and nothing else moves."""
        return {
            "orderId": self.order_id,
            "computedAtS": self.computed_at_s,
            "weightsVersion": self.weights_version,
            "engineVersion": self.engine_version,
            "riderIds": list(self.rider_ids),
            "scored": [
                {"riderId": entry.rider_id, "total": entry.total, "factors": list(entry.factors)}
                for entry in self.scored
            ],
            "waves": [
                {
                    "wave": wave.wave,
                    "riderIds": list(wave.rider_ids),
                    "ttlS": wave.ttl_s,
                    "startsAtS": wave.starts_at_s,
                    "pNone": wave.p_none,
                }
                for wave in self.waves
            ],
        }

    @classmethod
    def from_json(cls, payload: dict) -> "PrewarmEntry":
        """Rebuild an entry from `to_json`, refusing a payload that is missing a field."""
        try:
            return cls(
                order_id=str(payload["orderId"]),
                computed_at_s=int(payload["computedAtS"]),
                weights_version=str(payload["weightsVersion"]),
                engine_version=str(payload["engineVersion"]),
                rider_ids=tuple(str(rider_id) for rider_id in payload["riderIds"]),
                scored=tuple(
                    Scored(
                        rider_id=str(row["riderId"]),
                        total=float(row["total"]),
                        factors=tuple(float(value) for value in row["factors"]),
                    )
                    for row in payload["scored"]
                ),
                waves=tuple(
                    Wave(
                        wave=int(row["wave"]),
                        rider_ids=tuple(str(rider_id) for rider_id in row["riderIds"]),
                        ttl_s=int(row["ttlS"]),
                        starts_at_s=int(row["startsAtS"]),
                        p_none=float(row["pNone"]),
                    )
                    for row in payload["waves"]
                ),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"malformed pre-warm entry: {error}") from error


def build_entry(
    order_id: str,
    computed_at_s: int,
    scored: list[Scored],
    waves: list[Wave],
    weights_version: str = "r10.3.1",
    engine_version: str = "d7.2.0",
) -> PrewarmEntry:
    """Freeze a scored candidate list and its waves into a cache entry.

    The waves must only ask riders that were scored: a wave naming an unknown rider is a plan that
    cannot be executed, and finding that out at the top of the cascade is finding out too late.
    """
    if computed_at_s < 0:
        raise ValueError(f"computed_at_s cannot be negative, got {computed_at_s}")
    ranked = {entry.rider_id for entry in scored}
    for wave in waves:
        unknown = set(wave.rider_ids) - ranked
        if unknown:
            raise ValueError(f"wave {wave.wave} names unscored riders: {sorted(unknown)}")
    return PrewarmEntry(
        order_id=order_id,
        computed_at_s=computed_at_s,
        rider_ids=tuple(sorted(ranked)),
        scored=tuple(scored),
        waves=tuple(waves),
        weights_version=weights_version,
        engine_version=engine_version,
    )


def rider_set_drift(previous: tuple[str, ...], current: tuple[str, ...]) -> float:
    """How much the zone's rider set moved, as a fraction of the previous set.

    Symmetric difference, not additions alone: a zone that lost five riders and gained five different
    ones is not the same crowd, even though its size is unchanged.
    """
    before = set(previous)
    after = set(current)
    if not before:
        return 0.0 if not after else 1.0
    return len(before.symmetric_difference(after)) / len(before)


def recompute_reason(
    entry: PrewarmEntry,
    now_s: int,
    current_rider_ids: tuple[str, ...],
    weights_version: str | None = None,
) -> str | None:
    """Why this entry must be recomputed, or `None` for a cache hit.

    Precedence is expiry, then age, then a changed crowd, then a changed weight set: the first reason
    is the one an operator sees, and the cheapest explanation should not hide the most serious one.
    """
    age = entry.age_s(now_s)
    if age >= PREWARM_TTL_S:
        return EXPIRED
    if age < 0 or age > PREWARM_MAX_AGE_S:
        return STALE_AGE
    if rider_set_drift(entry.rider_ids, current_rider_ids) > RIDER_SET_DRIFT:
        return RIDER_SET_CHANGED
    if weights_version is not None and weights_version != entry.weights_version:
        return CONFIG_CHANGED
    return None


def is_warm(
    entry: PrewarmEntry,
    now_s: int,
    current_rider_ids: tuple[str, ...],
    weights_version: str | None = None,
) -> bool:
    """Whether the cascade may start from this entry without recomputing."""
    return recompute_reason(entry, now_s, current_rider_ids, weights_version) is None
