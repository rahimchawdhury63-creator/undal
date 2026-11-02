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
import type { CoordinatorEnv } from "../coordination/from-env.ts";
import type { PresenceRole } from "../coordination/coordinator.ts";

/** The bindings the room needs. */
export interface ZoneHubEnv extends CoordinatorEnv {
  readonly INTERNAL_TOKEN?: string;
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

  constructor(
    state: DurableObjectState,
    env: ZoneHubEnv,
    deps: { clock?: Clock; pair?: SocketPairFactory } = {},
  ) {
    this.state = state;
    this.env = env;
    this.clock = deps.clock ?? systemClock;
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

  /** A heartbeat, or a polite refusal of anything else. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let frame: HeartbeatFrame;
    try {
      frame = JSON.parse(text) as HeartbeatFrame;
    } catch {
      ws.send(JSON.stringify({ t: "error", reason: "not_json" }));
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

  /** The deadline sweep: publish what has expired, close what has gone silent, re-arm. */
  async alarm(): Promise<void> {
    const hub = await this.maybeHub();
    if (hub === null) return;
    await hub.alarm(this.clock.nowMs());
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
