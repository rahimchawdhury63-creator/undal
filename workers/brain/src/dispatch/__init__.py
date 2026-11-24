"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Dispatch: fourteen hard filters, fourteen weighted factors, and the waves that ask the winners.

The split is the design. A filter is a veto and cannot be argued with; a factor is an opinion in
`[0, 1]` and is always arguable, which is why the two are separate functions and why the factor
weights live in configuration rather than in code. `11 §3` and `11 §5` are the specifications.

Around that core sit the four things a dispatch decision needs to be operable: a cascade that ends in
an assignment or the ladder (`cascade.py`), a pre-warm cache that makes the accept fast
(`prewarm.py`), the six-rung ladder itself (`expansion.py`), and the trace that explains all of it
(`explain.py`).
"""

from dispatch.cascade import (
    ASSIGNED,
    EVENT_KINDS,
    FALLBACK,
    CascadeEvent,
    CascadeResult,
    ClaimResult,
    Offer,
    claim,
    plan_offers,
    run_cascade,
)
from dispatch.expansion import (
    ADMIN_EXCEPTION_KIND,
    ASK_CUSTOMER_AT_S,
    AUTO_CANCEL_AT_S,
    EXPANSION_LADDER,
    RELAX_AT_S,
    ExpansionStep,
    Relaxations,
    admin_exception,
    boosted_payout,
    due_step,
    may_auto_cancel,
    may_cancel,
    next_step,
    pickup_refund_paisa,
    relax_candidate,
    relax_candidates,
)
from dispatch.explain import (
    ENGINE_VERSION,
    TRACE_FACTOR_KEYS,
    TRACE_RETENTION_DAYS,
    TraceZone,
    build_dispatch_trace,
    factor_row,
    missing_fields,
    trace_retention_days,
)
from dispatch.factors import DEFAULT_WEIGHTS, PRINTED_WEIGHTS, FACTORS, Weights, normalise
from dispatch.filters import FILTERS, Candidate, OrderContext, filter_candidates
from dispatch.prewarm import (
    CACHE_PREFIX,
    CONFIG_CHANGED,
    EXPIRED,
    FRESH,
    PREWARM_MAX_AGE_S,
    PREWARM_TTL_S,
    RIDER_SET_CHANGED,
    RIDER_SET_DRIFT,
    STALE_AGE,
    PrewarmEntry,
    build_entry,
    is_warm,
    recompute_reason,
    rider_set_drift,
)
from dispatch.scoring import Scored, explain_row, score_candidates
from dispatch.waves import WAVE_SCHEDULE, Wave, size_waves

__all__ = [
    "ASSIGNED",
    "EVENT_KINDS",
    "FALLBACK",
    "CascadeEvent",
    "CascadeResult",
    "ClaimResult",
    "Offer",
    "claim",
    "plan_offers",
    "run_cascade",
    "ADMIN_EXCEPTION_KIND",
    "ASK_CUSTOMER_AT_S",
    "AUTO_CANCEL_AT_S",
    "EXPANSION_LADDER",
    "RELAX_AT_S",
    "ExpansionStep",
    "Relaxations",
    "admin_exception",
    "boosted_payout",
    "due_step",
    "may_auto_cancel",
    "may_cancel",
    "next_step",
    "pickup_refund_paisa",
    "relax_candidate",
    "relax_candidates",
    "ENGINE_VERSION",
    "TRACE_FACTOR_KEYS",
    "TRACE_RETENTION_DAYS",
    "TraceZone",
    "build_dispatch_trace",
    "factor_row",
    "missing_fields",
    "trace_retention_days",
    "CACHE_PREFIX",
    "CONFIG_CHANGED",
    "EXPIRED",
    "FRESH",
    "PREWARM_MAX_AGE_S",
    "PREWARM_TTL_S",
    "RIDER_SET_CHANGED",
    "RIDER_SET_DRIFT",
    "STALE_AGE",
    "PrewarmEntry",
    "build_entry",
    "is_warm",
    "recompute_reason",
    "rider_set_drift",
    "DEFAULT_WEIGHTS",
    "PRINTED_WEIGHTS",
    "FACTORS",
    "Weights",
    "normalise",
    "FILTERS",
    "Candidate",
    "OrderContext",
    "filter_candidates",
    "Scored",
    "explain_row",
    "score_candidates",
    "WAVE_SCHEDULE",
    "Wave",
    "size_waves",
]
