"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Dispatch: fourteen hard filters, fourteen weighted factors, and the waves that ask the winners.

The split is the design. A filter is a veto and cannot be argued with; a factor is an opinion in
`[0, 1]` and is always arguable, which is why the two are separate functions and why the factor
weights live in configuration rather than in code. `11 §3` and `11 §5` are the specifications.
"""

from dispatch.factors import DEFAULT_WEIGHTS, PRINTED_WEIGHTS, FACTORS, Weights, normalise
from dispatch.filters import FILTERS, Candidate, OrderContext, filter_candidates
from dispatch.scoring import Scored, explain_row, score_candidates
from dispatch.waves import WAVE_SCHEDULE, size_waves

__all__ = [
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
    "size_waves",
]
