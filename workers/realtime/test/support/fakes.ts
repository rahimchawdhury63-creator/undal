/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The doubles the coordination suite runs against.
 *
 * `MemoryStorage` mirrors Durable Object storage's one important property: values are serialised on
 * write and deserialised on read, so a room that mutates an array it was given cannot accidentally
 * mutate the stored value. `MemorySql` implements exactly three statements' worth of database
 * behaviour — the conditional claim, the event insert with its unique `(order_id, seq)` index, and
 * the two reads the coordinator issues — with the semantics the real statements have. It is a double,
 * not a mock: the class under test is the real coordinator, and what these replace is Cloudflare and
 * MySQL, not the code being tested.
 */

import type { CoordinationRoom } from "../../src/coordination/durable-object.ts";
import { CLAIM_SQL, INSERT_EVENT_SQL, OPEN_LOCK_SQL, READ_EVENTS_SQL, RELEASE_LOCK_SQL } from "../../src/coordination/tidb.ts";

/** An in-memory Durable Object storage, with the serialise-on-write behaviour of the real one. */
export class MemoryStorage {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const output = new Map<string, T>();
    for (const [key, raw] of this.map) {
      if (options.prefix === undefined || key.startsWith(options.prefix)) {
        output.set(key, JSON.parse(raw) as T);
      }
    }
    return output;
  }

  /** How many keys are stored, for a test that asserts nothing leaked. */
  size(): number {
    return this.map.size;
  }
}

/** A `DurableObjectState` good enough for the room, with real serialisation semantics. */
export function fakeState(): DurableObjectState {
  const storage = new MemoryStorage();
  return {
    storage,
    id: { toString: () => "fake-room", equals: () => true, name: "fake-room" },
    waitUntil: () => undefined,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  } as unknown as DurableObjectState;
}

/** A namespace that routes every room name to one instance, so RPCs exercise the room's real code. */
export class FakeNamespace {
  private readonly rooms = new Map<string, CoordinationRoom>();
  private readonly make: (name: string) => CoordinationRoom;

  constructor(make: (name: string) => CoordinationRoom) {
    this.make = make;
  }

  idFromName(name: string): DurableObjectId {
    return { toString: () => name, name, equals: (other: DurableObjectId) => other.toString() === name } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString();
    let room = this.rooms.get(name);
    if (room === undefined) {
      room = this.make(name);
      this.rooms.set(name, room);
    }
    const resolved = room;
    return {
      fetch: (request: Request) => resolved.fetch(request),
    } as unknown as DurableObjectStub;
  }
}

/** A row of the fake event table. */
interface EventRecord {
  readonly orderId: string;
  readonly seq: number;
  readonly kind: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly metadata: string;
  readonly occurredAt: string;
}

/** A row of the fake lock table. `expiresAt` is a UTC `DATETIME(6)` string, compared as one. */
interface LockRecord {
  holder: string;
  expiresAt: string;
}

/** In-memory TiDB, for the three statements the coordinator issues. */
export class MemorySql {
  readonly locks = new Map<string, LockRecord>();
  readonly events: EventRecord[] = [];
  readonly statements: string[] = [];
  /** Set to make the next event insert fail with a duplicate, simulating a lost sequence race. */
  duplicateOnNextInsert = false;
  /** Set to make health fail. */
  failHealth = false;

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.statements.push(sql);
    const text = sql.replace(/\s+/gu, " ").trim();

    if (text.startsWith("SELECT COALESCE(MAX(seq)")) {
      const orderId = String(params[0]);
      const seqs = this.events.filter((event) => event.orderId === orderId).map((event) => event.seq);
      return [{ maxSeq: seqs.length === 0 ? 0 : Math.max(...seqs) }] as unknown as T[];
    }
    if (text.startsWith("SELECT holder, expires_at")) {
      const lock = this.locks.get(String(params[0]));
      return (lock === undefined ? [] : [{ holder: lock.holder, expires_at: lock.expiresAt }]) as unknown as T[];
    }
    if (text === "SELECT 1 AS one") {
      if (this.failHealth) throw new Error("connection refused");
      return [{ one: 1 }] as unknown as T[];
    }
    if (text.startsWith("SELECT seq, to_state")) {
      const orderId = String(params[0]);
      const after = Number(params[1]);
      const limit = Number(params[2]);
      return this.events
        .filter((event) => event.orderId === orderId && event.seq > after)
        .sort((left, right) => left.seq - right.seq)
        .slice(0, limit)
        .map((event) => ({
          seq: event.seq,
          kind: event.kind,
          actorType: event.actorType,
          actorId: event.actorId,
          metadata: event.metadata,
          occurredAt: event.occurredAt,
        })) as unknown as T[];
    }
    throw new Error(`fake sql has no answer for: ${text.slice(0, 80)}`);
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<{ affectedRows: number }> {
    this.statements.push(sql);

    if (sql === OPEN_LOCK_SQL) {
      const orderId = String(params[1]);
      if (this.locks.has(orderId)) return { affectedRows: 0 };
      this.locks.set(orderId, { holder: "NONE", expiresAt: String(params[2]) });
      return { affectedRows: 1 };
    }

    if (sql === CLAIM_SQL) {
      const [riderId, expiresAt, orderId, sameRider, nowA, nowB] = params;
      const lock = this.locks.get(String(orderId));
      if (lock === undefined) return { affectedRows: 0 };
      const free = lock.holder === "NONE";
      const mineAndLive = lock.holder === String(sameRider) && lock.expiresAt >= String(nowA);
      const expired = lock.expiresAt < String(nowB);
      if (!free && !mineAndLive && !expired) return { affectedRows: 0 };
      const changed = lock.holder !== String(riderId) || lock.expiresAt !== String(expiresAt);
      lock.holder = String(riderId);
      lock.expiresAt = String(expiresAt);
      return { affectedRows: changed ? 1 : 0 };
    }

    if (sql === RELEASE_LOCK_SQL) {
      const [, orderId, riderId] = params;
      const lock = this.locks.get(String(orderId));
      if (lock === undefined || lock.holder !== String(riderId)) return { affectedRows: 0 };
      lock.holder = "NONE";
      return { affectedRows: 1 };
    }

    if (sql === INSERT_EVENT_SQL) {
      const [, orderId, seq, kind, actorType, actorId, metadata, occurredAt] = params;
      const duplicate = this.duplicateOnNextInsert || this.events.some(
        (event) => event.orderId === String(orderId) && event.seq === Number(seq),
      );
      this.duplicateOnNextInsert = false;
      if (duplicate) throw new Error("Error 1062: Duplicate entry for key 'uq_order_events_seq'");
      this.events.push({
        orderId: String(orderId),
        seq: Number(seq),
        kind: String(kind),
        actorType: String(actorType),
        actorId: actorId === null || actorId === undefined ? null : String(actorId),
        metadata: String(metadata),
        occurredAt: String(occurredAt),
      });
      return { affectedRows: 1 };
    }

    throw new Error(`fake sql has no answer for an execute: ${sql.replace(/\s+/gu, " ").slice(0, 80)}`);
  }

  /** Statements that began with a given prefix, for asserting what the coordinator actually ran. */
  ran(prefix: string): string[] {
    return this.statements.filter((sql) => sql.replace(/\s+/gu, " ").trim().startsWith(prefix));
  }
}

/** An in-memory key-value store with the KV contract the SQL coordinator uses. */
export class MemoryStore {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    void ttlSeconds;
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list<T>(prefix: string): Promise<readonly { readonly key: string; readonly value: T }[]> {
    const rows: { key: string; value: T }[] = [];
    for (const [key, raw] of this.map) {
      if (key.startsWith(prefix)) rows.push({ key, value: JSON.parse(raw) as T });
    }
    return rows.sort((left, right) => left.key.localeCompare(right.key));
  }

  size(): number {
    return this.map.size;
  }
}

/** The exports the fakes re-use, so a test can assert the exact statement text. */
export const STATEMENTS = { CLAIM_SQL, OPEN_LOCK_SQL, RELEASE_LOCK_SQL, INSERT_EVENT_SQL, READ_EVENTS_SQL };
