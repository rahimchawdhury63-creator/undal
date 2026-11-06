/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The TiDB half of a dispatch candidate (`11 §7`, D118).
 *
 * A `RiderSnapshot` is assembled from two stores that must not be allowed to disagree about who a rider is. This
 * module reads the half TiDB knows — approval, shift, vehicle, verification, cash, current load — and the feed in
 * `workers/realtime` answers the half that only exists while the rider is connected (D117). Both are keyed by the
 * **user id**: `rider_current.rider_id` is the token's `sub` (D110), while everything below is a `riders` row id,
 * so the row carries `userId` explicitly and the wave writer joins on it.
 *
 * One statement per zone, not per rider, for the same reason the feed is per zone: a wave of eight out of sixty
 * connected riders would otherwise be sixty of each.
 */

import type { Db } from "../db/client.ts";
import { vehiclePolicy, DEFAULT_CASH_LIMIT_PAISA, type VehiclePolicy } from "../domain/order/dispatch-policy.ts";

/** A rider in a zone who holds an open shift, with the limits the filters will judge them against. */
export interface DispatchCandidate {
  /** `riders.id` — the row an offer points at. */
  readonly riderId: Uint8Array;
  /** `riders.user_id` — the identity the live-tracking feed is keyed by. */
  readonly userId: Uint8Array;
  readonly code: string;
  /** `riders.status`; anything but `APPROVED` is filtered out by the statement itself. */
  readonly status: string;
  /** `riders.shift_state`, mapped onto the snapshot's four-valued vocabulary. */
  readonly shiftState: "ONLINE" | "ON_ORDER" | "BREAK" | "OFFLINE";
  readonly vehicle: string;
  readonly zoneId: string;
  readonly selfieVerified: boolean;
  readonly cashCollectedPaisa: number;
  readonly activeLoad: number;
  /** `null` when the vehicle is not one the policy describes — such a rider cannot be offered work. */
  readonly policy: VehiclePolicy | null;
  readonly cashLimitPaisa: number;
}

/**
 * Riders in a zone who could be offered an order right now, as far as TiDB is concerned.
 *
 * The statement is the floor, not the decision. It excludes only what cannot be true of any candidate under any
 * relaxation: no open shift, not approved, already sitting on a `CASH_LOCKED` shift, or in the middle of the
 * selfie check. Everything the filters can loosen stays in the list and is filtered in the open, by number, where
 * a refusal can be named — a bicycle is not excluded here even though most orders are too far for it, because
 * "too far for your vehicle" is what the rider's app says, and it can only say that if the row arrived.
 */
const SELECT_CANDIDATES = `SELECT r.\`id\` AS \`rider_id\`, r.\`user_id\`, r.\`code\`, r.\`status\`, r.\`shift_state\`,
    r.\`vehicle\`, s.\`zone_id\` AS \`zone_id\`, s.\`selfie_verified\` AS \`selfie_verified\`,
    s.\`cash_collected_paisa\` AS \`cash_collected_paisa\`,
    (SELECT COUNT(*) FROM \`orders\` o WHERE o.\`rider_id\` = r.\`id\`
       AND o.\`state\` IN ('RIDER_ASSIGNED', 'PICKED_UP', 'ARRIVED')) AS \`active_load\`
  FROM \`riders\` r
  JOIN \`rider_shifts\` s ON s.\`rider_id\` = r.\`id\` AND s.\`ended_at\` IS NULL
  WHERE s.\`zone_id\` = ? AND r.\`status\` = 'APPROVED'
    AND r.\`shift_state\` IN ('ONLINE', 'ON_ORDER', 'BREAK')
  ORDER BY r.\`id\`
  LIMIT 200`;

/** `BREAK` in `riders.shift_state` is `ON_BREAK` on the snapshot; the snapshot's `OFFLINE` has no candidate row. */
function shiftStateOf(raw: string): DispatchCandidate["shiftState"] | null {
  if (raw === "ONLINE") return "ONLINE";
  if (raw === "ON_ORDER") return "ON_ORDER";
  if (raw === "BREAK") return "BREAK";
  return null;
}

function hex(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return Uint8Array.from(Buffer.from(String(value ?? ""), "hex"));
}

/**
 * Read the candidates for a zone.
 *
 * A row whose `shift_state` the statement does not expect is dropped rather than mapped to `OFFLINE`: the WHERE
 * clause and the mapper disagreeing would mean a row changed between them, and a rider read out of a state
 * nobody believes in should not be in the wave.
 */
export async function ridersInZone(db: Db, zoneId: string): Promise<readonly DispatchCandidate[]> {
  const rows = await db.query<Record<string, unknown>>(SELECT_CANDIDATES, [zoneId]);
  const out: DispatchCandidate[] = [];
  for (const row of rows) {
    const shiftState = shiftStateOf(String(row["shift_state"] ?? ""));
    if (shiftState === null) continue;
    const vehicle = String(row["vehicle"] ?? "");
    out.push({
      riderId: hex(row["rider_id"]),
      userId: hex(row["user_id"]),
      code: String(row["code"] ?? ""),
      status: String(row["status"] ?? ""),
      shiftState,
      vehicle,
      zoneId: String(row["zone_id"] ?? zoneId),
      selfieVerified: Number(row["selfie_verified"] ?? 0) === 1,
      cashCollectedPaisa: Number(row["cash_collected_paisa"] ?? 0),
      activeLoad: Number(row["active_load"] ?? 0),
      policy: vehiclePolicy(vehicle),
      cashLimitPaisa: DEFAULT_CASH_LIMIT_PAISA,
    });
  }
  return out;
}
