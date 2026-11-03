/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Which positions may land in D1 (`07 §4.5`, D95).
 *
 * A position is a claim made by a phone. Some of those claims cannot be true — a fix that puts a bike at
 * 120 km/h, a timestamp from a clock that is eleven minutes fast, a rider in a lake outside every zone — and
 * the platform's job is to notice before writing, not after. D1 holds only what may be lost, but a lost
 * position is a customer watching a marker stop moving, so a plausible fix is worth keeping and an
 * implausible one is worth naming.
 *
 * Three rules of the module, in the order they matter:
 *
 * 1. **Mock location is a batch decision.** One fix carrying the OS's mock flag rejects the whole upload and
 *    suspends the shift. The alternative — accept the other nine fixes and drop one — turns a spoofed device
 *    into a partially trustworthy one, and the platform has no way to say which half.
 * 2. **Refusals are named and counted.** `poor_accuracy` is a phone under a bridge; `implausible_speed` is a
 *    teleport, a spoof or a tower fix, and it increments `teleport_count` for the rider's record. The two
 *    look identical in a count of "dropped fixes" and mean completely different things.
 * 3. **A refused fix does not move the baseline.** Speed is measured against the last *accepted* fix, so one
 *    bad point does not manufacture a second bad one from the good fix that follows it.
 *
 * Nothing here writes. The caller decides what to do with a suspension or an exception; this module decides
 * what the platform is willing to believe.
 */

import { haversineMeters, inBbox } from "@undal/contracts";
import type { BboxE7 } from "@undal/contracts";

/** The worst accuracy worth storing. Past this the marker moves without the rider moving (`07 §3.2`). */
export const MAX_ACCURACY_M = 60;

/** How far ahead of the edge clock a device's clock may be before its timestamps are refused. */
export const MAX_CLOCK_AHEAD_MS = 30_000;

/** How far outside its zone a position may be before it is worth an operator's attention. */
export const BBOX_INFLATE_M = 20_000;

/** The fastest a rider may plausibly be moving, by vehicle. A motorbike at 144 km/h is already generous. */
export const MAX_SPEED_MPS: Readonly<Record<VehicleClass, number>> = { MOTORBIKE: 40, BICYCLE: 15 };

/** What the rider is on, which is what "too fast" means. */
export type VehicleClass = "MOTORBIKE" | "BICYCLE";

/** One fix as the device reports it. Coordinates are the platform's e7 integers. */
export interface PositionFix {
  readonly latE7: number;
  readonly lonE7: number;
  /** Horizontal accuracy in metres; the OS's own number. */
  readonly accuracyM: number;
  readonly bearingDeg: number | null;
  readonly recordedAtMs: number;
  /** The OS's mock-location flag. Trustworthy on Android, absent on iOS. */
  readonly isMock: boolean;
}

/** A fix the platform has accepted, with the edge's arrival time beside the device's. */
export interface AcceptedFix extends PositionFix {
  readonly receivedAtMs: number;
}

/** Why a fix was refused. Each name is a different operational story. */
export type RefusalReason =
  | "mock_location"
  | "poor_accuracy"
  | "clock_ahead"
  | "out_of_order"
  | "implausible_speed"
  | "outside_zone";

/** A fix and the reason it was not stored. */
export interface Refusal {
  readonly fix: PositionFix;
  readonly reason: RefusalReason;
}

/** What one upload produced. */
export interface Judgement {
  /** In the order the device recorded them, after refusals. */
  readonly accepted: readonly AcceptedFix[];
  readonly refused: readonly Refusal[];
  /** One mock fix anywhere in the batch means the shift stops until a human looks (D95). */
  readonly suspendShift: boolean;
  /** A position this far outside its zone is worth an exception, not a silent drop. */
  readonly raiseException: boolean;
  /** How many refusals were teleports; the caller adds this to the rider's `teleport_count`. */
  readonly teleports: number;
}

/** What the batch is judged against. */
export interface IngestContext {
  /** The zone's bounding box, inflated by `BBOX_INFLATE_M` here rather than by the caller. */
  readonly zone: BboxE7;
  readonly vehicle: VehicleClass;
  /** The edge's clock when the upload arrived; the reference for a future timestamp. */
  readonly receivedAtMs: number;
  /** The newest accepted fix already stored, if any: the baseline for speed and ordering. */
  readonly lastAccepted?: PositionFix | null;
  /**
   * Whether the upload is a backfill.
   *
   * A backfill may carry fixes older than the newest stored one — a rider who came out of a tunnel — and is
   * the only case where `out_of_order` is not a refusal (`07 §4.5`).
   */
  readonly backfill?: boolean;
}

/** Grow a bounding box by a distance, per axis. */
export function inflateBbox(box: BboxE7, metres: number): BboxE7 {
  const latDegrees = metres / 111_320;
  const midLat = (box.minLatE7 + box.maxLatE7) / 2 / 1e7;
  const lonDegrees = metres / (111_320 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    minLatE7: Math.round(box.minLatE7 - latDegrees * 1e7),
    maxLatE7: Math.round(box.maxLatE7 + latDegrees * 1e7),
    minLonE7: Math.round(box.minLonE7 - lonDegrees * 1e7),
    maxLonE7: Math.round(box.maxLonE7 + lonDegrees * 1e7),
  };
}

/** The implied ground speed between two accepted fixes, in metres per second. */
export function impliedSpeedMps(from: PositionFix, to: PositionFix): number {
  const seconds = (to.recordedAtMs - from.recordedAtMs) / 1_000;
  if (seconds <= 0) return Number.POSITIVE_INFINITY;
  return haversineMeters({ latE7: from.latE7, lonE7: from.lonE7 }, { latE7: to.latE7, lonE7: to.lonE7 }) / seconds;
}

/**
 * Judge one upload.
 *
 * The order of the checks is the order of the stories: a mock flag ends the batch before anything else is
 * considered, accuracy comes next because an inaccurate fix is not evidence about anything, the clocks come
 * before geometry because a time that cannot be trusted makes a speed meaningless, and the zone comes last
 * because it is the only check that is about where rather than when.
 */
export function judgeBatch(fixes: readonly PositionFix[], context: IngestContext): Judgement {
  if (fixes.some((fix) => fix.isMock)) {
    return {
      accepted: [],
      refused: fixes.map((fix) => ({ fix, reason: "mock_location" as const })),
      suspendShift: true,
      raiseException: false,
      teleports: 0,
    };
  }

  const box = inflateBbox(context.zone, BBOX_INFLATE_M);
  const accepted: AcceptedFix[] = [];
  const refused: Refusal[] = [];
  let teleports = 0;
  let raiseException = false;
  let baseline: PositionFix | null = context.lastAccepted ?? null;

  for (const fix of fixes) {
    const refusal = refuse(fix, context, box, baseline);
    if (refusal !== null) {
      refused.push({ fix, reason: refusal });
      if (refusal === "implausible_speed") teleports += 1;
      if (refusal === "outside_zone") raiseException = true;
      // The baseline deliberately does not move: a refused fix must not manufacture a second refusal.
      continue;
    }
    accepted.push({ ...fix, receivedAtMs: context.receivedAtMs });
    baseline = fix;
  }

  return { accepted, refused, suspendShift: false, raiseException, teleports };
}

/** The first rule that refuses a fix, or `null` when it passes. */
function refuse(fix: PositionFix, context: IngestContext, box: BboxE7, baseline: PositionFix | null): RefusalReason | null {
  if (!Number.isFinite(fix.latE7) || !Number.isFinite(fix.lonE7) || !Number.isFinite(fix.recordedAtMs)) {
    return "out_of_order";
  }
  if (fix.accuracyM > MAX_ACCURACY_M) return "poor_accuracy";
  if (fix.recordedAtMs - context.receivedAtMs > MAX_CLOCK_AHEAD_MS) return "clock_ahead";
  if (baseline !== null && fix.recordedAtMs <= baseline.recordedAtMs && context.backfill !== true) return "out_of_order";
  // A speed only exists in one direction. A backfilled fix older than the baseline has no earlier neighbour to
  // be measured against — the fix that precedes it in time is already gone — so it is stored without a speed
  // verdict rather than refused for a number nobody can compute.
  if (baseline !== null && fix.recordedAtMs > baseline.recordedAtMs) {
    if (impliedSpeedMps(baseline, fix) > MAX_SPEED_MPS[context.vehicle]) return "implausible_speed";
  }
  if (!inBbox({ latE7: fix.latE7, lonE7: fix.lonE7 }, box)) return "outside_zone";
  return null;
}
