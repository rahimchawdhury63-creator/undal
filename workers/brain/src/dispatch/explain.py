"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The trace (`09 §6`, `D12`): every dispatch decision, written down with no field missing.

A trace is the answer to the only question that matters after a rider says "I should have got that
job": *why didn't I?* It is assembled **after** the decision, from values the engine already
computed — never recomputed for display, because a trace that re-derives the score can disagree with
the score that was actually used. The shape is the document's: `inputs`, `features`, `intermediates`,
`output`, `durationMs`.

Two details keep it honest. Every factor appears under a camelCase key derived from the engine's own
factor list, so a new factor cannot be added without appearing in the trace (the test asserts one key
per factor, and `09 §6`'s example — which lists a `cooldown` key that no factor produces and omits
area familiarity — is recorded as `D75`). And `missing_fields` walks the declared schema rather than
trusting the builder, so a trace from an older deploy can be rejected at the boundary instead of
rendering a blank bar in the admin panel.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from dispatch.factors import FACTORS
from dispatch.filters import Candidate
from dispatch.scoring import RiderHistory, Scored, ZoneFeatures
from dispatch.waves import FALLBACK_AT_S, Wave

#: The engine version stamped on every trace. Bumped deliberately when a decision changes.
ENGINE_VERSION = "d7.2.0"

#: The trace kinds of `09 §6` and how long each is kept, in days.
TRACE_RETENTION_DAYS = {
    "FARE": 14,
    "RANK": 14,
    "DISPATCH": 90,
    "BATCH": 90,
    "FORECAST": 7,
    "PREPTIME": 7,
}

#: The factor names as the trace spells them: camelCase, with the document's names where one exists.
TRACE_FACTOR_KEYS = {
    "proximity": "proximity",
    "eta_fit": "etaFit",
    "acceptance": "acceptance",
    "reliability": "reliability",
    "fairness": "fairness",
    "rating": "rating",
    "vendor_familiarity": "vendorFamiliarity",
    "area_familiarity": "areaFamiliarity",
    "batch_fit": "batchFit",
    "load_balance": "loadBalance",
    "cash_headroom": "cashRisk",
    "zone_coverage": "zoneFit",
    "freshness": "freshness",
    "vehicle_fit": "vehicleFit",
}


@dataclass(frozen=True)
class TraceZone:
    """The zone telemetry a dispatch trace records alongside the per-rider features."""

    active_orders: int
    active_riders: int
    sdr: float
    detour_factor: float
    as_of: str

    def __post_init__(self) -> None:
        """Refuse negative counts; a zone with −1 riders is a broken sensor, not a busy one."""
        if self.active_orders < 0 or self.active_riders < 0:
            raise ValueError("zone counts cannot be negative")
        if not self.as_of:
            raise ValueError("a trace must carry the timestamp its features were read at")


def factor_row(scored: Scored, rank: int) -> dict:
    """One candidate's intermediate row: raw factors, weighted contributions, and final rank."""
    factors = {TRACE_FACTOR_KEYS[name]: value for name, value in zip(FACTORS, scored.factors)}
    return {
        "riderId": scored.rider_id,
        "factors": factors,
        "weighted": scored.total,
        "rank": rank,
    }


def build_dispatch_trace(
    order_id: str,
    zone_id: str,
    vendor_point: Mapping[str, float],
    drop_point: Mapping[str, float],
    subtotal_paisa: int,
    ready_at: str,
    candidates: list[Candidate],
    scored: list[Scored],
    histories: Mapping[str, RiderHistory],
    zone: ZoneFeatures,
    telemetry: TraceZone,
    waves: list[Wave],
    duration_ms: int,
    weights_version: str = "r10.3.1",
    engine_version: str = ENGINE_VERSION,
) -> dict:
    """Assemble the `DISPATCH` trace for one decision.

    `scored` is the engine's actual output, in rank order; the trace never re-sorts or re-weights it.
    `zone` is kept in the signature because the factors were computed against it, even though the
    trace records `telemetry` — the medians are an input, the live counts are evidence.
    """
    if duration_ms < 0:
        raise ValueError(f"duration_ms cannot be negative, got {duration_ms}")
    if subtotal_paisa < 0:
        raise ValueError(f"subtotal_paisa cannot be negative, got {subtotal_paisa}")
    for label, point in (("vendorPoint", vendor_point), ("dropPoint", drop_point)):
        if "lat" not in point or "lon" not in point:
            raise ValueError(f"{label} needs lat and lon")
    if ready_at == "":
        raise ValueError("readyAt is required")
    if zone.median_pickup_m <= 0:
        raise ValueError("zone features must carry a positive median pickup distance")

    by_id = {candidate.rider_id: candidate for candidate in candidates}
    unknown = [entry.rider_id for entry in scored if entry.rider_id not in by_id]
    if unknown:
        raise ValueError(f"scored riders missing from the candidate list: {unknown}")

    features = []
    for entry in scored:
        candidate = by_id[entry.rider_id]
        history = histories.get(entry.rider_id, RiderHistory())
        features.append(
            {
                "riderId": entry.rider_id,
                "distanceM": candidate.routed_to_vendor_m,
                "etaToVendorS": history.eta_to_vendor_s,
                "acceptRate": history.acceptance_probability,
                "onTimeRate": history.on_time_rate,
                "idleSeconds": history.idle_s,
                "vendorFamiliarity": history.deliveries_from_vendor,
                "cashInHandPaisa": candidate.cash_in_hand_paisa,
                "asOf": telemetry.as_of,
            }
        )

    ranked = set(by_id)
    for wave in waves:
        missing = set(wave.rider_ids) - ranked
        if missing:
            raise ValueError(f"wave {wave.wave} names unscored riders: {sorted(missing)}")

    counts = {f"wave{wave.wave}": len(wave.rider_ids) for wave in waves}
    return {
        "kind": "DISPATCH",
        "engineVersion": engine_version,
        "weightsVersion": weights_version,
        "inputs": {
            "orderId": order_id,
            "zoneId": zone_id,
            "vendorPoint": {"lat": float(vendor_point["lat"]), "lon": float(vendor_point["lon"])},
            "dropPoint": {"lat": float(drop_point["lat"]), "lon": float(drop_point["lon"])},
            "subtotalPaisa": subtotal_paisa,
            "readyAt": ready_at,
            "candidateCount": len(candidates),
        },
        "features": {
            "zone": {
                "activeOrders": telemetry.active_orders,
                "activeRiders": telemetry.active_riders,
                "sdr": telemetry.sdr,
                "detourFactor": telemetry.detour_factor,
                "asOf": telemetry.as_of,
            },
            "candidates": features,
        },
        "intermediates": {
            "candidates": [
                factor_row(entry, rank) for rank, entry in enumerate(scored, start=1)
            ],
            "waveSizing": {
                "counts": counts,
                "intervalS": waves[0].ttl_s if waves else 0,
                "fallbackAfterS": FALLBACK_AT_S,
            },
        },
        "output": {
            "waves": [list(wave.rider_ids) for wave in waves],
            "offerTtlS": waves[0].ttl_s if waves else 0,
            "fallbackAfterS": FALLBACK_AT_S,
        },
        "durationMs": duration_ms,
    }


def _missing(mapping: Mapping, keys: tuple[str, ...], prefix: str) -> list[str]:
    return [f"{prefix}.{key}" for key in keys if key not in mapping]


def missing_fields(trace: Mapping) -> tuple[str, ...]:
    """Every path the dispatch trace schema requires and this trace does not carry."""
    missing: list[str] = _missing(
        trace,
        ("kind", "engineVersion", "weightsVersion", "inputs", "features", "intermediates", "output", "durationMs"),
        "",
    )
    inputs = trace.get("inputs") or {}
    missing += _missing(inputs, ("orderId", "zoneId", "vendorPoint", "dropPoint", "subtotalPaisa", "readyAt", "candidateCount"), "inputs")
    features = trace.get("features") or {}
    missing += _missing(features, ("zone", "candidates"), "features")
    missing += _missing(features.get("zone") or {}, ("activeOrders", "activeRiders", "sdr", "detourFactor", "asOf"), "features.zone")
    for index, row in enumerate(features.get("candidates") or []):
        missing += _missing(
            row,
            ("riderId", "distanceM", "etaToVendorS", "acceptRate", "onTimeRate", "idleSeconds", "vendorFamiliarity", "cashInHandPaisa", "asOf"),
            f"features.candidates[{index}]",
        )
    intermediates = trace.get("intermediates") or {}
    missing += _missing(intermediates, ("candidates", "waveSizing"), "intermediates")
    for index, row in enumerate(intermediates.get("candidates") or []):
        missing += _missing(row, ("riderId", "factors", "weighted", "rank"), f"intermediates.candidates[{index}]")
        keys = tuple(TRACE_FACTOR_KEYS[name] for name in FACTORS)
        missing += _missing(row.get("factors") or {}, keys, f"intermediates.candidates[{index}].factors")
    missing += _missing(
        intermediates.get("waveSizing") or {},
        ("counts", "intervalS", "fallbackAfterS"),
        "intermediates.waveSizing",
    )
    missing += _missing(trace.get("output") or {}, ("waves", "offerTtlS", "fallbackAfterS"), "output")
    return tuple(path.lstrip(".") for path in missing)


def trace_retention_days(kind: str) -> int:
    """How long a trace of this kind is kept (`09 §6.2`). Unknown kinds are refused, not guessed."""
    try:
        return TRACE_RETENTION_DAYS[kind]
    except KeyError as error:
        raise ValueError(f"unknown trace kind {kind!r}") from error
