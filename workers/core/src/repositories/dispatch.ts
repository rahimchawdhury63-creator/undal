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
import { readStoredModel } from "./propensity.ts";
import type { ZoneFeatures } from "../domain/order/scoring.ts";

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
  /**
   * The acceptance model's features, as the scorer computed them (`09 §7.4`, D134), or `null`.
   *
   * `null` rather than an array of zeroes: an offer judged without a model must not later train one, and a row of zeroes
   * would look like a perfectly ordinary sample whose offer had nothing to recommend it.
   */
  readonly propensity: readonly number[] | null;
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
  "(`id`, `order_id`, `rider_id`, `wave`, `rank_in_wave`, `score`, `trace_id`, `payout_paisa`, " +
  "`propensity_features`, `offered_at`, `expires_at`)";

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
      // `JSON`, so the driver gets a string. The array is the model's own wire format (`PROPENSITY_FEATURES`' order).
      offer.propensity === null ? null : JSON.stringify(offer.propensity),
      offeredAt,
      expiresAt,
    );
  }
  const row = `(${new Array(11).fill("?").join(", ")})`;
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

/** The order a dispatch decision is about, with everything the target needs. */
export interface DispatchOrder {
  readonly id: Uint8Array;
  readonly code: string;
  readonly state: string;
  readonly zoneId: string;
  /** The same zone as bytes, because `zones.id` is `BINARY(16)` and a hex string cannot be compared to it. */
  readonly zoneIdBytes: Uint8Array;
  readonly vendorId: string;
  readonly totalPaisa: number;
  readonly riderPayoutPaisa: number;
  /** When the kitchen expects the food to be ready, in epoch ms, or `null` if the estimate was never set. */
  readonly readyAtMs: number | null;
  /** Where the food is, in E7 — the origin of every candidate's distance. */
  readonly pickup: { readonly latE7: number; readonly lonE7: number };
  /** Where the food is going, in E7, or `null` — the cell factor 8 is counted in (D139). */
  readonly delivery: { readonly latE7: number; readonly lonE7: number } | null;
}

const SELECT_DISPATCH_ORDER = `SELECT \`id\`, \`code\`, \`state\`, \`zone_id\`, \`vendor_id\`, \`total_paisa\`, \`rider_payout_paisa\`,
    \`pickup_lat_e7\`, \`pickup_lon_e7\`, \`delivery_lat_e7\`, \`delivery_lon_e7\`, \`ready_at_estimate\`
  FROM \`orders\` WHERE \`code\` = ?`;

/** The order, or `null` when no such code exists. */
export async function orderForDispatch(db: Db, code: string): Promise<DispatchOrder | null> {
  const row = await db.first<Record<string, unknown>>(SELECT_DISPATCH_ORDER, [code]);
  if (row === null) return null;
  return {
    id: bytes(row["id"]),
    code: String(row["code"] ?? ""),
    state: String(row["state"] ?? ""),
    zoneId: hex(row["zone_id"]),
    zoneIdBytes: bytes(row["zone_id"]),
    vendorId: hex(row["vendor_id"]),
    totalPaisa: Number(row["total_paisa"] ?? 0),
    riderPayoutPaisa: Number(row["rider_payout_paisa"] ?? 0),
    readyAtMs: row["ready_at_estimate"] === null || row["ready_at_estimate"] === undefined
      ? null
      : new Date(String(row["ready_at_estimate"]).replace(" ", "T") + "Z").getTime(),
    pickup: { latE7: Number(row["pickup_lat_e7"] ?? 0), lonE7: Number(row["pickup_lon_e7"] ?? 0) },
    delivery:
      row["delivery_lat_e7"] === null || row["delivery_lat_e7"] === undefined
        ? null
        : { latE7: Number(row["delivery_lat_e7"]), lonE7: Number(row["delivery_lon_e7"] ?? 0) },
  };
}

/** A zone's stored polygon, unparsed: the caller validates it with `parseZoneRing` and decides what a bad one means. */
export async function zonePolygon(db: Db, zoneId: Uint8Array): Promise<unknown> {
  const row = await db.first<{ polygon: unknown }>("SELECT `polygon` FROM `zones` WHERE `id` = ?", [zoneId]);
  return row === null ? null : row.polygon;
}

const SELECT_NOTIFIABLE = `SELECT DISTINCT d.\`user_id\` AS \`user_id\` FROM \`devices\` d
  JOIN \`device_tokens\` t ON t.\`device_id\` = d.\`id\`
  WHERE d.\`notifications_allowed\` = 1 AND t.\`valid\` = 1`;

/**
 * The users with at least one push-capable device (`11 §7` filter 14).
 *
 * Keyed by **user id**, because that is what `devices` holds and what the assembly looks up. Filter 14 exists
 * because the alarm is how a rider learns about an offer at all: an offer written for a phone that cannot ring is
 * twenty-five seconds spent telling nobody.
 */
export async function notifiableUsers(db: Db): Promise<ReadonlySet<string>> {
  const rows = await db.query<{ user_id: unknown }>(SELECT_NOTIFIABLE, []);
  return new Set(rows.map((row) => hex(row.user_id)));
}

const SELECT_SUSPENDED = `SELECT DISTINCT \`rider_id\` AS \`rider_id\` FROM \`rider_suspensions\`
  WHERE \`starts_at\` <= ? AND (\`ends_at\` IS NULL OR \`ends_at\` > ?) AND \`lifted_at\` IS NULL`;

/**
 * Riders under an active suspension at an instant (`11 §7` filter 6), keyed by rider id hex.
 *
 * Three ways a suspension stops applying and all three are here: it has not started, it has ended, or an operator
 * lifted it. A row missing any one of those makes a suspended rider dispatchable again, which is the kind of bug
 * that arrives as a complaint rather than an alert.
 */
export async function suspendedRiderIds(db: Db, atMs: number): Promise<ReadonlySet<string>> {
  const at = sqlDatetime(new Date(atMs));
  const rows = await db.query<{ rider_id: unknown }>(SELECT_SUSPENDED, [at, at]);
  return new Set(rows.map((row) => hex(row.rider_id)));
}

/** A lock row's holder. */
export interface DispatchLock {
  readonly orderId: Uint8Array;
  readonly holder: string;
  readonly expiresAtMs: number;
}

const CLAIM_LOCK = `INSERT INTO \`dispatch_locks\` (\`id\`, \`order_id\`, \`holder\`, \`expires_at\`, \`created_at\`)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    \`holder\` = IF(\`expires_at\` <= ?, VALUES(\`holder\`), \`holder\`),
    \`expires_at\` = IF(\`expires_at\` <= ?, VALUES(\`expires_at\`), \`expires_at\`)`;

const SELECT_LOCK = "SELECT `holder` AS `holder`, `expires_at` AS `expires_at` FROM `dispatch_locks` WHERE `order_id` = ?";

/**
 * Take the planning lock for an order, or say who holds it.
 *
 * Two coordinators can be woken for the same order — a retried trigger and the original — and both would otherwise
 * write a wave, producing two sets of offers for wave 1 and a rider asked twice. `dispatch_locks` is unique on
 * `order_id`, so the claim is one statement: insert, or take the lock **only if the existing one has expired**. The
 * `IF` in the `ON DUPLICATE KEY UPDATE` is the whole mechanism — without it a stale lock from a crashed planner would
 * block the order until somebody deleted the row by hand.
 *
 * Returns `{taken: true, lock}` or `{taken: false, holder}` so the caller can say who is planning rather than
 * answering "busy".
 */
export async function claimDispatchLock(
  db: Db,
  input: { readonly id: Uint8Array; readonly orderId: Uint8Array; readonly holder: string; readonly nowMs: number; readonly ttlMs: number },
): Promise<{ readonly taken: true; readonly lock: DispatchLock } | { readonly taken: false; readonly holder: string }> {
  const expiresAtMs = input.nowMs + input.ttlMs;
  const expiresAt = sqlDatetime(new Date(expiresAtMs));
  const now = sqlDatetime(new Date(input.nowMs));
  await db.execute(CLAIM_LOCK, [
    input.id,
    input.orderId,
    input.holder,
    expiresAt,
    now,
    now,
    now,
  ]);
  const row = await db.first<{ holder: unknown; expires_at: unknown }>(SELECT_LOCK, [input.orderId]);
  const holder = String(row?.holder ?? "");
  if (holder !== input.holder) return { taken: false, holder };
  return { taken: true, lock: { orderId: input.orderId, holder, expiresAtMs } };
}

/** Release a lock this planner holds. The `holder` predicate is what stops one planner releasing another's. */
export async function releaseDispatchLock(db: Db, orderId: Uint8Array, holder: string): Promise<number> {
  const result = await db.execute(
    "UPDATE `dispatch_locks` SET `expires_at` = ? WHERE `order_id` = ? AND `holder` = ?",
    [sqlDatetime(new Date(0)), orderId, holder],
  );
  return result.affectedRows;
}

const SELECT_WAVE_STATE = `SELECT MAX(\`wave\`) AS \`last\`,
    SUM(CASE WHEN \`response\` IS NULL AND \`expires_at\` > ? THEN 1 ELSE 0 END) AS \`live\`
  FROM \`order_offers\` WHERE \`order_id\` = ?`;

/**
 * The next wave number for an order, and whether one of its waves is still live.
 *
 * A live wave is unanswered offers inside their TTL: writing wave 2 while wave 1's phones are still ringing tells
 * eight riders the order is gone when it is not, and doubles the alarm traffic for one order.
 */
export async function waveStateForOrder(
  db: Db,
  orderId: Uint8Array,
  nowMs: number,
): Promise<{ readonly lastWave: number; readonly liveOffers: number }> {
  const row = await db.first<{ last: unknown; live: unknown }>(SELECT_WAVE_STATE, [
    sqlDatetime(new Date(nowMs)),
    orderId,
  ]);
  return { lastWave: Number(row?.last ?? 0), liveOffers: Number(row?.live ?? 0) };
}

/** What the caller already knows about the offer, before the zone's model is added to it. */
export interface ScoringZoneInput {
  readonly medianPickupM: number;
  readonly medianDeliveriesToday: number;
  readonly payoutPaisa: number;
  readonly atMs: number;
  readonly tripDistanceM?: number;
  readonly weatherSeverity?: number;
  readonly batch?: boolean;
}

/**
 * The zone's figures for the scorer, including the acceptance model it has trained (`09 §7.4`, D133).
 *
 * The model is configuration, not state: `platform_config` is versioned and audited, and Brain Lab edits it. Two reads
 * at most — the zone's own row, then the global one — and a row that is shaped like nothing (a typo, an old version)
 * is *absent* rather than an error: a bad coefficient vector must degrade to the rider's own rate, never fail a
 * dispatch. The offer's figures are folded into the same object because that is the only shape the scorer asks for.
 */
export async function scoringZone(db: Db, zoneId: string, input: ScoringZoneInput): Promise<ZoneFeatures> {
  const base = { medianPickupM: input.medianPickupM, medianDeliveriesToday: input.medianDeliveriesToday };
  const model = await readStoredModel(db, zoneId);
  if (model === null) return base;
  return {
    ...base,
    acceptanceModel: {
      weights: model.weights,
      samples: model.samples,
      atMs: input.atMs,
      payoutPaisa: input.payoutPaisa,
      ...(input.tripDistanceM === undefined ? {} : { tripDistanceM: input.tripDistanceM }),
      ...(input.weatherSeverity === undefined ? {} : { weatherSeverity: input.weatherSeverity }),
      ...(input.batch === undefined ? {} : { batch: input.batch }),
    },
  };
}

