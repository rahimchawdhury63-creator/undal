/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Which fixes are worth a network write (`07 §3.2–3.3`, D96).
 *
 * The ingest gate in `./ingest.ts` decides what the *server* believes. This decides what the *device* sends,
 * and the two are not the same question: a fix can be perfectly believable and still not worth a write,
 * because the marker would move two metres and the customer would learn nothing. D1's free tier is a write
 * budget, and the gate is how a 40 m threshold near the door and a 300 s heartbeat in an empty street both fit
 * inside it.
 *
 * The rules, in the order `07 §3.2` gives them:
 *
 * 1. An inaccurate fix is dropped before anything else — it would move the marker without the rider moving.
 * 2. The first fix after a gap is always sent; the map has to start somewhere.
 * 3. The **ceiling** forces a write even for a stationary rider, so a map never looks frozen.
 * 4. The **floor** suppresses a write, protecting the budget from GPS jitter and from a highway.
 * 5. Past the floor, displacement buys a write, a turn at walking pace buys one because a turn is
 *    informative within 100 m, and a change of order state buys one because the customer is watching a
 *    different question.
 *
 * The thresholds are not constants: `cadenceFor` returns the row of `07 §3.3` that the rider's situation
 * deserves, and the battery multipliers are applied there so a caller cannot ask for the profile of a rider
 * whose phone is about to die and get the profile of one plugged into a charger.
 */

import { haversineMeters } from "@undal/contracts";
import type { PointE7 } from "@undal/contracts";

import { MAX_ACCURACY_M } from "./ingest.ts";

/** How far from the drop a rider counts as "at the gate" (`07 §3.3`). */
export const AT_DROP_RADIUS_M = 200;

/** How far from the drop the last-kilometre cadence begins. */
const NEAR_DROP_RADIUS_M = 1_000;

/** At this battery the app widens every threshold by half; the shift matters more than the marker. */
export const BATTERY_LOW_PCT = 15;

/** At this battery it widens them by two and a half; the UI says why. */
export const BATTERY_CRITICAL_PCT = 8;

/** A bearing change worth a write even when the rider has barely moved (`07 §3.2`). */
export const TURN_DEGREES = 45;

/** How far a rider must have moved for a turn to be worth mentioning. */
export const TURN_MIN_MOVE_M = 30;

/** What the rider is doing. The profile follows the situation, not the button they pressed. */
export type RiderPhase =
  | "IDLE_STATIONARY"
  | "IDLE_MOVING"
  | "TO_VENDOR"
  | "CARRYING_FAR"
  | "CARRYING_NEAR"
  | "AT_DROP"
  | "BREAK";

/** One row of `07 §3.3`, after the battery multiplier. */
export interface CadenceProfile {
  /** Displacement that buys a write, or `null` when only the ceiling applies (a rider on break). */
  readonly displacementM: number | null;
  /** Minimum time between writes. */
  readonly floorMs: number;
  /** Maximum time between writes: the map's heartbeat. */
  readonly ceilingMs: number;
}

/** One fix as the device holds it. */
export interface DeviceFix extends PointE7 {
  readonly accuracyM: number;
  readonly bearingDeg: number | null;
  /** The device's clock at the fix. */
  readonly atMs: number;
}

/** What the device last put on the wire, and when. */
export interface SentFix extends PointE7 {
  readonly bearingDeg: number | null;
  readonly sentAtMs: number;
}

/** Why a fix was sent. Each reason is a different sentence in the diagnostics screen. */
export type SendReason = "first_fix" | "ceiling" | "displacement" | "turn" | "state_change";

/** Why a fix was not sent. */
export type DropReason = "poor_accuracy" | "floor" | "stationary";

/** The gate's answer. */
export type Decision =
  | { readonly send: true; readonly reason: SendReason }
  | { readonly send: false; readonly reason: DropReason };

const BASE_PROFILES: Readonly<Record<RiderPhase, CadenceProfile>> = {
  IDLE_STATIONARY: { displacementM: 150, floorMs: 20_000, ceilingMs: 300_000 },
  IDLE_MOVING: { displacementM: 150, floorMs: 15_000, ceilingMs: 120_000 },
  TO_VENDOR: { displacementM: 100, floorMs: 10_000, ceilingMs: 60_000 },
  CARRYING_FAR: { displacementM: 100, floorMs: 8_000, ceilingMs: 45_000 },
  CARRYING_NEAR: { displacementM: 60, floorMs: 6_000, ceilingMs: 25_000 },
  AT_DROP: { displacementM: 40, floorMs: 5_000, ceilingMs: 15_000 },
  BREAK: { displacementM: null, floorMs: 0, ceilingMs: 600_000 },
};

/** How much the battery widens the thresholds, or 1 when the phone is fine. */
export function batteryScale(batteryPct: number | null | undefined): number {
  if (batteryPct === null || batteryPct === undefined) return 1;
  if (batteryPct < BATTERY_CRITICAL_PCT) return 2.5;
  if (batteryPct < BATTERY_LOW_PCT) return 1.5;
  return 1;
}

/**
 * The profile for a rider's situation.
 *
 * A rider on `CARRYING_NEAR` who is not moving is judged by that row, not by `IDLE_STATIONARY`: the customer is
 * still watching the last kilometre, and the row is about what is being watched, not about the speedometer.
 */
export function cadenceFor(phase: RiderPhase, batteryPct?: number | null): CadenceProfile {
  const base = BASE_PROFILES[phase];
  const scale = batteryScale(batteryPct);
  if (scale === 1) return base;
  return {
    displacementM: base.displacementM === null ? null : Math.round(base.displacementM * scale),
    floorMs: Math.round(base.floorMs * scale),
    ceilingMs: Math.round(base.ceilingMs * scale),
  };
}

/**
 * The phase a rider is in, from what the server told the device.
 *
 * `distanceToDropM` is the straight line to the drop, which the device has and the server does not; the
 * thresholds are about what the customer sees, so the device is the right place to compute this.
 */
export function phaseFor(input: {
  readonly onBreak: boolean;
  readonly carrying: boolean;
  readonly distanceToDropM: number | null;
  readonly moving: boolean;
}): RiderPhase {
  if (input.onBreak) return "BREAK";
  if (!input.carrying) return input.moving ? "IDLE_MOVING" : "IDLE_STATIONARY";
  if (input.distanceToDropM === null) return "CARRYING_FAR";
  if (input.distanceToDropM <= AT_DROP_RADIUS_M) return "AT_DROP";
  if (input.distanceToDropM <= NEAR_DROP_RADIUS_M) return "CARRYING_NEAR";
  return "CARRYING_FAR";
}

/** The shortest angle between two bearings, in degrees, 0–180. */
export function angularDeltaDegrees(from: number | null, to: number | null): number {
  if (from === null || to === null) return 0;
  return Math.abs((((to - from + 540) % 360) + 360) % 360 - 180);
}

/**
 * Decide whether a fix is worth a write.
 *
 * `orderStateChanged` is the device's word that the rider's situation changed since the last sent fix — the
 * customer is now watching a different question, and the answer should not wait for a 25 s ceiling.
 */
export function shouldSend(
  fix: DeviceFix,
  last: SentFix | null,
  profile: CadenceProfile,
  orderStateChanged = false,
): Decision {
  if (!Number.isFinite(fix.latE7) || !Number.isFinite(fix.lonE7) || !Number.isFinite(fix.atMs)) {
    return { send: false, reason: "poor_accuracy" };
  }
  if (fix.accuracyM > MAX_ACCURACY_M) return { send: false, reason: "poor_accuracy" };
  if (last === null) return { send: true, reason: "first_fix" };

  const elapsed = fix.atMs - last.sentAtMs;
  if (elapsed >= profile.ceilingMs) return { send: true, reason: "ceiling" };
  if (elapsed < profile.floorMs) return { send: false, reason: "floor" };

  const moved = haversineMeters(last, fix);
  if (profile.displacementM !== null && moved >= profile.displacementM) {
    return { send: true, reason: "displacement" };
  }
  if (
    profile.displacementM !== null &&
    moved >= TURN_MIN_MOVE_M &&
    angularDeltaDegrees(last.bearingDeg, fix.bearingDeg) >= TURN_DEGREES
  ) {
    return { send: true, reason: "turn" };
  }
  if (orderStateChanged) return { send: true, reason: "state_change" };
  return { send: false, reason: "stationary" };
}
