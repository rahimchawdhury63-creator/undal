/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Everything an invoice shows is frozen into the order at placement (`06 §7.1`).
 *
 * The rule sounds like bookkeeping and is actually a promise: a customer who renames "Home" to
 * "Office" next month must not change what an old receipt says, and a vendor who raises a price must
 * not change what a customer was charged. Foreign keys are kept for navigation; snapshots are kept
 * for truth.
 *
 * Each snapshot carries a version, because a snapshot is read years later by code that has moved on.
 * A reader that meets an unknown version refuses rather than guessing, which turns "the address looks
 * wrong" into an alert instead of a wrong delivery.
 */

/** The shape version of an address snapshot. Bumped when a reader could misinterpret an old one. */
export const ADDRESS_SNAPSHOT_VERSION = 1;

/** An address as it existed when the order was placed. */
export interface AddressSnapshot {
  readonly version: number;
  readonly addressId: string | null;
  readonly label: string;
  readonly recipientName: string;
  /** The full phone, kept because a rider must be able to call at the door. */
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly instructions: string | null;
  readonly latE7: number;
  readonly lonE7: number;
  readonly city: string;
  readonly zoneId: string;
  readonly frozenAtIso: string;
}

/** What the caller knows about the address when it places an order. */
export interface AddressInput {
  readonly addressId?: string | null | undefined;
  readonly label: string;
  readonly recipientName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2?: string | null | undefined;
  readonly landmark?: string | null | undefined;
  readonly instructions?: string | null | undefined;
  readonly latE7: number;
  readonly lonE7: number;
  readonly city: string;
  readonly zoneId: string;
}

/** A snapshot that cannot be taken, with the code the app renders. */
export class SnapshotRefused extends Error {
  readonly code: "ORDER_ADDRESS_TOO_FAR" | "VALIDATION_FAILED";

  constructor(code: SnapshotRefused["code"], message: string) {
    super(message);
    this.name = "SnapshotRefused";
    this.code = code;
  }
}

/** Freeze an address. */
export function snapshotAddress(input: AddressInput, nowMs: number): AddressSnapshot {
  if (input.line1.trim().length === 0) throw new SnapshotRefused("VALIDATION_FAILED", "an address needs a first line");
  if (!/^\+?[0-9]{10,15}$/u.test(input.phone.replace(/[\s-]/gu, ""))) throw new SnapshotRefused("VALIDATION_FAILED", "a phone a rider can dial is required");
  if (!Number.isInteger(input.latE7) || !Number.isInteger(input.lonE7)) throw new SnapshotRefused("VALIDATION_FAILED", "coordinates must be E7 integers");

  return {
    version: ADDRESS_SNAPSHOT_VERSION,
    addressId: input.addressId ?? null,
    label: input.label,
    recipientName: input.recipientName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2 ?? null,
    landmark: input.landmark ?? null,
    instructions: input.instructions ?? null,
    latE7: input.latE7,
    lonE7: input.lonE7,
    city: input.city,
    zoneId: input.zoneId,
    frozenAtIso: new Date(nowMs).toISOString(),
  };
}

/**
 * Read a snapshot, refusing a version this build does not understand.
 *
 * The alternative — reading it anyway — is how a renderer silently drops a field it has never heard
 * of and prints an address that is missing the flat number.
 */
export function readAddressSnapshot(raw: unknown): AddressSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<AddressSnapshot>;
  if (candidate.version !== ADDRESS_SNAPSHOT_VERSION) return null;
  if (typeof candidate.line1 !== "string" || typeof candidate.city !== "string") return null;
  return candidate as AddressSnapshot;
}

/**
 * The address as a rider sees it on the way, and the address as it is stored.
 *
 * A rider needs the door and the phone; nothing else on the snapshot is theirs to see, and the
 * customer's own copy keeps everything. Returning the same object with a comment would be a lie in
 * every log line that prints it.
 */
export interface RiderAddressView {
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly instructions: string | null;
  readonly phone: string;
  readonly latE7: number;
  readonly lonE7: number;
}

/** The subset a rider is shown, with the phone second line kept out of the app's share sheet. */
export function riderView(snapshot: AddressSnapshot): RiderAddressView {
  return {
    line1: snapshot.line1,
    line2: snapshot.line2,
    landmark: snapshot.landmark,
    instructions: snapshot.instructions,
    phone: snapshot.phone,
    latE7: snapshot.latE7,
    lonE7: snapshot.lonE7,
  };
}
