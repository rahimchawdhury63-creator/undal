/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The grace window, and the flap it exists to suppress (`14 §2.1`, `14 §10`).
 *
 * A mobile network hands a device between towers several times a minute. Publishing an absence on
 * every one of those blips would produce a vendor who flickers on the admin map, a rider whose
 * dispatch score is punished for their commute, and an audit log nobody can read. So an involuntary
 * close does not publish immediately — it schedules a publication at `detected + grace`, and a
 * reconnect inside that window cancels it.
 *
 * This file is that schedule, as a value. `sweep` is the only thing that publishes, and it publishes
 * once per device: a device that is already absent and closes again is not a second absence.
 */

import type { AbsenceReason } from "./policy.ts";

/** An absence that has been scheduled but not yet published. */
export interface PendingAbsence {
  readonly actorId: string;
  readonly deviceId: string;
  readonly reason: AbsenceReason;
  readonly detectedAtMs: number;
  readonly publishAtMs: number;
}

/** An absence that has been published. It stays until the device comes back. */
export interface AbsenceRecord {
  readonly actorId: string;
  readonly deviceId: string;
  readonly reason: AbsenceReason;
  readonly detectedAtMs: number;
  readonly publishedAtMs: number;
}

/** A device's presence history, as far as publication is concerned. */
export interface PresenceLedger {
  readonly pending: readonly PendingAbsence[];
  readonly absent: readonly AbsenceRecord[];
}

/** A ledger with nothing outstanding: the state of a platform where everybody is present. */
export function emptyLedger(): PresenceLedger {
  return { pending: [], absent: [] };
}

/** The identity a device is tracked by. A rider with two phones is two devices, deliberately. */
export function deviceKey(actorId: string, deviceId: string): string {
  return `${actorId}\u0000${deviceId}`;
}

/**
 * Schedule an absence.
 *
 * A device that is already absent schedules nothing: its close is a duplicate, and a duplicate must
 * not restart a clock or raise a second alert. A device that already has a pending absence keeps the
 * earlier one, so a rapid second close cannot push a publication further into the future.
 */
export function noteClose(
  ledger: PresenceLedger,
  close: { actorId: string; deviceId: string; reason: AbsenceReason; detectedAtMs: number; publishAtMs: number },
): PresenceLedger {
  const key = deviceKey(close.actorId, close.deviceId);
  if (ledger.absent.some((record) => deviceKey(record.actorId, record.deviceId) === key)) return ledger;
  if (ledger.pending.some((absence) => deviceKey(absence.actorId, absence.deviceId) === key)) return ledger;
  const pending: PendingAbsence = {
    actorId: close.actorId,
    deviceId: close.deviceId,
    reason: close.reason,
    detectedAtMs: close.detectedAtMs,
    publishAtMs: close.publishAtMs,
  };
  return { pending: [...ledger.pending, pending], absent: ledger.absent };
}

/**
 * A device came back.
 *
 * A reconnect inside the grace cancels the pending publication, and that is the whole point of the
 * grace. A reconnect after publication clears the absence record, because the device is present again
 * and the alert that was raised has been answered — the history of it lives in the event log, not
 * here.
 */
export function noteReconnect(
  ledger: PresenceLedger,
  device: { actorId: string; deviceId: string },
): { readonly ledger: PresenceLedger; readonly cancelled: PendingAbsence | null; readonly restored: boolean } {
  const key = deviceKey(device.actorId, device.deviceId);
  const cancelled = ledger.pending.find((absence) => deviceKey(absence.actorId, absence.deviceId) === key) ?? null;
  const wasAbsent = ledger.absent.some((record) => deviceKey(record.actorId, record.deviceId) === key);
  return {
    ledger: {
      pending: ledger.pending.filter((absence) => deviceKey(absence.actorId, absence.deviceId) !== key),
      absent: ledger.absent.filter((record) => deviceKey(record.actorId, record.deviceId) !== key),
    },
    cancelled,
    restored: wasAbsent,
  };
}

/**
 * Publish every absence whose grace has run out.
 *
 * The comparison is `<=` so an absence with zero grace — a deliberate close, or a heartbeat timeout —
 * is publishable in the same instant it was detected. That is not an off-by-one; it is the user having
 * pressed the switch.
 */
export function sweep(
  ledger: PresenceLedger,
  atMs: number,
): { readonly ledger: PresenceLedger; readonly published: readonly AbsenceRecord[] } {
  const due = ledger.pending.filter((absence) => absence.publishAtMs <= atMs);
  if (due.length === 0) return { ledger, published: [] };
  const published: AbsenceRecord[] = due.map((absence) => ({
    actorId: absence.actorId,
    deviceId: absence.deviceId,
    reason: absence.reason,
    detectedAtMs: absence.detectedAtMs,
    publishedAtMs: atMs,
  }));
  const remaining = ledger.pending.filter((absence) => absence.publishAtMs > atMs);
  return { ledger: { pending: remaining, absent: [...ledger.absent, ...published] }, published };
}

/** Everyone currently published as absent. */
export function absentDevices(ledger: PresenceLedger): readonly AbsenceRecord[] {
  return ledger.absent;
}
