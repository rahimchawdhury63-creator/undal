/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /rt/location/batch`: one flush from one rider's phone (`07 §4.1`, D97).
 *
 * This is the route where the two halves of the D1 contract finally meet. `d1/batch.ts` turns twelve deltas
 * into positions, `d1/ingest.ts` decides which of them the platform believes, and `d1/store.ts` writes the
 * survivors into the ring and the current row. The route owns only the sequence and the answers:
 *
 * - **The token decides who the rider is.** `shiftId` in the body is a claim about which shift a position
 *   belongs to; the rider is not a claim, it is the token's `sub`. A batch whose `shiftId` disagrees with the
 *   shift the store has open is refused — a stale queue flushing after a shift ended must not write into the
 *   next one.
 * - **The response carries the next cadence.** `07 §3.3` says the profile is pushed from the server; this is
 *   the push. A rider who has just started carrying food gets `CARRYING_FAR` back in the same round trip, so
 *   the device does not need a second request to learn that the customer is now watching.
 * - **A refused batch is not an error the phone retries blindly.** A mock location suspends the shift and says
 *   so; a bad delta is a client bug and says which. The device distinguishes them by `reason`.
 *
 * `readOnly: true` is not claimed here: this route writes, but it writes D1 — the live channel that
 * `07 §6` erases — and nothing in it is auditable, because an audit row is a business record and a breadcrumb
 * is precisely what the platform promises not to keep.
 */

import { failure, statusFor } from "@undal/contracts";

import { BATCH_MAX_BYTES, parseBatch, ringSlots } from "../d1/batch.ts";
import { cadenceFor, phaseFor } from "../d1/cadence.ts";
import { judgeBatch } from "../d1/ingest.ts";
import type { RefusalReason, VehicleClass } from "../d1/ingest.ts";
import type { PositionStore, StoredPosition } from "../d1/store.ts";

/** What the route is given. */
export interface LocationContext {
  /** The D1-backed store, or `undefined` when this deployment has no `RIDER_DB` binding. */
  readonly store: PositionStore | undefined;
  /** The rider the token names. */
  readonly riderId: string;
  /** The shift the token was minted for, when the token carries one. */
  readonly shiftId: string | null;
  readonly requestId: string;
  /** The edge clock, injected so a test can be deterministic. */
  readonly nowMs: number;
}

/** JSON, with the request id and no caching. */
function json(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-Undal-Request-Id": requestId,
    },
  });
}

/** A refusal in the shared envelope, with the status its code carries. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return json(failure(code, { requestId, details }), statusFor(code), requestId);
}

/** The vehicle class the plausibility rules are about; anything unrecognised is treated as the faster one. */
function vehicleClassOf(vehicle: string): VehicleClass {
  return vehicle.toUpperCase() === "BICYCLE" ? "BICYCLE" : "MOTORBIKE";
}

/** Count refusals by reason, which is what the device's diagnostics screen shows. */
function countRefusals(reasons: readonly RefusalReason[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

/** Handle one location flush. */
export async function handleLocationBatch(request: Request, context: LocationContext): Promise<Response> {
  const { store, requestId } = context;
  if (store === undefined) {
    return refuse("NOT_IMPLEMENTED", requestId, {
      reason: "d1_not_configured",
      hint: "this Worker is serving without a RIDER_DB binding",
    });
  }

  const text = await request.text();
  if (text.length > BATCH_MAX_BYTES) {
    return refuse("VALIDATION_FAILED", requestId, { reason: "batch_too_large", bytes: text.length, maxBytes: BATCH_MAX_BYTES });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return refuse("VALIDATION_FAILED", requestId, { reason: "not_json" });
  }

  const batch = parseBatch(parsed);
  if (!batch.ok) return refuse("VALIDATION_FAILED", requestId, { reason: batch.reason });

  const rider = await store.context(context.riderId);
  if (rider === null) {
    return refuse("SHIFT_NOT_OPEN", requestId, { reason: "shift_not_started" });
  }
  if (context.shiftId !== null && context.shiftId !== "" && context.shiftId !== batch.batch.shiftId) {
    return refuse("SHIFT_NOT_OPEN", requestId, {
      reason: "shift_mismatch",
      expected: context.shiftId,
      received: batch.batch.shiftId,
    });
  }

  const newest = await store.newest(context.riderId);
  const judgement = judgeBatch(batch.batch.fixes, {
    // The zone's shape is core's, not this Worker's: the id is in D1, the polygon is not (D97, *Open*).
    zone: null,
    vehicle: vehicleClassOf(rider.vehicle),
    receivedAtMs: context.nowMs,
    lastAccepted: newest,
  });

  const slots = ringSlots(batch.batch.seqStart, batch.batch.fixes.length);
  const positions: StoredPosition[] = judgement.acceptedIndexes.map((index) => ({
    seq: slots[index] ?? 0,
    fix: judgement.accepted[judgement.acceptedIndexes.indexOf(index)]!,
  }));

  const lastStored = judgement.accepted[judgement.accepted.length - 1];
  const phase = phaseFor({
    onBreak: rider.state.toUpperCase() === "BREAK",
    carrying: rider.state.toUpperCase() === "ON_ORDER",
    distanceToDropM: null,
    moving: judgement.accepted.length > 1,
  });
  const cadence = cadenceFor(phase, rider.batteryPct);

  if (lastStored !== undefined) {
    await store.write({
      riderId: context.riderId,
      shiftId: batch.batch.shiftId,
      zoneId: rider.zoneId,
      vehicle: rider.vehicle,
      state: rider.state,
      activeOrderId: rider.activeOrderId,
      batteryPct: rider.batteryPct,
      positions,
      staleAfterMs: lastStored.receivedAtMs + cadence.ceilingMs * 2,
    });
  }

  return json(
    {
      ok: true,
      data: {
        accepted: judgement.accepted.length,
        refused: countRefusals(judgement.refused.map((entry) => entry.reason)),
        teleports: judgement.teleports,
        // A suspended shift is the device's instruction to stop sending until a human looks (D95).
        suspendShift: judgement.suspendShift,
        raiseException: judgement.raiseException,
        cadence: { phase, ...cadence },
      },
      meta: { requestId, receivedAtMs: context.nowMs },
    },
    200,
    requestId,
  );
}
