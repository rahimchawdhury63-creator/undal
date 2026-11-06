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
import { sqlDatetime } from "../db/time.ts";
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

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return Uint8Array.from(Buffer.from(String(value ?? ""), "hex"));
}

/** The hex form of a binary column, which is how callers key maps (`assembly`'s signals, for one). */
function hex(value: unknown): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return String(value ?? "").toLowerCase();
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
      riderId: bytes(row["rider_id"]),
      userId: bytes(row["user_id"]),
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

/** One rider a wave asks: the row id an offer points at, and where they ranked. */
export interface WaveOffer {
  readonly id: Uint8Array;
  readonly riderId: Uint8Array;
  readonly rankInWave: number;
  readonly score: number;
  readonly payoutPaisa: number;
}

/** Everything a wave insert needs besides the offers themselves. */
export interface WaveInsert {
  readonly orderId: Uint8Array;
  /** The cascade wave number, 1-based (`007_dispatch.sql`). */
  readonly wave: number;
  /** Links the offers to the trace that produced them, for the audit trail. */
  readonly traceId: Uint8Array;
  /** The instant the offers were written; also the base the TTL is measured from. */
  readonly offeredAtMs: number;
  /** `offeredAtMs + waveExpiryMs(wave)` — computed by the caller from `11 §7`'s schedule, not here. */
  readonly expiresAtMs: number;
  readonly offers: readonly WaveOffer[];
}

const OFFER_COLUMNS =
  "(`id`, `order_id`, `rider_id`, `wave`, `rank_in_wave`, `score`, `trace_id`, `payout_paisa`, `offered_at`, `expires_at`)";

/**
 * Write one wave of offers, in one statement.
 *
 * One statement rather than a loop, because a wave is one act: eight offers written one at a time would let a wave
 * be half-visible to a rider refreshing their list mid-write, and the readers (`GET /v1/rider/offers`) do not take a
 * transaction. It is also the only way the TTL stays a single instant — eight separate `now`s would give wave 1
 * eight different deadlines, and `11 §7`'s twenty-five seconds is a promise about the wave, not about each row.
 *
 * **Duplicates throw rather than collapse.** `uq_offers_order_rider_wave` would reject them anyway, but a wave that
 * asked the same rider twice is a planner bug, and a `DatabaseError` a hundred lines away from the cause is not
 * where that should be discovered.
 *
 * An empty wave writes nothing and returns 0: a wave with nobody in it is a legitimate outcome (the fallback ladder
 * reached its end), and an `INSERT` with no tuples is a syntax error, not a no-op.
 */
export async function insertOfferWave(db: Db, insert: WaveInsert): Promise<number> {
  if (insert.offers.length === 0) return 0;
  const seen = new Set<string>();
  for (const offer of insert.offers) {
    const key = Buffer.from(offer.riderId).toString("hex");
    if (seen.has(key)) {
      throw new RangeError(`wave ${String(insert.wave)} asks rider ${key} twice`);
    }
    seen.add(key);
  }
  const offeredAt = sqlDatetime(new Date(insert.offeredAtMs));
  const expiresAt = sqlDatetime(new Date(insert.expiresAtMs));
  if (insert.expiresAtMs <= insert.offeredAtMs) {
    // An offer that expires when it was written is a rider who has already lost, and the claim route would answer
    // `OFFER_EXPIRED` to a tap that arrived instantly. Refusing here keeps that impossible rather than unlikely.
    throw new RangeError("a wave must expire after it is offered");
  }

  const params: unknown[] = [];
  for (const offer of insert.offers) {
    params.push(
      offer.id,
      insert.orderId,
      offer.riderId,
      insert.wave,
      offer.rankInWave,
      offer.score,
      insert.traceId,
      offer.payoutPaisa,
      offeredAt,
      expiresAt,
    );
  }
  const row = `(${new Array(10).fill("?").join(", ")})`;
  const sql = `INSERT INTO \`order_offers\` ${OFFER_COLUMNS} VALUES ${insert.offers.map(() => row).join(", ")}`;
  const result = await db.execute(sql, params);
  return result.affectedRows;
}

const SELECT_REJECTED_WAVES = `SELECT \`rider_id\`, \`wave\` FROM \`order_offers\`
  WHERE \`order_id\` = ? AND \`response\` = 'REJECTED' ORDER BY \`wave\` ASC`;

/**
 * The waves each rider was already asked in for this order and declined, keyed by rider id hex.
 *
 * Only `REJECTED` counts. An `EXPIRED` or `WITHDRAWN` offer is silence or a change of plan, and `11 §9.3` weighs it
 * at half a refusal — but filter 12's sentence is "no re-offering after an explicit no", and a rider who never
 * answered did not say no. The distinction is the difference between a zone that has gone quiet and a rider who has
 * told the platform something.
 *
 * Keys are lower-case hex, because the assembly's signals are keyed the same way and TiDB is not obliged to spell a
 * binary column's hex in one case.
 */
export async function rejectedWavesForOrder(
  db: Db,
  orderId: Uint8Array,
): Promise<ReadonlyMap<string, readonly number[]>> {
  const rows = await db.query<{ rider_id: unknown; wave: unknown }>(SELECT_REJECTED_WAVES, [orderId]);
  const out = new Map<string, number[]>();
  for (const row of rows) {
    const key = hex(row.rider_id);
    const waves = out.get(key) ?? [];
    waves.push(Number(row.wave));
    out.set(key, waves);
  }
  return out;
}
