/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { haversineMeters, type PointE7 } from "@undal/contracts";

import { PICKUP_GEOFENCE_M } from "./guards.ts";

/**
 * Proof that a handover happened, and whether it is enough to say so.
 *
 * The platform moves food and cash between three parties who will disagree later, and the only
 * evidence either side can produce is what was captured at the door. A `DELIVERED` transition
 * therefore needs a proof row — a photo, a scanned pickup code, a signature, or the rider's own
 * position at the moment of handover — and a proof captured two kilometres from the address is not
 * evidence of anything.
 *
 * This module decides whether a capture is admissible. It never stores anything: the caller writes
 * the row (`order_proofs`), and the decision is a value that can be asserted in a test with no
 * camera, no GPS and no network.
 */

/** The kinds of proof `order_proofs.kind` allows, and what each one is evidence of. */
export type ProofKind = "PICKUP_QR" | "DELIVERY_PHOTO" | "HANDOVER_SELFIE" | "CUSTOMER_SIGNATURE";

/** A capture as the app reports it. */
export interface ProofCapture {
  readonly kind: ProofKind;
  readonly orderId: string;
  /** The media object id, required by every kind except a scanned code. */
  readonly mediaId: string | null;
  /** The parsed payload of a scanned code, or null for a photograph. */
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly point: PointE7 | null;
  readonly capturedAtMs: number;
}

/** A proof the platform refuses, with the code the app renders. */
export class ProofRefused extends Error {
  readonly code: "ORDER_PROOF_MISSING_MEDIA" | "ORDER_PROOF_TOO_FAR" | "ORDER_PROOF_INVALID_PAYLOAD" | "ORDER_PROOF_STALE";

  constructor(code: ProofRefused["code"], message: string) {
    super(message);
    this.name = "ProofRefused";
    this.code = code;
  }
}

/** Where the capture must have happened, and how long ago it may have happened. */
export interface ProofExpectation {
  readonly point: PointE7;
  /** The radius that counts as "at the door". A handover happens at arm's length, not across a city. */
  readonly radiusM?: number;
  readonly nowMs: number;
  /** A capture older than this belongs to a different moment in the order's life. */
  readonly maxAgeS?: number;
}

/** The default age beyond which a capture is not evidence of *this* handover. */
export const PROOF_MAX_AGE_S = 15 * 60;

/** The default radius: the same geofence a pickup scan must satisfy. */
export const PROOF_RADIUS_M = PICKUP_GEOFENCE_M;

/**
 * Whether a capture may be written as proof.
 *
 * Order of checks is the order the failures matter: a photograph with no media is a client bug (it
 * cannot be shown to anybody), a scan with no payload is a corrupt code, an old capture is a
 * different delivery, and only then does distance decide. A rider twenty metres away is fine; a
 * rider who "delivered" from home is not.
 */
export function admissibleProof(capture: ProofCapture, expectation: ProofExpectation): void {
  const radiusM = expectation.radiusM ?? PROOF_RADIUS_M;
  const maxAgeS = expectation.maxAgeS ?? PROOF_MAX_AGE_S;

  if (capture.kind !== "PICKUP_QR" && (capture.mediaId === null || capture.mediaId.length === 0))
    throw new ProofRefused("ORDER_PROOF_MISSING_MEDIA", `a ${capture.kind} needs a photograph`);
  if (capture.kind === "PICKUP_QR" && capture.payload === null) throw new ProofRefused("ORDER_PROOF_INVALID_PAYLOAD", "a scanned code carries no payload");

  const ageS = Math.floor((expectation.nowMs - capture.capturedAtMs) / 1000);
  if (ageS > maxAgeS) throw new ProofRefused("ORDER_PROOF_STALE", `the capture is ${ageS}s old`);
  // A capture from the future is a clock bug on the device; refusing it keeps a wrong clock out of
  // the evidence trail rather than letting it appear as a proof taken before the order existed.
  if (ageS < 0) throw new ProofRefused("ORDER_PROOF_STALE", `the capture is ${-ageS}s in the future`);

  if (capture.point === null) throw new ProofRefused("ORDER_PROOF_TOO_FAR", "the capture carries no position");
  const distanceM = Math.round(haversineMeters(capture.point, expectation.point));
  if (distanceM > radiusM) throw new ProofRefused("ORDER_PROOF_TOO_FAR", `the capture was ${distanceM} m away, beyond ${radiusM} m`);
}

/**
 * Whether an order has enough evidence to be marked delivered.
 *
 * A delivery needs *one* of: a photograph at the door, a signature, or a selfie at handover — the QR
 * is a pickup proof and says nothing about the customer's doorstep. Requiring any of the three rather
 * than a specific one is deliberate: a customer who will not be photographed can still sign, and a
 * rider whose camera died can still be seen at the door.
 */
export function hasDeliveryEvidence(proofs: readonly ProofCapture[]): boolean {
  return proofs.some((proof) => proof.kind === "DELIVERY_PHOTO" || proof.kind === "CUSTOMER_SIGNATURE" || proof.kind === "HANDOVER_SELFIE");
}

/** Whether an order has the pickup proof a `PICKED_UP` transition requires. */
export function hasPickupEvidence(proofs: readonly ProofCapture[]): boolean {
  return proofs.some((proof) => proof.kind === "PICKUP_QR");
}
