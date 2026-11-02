"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Batching: ten constraints, six orderings at most, one score, and a proof that can be re-checked.

`12 §4` is the specification. The module split follows the questions in the order they are asked:
may these two travel together (`feasibility`), in which order (`permutations`), is it worth doing
(`score`), and can we still defend it when the rider taps accept (`proof`).
"""

from batch.constraints import (
    BATCH_SCORE_MIN,
    CAPACITY,
    DEFAULT_HANDOVER_S,
    MAX_BUNDLE_ORDERS,
    MAX_BUNDLE_SPAN_M,
    MAX_DETOUR_S,
    MAX_LEG_M,
    MAX_PERMUTATIONS,
    READY_WINDOW_S,
    ROUTE_PENALTY_PER_M,
    TEMPERATURE_DETOUR_S,
    BundleOrder,
    ConstraintReport,
    Legs,
    RiderFacts,
    ZonePressure,
    clamp_handover,
)
from batch.feasibility import Timings, evaluate, feasible_orderings
from batch.permutations import BestOrdering, best_ordering, cost_of
from batch.proof import BundleProof, Revalidation, make_proof, revalidate
from batch.score import WEIGHTS, ScoreBreakdown, ScoreInput, batch_score

__all__ = [
    "BATCH_SCORE_MIN",
    "CAPACITY",
    "DEFAULT_HANDOVER_S",
    "MAX_BUNDLE_ORDERS",
    "MAX_BUNDLE_SPAN_M",
    "MAX_DETOUR_S",
    "MAX_LEG_M",
    "MAX_PERMUTATIONS",
    "READY_WINDOW_S",
    "ROUTE_PENALTY_PER_M",
    "TEMPERATURE_DETOUR_S",
    "BundleOrder",
    "ConstraintReport",
    "Legs",
    "RiderFacts",
    "ZonePressure",
    "clamp_handover",
    "Timings",
    "evaluate",
    "feasible_orderings",
    "BestOrdering",
    "best_ordering",
    "cost_of",
    "BundleProof",
    "Revalidation",
    "make_proof",
    "revalidate",
    "WEIGHTS",
    "ScoreBreakdown",
    "ScoreInput",
    "batch_score",
]
