/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The coordination interface: fourteen methods, two implementations, one set of semantics.
 *
 * Two things in this platform cannot be done with a plain read-then-write: deciding which rider wins
 * an offer, and deciding which of two heartbeats is the later one. Both are answered here, behind an
 * interface small enough to implement twice and test identically. The Durable Object backend is
 * single-threaded by construction; the `sql` backend gets the same guarantee from one conditional
 * `UPDATE` against `dispatch_locks` and from a lease on every row. The free path is the default and is
 * not a stub.
 *
 * Methods take ids and facts; they return state. Nothing here formats a response, sends a push or
 * knows what an SSE frame is — the route layer and the stream layer sit above, and a coordinator that
 * also rendered HTML would be the place the 2-second presence budget went to die.
 */

import type { ClaimResult } from "./claim.ts";

/** Where a cascade is. `OPEN` is the only phase in which offers are live. */
export type DispatchPhase = "OPEN" | "ASSIGNED" | "FALLBACK" | "CANCELLED";

/** Who can hold a socket. An admin's map is a fourth kind of watcher, not a special case. */
export type PresenceRole = "RIDER" | "PARTNER" | "CUSTOMER" | "ADMIN";

/** One wave, as stored: who was asked, from when, until when. */
export interface DispatchWave {
  readonly wave: number;
  readonly riderIds: readonly string[];
  readonly startsAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * The stored state of one order's cascade.
 *
 * It is a value, not a class: both backends persist exactly this shape, and a test can build one by
 * hand. `currentWave` is `0` before the first wave has been fired, which is a different thing from a
 * wave whose offers have all expired.
 */
export interface DispatchState {
  readonly orderId: string;
  readonly zoneId: string;
  readonly phase: DispatchPhase;
  readonly waves: readonly DispatchWave[];
  readonly currentWave: number;
  readonly claimedBy: string | null;
  readonly claimedAtMs: number | null;
  readonly rejected: readonly string[];
  readonly closedReason: CloseReason | null;
  readonly openedAtMs: number;
  readonly leaseUntilMs: number;
  readonly excludedRiderId: string | null;
}

/** Which implementation is live. Selected by configuration, never by a build flag. */
export type CoordinatorMode = "durable-object" | "sql";

/** Why a dispatch ended. `ASSIGNED` is the only happy ending. */
export type CloseReason = "ASSIGNED" | "FALLBACK" | "CANCELLED" | "REASSIGNED";

/** A wave, as the Brain hands it over: who is asked, and when their phones stop ringing. */
export interface WavePlan {
  readonly wave: number;
  readonly riderIds: readonly string[];
  readonly startsAtMs: number;
  readonly expiresAtMs: number;
}

/** Everything needed to open a cascade. */
export interface OpenDispatchInput {
  readonly orderId: string;
  readonly zoneId: string;
  readonly waves: readonly WavePlan[];
  /** The rider who must not be offered the order again — a reassignment's dropped rider. */
  readonly excludeRiderId?: string;
}

/** A presence claim from a connected socket. */
export interface PresenceClaim {
  readonly actorId: string;
  readonly deviceId: string;
  readonly role: PresenceRole;
  readonly zoneId: string;
  /** The socket's connection instant, if the caller knows it. Defaults to the coordinator's clock. */
  readonly connectedAtMs?: number;
}

/** A presence row, as an admin map or a dispatch query sees it. */
export interface PresenceSession {
  readonly actorId: string;
  readonly deviceId: string;
  readonly role: PresenceRole;
  readonly zoneId: string;
  readonly connectedAtMs: number;
  readonly lastHeartbeatMs: number;
  /** The client's heartbeat sequence, echoed so the app can detect a lost ack. */
  readonly seq: number;
}

/** What a heartbeat produced. */
export interface HeartbeatAck {
  readonly actorId: string;
  readonly deviceId: string;
  readonly seq: number;
  readonly nowMs: number;
  /** The instant after which silence means absence: `now + 2 000` in production. */
  readonly deadlineMs: number;
  readonly known: boolean;
}

/** An event to append to an order's ordered log. */
export interface OrderEventInput {
  readonly orderId: string;
  readonly kind: string;
  readonly actorType: "CUSTOMER" | "VENDOR" | "RIDER" | "ADMIN" | "SYSTEM";
  readonly actorId?: string;
  readonly payload?: Record<string, unknown>;
  readonly occurredAtMs?: number;
}

/** One row of an order's event log, after the coordinator has assigned its sequence number. */
export interface OrderEvent {
  readonly orderId: string;
  readonly seq: number;
  readonly kind: string;
  readonly actorType: OrderEventInput["actorType"];
  readonly actorId: string | null;
  readonly payload: Record<string, unknown>;
  readonly occurredAtMs: number;
}

/** A zone, as the admin map's first paint needs it. */
export interface ZoneSnapshot {
  readonly zoneId: string;
  readonly asOfMs: number;
  readonly openDispatches: number;
  readonly presence: Readonly<Record<PresenceRole, number>>;
}

/** The backend's own answer about itself, for `/health` and for the ops dashboard. */
export interface BackendHealth {
  readonly backend: CoordinatorMode;
  readonly ok: boolean;
  readonly nowMs: number;
  /** How long the coordinator's own probe took, when the backend can measure it. */
  readonly latencyMs?: number;
}

/**
 * The fourteen methods.
 *
 * The split is dispatch (1–6), presence (7–10), the ordered log (11–12) and operations (13–14). Every
 * method is idempotent where the caller can retry, and none of them throws for a lost race: a race is
 * an answer, not an exception, and an exception is a 500 the rider cannot act on.
 */
export interface Coordinator {
  /** 1. Open a cascade. Re-opening an open dispatch is a no-op that returns the stored state. */
  openDispatch(input: OpenDispatchInput): Promise<DispatchState>;
  /** 2. The current state, or `null` when nothing is open (or it has been swept). */
  getDispatch(orderId: string): Promise<DispatchState | null>;
  /** 3. The atomic claim. Exactly one rider wins; a repeated claim by the winner also wins. */
  claimOffer(orderId: string, riderId: string): Promise<ClaimResult>;
  /** 4. Record a rejection and withdraw that rider's offer. */
  withdrawOffer(orderId: string, riderId: string, reason: string): Promise<DispatchState>;
  /** 5. Move to the next wave. Returns `FALLBACK` when the plan is exhausted. */
  advanceWave(orderId: string): Promise<DispatchState>;
  /** 6. Close a dispatch, with the reason the order's history will show. */
  closeDispatch(orderId: string, reason: CloseReason): Promise<DispatchState>;
  /** 7. Register a connected device. A reconnect inside the grace window replaces the session. */
  declarePresence(claim: PresenceClaim): Promise<PresenceSession>;
  /**
   * 8. Accept a heartbeat, echo its sequence and return the new deadline.
   *
   * The zone is part of the address, not of the payload: presence lives in a per-zone room, so a
   * heartbeat to the wrong room would otherwise look like a heartbeat from a device that is not
   * connected — the one failure mode this must never have.
   */
  heartbeat(zoneId: string, actorId: string, deviceId: string, seq: number): Promise<HeartbeatAck>;
  /** 9. Mark a device absent. Missing is not an error: the transport may close twice. */
  markAbsent(zoneId: string, actorId: string, deviceId: string, reason: string): Promise<void>;
  /** 10. Everyone present in a zone, optionally filtered by role. */
  listPresence(zoneId: string, role?: PresenceRole): Promise<readonly PresenceSession[]>;
  /**
   * How old a row from `listPresence` may look and still be read as alive.
   *
   * The backend knows how often it writes a presence row, so the backend is the only thing that can answer
   * this honestly: a Durable Object writes on every beat and a row is stale after the two-second deadline,
   * while the `sql` backend stamps once per window and a row that looked two seconds old would describe a
   * device that is beating right now as gone (D89). A caller that hard-codes either number is wrong on the
   * other backend.
   */
  readonly presenceWindowMs: number;
  /** 11. Append to the order's ordered log, assigning the next sequence number. */
  appendEvent(event: OrderEventInput): Promise<OrderEvent>;
  /** 12. Read the log after a sequence number — the SSE resume path. */
  readEvents(orderId: string, afterSeq: number, limit?: number): Promise<readonly OrderEvent[]>;
  /** 13. A zone's counts, for the first paint of the command map. */
  snapshot(zoneId: string): Promise<ZoneSnapshot>;
  /** 14. The backend's self-report. */
  health(): Promise<BackendHealth>;
}

/** The heartbeat deadline: two seconds of silence means the device is gone (`14 §3.1`). */
export const HEARTBEAT_DEADLINE_MS = 2_000;

/**
 * How often a presence *row* is written while a device keeps beating (D89).
 *
 * A beat is a socket frame; a stamp is a write. The two are not the same event, and treating them as one
 * spends a database write every 750 ms per device — forty thousand a shift — to record a fact that the
 * process holding the socket already knows.
 */
export const HEARTBEAT_STAMP_MS = 15_000;

/**
 * How old a presence row may look and still be read as possibly alive.
 *
 * A stamped row is up to one stamp interval behind the device it describes, so a reader adds that interval
 * to the heartbeat deadline rather than pretending the row is live. This is the honest width of "online as
 * of the last stamp", and it is a *listing* answer: the two-second deadline is enforced where the socket is.
 */
export const PRESENCE_STALENESS_MS = HEARTBEAT_STAMP_MS + HEARTBEAT_DEADLINE_MS;

/** The reconnect grace: a blip shorter than this publishes nothing (`14 §2.1`). */
export const RECONNECT_GRACE_MS = 1_500;

/** The sequence number a client starts from. */
export const FIRST_SEQ = 1;

/** The default page size for an event replay. */
export const EVENT_PAGE_LIMIT = 200;

/** Every presence role, in one tuple so a snapshot can promise a count for each. */
export const PRESENCE_ROLES = ["RIDER", "PARTNER", "CUSTOMER", "ADMIN"] as const;
