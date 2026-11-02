"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The bundle proof (`12 §5`), and its re-validation at accept time.

A bundle offer carries the evidence that produced it: the permutation, the detours, every constraint's
verdict, and the score. The rider's phone shows the card for twenty-five seconds, and in those seconds
a kitchen can slow down, a rider can accept something else, and a customer can add a note — so the
proof is checked again when the rider accepts. If it no longer holds, the second order is removed from
the offer and dispatched separately: the rider sees a single-order card, not an error, and the platform
does not ship a bundle it cannot defend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from batch.constraints import ConstraintReport, MAX_DETOUR_S
from batch.score import ScoreBreakdown


@dataclass(frozen=True)
class BundleProof:
    """Everything an offer asserts, in a shape that can be stored and re-read."""

    bundle_id: str
    order_ids: tuple[str, ...]
    permutation: tuple[str, ...]
    detours_s: dict[str, int]
    total_route_m: int
    constraints: dict[str, bool | None]
    score: float
    handover_s: int

    def to_json(self) -> dict[str, Any]:
        """The wire shape of `12 §5`, with the constraint keys the admin panel renders."""
        return {
            "bundleId": self.bundle_id,
            "orders": list(self.order_ids),
            "permutation": list(self.permutation),
            "detoursS": dict(self.detours_s),
            "totalRouteM": self.total_route_m,
            "constraints": dict(self.constraints),
            "score": self.score,
            "handoverS": self.handover_s,
        }

    @staticmethod
    def from_json(payload: Mapping[str, Any]) -> "BundleProof":
        return BundleProof(
            bundle_id=str(payload["bundleId"]),
            order_ids=tuple(payload["orders"]),
            permutation=tuple(payload["permutation"]),
            detours_s={str(key): int(value) for key, value in payload["detoursS"].items()},
            total_route_m=int(payload["totalRouteM"]),
            constraints=dict(payload["constraints"]),
            score=float(payload["score"]),
            handover_s=int(payload["handoverS"]),
        )


def make_proof(
    bundle_id: str,
    order_ids: tuple[str, ...],
    permutation: tuple[str, ...],
    detours_s: dict[str, int],
    total_route_m: int,
    report: ConstraintReport,
    score: ScoreBreakdown,
    handover_s: int,
) -> BundleProof:
    """Assemble a proof, refusing to build one that does not pass its own constraints."""
    if not report.feasible:
        raise ValueError(f"cannot prove an infeasible bundle: {report.failed}")
    if set(permutation) != set(order_ids):
        raise ValueError("the permutation must contain exactly the bundle's orders")
    return BundleProof(
        bundle_id=bundle_id,
        order_ids=order_ids,
        permutation=permutation,
        detours_s=detours_s,
        total_route_m=total_route_m,
        constraints=dict(report.verdicts),
        score=score.total,
        handover_s=handover_s,
    )


@dataclass(frozen=True)
class Revalidation:
    """Whether the offer still holds, and which constraints stopped holding if not."""

    valid: bool
    broken: tuple[str, ...] = field(default_factory=tuple)


def revalidate(proof: BundleProof, report: ConstraintReport) -> Revalidation:
    """Check the proof against the world as it is now, at the moment the rider accepts.

    The detour ceiling is re-checked from the proof's own numbers as well as the fresh report: if a
    stored detour is already over budget, the proof was never honest — which is a different failure
    from a world that moved, and it must not be swallowed by a fresh "looks fine now".
    """
    stored_over_budget = tuple(order_id for order_id, detour in proof.detours_s.items() if detour > MAX_DETOUR_S)
    broken = tuple(sorted({*report.failed, *stored_over_budget}))
    return Revalidation(valid=not broken, broken=broken)
