/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Joining the two halves of a candidate into one snapshot (`11 §7`, D120).
 *
 * Dispatch asks one question — *may this rider be offered this order?* — and answers it against a `RiderSnapshot`
 * whose fields are written by three different parts of the platform. TiDB knows who the rider is (approval, shift,
 * verification, cash, load); D1 knows where they are (position, its age, its deadline); the policy table knows what
 * their vehicle may carry. This module is the seam, and it is a pure function so the seam can be tested without
 * either store.
 *
 * **The identity is the trap.** `rider_current.rider_id` holds the token's `sub` — the **user id** — while
 * `order_offers.rider_id` and `riders.id` are the **row id** (D110). The join below is done on `userId` and there is
 * a test that fails if it is ever changed to `riderId`, because the failure mode is silent: every rider would look
 * unconnected, every filter 4 would refuse, and the queue would be empty with no error anywhere.
 *
 * **What this module refuses, and what it leaves to the filters.** Two things cannot be turned into a snapshot at
 * all: a rider whose vehicle the policy table does not describe, and a rider whose zone polygon is missing or
 * malformed. Both are data errors, both are reported with the rider's code so an operator can fix the row, and
 * neither becomes a filter refusal — a filter refusal means "we judged you and the answer was no", which would be a
 * lie about a rider nobody could judge. Everything else, including a rider with no live position, becomes a
 * snapshot and is refused by number: a missing fix has no age, so it carries an infinite one and filter 4 names it
 * `POSITION_FRESH` like any other stale position. One vocabulary, one place to look.
 */

import type { PointE7 } from "@undal/contracts";
import type { AssignmentTarget, RiderSnapshot } from "./assignment.ts";
import type { DispatchCandidate } from "../../repositories/dispatch.ts";
import { distanceOutsideZoneM, type ZoneRing } from "../geo/zone-shape.ts";
import { estimateRoute } from "./distance.ts";

/** A rider's last accepted fix, as `workers/realtime`'s candidate feed returns it (D117). */
export interface FeedFix {
  /** The token's `sub` — **not** a `riders` row id. */
  readonly riderId: string;
  readonly latE7: number;
  readonly lonE7: number;
  readonly accuracyM: number;
  readonly batteryPct: number | null;
  readonly updatedAtMs: number;
  /** Absolute deadline in epoch milliseconds, from the rider's own row. */
  readonly staleAfterMs: number;
}

/** The facts that live outside both candidate halves. Every field is required, empty is allowed, silent is not. */
export interface AssemblySignals {
  /** Waves this rider was already asked in for **this** order and declined, keyed by `riders.id` hex. */
  readonly rejectedWavesByRider: ReadonlyMap<string, readonly number[]>;
  /** Riders with at least one push-enabled device (`11 §7` filter 14). */
  readonly notificationsAllowed: ReadonlySet<string>;
  /** Riders under an active suspension (`11 §7` filter 6). */
  readonly suspendedRiders: ReadonlySet<string>;
  /**
   * Riders inside a per-vendor rejection cooldown for this order's vendor (`11 §9` effect, `11 §9.2`).
   *
   * The cooldown has no table yet — D120 does not invent one — so the writer passes an empty set and this is the
   * seam where the deferred effect will arrive. It is a parameter rather than a `false` constant so that the day
   * the table exists, the filter starts working without the assembly changing.
   */
  readonly vendorCooldownRiders: ReadonlySet<string>;
}

/** Why a candidate could not become a snapshot: a data error, not a judgement about the rider. */
export interface AssemblyRefusal {
  readonly riderId: string;
  readonly code: string;
  readonly reason: "UNKNOWN_VEHICLE" | "ZONE_SHAPE_UNKNOWN";
}

/** Everything the assembly needs, named once so the writer cannot forget a half. */
export interface AssemblyInput {
  readonly candidates: readonly DispatchCandidate[];
  readonly fixes: readonly FeedFix[];
  /** Zone polygons by zone id hex. A rider whose zone is absent is refused, not assumed inside. */
  readonly zones: ReadonlyMap<string, ZoneRing>;
  /** Where the food is: the origin of the rider's distance to the vendor. */
  readonly vendor: PointE7;
  readonly target: AssignmentTarget;
  readonly nowMs: number;
  readonly signals: AssemblySignals;
}

/** The result: snapshots ready for the filters, and the candidates that could not be described. */
export interface AssemblyResult {
  readonly snapshots: readonly RiderSnapshot[];
  readonly refusals: readonly AssemblyRefusal[];
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Assemble the snapshots.
 *
 * Order is preserved from the candidate list, which is ordered by `riders.id` — the filters re-rank anyway, but a
 * deterministic order is what makes a wave reproducible when the same zone is planned twice.
 */
export function assembleSnapshots(input: AssemblyInput): AssemblyResult {
  const fixes = new Map<string, FeedFix>();
  for (const fix of input.fixes) {
    // First wins: the feed is ordered newest-first, and a duplicate row is a bug rather than a candidate for
    // averaging.
    if (!fixes.has(fix.riderId)) fixes.set(fix.riderId, fix);
  }
  const zoneHex = new Map<string, string>();
  for (const key of input.zones.keys()) zoneHex.set(key.toLowerCase(), key);

  const snapshots: RiderSnapshot[] = [];
  const refusals: AssemblyRefusal[] = [];

  for (const candidate of input.candidates) {
    const rowId = hex(candidate.riderId);
    const userId = hex(candidate.userId);

    if (candidate.policy === null) {
      refusals.push({ riderId: rowId, code: candidate.code, reason: "UNKNOWN_VEHICLE" });
      continue;
    }
    const ringKey = zoneHex.get(candidate.zoneId.toLowerCase());
    const ring = ringKey === undefined ? undefined : input.zones.get(ringKey);
    if (ring === undefined) {
      refusals.push({ riderId: rowId, code: candidate.code, reason: "ZONE_SHAPE_UNKNOWN" });
      continue;
    }

    const fix = fixes.get(userId);
    const point: PointE7 | null = fix === undefined ? null : { latE7: fix.latE7, lonE7: fix.lonE7 };
    // A rider with no live row has no age. An infinite age routes them through filter 4 like any stale fix, so
    // they are refused by name rather than dropped before anyone can say why.
    const positionAgeS =
      fix === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor((input.nowMs - fix.updatedAtMs) / 1000));
    const positionStaleAfterS =
      fix === undefined ? 0 : Math.max(0, Math.floor((fix.staleAfterMs - fix.updatedAtMs) / 1000));

    snapshots.push({
      // The snapshot carries the row id — the identity an offer points at — while `userId` was only the key that
      // found the fix above. Conflating them is D110's bug, and an offer written with a user id would point at
      // nothing: the foreign key is `riders.id`.
      riderId: rowId,
      status: candidate.status,
      shiftState: candidate.shiftState === "BREAK" ? "ON_BREAK" : candidate.shiftState,
      selfieVerified: candidate.selfieVerified,
      positionAgeS,
      positionStaleAfterS,
      // A cash-locked shift has no candidate row at all: `ridersInZone` excludes the state, so this is not a
      // default that hides a filter — filter 5 can never see a locked rider, by construction.
      cashLocked: false,
      suspended: input.signals.suspendedRiders.has(rowId),
      zoneId: candidate.zoneId,
      distanceToZoneEdgeM: point === null ? 0 : distanceOutsideZoneM(ring, point),
      vehicleMaxRadiusM: candidate.policy.maxRadiusM,
      // Straight line, marked where it is produced: routing is not built, and `D67` already tells customers the
      // difference between a road and a map. A rider's eligibility is judged on the same number the fee is.
      routedDistanceToVendorM: point === null ? 0 : estimateRoute(point, input.vendor).distanceM,
      currentLoad: candidate.activeLoad,
      maxConcurrent: candidate.policy.maxConcurrent,
      // Both halves of what the rider is carrying (D152): this shift's collections plus whatever earlier shifts still
      // owe. `25 §7` promises a rider who paid part of a balance that they go online "with a reduced cash limit equal to
      // their remaining headroom", and this line is what makes that sentence true — the ৳3 500 ceiling counts the debt.
      cashInHandPaisa: candidate.cashCollectedPaisa + candidate.cashOwedPaisa,
      cashLimitPaisa: candidate.cashLimitPaisa,
      rejectedWaves: input.signals.rejectedWavesByRider.get(rowId) ?? [],
      vendorCooldown: input.signals.vendorCooldownRiders.has(rowId),
      notificationsAllowed: input.signals.notificationsAllowed.has(rowId),
    });
  }

  return { snapshots, refusals };
}
