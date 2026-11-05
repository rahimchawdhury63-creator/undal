/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `ZoneHub`: one Durable Object per zone, holding the sockets that are present in it (`14 §2`, `05 §4.1`).
 *
 * Cloudflare delivers the three events this room is built around — `webSocketMessage` for a heartbeat,
 * `webSocketClose` for a drop, and `alarm` for a deadline — and this class does nothing but turn them into
 * calls on `PresenceHub`, which is where the policy lives and where the tests point. The room is
 * deliberately thin: a Durable Object is hard to test in isolation, so its job is to be obvious.
 *
 * The zone id is remembered at the first connection. A room is addressed by name, and `getByName` is not
 * available on every account tier, so the id travels in the upgrade request and is stored rather than
 * inferred from `state.id` — which on an id-addressed room is an opaque string.
 */

import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import { PresenceHub } from "./presence-hub.ts";
import { CLOSE_GOING_OFFLINE } from "../presence/grace.ts";
import { coordinatorFrom } from "../coordination/from-env.ts";
import { createCoreReceiptRecorder } from "../authority/core-receipts.ts";
import { absenceEraser } from "../d1/on-absence.ts";
import { d1Positions } from "../d1/store.ts";
import { runZoneAlarm } from "../d1/sweep.ts";
import type { ReceiptRecorder } from "../authority/core-receipts.ts";
import type { CoordinatorEnv } from "../coordination/from-env.ts";
import type { PresenceRole } from "../coordination/coordinator.ts";

/** The bindings the room needs. */
export interface ZoneHubEnv extends CoordinatorEnv {
  readonly INTERNAL_TOKEN?: string;
  /**
   * The live-position database (`07 §6`). Present, a presence-declared absence erases that rider's
   * breadcrumbs at the instant the absence is published (D99); absent, presence publishes and nothing is
   * erased, because there is nothing to erase.
   */
  readonly RIDER_DB?: D1Database;
  /** Where core is, for the receipt a `alarm_received` frame produces. */
  readonly CORE_BASE_URL?: string;
  readonly PUBLIC_API_BASE?: string;
}

/** The frame a device sends when the alarm it was pushed actually rang (`15 §8`). */
export interface AlarmReceivedFrame {
  readonly t: string;
  /** The public order code the alarm was for. */
  readonly orderId?: unknown;
  /** How long the device measured between the push arriving and the alarm starting. */
  readonly latencyMs?: unknown;
  /** `FCM`, `SOCKET` or `BOTH`, as the device reports the path that woke it. */
  readonly path?: unknown;
}

/** A connected device, as the Worker passes it in headers after verifying the token. */
export interface ZoneSocketIdentity {
  readonly actorId: string;
  readonly actorType: string;
  readonly deviceId: string;
}

/** The storage key the zone id is remembered under. */
export const ZONE_KEY = "zone:id";

/** The two ends of an accepted socket, as the runtime hands them over. */
export interface SocketPair {
  readonly client: WebSocket;
  readonly server: WebSocket;
}

/** How a pair is made. The runtime's `WebSocketPair` is the default; a test supplies its own. */
export type SocketPairFactory = () => SocketPair;

/** The frame a client sends to say it is alive. */
export interface HeartbeatFrame {
  readonly t: string;
  readonly s?: number;
}

/**
 * One zone's presence room.
 *
 * The third constructor argument exists so a test can pass a fixed clock; the runtime constructs with
 * `(state, env)` and the default applies. That is the only accommodation this class makes for being
 * testable, and it is the same one the coordination room makes.
 */
export class ZoneHub {
  private readonly state: DurableObjectState;
  private readonly env: ZoneHubEnv;
  private readonly clock: Clock;
  private hubInstance: PresenceHub | null = null;

  private readonly pair: SocketPairFactory;
  /** Where a delivery receipt goes. Absent, receipts are acknowledged-and-forgotten (D86). */
  private readonly receipts: ReceiptRecorder | null;

  constructor(
    state: DurableObjectState,
    env: ZoneHubEnv,
    deps: { clock?: Clock; pair?: SocketPairFactory; receipts?: ReceiptRecorder | null } = {},
  ) {
    this.state = state;
    this.env = env;
    this.clock = deps.clock ?? systemClock;
    this.receipts =
      deps.receipts === undefined
        ? (this.env.INTERNAL_TOKEN === undefined || this.env.INTERNAL_TOKEN === ""
            ? null
            : createCoreReceiptRecorder(this.env.CORE_BASE_URL ?? this.env.PUBLIC_API_BASE ?? "", this.env.INTERNAL_TOKEN))
        : deps.receipts;
    this.pair =
      deps.pair ??
      (() => {
        const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
        return { client, server };
      });
  }

  /**
   * Serve the upgrade.
   *
   * The identity headers are set by the Worker after it has verified the access token; the room never
   * parses a token itself. A request without them is refused rather than connected as a ghost.
   */
  async fetch(request: Request): Promise<Response> {
    const accepted = await this.upgrade(request);
    if (!accepted.ok) {
      return new Response(JSON.stringify({ ok: false, error: accepted.reason }), {
        status: accepted.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 101, webSocket: accepted.client });
  }

  /**
   * The upgrade, as a value.
   *
   * `fetch` is three lines around this because a `101` cannot be constructed outside the Workers runtime,
   * and the interesting half of the upgrade — the checks, the registration, the remembered zone — should
   * be testable where the suite runs.
   */
  async upgrade(request: Request): Promise<UpgradeResult> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader === null || upgradeHeader.toLowerCase() !== "websocket") {
      return { ok: false, status: 426, reason: "expected a websocket upgrade" };
    }
    const identity = identityFrom(request);
    if (identity === null) return { ok: false, status: 401, reason: "no actor on the upgrade" };

    const remembered = (await this.state.storage.get<string>(ZONE_KEY)) ?? "";
    const requested = url.searchParams.get("zone") ?? "";
    const zoneId = requested === "" ? remembered : requested;
    if (zoneId === "") return { ok: false, status: 422, reason: "no zone on the upgrade" };
    if (remembered !== zoneId) await this.state.storage.put(ZONE_KEY, zoneId);

    const { client, server } = this.pair();
    server.accept();
    const hub = await this.hub(zoneId);
    const session = await hub.connect(server, {
      actorId: identity.actorId,
      deviceId: identity.deviceId,
      role: roleFor(identity.actorType),
    });
    return { ok: true, client, server, zoneId, session: session.session };
  }

  /**
   * Two kinds of frame arrive on this socket, and they answer different questions.
   *
   * A heartbeat says *the device is alive*, and it feeds presence. An `alarm_received` frame says *the alarm
   * rang*, and it feeds the delivery log (`15 §8`) — it is not presence evidence, because a device can hear an
   * alarm while its socket is a second late, and the whole point of the alarm is that it does not need the
   * socket. Anything else is refused by name, so a client bug is a message rather than a silent drop.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let frame: HeartbeatFrame & AlarmReceivedFrame;
    try {
      frame = JSON.parse(text) as HeartbeatFrame & AlarmReceivedFrame;
    } catch {
      ws.send(JSON.stringify({ t: "error", reason: "not_json" }));
      return;
    }
    if (frame.t === "alarm_received") {
      await this.noteAlarmReceived(ws, frame);
      return;
    }
    if (frame.t !== "hb" || typeof frame.s !== "number") {
      ws.send(JSON.stringify({ t: "error", reason: "not_a_heartbeat" }));
      return;
    }
    const hub = await this.hub();
    await hub.beat(ws, frame.s);
  }

  /**
   * The alarm rang on the device, and the room says so to core.
   *
   * The order comes from the frame; the **device** comes from the session, never from the frame. A client that
   * could name its own device could claim a delivery for a phone that never heard anything, and a delivery
   * matrix built on self-reported identity is a matrix that flatters every broken phone.
   */
  private async noteAlarmReceived(ws: WebSocket, frame: AlarmReceivedFrame): Promise<void> {
    const orderCode = typeof frame.orderId === "string" ? frame.orderId.trim() : "";
    if (orderCode === "" || orderCode.length > 64) {
      ws.send(JSON.stringify({ t: "error", reason: "not_a_receipt" }));
      return;
    }
    const hub = await this.maybeHub();
    if (hub === null) {
      ws.send(JSON.stringify({ t: "error", reason: "not_connected" }));
      return;
    }
    const session = await hub.sessionFor(ws);
    if (session === null) {
      ws.send(JSON.stringify({ t: "error", reason: "not_connected" }));
      return;
    }
    if (this.receipts === null) return;
    await this.receipts.record({
      orderCode,
      deviceId: session.deviceId,
      receivedAtMs: this.clock.nowMs(),
      // Forwarded, not judged. Core owns the closed set of path names and the bound on the number; the room
      // only stops a frame from carrying a paragraph where a measurement belongs.
      latencyMs: typeof frame.latencyMs === "number" && Number.isFinite(frame.latencyMs) ? frame.latencyMs : null,
      path: typeof frame.path === "string" && frame.path.length <= 16 ? frame.path : null,
    });
  }

  /**
   * A dropped socket.
   *
   * Nothing is published here. The hub schedules the absence one grace window away, and a reconnect in
   * between cancels it — which is the whole reason a tower handoff does not take a vendor offline.
   */
  async webSocketClose(ws: WebSocket, code: number, _reason: string, clean: boolean): Promise<void> {
    const hub = await this.hub();
    await hub.disconnect(ws, { code, clean });
    if (code === CLOSE_GOING_OFFLINE) {
      try {
        ws.close(1_000, "offline");
      } catch {
        // Already closed by the client; closing twice is not an error.
      }
    }
  }

  /**
   * The deadline sweep: publish what has expired, close what has gone silent, re-arm — and then the fifth
   * erasure trigger, the one nobody can ask for (`07 §6.1`, D107).
   *
   * Presence goes first, always: an absence published by this tick erases its own rider through `onPublished`,
   * and the sweep that follows must find nothing left of them rather than report a departure the room already
   * explained. The room is the only thing in the system that runs while riders are connected, which is exactly
   * the window in which a zombie `rider_current` row exists to be found.
   */
  async alarm(): Promise<void> {
    const hub = await this.maybeHub();
    if (hub === null) return;
    const nowMs = this.clock.nowMs();
    const store = this.env.RIDER_DB === undefined ? null : d1Positions(this.env.RIDER_DB);
    await runZoneAlarm(
      {
        presence: (at) => hub.alarm(at),
        sweep: store === null ? null : (cutoffMs) => store.sweepStale(cutoffMs),
        report: (swept, cutoffMs) => {
          // A phone that never came back: worth a line, because it is the one erasure with no user behind it.
          console.warn(
            `sweep: erased ${String(swept.riders)} rider(s), ${String(swept.positions)} position(s) whose deadline passed before ${String(cutoffMs)}`,
          );
        },
        reportError: (error) => {
          console.error(`sweep: erasure failed, the next alarm retries: ${String(error)}`);
        },
      },
      nowMs,
    );
  }

  /** The room's view of who is connected, for the admin map and for a test. */
  async presence(): Promise<readonly { actorId: string; deviceId: string; role: PresenceRole }[]> {
    const hub = await this.maybeHub();
    if (hub === null) return [];
    return (await hub.present()).map((session) => ({
      actorId: session.actorId,
      deviceId: session.deviceId,
      role: session.role,
    }));
  }

  /** The hub, built once, over this room's own storage and the configured coordinator. */
  private async maybeHub(): Promise<PresenceHub | null> {
    if (this.hubInstance !== null) return this.hubInstance;
    const zone = (await this.state.storage.get<string>(ZONE_KEY)) ?? "";
    // A room that has never seen an upgrade has no zone and holds nothing. An alarm can still arrive —
    // the platform makes no promise that a scheduled alarm is matched by a came-before-it connection.
    if (zone === "") return null;
    const built = coordinatorFrom(this.env);
    if (!built.ok) throw new RangeError(`${built.error.reason}: ${built.error.detail}`);
    this.hubInstance = new PresenceHub({
      zoneId: zone,
      coordinator: built.coordinator,
      storage: this.state.storage,
      clock: this.clock,
      // The one absence consequence this room owns outright. Everything else a presence change implies —
      // reassignment, the admin map, the vendor's `open_state` — belongs to whoever hears about it next.
      onPublished: absenceEraser(
        this.env.RIDER_DB === undefined ? null : d1Positions(this.env.RIDER_DB),
        (record, error) => {
          // The absence is published and cannot be unpublished, so this is a report rather than a retry:
          // an operator reading it knows one rider's trail outlived their departure.
          console.error(
            `presence: erasure failed for ${record.reason} at ${String(record.publishedAtMs)}: ${String(error)}`,
          );
        },
      ),
    });
    return this.hubInstance;
  }

  private async hub(zoneId = ""): Promise<PresenceHub> {
    if (this.hubInstance !== null) return this.hubInstance;
    const hub = await this.maybeHub();
    if (hub === null) {
      throw new RangeError(`a presence room needs a zone before it can hold ${zoneId === "" ? "a socket" : zoneId}`);
    }
    return hub;
  }
}

/** What an upgrade produced: the two ends, or the reason it did not happen. */
export type UpgradeResult =
  | {
      readonly ok: true;
      readonly client: WebSocket;
      readonly server: WebSocket;
      readonly zoneId: string;
      readonly session: { readonly actorId: string; readonly deviceId: string; readonly role: PresenceRole };
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** The identity the Worker put on the upgrade, or `null` when it did not. */
export function identityFrom(request: Request): ZoneSocketIdentity | null {
  const actorId = request.headers.get("X-Undal-Actor");
  const actorType = request.headers.get("X-Undal-Actor-Type");
  const deviceId = request.headers.get("X-Undal-Device");
  if (actorId === null || actorType === null || deviceId === null) return null;
  if (actorId.trim() === "" || actorType.trim() === "" || deviceId.trim() === "") return null;
  return { actorId, actorType, deviceId };
}

/** Which presence role an actor type occupies. An admin is present, but never dispatched to. */
export function roleFor(actorType: string): PresenceRole {
  switch (actorType) {
    case "VENDOR_OWNER":
      return "PARTNER";
    case "RIDER":
      return "RIDER";
    case "ADMIN":
      return "ADMIN";
    default:
      return "CUSTOMER";
  }
}
