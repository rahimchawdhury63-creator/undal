/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The upload a phone actually sends: delta-encoded, small, and hostile until parsed (`07 §4.1–4.2`, D97).
 *
 * A batch is one `POST /rt/location/batch` carrying a base position and up to eleven deltas: `[dLat, dLon,
 * dt, accuracy, bearing, speed×10]`, where the angles are in units of 1e-6 degrees (≈ 0.11 m) and the time in
 * milliseconds. The encoding exists because a rider on a weak signal is uploading every eight seconds and a
 * hundred bytes of JSON per flush is a real cost on a real phone.
 *
 * Parsing is where a worker is most likely to be generous by accident, so this module is strict about three
 * things and explicit about why:
 *
 * 1. **The batch is bounded.** Twelve positions, two thousand and forty-eight bytes. A caller that sends more
 *    is refused rather than truncated: half a trail is a rider whose marker jumps, which is worse than a
 *    client that knows its upload failed and will retry.
 * 2. **Numbers are numbers.** Every field is checked for finiteness before it becomes a coordinate, because a
 *    `null` delta becomes `NaN` two multiplications later and arrives at the plausibility gate as a fix that
 *    is neither inside nor outside the zone.
 * 3. **The device owns `seq`.** The ring buffer in `07 §5` is a modular counter, and only the device knows how
 *    many fixes it has produced across a dead network. The batch carries the counter of its **first** position
 *    and the server advances it per position *offered*, not per position stored — a refused fix still consumed
 *    a slot on the device, and pretending otherwise would drift the two counters apart for the rest of the shift.
 */

import type { PositionFix } from "./ingest.ts";

/** `07 §4.1`: a flush carries up to twelve positions. */
export const BATCH_MAX_POSITIONS = 12;

/** `07 §4.2`: a body past this is not a batch this platform produced. */
export const BATCH_MAX_BYTES = 2_048;

/** `07 §5`: the trail's modulus. Duplicated here rather than imported from D1 so the parser stays pure. */
export const TRAIL_CAPACITY = 120;

/** A delta is 1e-6 of a degree, which is ten e7 units. */
const DELTA_UNITS_PER_E7 = 10;

/** The largest delta worth accepting: about eleven kilometres, which no plausible flush covers. */
export const DELTA_MAX_UNITS = 100_000;

/** The largest gap between two positions in one flush; a batch is one flush, not a day. */
export const DELTA_MAX_MS = 600_000;

/** Why a batch was refused. Each is a different thing for the client to log. */
export type BatchRefusal =
  | "not_an_object"
  | "missing_shift"
  | "no_positions"
  | "too_many_positions"
  | "bad_base"
  | "bad_delta"
  | "delta_too_large";

/** A batch that parsed. */
export interface ParsedBatch {
  readonly shiftId: string;
  /** The device's ring counter for the first position in the batch (`07 §5`). */
  readonly seqStart: number;
  /** Every position offered, oldest first. The first is the base. */
  readonly fixes: readonly PositionFix[];
}

/** What a parse produced. */
export type BatchParse = { readonly ok: true; readonly batch: ParsedBatch } | { readonly ok: false; readonly reason: BatchRefusal };

/** A finite number, or `null`. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An integer field that may be absent; absent is `null`, present-but-not-an-integer is a refusal. */
function optionalInteger(value: unknown): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const number = numberOrNull(value);
  if (number === null || !Number.isInteger(number)) return { ok: false };
  return { ok: true, value: number };
}

/**
 * Parse a batch body.
 *
 * The base position's `t` is its device clock and its accuracy is optional; without an accuracy the fix cannot
 * be judged and the whole batch is refused, because a position whose error is unknown is not a position the
 * platform can decide about.
 */
export function parseBatch(body: unknown): BatchParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, reason: "not_an_object" };
  const record = body as Record<string, unknown>;

  const shiftId = typeof record.shiftId === "string" ? record.shiftId.trim() : "";
  if (shiftId === "" || shiftId.length > 64) return { ok: false, reason: "missing_shift" };

  const seq = optionalInteger(record.seq);
  const seqStart = seq.ok ? (seq.value ?? 0) % TRAIL_CAPACITY : 0;
  if (!seq.ok) return { ok: false, reason: "bad_delta" };

  const base = record.base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return { ok: false, reason: "bad_base" };
  const baseRecord = base as Record<string, unknown>;
  const lat = numberOrNull(baseRecord.lat);
  const lon = numberOrNull(baseRecord.lon);
  const at = numberOrNull(baseRecord.t);
  const accuracy = optionalInteger(baseRecord.acc);
  if (lat === null || lon === null || at === null || !accuracy.ok || accuracy.value === null) {
    return { ok: false, reason: "bad_base" };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, reason: "bad_base" };

  const bearing = optionalInteger(baseRecord.brg);
  if (!bearing.ok) return { ok: false, reason: "bad_base" };

  const deltas = record.d;
  if (!Array.isArray(deltas)) return { ok: false, reason: "no_positions" };
  if (deltas.length === 0) return { ok: false, reason: "no_positions" };
  if (deltas.length + 1 > BATCH_MAX_POSITIONS) return { ok: false, reason: "too_many_positions" };

  const baseLatE7 = Math.round(lat * 1e7);
  const baseLonE7 = Math.round(lon * 1e7);
  const fixes: PositionFix[] = [
    {
      latE7: baseLatE7,
      lonE7: baseLonE7,
      accuracyM: accuracy.value,
      bearingDeg: bearing.value,
      recordedAtMs: at,
      isMock: record.mock === true,
    },
  ];

  for (const raw of deltas) {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 6) return { ok: false, reason: "bad_delta" };
    const dLat = numberOrNull(raw[0]);
    const dLon = numberOrNull(raw[1]);
    const dt = numberOrNull(raw[2]);
    if (dLat === null || dLon === null || dt === null) return { ok: false, reason: "bad_delta" };
    if (!Number.isInteger(dLat) || !Number.isInteger(dLon) || !Number.isInteger(dt)) return { ok: false, reason: "bad_delta" };
    if (Math.abs(dLat) > DELTA_MAX_UNITS || Math.abs(dLon) > DELTA_MAX_UNITS) return { ok: false, reason: "delta_too_large" };
    if (dt < 0 || dt > DELTA_MAX_MS) return { ok: false, reason: "delta_too_large" };

    const deltaAccuracy = optionalInteger(raw[3]);
    const deltaBearing = optionalInteger(raw[4]);
    const deltaSpeed = numberOrNull(raw[5]);
    if (!deltaAccuracy.ok || !deltaBearing.ok) return { ok: false, reason: "bad_delta" };

    fixes.push({
      latE7: baseLatE7 + dLat * DELTA_UNITS_PER_E7,
      lonE7: baseLonE7 + dLon * DELTA_UNITS_PER_E7,
      accuracyM: deltaAccuracy.value ?? accuracy.value,
      bearingDeg: deltaBearing.value,
      recordedAtMs: at + dt,
      isMock: record.mock === true,
    });
  }

  return { ok: true, batch: { shiftId, seqStart, fixes } };
}

/**
 * The ring slot each position in a batch occupies.
 *
 * The counter advances for every position the device *offered*, so a refused fix does not renumber the rest of
 * the ring — the alternative drifts the device's counter from the server's for the remainder of the shift, and
 * the trail reassembles by `recorded_at` until the day it does not.
 */
export function ringSlots(seqStart: number, count: number): number[] {
  const start = ((Math.trunc(seqStart) % TRAIL_CAPACITY) + TRAIL_CAPACITY) % TRAIL_CAPACITY;
  return Array.from({ length: count }, (_, index) => (start + index) % TRAIL_CAPACITY);
}
