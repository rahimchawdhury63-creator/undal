/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The zone's presence hub: the sockets, the deadlines, and the one alarm that publishes absences.
 *
 * This is where `14` becomes a running thing. A device connects, is registered with the coordinator,
 * and sends a heartbeat every 750 ms; the hub answers each one and keeps a deadline. When a socket
 * closes the hub does *not* publish — it schedules a publication `graceMs` later and re-arms its alarm.
 * When the alarm fires, everything whose deadline has passed is published exactly once: the
 * coordinator is told the device is gone, the timed-out socket is closed with `4408`, and the ledger is
 * persisted so a room that was evicted between the close and the alarm still knows what it owed.
 *
 * The hub owns no timer of its own. It has an alarm, one, set to the earliest instant at which anything
 * can change — which is why an idle zone costs nothing and why this is not a cron job.
 */

import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import type { Coordinator, PresenceClaim, PresenceRole, PresenceSession } from "../coordination/coordinator.ts";
import { HEARTBEAT_DEADLINE_MS } from "../coordination/coordinator.ts";
import type { AbsenceOrder, AbsenceReason, CloseEvent } from "../presence/grace.ts";
import { absenceFor } from "../presence/grace.ts";
import type { HeartbeatState } from "../presence/heartbeat.ts";
import { deadlineOf, isSilent, recordBeat, startHeartbeat } from "../presence/heartbeat.ts";
import type { AbsenceRecord, PresenceLedger } from "../presence/ledger.ts";
import { deviceKey, emptyLedger, noteClose, noteReconnect, sweep } from "../presence/ledger.ts";
import type { DeadlineEntry } from "../presence/deadline.ts";
import { nextAlarmAt, shouldRearm } from "../presence/deadline.ts";
import { CLOSE_HEARTBEAT_TIMEOUT } from "../presence/grace.ts";

/** The socket, as the hub uses it. A Durable Object's WebSocket satisfies this. */
export interface HubSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

/** The storage and alarm surface the hub needs. `DurableObjectStorage` satisfies it. */
export interface HubStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(atMs: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** A live socket the hub is tracking. */
interface LiveSocket {
  readonly socket: HubSocket;
  readonly session: PresenceSession;
  readonly heartbeat: HeartbeatState;
}

/** What the hub is built with. */
export interface PresenceHubOptions {
  readonly zoneId: string;
  readonly coordinator: Coordinator;
  readonly storage: HubStorage;
  readonly clock?: Clock;
  /**
   * What to do when an absence is published.
   *
   * Presence is not the only consequence: the vendor's `open_state` changes, an FCM alert goes out, the
   * admin map redraws, and a rider carrying an order starts the reassignment clock. The hub reports;
   * whoever owns those effects decides.
   */
  readonly onPublished?: (record: AbsenceRecord) => void | Promise<void>;
}

/** The most dispatch instants one room will hold. Two per wave, so this is several waves of margin. */
export const MAX_DISPATCH_INSTANTS = 8;

/** The storage key the ledger is persisted under. */
export const LEDGER_KEY = "presence:ledger";

/** The storage key the alarm's current instant is remembered under. */
export const ALARM_KEY = "presence:alarm";

/**
 * The instants the dispatch tick must run for this zone (`11 §7`, D132).
 *
 * Presence is not the only deadline a room holds. An offer expires twenty-five seconds after it is written, and in a
 * zone whose riders are all in pockets — no sockets, so no heartbeats — nothing in this room would wake to notice.
 * Core announces the wave to the room anyway, and the announcement is what arms these instants: a retry pass a few
 * seconds after the push, and the expiry itself.
 */
export const DISPATCH_KEY = "dispatch:at";

/** One zone's presence. */
export class PresenceHub {
  private readonly zoneId: string;
  private readonly coordinator: Coordinator;
  private readonly storage: HubStorage;
  private readonly clock: Clock;
  private readonly onPublished: ((record: AbsenceRecord) => void | Promise<void>) | undefined;
  private readonly sockets = new Map<string, LiveSocket>();
  private ledger: PresenceLedger = emptyLedger();
  private loaded = false;
  /**
   * When the room must run the dispatch tick, ascending (`11 §7`, D132).
   *
   * Two instants per wave — the retry pass and the expiry — and the room's single alarm is set to the earliest of them
   * and of every presence deadline. A room with no sockets but a live offer therefore keeps its alarm, which is the
   * whole point: the offer is a deadline too.
   */
  private dispatchAtMs: readonly number[] = [];

  constructor(options: PresenceHubOptions) {
    this.zoneId = options.zoneId;
    this.coordinator = options.coordinator;
    this.storage = options.storage;
    this.clock = options.clock ?? systemClock;
    this.onPublished = options.onPublished;
  }

  /**
   * A device connected.
   *
   * A reconnect inside the grace cancels the pending absence — that is the entire reason the grace
   * exists — and a reconnect after publication clears the record so the device is present again.
   */
  async connect(
    socket: HubSocket,
    claim: Omit<PresenceClaim, "zoneId">,
  ): Promise<{ readonly session: PresenceSession; readonly cancelled: boolean; readonly restored: boolean }> {
    await this.load();
    const atMs = this.clock.nowMs();
    const restored = noteReconnect(this.ledger, { actorId: claim.actorId, deviceId: claim.deviceId });
    this.ledger = restored.ledger;
    const session = await this.coordinator.declarePresence({ ...claim, zoneId: this.zoneId });
    this.sockets.set(deviceKey(claim.actorId, claim.deviceId), {
      socket,
      session,
      heartbeat: startHeartbeat(atMs),
    });
    await this.persist();
    await this.rearm();
    return { session, cancelled: restored.cancelled !== null, restored: restored.restored };
  }

  /**
   * A heartbeat arrived.
   *
   * The sequence is acknowledged whether or not it is fresh, because the client needs to know the
   * server heard it; the deadline only moves for a fresh one. An unknown socket answers `known: false`
   * rather than throwing: a beat that arrives as the socket is closing is a race, not an error.
   */
  async beat(socket: HubSocket, seq: number): Promise<{ readonly known: boolean; readonly seq: number; readonly deadlineMs: number; readonly stale: boolean }> {
    await this.load();
    const atMs = this.clock.nowMs();
    const entry = [...this.sockets.values()].find((held) => held.socket === socket);
    if (entry === undefined) {
      return { known: false, seq, deadlineMs: atMs + HEARTBEAT_DEADLINE_MS, stale: false };
    }
    const beat = recordBeat(entry.heartbeat, seq, atMs);
    const live: LiveSocket = { ...entry, heartbeat: beat.state };
    this.sockets.set(deviceKey(entry.session.actorId, entry.session.deviceId), live);
    const ack = await this.coordinator.heartbeat(
      this.zoneId,
      entry.session.actorId,
      entry.session.deviceId,
      beat.ack.stale ? entry.heartbeat.seq : seq,
    );
    entry.socket.send(JSON.stringify({ t: "hb_ack", s: ack.seq, now: ack.nowMs, deadline: ack.deadlineMs }));
    await this.rearm();
    return { known: true, seq: beat.ack.seq, deadlineMs: deadlineOf(live.heartbeat), stale: beat.ack.stale };
  }

  /**
   * Who a socket belongs to, or `null` when this room does not hold it.
   *
   * The receipt path needs this: a device's `alarm_received` frame names an order, not a device, and the
   * session is the only place the room knows which device sent it. An unknown socket answers `null` rather
   * than throwing — a receipt that arrives as the socket is closing is a race, not an error.
   */
  async sessionFor(socket: HubSocket): Promise<PresenceSession | null> {
    await this.load();
    const entry = [...this.sockets.values()].find((held) => held.socket === socket);
    return entry === undefined ? null : entry.session;
  }

  /**
   * A socket closed.
   *
   * Nothing is published yet. The return value is what was scheduled, so a caller can log the grace it
   * chose without duplicating the policy.
   */
  async disconnect(socket: HubSocket, close: CloseEvent): Promise<{ readonly reason: AbsenceReason; readonly publishAtMs: number }> {
    await this.load();
    const atMs = this.clock.nowMs();
    const entry = [...this.sockets.entries()].find(([, held]) => held.socket === socket);
    if (entry === undefined) {
      return { reason: close.clean && close.code === 4_001 ? "USER_OFFLINE" : "TRANSPORT_CLOSED", publishAtMs: atMs };
    }
    const [key, held] = entry;
    this.sockets.delete(key);
    const order: AbsenceOrder = absenceFor(close);
    this.ledger = noteClose(this.ledger, {
      actorId: held.session.actorId,
      deviceId: held.session.deviceId,
      reason: order.reason,
      detectedAtMs: atMs,
      publishAtMs: atMs + order.graceMs,
    });
    await this.persist();
    await this.rearm();
    return { reason: order.reason, publishAtMs: atMs + order.graceMs };
  }

  /**
   * Ask the room to wake for the dispatch tick (`11 §7`, D132).
   *
   * Core's announcement of a wave carries the offer's deadline, and the Worker that forwards it posts the instants
   * here. Earlier wins: an instant already at or before the new ones makes the call a no-op, so a wave every few
   * seconds does not turn into a storage write every few seconds. Instants in the past are dropped rather than
   * scheduled, because a deadline that has passed is a tick the caller already missed.
   */
  async armDispatch(instants: readonly number[]): Promise<readonly number[]> {
    await this.load();
    const atMs = this.clock.nowMs();
    const merged = [...new Set([...this.dispatchAtMs, ...instants])]
      .filter((at) => Number.isFinite(at) && at > atMs)
      .sort((left, right) => left - right)
      .slice(0, MAX_DISPATCH_INSTANTS);
    if (merged.length === this.dispatchAtMs.length && merged.every((at, index) => at === this.dispatchAtMs[index])) {
      return this.dispatchAtMs;
    }
    this.dispatchAtMs = merged;
    await this.storage.put(DISPATCH_KEY, merged);
    await this.rearm();
    return merged;
  }

  /** The instants this room is still waiting to wake for, for a test or an admin view. */
  dispatchDeadlines(): readonly number[] {
    return this.dispatchAtMs;
  }

  /**
   * The room's alarm fired.
   *
   * Two things expire at once: a silence that outlived the heartbeat deadline, and a grace that ran out.
   * The first is turned into an absence with no grace of its own and its socket is closed with `4408`;
   * the second was scheduled by a close. Both are published through the coordinator exactly once,
   * because `noteClose` refuses a device that is already absent and `sweep` removes what it publishes.
   */
  async alarm(atMs: number = this.clock.nowMs()): Promise<readonly AbsenceRecord[]> {
    await this.load();
    for (const [key, held] of [...this.sockets.entries()]) {
      if (!isSilent(held.heartbeat, atMs)) continue;
      this.sockets.delete(key);
      this.ledger = noteClose(this.ledger, {
        actorId: held.session.actorId,
        deviceId: held.session.deviceId,
        reason: "HEARTBEAT_TIMEOUT",
        detectedAtMs: atMs,
        publishAtMs: atMs,
      });
      try {
        held.socket.close(CLOSE_HEARTBEAT_TIMEOUT, "heartbeat timeout");
      } catch {
        // The socket may already be gone; the close is a courtesy, the publication is the fact.
      }
    }
    const swept = sweep(this.ledger, atMs);
    this.ledger = swept.ledger;
    for (const record of swept.published) {
      await this.coordinator.markAbsent(this.zoneId, record.actorId, record.deviceId, record.reason);
      await this.onPublished?.(record);
    }
    await this.persist();
    // A dispatch instant that has fired is spent; the tick it belongs to has run. What is left is the wave's later
    // instant — the expiry, when this was the retry pass — which re-arms the alarm for it and nothing more.
    const remaining = this.dispatchAtMs.filter((at) => at > atMs);
    if (remaining.length !== this.dispatchAtMs.length) {
      this.dispatchAtMs = remaining;
      await this.storage.put(DISPATCH_KEY, remaining);
    }
    await this.rearm();
    return swept.published;
  }

  /** Everyone the coordinator currently reports present in this zone. */
  async present(role?: PresenceRole): Promise<readonly PresenceSession[]> {
    return this.coordinator.listPresence(this.zoneId, role);
  }

  /** How many sockets the hub holds, for a test that asserts nothing leaked. */
  socketCount(): number {
    return this.sockets.size;
  }

  /** The ledger, for a test or an admin view that wants to see what is pending. */
  pendingAbsences(): PresenceLedger {
    return this.ledger;
  }

  /** Read the persisted ledger once. A room that was evicted reloads what it owed. */
  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.storage.get<PresenceLedger>(LEDGER_KEY);
    this.ledger = stored ?? emptyLedger();
    const dispatch = await this.storage.get<readonly number[]>(DISPATCH_KEY);
    this.dispatchAtMs = Array.isArray(dispatch) ? dispatch.filter((at) => Number.isFinite(at)) : [];
    this.loaded = true;
  }

  /** Persist the ledger. The sockets themselves are memory: a socket cannot outlive its isolate. */
  private async persist(): Promise<void> {
    await this.storage.put(LEDGER_KEY, this.ledger);
  }

  /**
   * Set the alarm to the earliest instant anything can change.
   *
   * Two sources: a live socket's heartbeat deadline, and a pending absence's publication. The minimum of
   * those is the only instant at which this room's state can move; when there are none, the alarm is
   * cleared and the room may be evicted.
   */
  private async rearm(): Promise<void> {
    const entries: DeadlineEntry[] = [
      ...[...this.sockets.values()].map((held) => ({
        actorId: held.session.actorId,
        deviceId: held.session.deviceId,
        deadlineMs: deadlineOf(held.heartbeat),
      })),
      ...this.ledger.pending.map((absence) => ({
        actorId: absence.actorId,
        deviceId: absence.deviceId,
        deadlineMs: absence.publishAtMs,
      })),
    ];
    const presenceNext = nextAlarmAt(entries);
    // The earliest of the presence deadlines and the dispatch instants: one alarm, and it is the next instant anything
    // in this room can change. A room with a live offer keeps its alarm even when every socket has gone.
    const dispatchNext = this.dispatchAtMs[0] ?? null;
    const next =
      presenceNext === null ? dispatchNext : dispatchNext === null ? presenceNext : Math.min(presenceNext, dispatchNext);
    const current = (await this.storage.get<number | null>(ALARM_KEY)) ?? null;
    if (!shouldRearm(current, next)) return;
    if (next === null) {
      await this.storage.deleteAlarm();
      await this.storage.put(ALARM_KEY, null);
      return;
    }
    await this.storage.setAlarm(next);
    await this.storage.put(ALARM_KEY, next);
  }
}
