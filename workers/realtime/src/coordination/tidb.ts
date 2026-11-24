/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The `sql` backend: the free path, and the one that actually ships at launch.
 *
 * A Durable Object gives atomicity by being single-threaded. TiDB has to be asked, so the claim is
 * one conditional `UPDATE` against `dispatch_locks` — the statement in `05 §4.2` — where exactly one
 * caller comes back with `affectedRows = 1`. Everything that does not need cross-process atomicity
 * (the wave plan, presence sessions) lives in a key-value store behind a lease, and the event log
 * lives in `order_state_events`, which is the table that already exists for it.
 *
 * Two honest limitations, stated here rather than discovered in production:
 *
 * 1. **KV is eventually consistent.** A presence list can lag a heartbeat by a second. The deadline
 *    that matters is computed from `lastHeartbeatMs` on the row, so a stale row is filtered out by its
 *    timestamp, never trusted for liveness.
 * The executor this class is given is a port, not a driver. `05 §2.1` and `34 §3.1` are unambiguous that
 * `undal-core` is the only Worker that writes TiDB, so in production the `SqlExecutor` is filled by
 * core's internal surface over a service binding, and this class composes the statement rather than
 * opening a connection. A TiDB driver in this Worker would be a second writer with a second set of
 * assumptions about the same row, which is the thing the single-writer rule exists to prevent.
 *
 * 2. **Only the claim is atomic across processes.** `advanceWave` and `closeDispatch` are driven by the
 *    single cascade owner (the socket that holds the dispatch lease), so they are read-then-write on a
 *    row nobody else is writing. If two owners ever raced, the second write would win, and the claim
 *    row — not the wave plan — is what decides who has the order.
 */

import type {
  BackendHealth,
  CloseReason,
  Coordinator,
  DispatchState,
  HeartbeatAck,
  OpenDispatchInput,
  OrderEvent,
  OrderEventInput,
  PresenceClaim,
  PresenceRole,
  PresenceSession,
  ZoneSnapshot,
} from "./coordinator.ts";
import {
  EVENT_PAGE_LIMIT,
  HEARTBEAT_DEADLINE_MS,
  HEARTBEAT_STAMP_MS,
  PRESENCE_STALENESS_MS,
} from "./coordinator.ts";
import type { ClaimResult } from "./claim.ts";
import { decideClaim } from "./claim.ts";
import { advanceState, claimState, closeState, dispatchKey, openState, withdrawState } from "./machine.ts";
import { leaseFrom } from "./lease.ts";
import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import { COORDINATION_STATEMENTS, uuidv7 } from "@undal/contracts";

/** The SQL surface the coordinator needs. The core Worker's `Db` satisfies it. */
export interface SqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<{ affectedRows: number }>;
}

/**
 * The key-value surface the coordinator needs.
 *
 * Cloudflare KV satisfies it; so does a `Map` in a test. Presence sessions are stored with the KV
 * minimum TTL of 60 s and additionally carry their own 2 s heartbeat deadline, because a session row
 * outliving its heartbeat is expected and must not be read as presence.
 */
export interface StateStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(prefix: string): Promise<readonly { readonly key: string; readonly value: T }[]>;
}

/** The shortest TTL Cloudflare KV accepts. A presence row is swept by its own deadline long before it. */
export const KV_MIN_TTL_S = 60;

/**
 * What one isolate remembers about one device between beats.
 *
 * `session` is kept so a refresh needs no read: the row this isolate last wrote *is* the row, because a
 * presence key belongs to one device and two isolates racing on it are two sockets for one device — which
 * the platform treats as one session either way. `key === null` means the last lookup found no row, and the
 * memo expires like any other so a beat that arrives before its `declarePresence` is not lost forever.
 */
interface PresenceMemo {
  readonly key: string | null;
  readonly session: PresenceSession | null;
  readonly atMs: number;
}

/** How many times an event insert retries after losing the sequence race. */
export const EVENT_INSERT_RETRIES = 3;

/** The open-dispatch counter a zone's first paint reads. It is a display number, not a lock. */
function zoneCountKey(zoneId: string): string {
  return `zone:${zoneId}:openDispatches`;
}

/** The key a presence session lives under. Role and zone are in the key so a zone list is a prefix. */
function presenceKey(session: PresenceClaim | PresenceSession): string {
  return `presence:${session.zoneId}:${session.role}:${session.actorId}:${session.deviceId}`;
}

/** A UUIDv7 as the 32 hex characters MySQL's `UNHEX` expects. */
function hexId(atMs: number): string {
  const bytes = uuidv7(atMs);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** A timestamp as TiDB's `DATETIME(6)` literal, in UTC, which is what the schema stores. */
export function sqlTime(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 23).replace("T", " ");
}

/**
 * The statements this coordinator composes.
 *
 * They live in the shared catalogue (`D90`) rather than here, because the free path does not run SQL in this
 * Worker: core does. The coordinator still *composes* the statement — it holds the spelling, chooses the
 * parameters and decides which statement a situation calls for — and the executor sends the catalogue's
 * name, so the SQL itself never crosses the service boundary.
 */
export const CLAIM_SQL = COORDINATION_STATEMENTS.claim_lock.sql;

/** The row that must exist before anybody can claim. */
export const OPEN_LOCK_SQL = COORDINATION_STATEMENTS.open_lock.sql;

/** Release a lock won by a claim that then turned out to be invalid. */
export const RELEASE_LOCK_SQL = COORDINATION_STATEMENTS.release_lock.sql;

/** Who holds the lock, for the loser's answer and for an admin looking at a stuck order. */
export const LOCK_HOLDER_SQL = COORDINATION_STATEMENTS.lock_holder.sql;

/** The next sequence number for an order's log. */
export const NEXT_SEQ_SQL = COORDINATION_STATEMENTS.next_seq.sql;

/** Append one event. The unique index on `(order_id, seq)` is the arbiter of a lost race. */
export const INSERT_EVENT_SQL = COORDINATION_STATEMENTS.insert_event.sql;

/** The replay query: everything after a sequence number, oldest first. */
export const READ_EVENTS_SQL = COORDINATION_STATEMENTS.read_events.sql;

/** A liveness read that touches nothing and needs no table. */
export const PING_SQL = COORDINATION_STATEMENTS.ping.sql;

/** A row of `READ_EVENTS_SQL`, before the JSON column is decoded. */
interface EventRow {
  readonly seq: number;
  readonly kind: string;
  readonly actorType: OrderEventInput["actorType"];
  readonly actorId: string | null;
  readonly metadata: unknown;
  readonly occurredAt: string | Date;
}

/**
 * The free-tier coordinator.
 *
 * The constructor takes its two ports and a clock; it opens no connection of its own. That is what
 * lets the concurrency suite run the real class against a store that implements the same conditional
 * update the database does, rather than mocking the class under test.
 */
export class TiDBCoordinator implements Coordinator {
  /** Stamped rows: alive as of the last stamp, plus the deadline that follows it (D89). */
  readonly presenceWindowMs = PRESENCE_STALENESS_MS;

  private readonly sql: SqlExecutor;
  private readonly store: StateStore;
  private readonly clock: Clock;
  /** Presence rows this isolate is looking after, so a beat costs no store operation at all (D89). */
  private readonly memos = new Map<string, PresenceMemo>();

  constructor(sql: SqlExecutor, store: StateStore, clock: Clock = systemClock) {
    this.sql = sql;
    this.store = store;
    this.clock = clock;
  }

  async openDispatch(input: OpenDispatchInput): Promise<DispatchState> {
    const key = dispatchKey(input.orderId);
    const existing = await this.store.get<DispatchState>(key);
    if (existing !== null) return existing;
    const now = this.clock.nowMs();
    const state = openState(input, now);
    await this.sql.execute(OPEN_LOCK_SQL, [
      hexId(now),
      input.orderId,
      sqlTime(state.leaseUntilMs),
      sqlTime(now),
    ]);
    await this.store.put(key, state);
    await this.noteDispatch(input.zoneId, 1);
    return state;
  }

  async getDispatch(orderId: string): Promise<DispatchState | null> {
    return this.store.get<DispatchState>(dispatchKey(orderId));
  }

  async claimOffer(orderId: string, riderId: string): Promise<ClaimResult> {
    const now = this.clock.nowMs();
    const current = await this.getDispatch(orderId);
    if (current === null) {
      return {
        ok: false,
        code: "OFFER_WAVE_CLOSED",
        orderId,
        riderId,
        claimedBy: null,
        wave: null,
        atMs: now,
      };
    }
    // Refuse early when the answer is already no: there is no reason to spend a lock write on a rider
    // whose wave has expired. The decision is re-made after the lock is won, because that is the state
    // that matters.
    const preliminary = decideClaim(current, riderId, now);
    if (!preliminary.ok) return preliminary;

    const lease = leaseFrom(now);
    const won = await this.sql.execute(CLAIM_SQL, [
      riderId,
      sqlTime(lease.untilMs),
      orderId,
      riderId,
      sqlTime(now),
      sqlTime(now),
    ]);
    if (won.affectedRows === 0) {
      const holders = await this.sql.query<{ holder: string }>(LOCK_HOLDER_SQL, [orderId]);
      const holder = holders[0]?.holder ?? "UNKNOWN";
      return {
        ok: holder === riderId,
        code: holder === riderId ? "OK" : current === null ? "OFFER_WAVE_CLOSED" : "OFFER_CLAIMED",
        orderId,
        riderId,
        claimedBy: holder === "NONE" ? null : holder,
        wave: null,
        atMs: now,
      };
    }

    const fresh = (await this.getDispatch(orderId)) ?? current;
    if (fresh === null) return this.release(lease, orderId, riderId, now);
    const applied = claimState(fresh, riderId, now);
    if (!applied.result.ok) return this.release(lease, orderId, riderId, now);
    await this.store.put(dispatchKey(orderId), applied.state);
    return applied.result;
  }

  async withdrawOffer(orderId: string, riderId: string, reason: string): Promise<DispatchState> {
    const current = await this.requireDispatch(orderId);
    const next = withdrawState(current, riderId);
    if (next !== current) await this.store.put(dispatchKey(orderId), next);
    return next;
  }

  async advanceWave(orderId: string): Promise<DispatchState> {
    const current = await this.requireDispatch(orderId);
    const next = advanceState(current);
    if (next !== current) await this.store.put(dispatchKey(orderId), next);
    if (next.phase === "FALLBACK" && current.phase !== "FALLBACK") {
      await this.noteDispatch(next.zoneId, -1);
    }
    return next;
  }

  async closeDispatch(orderId: string, reason: CloseReason): Promise<DispatchState> {
    const current = await this.requireDispatch(orderId);
    if (current.closedReason !== null) return current;
    const next = closeState(current, reason, this.clock.nowMs());
    await this.store.put(dispatchKey(orderId), next);
    await this.noteDispatch(next.zoneId, -1);
    return next;
  }

  async declarePresence(claim: PresenceClaim): Promise<PresenceSession> {
    const now = this.clock.nowMs();
    const session: PresenceSession = {
      actorId: claim.actorId,
      deviceId: claim.deviceId,
      role: claim.role,
      zoneId: claim.zoneId,
      connectedAtMs: claim.connectedAtMs ?? now,
      lastHeartbeatMs: now,
      seq: 0,
    };
    await this.store.put(presenceKey(session), session, KV_MIN_TTL_S);
    // The upgrade is the moment this isolate learns where the row lives, so it is also the moment a memo
    // costs nothing and a beat costs nothing.
    this.memos.set(this.memoKey(session.zoneId, session.actorId, session.deviceId), {
      key: presenceKey(session),
      session,
      atMs: now,
    });
    return session;
  }

  /**
   * Accept a heartbeat.
   *
   * A beat inside the stamp window touches nothing. The row written when the window last closed still
   * describes this device — same session, same zone, same role — and the only number a beat changes is the
   * one the ack carries back, which the caller already has. The deadline that decides whether the device is
   * alive is enforced by the process holding the socket (`14 §3.1`), so a store write here would be a
   * forty-thousand-row transcript of a fact nobody reads that precisely.
   */
  async heartbeat(zoneId: string, actorId: string, deviceId: string, seq: number): Promise<HeartbeatAck> {
    const now = this.clock.nowMs();
    const memoKey = this.memoKey(zoneId, actorId, deviceId);
    const memo = this.memos.get(memoKey);
    const ack = (known: boolean): HeartbeatAck => ({
      actorId,
      deviceId,
      seq,
      nowMs: now,
      deadlineMs: now + HEARTBEAT_DEADLINE_MS,
      known,
    });

    if (memo !== undefined && now - memo.atMs < HEARTBEAT_STAMP_MS) return ack(memo.key !== null);

    const session = memo !== undefined && memo.key !== null ? memo.session : await this.findPresence(zoneId, actorId, deviceId);
    if (session === null) {
      // Re-checked once per window rather than remembered as absent forever: a beat can arrive before the
      // upgrade that declares the session, and a device must not be invisible because two frames raced.
      this.memos.set(memoKey, { key: null, session: null, atMs: now });
      return ack(false);
    }

    const stamped: PresenceSession = { ...session, lastHeartbeatMs: now, seq };
    const rowKey = memo?.key ?? presenceKey(stamped);
    await this.store.put(rowKey, stamped, KV_MIN_TTL_S);
    this.memos.set(memoKey, { key: rowKey, session: stamped, atMs: now });
    return ack(true);
  }

  /**
   * Mark a device gone.
   *
   * The memo is what makes this one write rather than a list and a write: the isolate that saw the socket
   * close is normally the isolate whose memo holds the key.
   */
  async markAbsent(zoneId: string, actorId: string, deviceId: string, reason: string): Promise<void> {
    void reason;
    const memoKey = this.memoKey(zoneId, actorId, deviceId);
    const memo = this.memos.get(memoKey);
    this.memos.delete(memoKey);
    if (memo !== undefined && memo.key !== null) {
      await this.store.delete(memo.key);
      return;
    }
    if (memo !== undefined) return;
    const rows = await this.store.list<PresenceSession>(`presence:${zoneId}:`);
    const found = rows.find((row) => row.value.actorId === actorId && row.value.deviceId === deviceId);
    if (found !== undefined) await this.store.delete(found.key);
  }

  /**
   * The zone's rows, exactly as they were last written.
   *
   * Unfiltered on purpose. Presence expires by an explicit `markAbsent` from the escalation that watched the
   * socket go quiet, not by quietly dropping rows from a listing: a dropped row is indistinguishable from a
   * device that never connected, and the two need different answers. A reader that needs "is this alive now"
   * compares `lastHeartbeatMs` against `presenceWindowMs` itself — which is what the row carries the stamp
   * for (D89).
   */
  async listPresence(zoneId: string, role?: PresenceRole): Promise<readonly PresenceSession[]> {
    const rows = await this.store.list<PresenceSession>(`presence:${zoneId}:`);
    return rows
      .map((row) => row.value)
      .filter((session) => role === undefined || session.role === role)
      .sort((left, right) => left.actorId.localeCompare(right.actorId));
  }

  /** The one row a device's beats are about, found by listing the zone it says it is in. */
  private async findPresence(
    zoneId: string,
    actorId: string,
    deviceId: string,
  ): Promise<PresenceSession | null> {
    const rows = await this.store.list<PresenceSession>(`presence:${zoneId}:`);
    const found = rows.find((row) => row.value.actorId === actorId && row.value.deviceId === deviceId);
    return found === undefined ? null : found.value;
  }

  /** The memo's identity: one device in one zone, whatever role it holds. */
  private memoKey(zoneId: string, actorId: string, deviceId: string): string {
    return `${zoneId}|${actorId}|${deviceId}`;
  }

  async appendEvent(input: OrderEventInput): Promise<OrderEvent> {
    for (let attempt = 0; attempt < EVENT_INSERT_RETRIES; attempt += 1) {
      const rows = await this.sql.query<{ maxSeq: number | string }>(NEXT_SEQ_SQL, [input.orderId]);
      const seq = Number(rows[0]?.maxSeq ?? 0) + 1;
      const occurredAtMs = input.occurredAtMs ?? this.clock.nowMs();
      const event: OrderEvent = {
        orderId: input.orderId,
        seq,
        kind: input.kind,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        payload: input.payload ?? {},
        occurredAtMs,
      };
      try {
        await this.sql.execute(INSERT_EVENT_SQL, [
          hexId(occurredAtMs),
          input.orderId,
          seq,
          input.kind,
          input.actorType,
          event.actorId,
          JSON.stringify(event.payload),
          sqlTime(occurredAtMs),
        ]);
        return event;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/duplicate/iu.test(message) || attempt === EVENT_INSERT_RETRIES - 1) throw error;
      }
    }
    throw new Error("unreachable");
  }

  async readEvents(orderId: string, afterSeq: number, limit: number = EVENT_PAGE_LIMIT): Promise<readonly OrderEvent[]> {
    const capped = Math.min(Math.max(1, limit), EVENT_PAGE_LIMIT);
    const rows = await this.sql.query<EventRow>(READ_EVENTS_SQL, [orderId, afterSeq, capped]);
    return rows.map((row) => ({
      orderId,
      seq: Number(row.seq),
      kind: row.kind,
      actorType: row.actorType,
      actorId: row.actorId,
      payload: decodeMetadata(row.metadata),
      occurredAtMs: Date.parse(String(row.occurredAt)),
    }));
  }

  async snapshot(zoneId: string): Promise<ZoneSnapshot> {
    const sessions = await this.listPresence(zoneId);
    const presence: Record<PresenceRole, number> = { RIDER: 0, PARTNER: 0, CUSTOMER: 0, ADMIN: 0 };
    for (const session of sessions) presence[session.role] += 1;
    const openDispatches = (await this.store.get<number>(zoneCountKey(zoneId))) ?? 0;
    return {
      zoneId,
      asOfMs: this.clock.nowMs(),
      openDispatches: Math.max(0, openDispatches),
      presence,
    };
  }

  async health(): Promise<BackendHealth> {
    const started = this.clock.nowMs();
    try {
      await this.sql.query(PING_SQL);
      return {
        backend: "sql",
        ok: true,
        nowMs: this.clock.nowMs(),
        latencyMs: this.clock.nowMs() - started,
      };
    } catch {
      return { backend: "sql", ok: false, nowMs: this.clock.nowMs(), latencyMs: this.clock.nowMs() - started };
    }
  }

  /** Give a lock back after a claim that the state no longer allows. */
  private async release(lease: { untilMs: number }, orderId: string, riderId: string, now: number): Promise<ClaimResult> {
    await this.sql.execute(RELEASE_LOCK_SQL, [sqlTime(lease.untilMs), orderId, riderId]);
    return {
      ok: false,
      code: "OFFER_WAVE_CLOSED",
      orderId,
      riderId,
      claimedBy: null,
      wave: null,
      atMs: now,
    };
  }

  private async requireDispatch(orderId: string): Promise<DispatchState> {
    const state = await this.getDispatch(orderId);
    if (state === null) throw new RangeError(`no dispatch for ${orderId}`);
    return state;
  }

  /** Adjust the zone's open-dispatch display counter. */
  private async noteDispatch(zoneId: string, delta: number): Promise<void> {
    if (zoneId === "") return;
    const key = zoneCountKey(zoneId);
    const current = (await this.store.get<number>(key)) ?? 0;
    await this.store.put(key, Math.max(0, current + delta));
  }
}

/** Decode a JSON column that may already have been decoded by the driver. */
function decodeMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}
