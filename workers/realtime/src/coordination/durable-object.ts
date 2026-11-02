/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The Durable Object backend: one room per order, one room per zone, and the single-threaded
 * guarantee that makes a claim a claim.
 *
 * Cloudflare runs a Durable Object's requests one at a time. That is the entire locking story: a
 * claim reads the state, decides with `claimState`, and writes it back, and no second claim can
 * interleave. There is no transaction, no retry ladder and no lock to leak, which is why this is the
 * preferred backend on the paid plan and the reference implementation the `sql` backend is measured
 * against.
 *
 * The room is deliberately a plain class: it takes a `DurableObjectState` and a clock, so a test can
 * construct it with in-memory storage and a `FixedClock` and drive 50 simultaneous claims through the
 * real code path rather than a simulation of it.
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
import { EVENT_PAGE_LIMIT, HEARTBEAT_DEADLINE_MS } from "./coordinator.ts";
import type { ClaimResult } from "./claim.ts";
import { advanceState, claimState, closeState, dispatchKey, nextSeq, openState, withdrawState } from "./machine.ts";
import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";

const DISPATCH_STORAGE_KEY = "dispatch";
const EVENTS_STORAGE_KEY = "events";
const PRESENCE_STORAGE_KEY = "presence";
const DISPATCH_COUNT_KEY = "dispatchCount";

/** A Durable Object's storage surface, narrowed to what the room uses. */
type RoomStorage = DurableObjectState["storage"];

/** The key a session lives under inside the presence map. */
function sessionKey(actorId: string, deviceId: string): string {
  return `${actorId}:${deviceId}`;
}

/** The room's reply to an RPC. */
interface RoomReply<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

/**
 * One Durable Object: an order's cascade and event log, or a zone's presence and counters.
 *
 * The same class serves both because the storage layout is the same: a state value, a log and a map.
 * A zone room simply never receives a dispatch command and an order room never receives presence,
 * which is a routing fact rather than a class hierarchy.
 */
export class CoordinationRoom {
  private readonly storage: RoomStorage;
  private readonly clock: Clock;
  /**
   * The room's input gate.
   *
   * A real Durable Object runs one request at a time; a test that calls `fetch` fifty times at once
   * must see the same thing. Chaining every RPC on one promise reproduces the property the claim
   * relies on, and does it without a lock, because JavaScript's run-to-completion plus this queue is
   * the same guarantee the runtime gives.
   */
  private gate: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, clock: Clock = systemClock) {
    this.storage = state.storage;
    this.clock = clock;
  }

  /** Run one operation after everything already queued. */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.gate.then(operation, operation);
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** HTTP surface: one `/rpc` endpoint, JSON in and JSON out. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/rpc" || request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "NOT_IMPLEMENTED" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    let body: { method?: string; args?: unknown[] };
    try {
      body = (await request.json()) as { method?: string; args?: unknown[] };
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "BAD_JSON" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const method = body.method ?? "";
    const args = body.args ?? [];
    try {
      const data = await this.serial(() => this.invoke(method, args));
      return new Response(JSON.stringify({ ok: true, data }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }

  /**
   * Route one RPC by name.
   *
   * The switch is explicit rather than a dynamic lookup because a dynamic dispatch table is a way for
   * a typo in a method name to become a silent no-op instead of a 500 in a test.
   */
  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "openDispatch":
        return this.openDispatch(args[0] as OpenDispatchInput);
      case "getDispatch":
        return this.getDispatch();
      case "claimOffer":
        return this.claimOffer(String(args[0]));
      case "withdrawOffer":
        return this.withdrawOffer(String(args[0]), String(args[1]));
      case "advanceWave":
        return this.advanceWave();
      case "closeDispatch":
        return this.closeDispatch(args[0] as CloseReason);
      case "declarePresence":
        return this.declarePresence(args[0] as PresenceClaim);
      case "heartbeat":
        return this.heartbeat(String(args[0]), String(args[1]), Number(args[2]));
      case "markAbsent":
        return this.markAbsent(String(args[0]), String(args[1]));
      case "listPresence": {
        // JSON has no `undefined`: an omitted role arrives as `null`, and treating it as a role
        // would filter every session out instead of none.
        const role = args[0];
        return this.listPresence(typeof role === "string" ? (role as PresenceRole) : undefined);
      }
      case "appendEvent":
        return this.appendEvent(args[0] as OrderEventInput);
      case "readEvents":
        return this.readEvents(Number(args[0]), Number(args[1]));
      case "snapshot":
        return this.snapshot(String(args[0]));
      case "noteDispatch":
        return this.noteDispatch(Number(args[0]));
      case "health":
        return this.health();
      default:
        throw new RangeError(`unknown coordination method: ${method}`);
    }
  }

  /** Read the dispatch state, or `null` before a cascade has been opened. */
  async getDispatch(): Promise<DispatchState | null> {
    return (await this.storage.get<DispatchState>(DISPATCH_STORAGE_KEY)) ?? null;
  }

  /** Open a cascade. Re-opening an open one returns the stored plan unchanged. */
  async openDispatch(input: OpenDispatchInput): Promise<DispatchState> {
    const existing = await this.getDispatch();
    if (existing !== null) {
      if (existing.orderId !== input.orderId) throw new RangeError("a room holds exactly one order");
      return existing;
    }
    const state = openState(input, this.clock.nowMs());
    await this.storage.put(DISPATCH_STORAGE_KEY, state);
    return state;
  }

  /** Claim the offer for a rider. The room's serialisation is the lock. */
  async claimOffer(riderId: string): Promise<ClaimResult> {
    const current = await this.getDispatch();
    if (current === null) {
      return {
        ok: false,
        code: "OFFER_WAVE_CLOSED",
        orderId: "",
        riderId,
        claimedBy: null,
        wave: null,
        atMs: this.clock.nowMs(),
      };
    }
    const { state, result } = claimState(current, riderId, this.clock.nowMs());
    if (state !== current) await this.storage.put(DISPATCH_STORAGE_KEY, state);
    return result;
  }

  /** Record a rejection and withdraw that rider's offer. */
  async withdrawOffer(riderId: string, reason: string): Promise<DispatchState> {
    const current = await this.requireDispatch();
    const next = withdrawState(current, riderId);
    if (next !== current) await this.storage.put(DISPATCH_STORAGE_KEY, next);
    return next;
  }

  /** Fire the next wave, or move the dispatch to the fallback ladder. */
  async advanceWave(): Promise<DispatchState> {
    const current = await this.requireDispatch();
    const next = advanceState(current);
    if (next !== current) await this.storage.put(DISPATCH_STORAGE_KEY, next);
    return next;
  }

  /** Close the dispatch. Closing an already-closed dispatch is idempotent. */
  async closeDispatch(reason: CloseReason): Promise<DispatchState> {
    const current = await this.requireDispatch();
    if (current.closedReason !== null) return current;
    const next = closeState(current, reason, this.clock.nowMs());
    await this.storage.put(DISPATCH_STORAGE_KEY, next);
    return next;
  }

  /** Register, or replace, a connected device. */
  async declarePresence(claim: PresenceClaim): Promise<PresenceSession> {
    const now = this.clock.nowMs();
    const sessions = await this.presenceMap();
    const session: PresenceSession = {
      actorId: claim.actorId,
      deviceId: claim.deviceId,
      role: claim.role,
      zoneId: claim.zoneId,
      connectedAtMs: claim.connectedAtMs ?? now,
      lastHeartbeatMs: now,
      seq: 0,
    };
    sessions[sessionKey(claim.actorId, claim.deviceId)] = session;
    await this.storage.put(PRESENCE_STORAGE_KEY, sessions);
    return session;
  }

  /** Accept a heartbeat and return the deadline it buys. */
  async heartbeat(actorId: string, deviceId: string, seq: number): Promise<HeartbeatAck> {
    const now = this.clock.nowMs();
    const sessions = await this.presenceMap();
    const key = sessionKey(actorId, deviceId);
    const existing = sessions[key];
    if (existing === undefined) {
      return { actorId, deviceId, seq, nowMs: now, deadlineMs: now + HEARTBEAT_DEADLINE_MS, known: false };
    }
    const updated: PresenceSession = { ...existing, lastHeartbeatMs: now, seq };
    sessions[key] = updated;
    await this.storage.put(PRESENCE_STORAGE_KEY, sessions);
    return { actorId, deviceId, seq, nowMs: now, deadlineMs: now + HEARTBEAT_DEADLINE_MS, known: true };
  }

  /** Remove a session. A second removal is a no-op, because a close event can arrive twice. */
  async markAbsent(actorId: string, deviceId: string): Promise<void> {
    const sessions = await this.presenceMap();
    const key = sessionKey(actorId, deviceId);
    if (sessions[key] === undefined) return;
    delete sessions[key];
    await this.storage.put(PRESENCE_STORAGE_KEY, sessions);
  }

  /** Every live session, optionally for one role. */
  async listPresence(role?: PresenceRole): Promise<PresenceSession[]> {
    const sessions = Object.values(await this.presenceMap());
    const filtered = role === undefined ? sessions : sessions.filter((session) => session.role === role);
    return filtered.sort((left, right) => left.actorId.localeCompare(right.actorId));
  }

  /** Append an event, assigning the next sequence number. */
  async appendEvent(input: OrderEventInput): Promise<OrderEvent> {
    const events = await this.events();
    const event: OrderEvent = {
      orderId: input.orderId,
      seq: nextSeq(events),
      kind: input.kind,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      occurredAtMs: input.occurredAtMs ?? this.clock.nowMs(),
    };
    events.push(event);
    await this.storage.put(EVENTS_STORAGE_KEY, events);
    return event;
  }

  /** The events after `afterSeq`, oldest first — the SSE resume. */
  async readEvents(afterSeq: number, limit: number = EVENT_PAGE_LIMIT): Promise<OrderEvent[]> {
    const capped = Math.min(limit, EVENT_PAGE_LIMIT);
    return (await this.events())
      .filter((event) => event.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
      .slice(0, capped);
  }

  /** The zone's first paint. */
  async snapshot(zoneId: string): Promise<ZoneSnapshot> {
    const sessions = await this.listPresence();
    const presence: Record<PresenceRole, number> = { RIDER: 0, PARTNER: 0, CUSTOMER: 0, ADMIN: 0 };
    for (const session of sessions) presence[session.role] += 1;
    const openDispatches = (await this.storage.get<number>(DISPATCH_COUNT_KEY)) ?? 0;
    return { zoneId, asOfMs: this.clock.nowMs(), openDispatches: Math.max(0, openDispatches), presence };
  }

  /** Adjust the zone's open-dispatch counter. Called by the coordinator on open and close. */
  async noteDispatch(delta: number): Promise<number> {
    const current = (await this.storage.get<number>(DISPATCH_COUNT_KEY)) ?? 0;
    const next = Math.max(0, current + delta);
    await this.storage.put(DISPATCH_COUNT_KEY, next);
    return next;
  }

  /** The room's own health. A DO that answers is alive; that is the whole check. */
  async health(): Promise<BackendHealth> {
    return { backend: "durable-object", ok: true, nowMs: this.clock.nowMs() };
  }

  private async requireDispatch(): Promise<DispatchState> {
    const state = await this.getDispatch();
    if (state === null) throw new RangeError("no dispatch has been opened in this room");
    return state;
  }

  private async events(): Promise<OrderEvent[]> {
    return (await this.storage.get<OrderEvent[]>(EVENTS_STORAGE_KEY)) ?? [];
  }

  private async presenceMap(): Promise<Record<string, PresenceSession>> {
    return (await this.storage.get<Record<string, PresenceSession>>(PRESENCE_STORAGE_KEY)) ?? {};
  }
}

/** The route a room is addressed by: an order id or a zone id, never both. */
type RoomTarget = { readonly kind: "order"; readonly id: string } | { readonly kind: "zone"; readonly id: string };

/**
 * The `Coordinator` implementation over a DO namespace.
 *
 * Every method is one RPC to one room. Dispatch and event methods address `order:<id>`; presence and
 * snapshots address `zone:<id>`. The zone room also keeps the open-dispatch counter, so the command
 * map's first paint is one round trip rather than a query per zone.
 */
export class DurableObjectCoordinator implements Coordinator {
  private readonly namespace: DurableObjectNamespace;
  private readonly clock: Clock;

  constructor(namespace: DurableObjectNamespace, clock: Clock = systemClock) {
    this.namespace = namespace;
    this.clock = clock;
  }

  async openDispatch(input: OpenDispatchInput): Promise<DispatchState> {
    const existing = await this.getDispatch(input.orderId);
    const state = await this.rpc<DispatchState>({ kind: "order", id: input.orderId }, "openDispatch", [input]);
    // Only a newly opened cascade counts. Re-opening is a no-op, and counting it would make the
    // command map's number drift upward every time a retry landed.
    if (existing === null) {
      await this.rpc<number>({ kind: "zone", id: input.zoneId }, "noteDispatch", [1]);
    }
    return state;
  }

  getDispatch(orderId: string): Promise<DispatchState | null> {
    return this.rpc<DispatchState | null>({ kind: "order", id: orderId }, "getDispatch", []);
  }

  claimOffer(orderId: string, riderId: string): Promise<ClaimResult> {
    return this.rpc<ClaimResult>({ kind: "order", id: orderId }, "claimOffer", [riderId]);
  }

  withdrawOffer(orderId: string, riderId: string, reason: string): Promise<DispatchState> {
    return this.rpc<DispatchState>({ kind: "order", id: orderId }, "withdrawOffer", [riderId, reason]);
  }

  async advanceWave(orderId: string): Promise<DispatchState> {
    const state = await this.rpc<DispatchState>({ kind: "order", id: orderId }, "advanceWave", []);
    if (state.phase === "FALLBACK") {
      await this.rpc<number>({ kind: "zone", id: state.zoneId }, "noteDispatch", [-1]);
    }
    return state;
  }

  async closeDispatch(orderId: string, reason: CloseReason): Promise<DispatchState> {
    const before = await this.getDispatch(orderId);
    const state = await this.rpc<DispatchState>({ kind: "order", id: orderId }, "closeDispatch", [reason]);
    if (before !== null && before.closedReason === null) {
      await this.rpc<number>({ kind: "zone", id: state.zoneId }, "noteDispatch", [-1]);
    }
    return state;
  }

  declarePresence(claim: PresenceClaim): Promise<PresenceSession> {
    return this.rpc<PresenceSession>({ kind: "zone", id: claim.zoneId }, "declarePresence", [claim]);
  }

  heartbeat(zoneId: string, actorId: string, deviceId: string, seq: number): Promise<HeartbeatAck> {
    return this.rpc<HeartbeatAck>({ kind: "zone", id: zoneId }, "heartbeat", [actorId, deviceId, seq]);
  }

  async markAbsent(zoneId: string, actorId: string, deviceId: string, reason: string): Promise<void> {
    await this.rpc<null>({ kind: "zone", id: zoneId }, "markAbsent", [actorId, deviceId, reason]);
  }

  listPresence(zoneId: string, role?: PresenceRole): Promise<readonly PresenceSession[]> {
    return this.rpc<PresenceSession[]>({ kind: "zone", id: zoneId }, "listPresence", [role]);
  }

  appendEvent(event: OrderEventInput): Promise<OrderEvent> {
    return this.rpc<OrderEvent>({ kind: "order", id: event.orderId }, "appendEvent", [event]);
  }

  readEvents(orderId: string, afterSeq: number, limit?: number): Promise<readonly OrderEvent[]> {
    return this.rpc<OrderEvent[]>({ kind: "order", id: orderId }, "readEvents", [afterSeq, limit ?? EVENT_PAGE_LIMIT]);
  }

  snapshot(zoneId: string): Promise<ZoneSnapshot> {
    return this.rpc<ZoneSnapshot>({ kind: "zone", id: zoneId }, "snapshot", [zoneId]);
  }

  health(): Promise<BackendHealth> {
    return Promise.resolve({ backend: "durable-object", ok: true, nowMs: this.clock.nowMs() });
  }

  /** One RPC: address a room by kind and id, send a method name and its arguments. */
  private async rpc<T>(target: RoomTarget, method: string, args: unknown[]): Promise<T> {
    const id = this.namespace.idFromName(`${target.kind}:${target.id}`);
    const stub = this.namespace.get(id);
    const response = await stub.fetch(
      new Request("https://coordination.invalid/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, args }),
      }),
    );
    const reply = (await response.json()) as RoomReply<T>;
    if (!reply.ok) throw new Error(`coordination ${method} failed: ${reply.error ?? "unknown"}`);
    return reply.data as T;
  }
}
