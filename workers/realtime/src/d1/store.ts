/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The two writes a live position costs, and nothing else (`07 §4.2`, `§5`, D97).
 *
 * D1 holds only what may be lost: a 120-slot ring of recent fixes per rider and one row saying where that
 * rider is now. There is no update path, no history and no second table, because the whole privacy position
 * in `07 §6` rests on the live channel being the *only* place a rider's movements exist.
 *
 * The port exists so the route can be tested without a database and so the statements live in one file. Two
 * properties matter and are worth stating rather than implying:
 *
 * - **The ring is written with `INSERT OR REPLACE` at `(rider_id, seq)`.** Slot 121 overwrites slot 1, so the
 *   row count is bounded by `riders × 120` by construction rather than by a cleanup job that might not run.
 * - **`rider_current.stale_after` is computed from the profile, not from a constant.** It is the moment a map
 *   should stop calling the marker live, and it moves when the cadence moves — a rider at the door is stale in
 *   half a minute, a rider idling in an empty street in ten.
 */

import type { AcceptedFix } from "./ingest.ts";

/** A position and the ring slot it occupies. */
export interface StoredPosition {
  readonly seq: number;
  readonly fix: AcceptedFix;
}

/** Who and what the writes are about. */
export interface WriteInput {
  readonly riderId: string;
  readonly shiftId: string;
  readonly zoneId: string;
  readonly vehicle: string;
  /** `ONLINE`, `ON_ORDER` or `BREAK`. */
  readonly state: string;
  readonly activeOrderId: string | null;
  readonly batteryPct: number | null;
  readonly positions: readonly StoredPosition[];
  /** When the marker should stop being called live: `updated_at + 2 × ceiling`. */
  readonly staleAfterMs: number;
}

/** Where a rider's shift says they are, which is what the next batch is judged against. */
export interface RiderContext {
  readonly zoneId: string;
  readonly vehicle: string;
  readonly state: string;
  readonly activeOrderId: string | null;
  readonly batteryPct: number | null;
}

/** What an erasure removed. Counts are what the caller reports; zero is a success, not a miss. */
export interface Erasure {
  readonly positions: number;
  readonly current: number;
}

/** What the route needs from a position store. */
export interface PositionStore {
  /** The rider's shift context, or `null` when there is no current row: the shift has not started. */
  context(riderId: string): Promise<RiderContext | null>;
  /** The newest accepted fix for a rider, or `null` when the shift has not started. */
  newest(riderId: string): Promise<AcceptedFix | null>;
  /** Write a judged batch: every accepted fix, then one current row. */
  write(input: WriteInput): Promise<void>;
  /**
   * Remove a rider from the live channel (`07 §6`).
   *
   * Idempotent by design: a shift end, a presence timeout and an admin force-end can all fire for the same
   * rider within a second of each other, and the second one to arrive must be a success with zeros rather than
   * a 404 that leaves a caller thinking the trail is still there.
   */
  erase(riderId: string): Promise<Erasure>;
  /**
   * Erase every rider whose current row expired before `cutoffMs` (`07 §6.1`, the 60 s sweep).
   *
   * This is the fifth erasure trigger and the only one with no actor: a device that was uninstalled, whose
   * token was revoked, or that died in a way presence never proved. Nothing asks for it, so something has to
   * notice — and what it notices is the one fact the platform already stores: a `rider_current` row whose
   * `stale_after` is in the past is a row no device is refreshing.
   */
  sweepStale(cutoffMs: number): Promise<Swept>;
}

/** What a sweep removed. Zero is the normal answer; the counts make the abnormal one visible. */
export interface Swept {
  readonly riders: number;
  readonly positions: number;
}

/** The subset of D1 this module uses, so a test can be a plain object. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> };
  };
  /** `run()` reports changed rows in `meta.changes`, which is how an erasure is counted. */
  batch(statements: readonly { run(): Promise<unknown> }[]): Promise<unknown>;
}

/** The ring insert. `OR REPLACE` is what makes the trail a ring rather than a log. */
const INSERT_POSITION = `INSERT OR REPLACE INTO rider_positions
  (rider_id, seq, lat, lon, accuracy_m, bearing_deg, speed_mps, battery_pct, is_moving, order_id, recorded_at, received_at)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)`;

/** The current row, replaced rather than updated: one row per online rider, always. */
const UPSERT_CURRENT = `INSERT OR REPLACE INTO rider_current
  (rider_id, shift_id, zone_id, vehicle, lat, lon, bearing_deg, speed_mps, accuracy_m, state, active_order_id, batch_size, battery_pct, updated_at, stale_after)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`;

/** The rider's current row: the zone, vehicle and state a batch is judged against. */
const SELECT_CONTEXT = `SELECT zone_id, vehicle, state, active_order_id, battery_pct
  FROM rider_current WHERE rider_id = ?`;

/** `07 §6`: both statements, one batch, no history kept. */
const DELETE_POSITIONS = "DELETE FROM rider_positions WHERE rider_id = ?";
const DELETE_CURRENT = "DELETE FROM rider_current WHERE rider_id = ?";

/**
 * The sweep's two statements (`07 §6.1`). Positions first: the second statement deletes the rows the first one
 * selects, so running it first would leave orphaned trail rows behind for a rider the platform has forgotten.
 */
const SWEEP_POSITIONS = `DELETE FROM rider_positions
  WHERE rider_id IN (SELECT rider_id FROM rider_current WHERE stale_after < ?)`;
const SWEEP_CURRENT = "DELETE FROM rider_current WHERE stale_after < ?";

/** The newest stored fix, for the next batch's speed and ordering checks. */
const SELECT_NEWEST = `SELECT lat, lon, accuracy_m, bearing_deg, recorded_at, received_at
  FROM rider_positions WHERE rider_id = ? ORDER BY recorded_at DESC LIMIT 1`;

/** A position store over a D1 binding. */
export function d1Positions(db: D1Like): PositionStore {
  return {
    async context(riderId: string): Promise<RiderContext | null> {
      const result = (await db.prepare(SELECT_CONTEXT).bind(riderId).run()) as
        | { results?: readonly Record<string, unknown>[] }
        | undefined;
      const row = result?.results?.[0];
      if (row === undefined) return null;
      return {
        zoneId: String(row.zone_id),
        vehicle: String(row.vehicle),
        state: String(row.state),
        activeOrderId: row.active_order_id === null || row.active_order_id === undefined ? null : String(row.active_order_id),
        batteryPct: row.battery_pct === null || row.battery_pct === undefined ? null : Number(row.battery_pct),
      };
    },

    async newest(riderId: string): Promise<AcceptedFix | null> {
      const statement = db.prepare(SELECT_NEWEST).bind(riderId);
      const result = (await statement.run()) as { results?: readonly Record<string, unknown>[] } | undefined;
      const row = result?.results?.[0];
      if (row === undefined) return null;
      return {
        latE7: Math.round(Number(row.lat) * 1e7),
        lonE7: Math.round(Number(row.lon) * 1e7),
        accuracyM: Number(row.accuracy_m),
        bearingDeg: row.bearing_deg === null || row.bearing_deg === undefined ? null : Number(row.bearing_deg),
        recordedAtMs: Number(row.recorded_at),
        receivedAtMs: Number(row.received_at),
        isMock: false,
      };
    },

    async write(input: WriteInput): Promise<void> {
      const statements = input.positions.map((position) =>
        db
          .prepare(INSERT_POSITION)
          .bind(
            input.riderId,
            position.seq,
            position.fix.latE7 / 1e7,
            position.fix.lonE7 / 1e7,
            position.fix.accuracyM,
            position.fix.bearingDeg,
            input.batteryPct,
            input.activeOrderId,
            position.fix.recordedAtMs,
            position.fix.receivedAtMs,
          ),
      );
      const newest = input.positions[input.positions.length - 1];
      if (newest !== undefined) {
        statements.push(
          db
            .prepare(UPSERT_CURRENT)
            .bind(
              input.riderId,
              input.shiftId,
              input.zoneId,
              input.vehicle,
              newest.fix.latE7 / 1e7,
              newest.fix.lonE7 / 1e7,
              newest.fix.bearingDeg,
              newest.fix.accuracyM,
              input.state,
              input.activeOrderId,
              input.positions.length,
              input.batteryPct,
              newest.fix.receivedAtMs,
              input.staleAfterMs,
            ),
        );
      }
      // One D1 batch is one round trip and one atomic commit; a shift's trail and its current row cannot
      // disagree about where the rider is because both are in it.
      await db.batch(statements);
    },

    async erase(riderId: string): Promise<Erasure> {
      const results = (await db.batch([
        db.prepare(DELETE_POSITIONS).bind(riderId),
        db.prepare(DELETE_CURRENT).bind(riderId),
      ])) as readonly { meta?: { changes?: number } }[] | undefined;
      return {
        positions: results?.[0]?.meta?.changes ?? 0,
        current: results?.[1]?.meta?.changes ?? 0,
      };
    },

    async sweepStale(cutoffMs: number): Promise<Swept> {
      const results = (await db.batch([
        db.prepare(SWEEP_POSITIONS).bind(cutoffMs),
        db.prepare(SWEEP_CURRENT).bind(cutoffMs),
      ])) as readonly { meta?: { changes?: number } }[] | undefined;
      return {
        positions: results?.[0]?.meta?.changes ?? 0,
        riders: results?.[1]?.meta?.changes ?? 0,
      };
    },
  };
}
