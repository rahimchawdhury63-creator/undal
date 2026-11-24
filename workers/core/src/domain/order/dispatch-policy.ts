/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The numbers dispatch filters with, and where each one comes from (`11 §7`, `§9`).
 *
 * `assignment.ts` is deliberately arithmetic-free: its filters read `rider.vehicleMaxRadiusM` and
 * `rider.cashLimitPaisa` off the snapshot, so the module that decides *whether* a rule passes never has to know
 * *what* the rule's threshold is. That separation only pays off if the thresholds live somewhere with a citation,
 * which is this file. Two of them were previously nowhere at all — `max_concurrent` and the vehicle radius had no
 * column, no constant and no owner, so a wave writer would have had to invent them at the call site. Numbers
 * invented at a call site are how a bicycle ends up offered a 12 km delivery.
 *
 * Nothing here touches the network or the database.
 */

/** The vehicles a rider row may carry (`005_riders.sql` constrains the column to exactly these two). */
export type DispatchVehicle = "MOTORBIKE" | "BICYCLE";

/** What the vehicle decides, before any rider is considered. */
export interface VehiclePolicy {
  /** Filter 8's ceiling on `routedDistanceToVendorM` (`11 §7` filter 8, `10 §7.2`). */
  readonly maxRadiusM: number;
  /** Filter 9's ceiling on concurrent orders: a bicycle cannot carry three bags of hot food (`11 §7` filter 9). */
  readonly maxConcurrent: number;
}

/**
 * The vehicle table, verbatim from `11 §7` filters 8 and 9.
 *
 * Deliberately exhaustive over the two allowed values with no `default` branch: the column's CHECK constraint
 * makes a third value impossible in TiDB, so a `default` here could only ever fire on a bug, and it would fire
 * silently by handing that bug a radius.
 */
export const VEHICLE_POLICY: Readonly<Record<DispatchVehicle, VehiclePolicy>> = Object.freeze({
  BICYCLE: Object.freeze({ maxRadiusM: 4_000, maxConcurrent: 1 }),
  MOTORBIKE: Object.freeze({ maxRadiusM: 12_000, maxConcurrent: 3 }),
});

/** Default cash ceiling in hand, ৳3 500 (`11 §9`, the settlement threshold). */
export const DEFAULT_CASH_LIMIT_PAISA = 350_000;

/**
 * The vehicle's policy, or `null` when the row carries something the table does not describe.
 *
 * Returning `null` rather than a default is the point: an unrecognised vehicle is a data error, and a rider
 * whose limits cannot be computed must not be offered work under guessed limits. The caller records a refusal
 * (filter 8 cannot pass) instead of a radius.
 */
export function vehiclePolicy(vehicle: string): VehiclePolicy | null {
  if (vehicle === "MOTORBIKE") return VEHICLE_POLICY.MOTORBIKE;
  if (vehicle === "BICYCLE") return VEHICLE_POLICY.BICYCLE;
  return null;
}

/** The T+112 s relaxation (`11 §9` fallback row 1), as factors rather than edited numbers. */
export interface FallbackRelaxation {
  readonly radiusFactor: number;
  readonly cashLimitFactor: number;
  /** How far outside the rider's own zone boundary a rider may be and still be asked. */
  readonly outsideZoneEdgeM: number;
}

/**
 * What the fallback ladder loosens at `FALLBACK_AT_S` (`11 §9`): radius +20 %, cash cap +20 %, and riders up to
 * 3 000 m outside the boundary become eligible.
 *
 * It relaxes three filters and no others. Freshness, verification, suspension and the reject cooldown stay
 * exactly as they were — those are about trust, and a slow order is not a reason to trust a stale position or an
 * unverified face. Writing that boundary down is the whole reason this is a named type and not three scalars in a
 * call site: the tempting version of "relax" is a boolean, and a boolean relaxes everything.
 */
export const FALLBACK_RELAXATION: FallbackRelaxation = Object.freeze({
  radiusFactor: 1.2,
  cashLimitFactor: 1.2,
  outsideZoneEdgeM: 3_000,
});

/** The limits a rider is judged against once the fallback is in effect. */
export interface RelaxedLimits {
  readonly maxRadiusM: number;
  readonly maxConcurrent: number;
  readonly cashLimitPaisa: number;
  readonly zoneEdgeAllowanceM: number;
}

/**
 * Apply the relaxation to a vehicle policy and a cash limit.
 *
 * Rounded up, because a limit is a promise: `4 000 × 1.2 = 4 800` exactly, but `350 000 × 1.2 = 420 000` only
 * after floating-point multiplication of a 1.2 that is not representable in binary — `Math.ceil` makes the
 * promise hold in the direction the rider expects (never a metre or a paisa short of the documented figure).
 */
export function relaxForFallback(policy: VehiclePolicy, cashLimitPaisa: number): RelaxedLimits {
  return {
    maxRadiusM: Math.ceil(policy.maxRadiusM * FALLBACK_RELAXATION.radiusFactor),
    maxConcurrent: policy.maxConcurrent,
    cashLimitPaisa: Math.ceil(cashLimitPaisa * FALLBACK_RELAXATION.cashLimitFactor),
    zoneEdgeAllowanceM: FALLBACK_RELAXATION.outsideZoneEdgeM,
  };
}
