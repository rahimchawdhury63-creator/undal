/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `ZoneHub`: the three events a socket produces, and the room's answer to each.
 *
 * The runtime's `WebSocketPair` does not exist outside Workers, so the room takes its pair factory as a
 * dependency and the tests supply a fake. Everything below the pair — the upgrade checks, the heartbeat
 * parse, the close, the alarm — is the code that ships.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ZoneHub, ZONE_KEY, identityFrom, roleFor } from "../src/hubs/zone-hub.ts";
import type { SocketPair, ZoneHubEnv } from "../src/hubs/zone-hub.ts";
import type { Clock } from "../src/lib/clock.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { CoordinationRoom } from "../src/coordination/durable-object.ts";
import { CLOSE_GOING_OFFLINE, CLOSE_HEARTBEAT_TIMEOUT, PRESENCE_GRACE_MS } from "../src/presence/grace.ts";
import type { ReceiptRecorder } from "../src/authority/core-receipts.ts";
import { FakeNamespace, fakeState } from "./support/fakes.ts";
import { T0 } from "./support/backends.ts";

/** One end of a fake socket. */
class FakeWebSocket {
  readonly sent: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  accepted = false;

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  /** The last frame, parsed. */
  lastFrame(): { t: string; s?: number; reason?: string } {
    const raw = this.sent[this.sent.length - 1];
    if (raw === undefined) throw new Error("nothing was sent");
    return JSON.parse(raw) as { t: string; s?: number; reason?: string };
  }
}

/** An environment over a durable-object coordinator. */
function environment(clock: Clock): ZoneHubEnv {
  const namespace = new FakeNamespace(() => new CoordinationRoom(fakeState(), clock));
  return { COORDINATION_MODE: "durable-object", COORDINATION_ROOM: namespace as unknown as DurableObjectNamespace };
}

/** A room with a pair the test can hold both ends of. */
function room(
  storeClock: FixedClock = new FixedClock(T0),
  receipts: ReceiptRecorder | null = null,
): {
  hub: ZoneHub;
  server: FakeWebSocket;
  client: FakeWebSocket;
  clock: FixedClock;
} {
  const state = fakeState();
  const server = new FakeWebSocket();
  const client = new FakeWebSocket();
  const pair: () => SocketPair = () => ({
    client: client as unknown as WebSocket,
    server: server as unknown as WebSocket,
  });
  const hub = new ZoneHub(state, environment(storeClock), { clock: storeClock, pair, receipts });
  return { hub, server, client, clock: storeClock };
}

/** An upgrade request for a zone, with an identity on it. */
function upgrade(zone = "zone-1", identity = true): Request {
  return new Request(`https://rt.undal.app/v1/presence?zone=${zone}`, {
    headers: {
      Upgrade: "websocket",
      ...(identity
        ? { "X-Undal-Actor": "rider-a", "X-Undal-Actor-Type": "RIDER", "X-Undal-Device": "phone-1" }
        : {}),
    },
  });
}

describe("the presence upgrade", () => {
  test("a request that is not an upgrade is refused with 426", async () => {
    const { hub } = room();
    const response = await hub.fetch(new Request("https://rt.undal.app/v1/presence?zone=zone-1"));
    assert.equal(response.status, 426);
  });

  test("an upgrade with no verified identity is refused, not connected as a ghost", async () => {
    const { hub } = room();
    const response = await hub.fetch(upgrade("zone-1", false));
    assert.equal(response.status, 401);
  });

  test("an upgrade with no zone is refused", async () => {
    const { hub } = room();
    const response = await hub.fetch(upgrade(""));
    assert.equal(response.status, 422);
  });

  test("an accepted upgrade registers the device", async () => {
    const { hub, server } = room();
    const accepted = await hub.upgrade(upgrade());
    assert.equal(accepted.ok, true);
    assert.equal(server.accepted, true);
    assert.deepEqual(await hub.presence(), [{ actorId: "rider-a", deviceId: "phone-1", role: "RIDER" }]);
  });

  test("the zone is remembered, so a later alarm knows which zone it is sweeping", async () => {
    const { hub } = room();
    const accepted = await hub.upgrade(upgrade("zone-7"));
    assert.equal(accepted.ok && accepted.zoneId, "zone-7");
    const state = (hub as unknown as { state: DurableObjectState }).state;
    assert.equal(await state.storage.get<string>(ZONE_KEY), "zone-7");
  });

  test("a second upgrade without a zone reuses the remembered one", async () => {
    const { hub } = room();
    await hub.upgrade(upgrade("zone-7"));
    const remembered = await hub.upgrade(upgrade(""));
    assert.equal(remembered.ok && remembered.zoneId, "zone-7");
  });

  test("the 101 is built only where the runtime can build one", async () => {
    const { hub } = room();
    // Node's `Response` refuses a 101, which is why the interesting half is `upgrade` and `fetch` is a
    // wrapper. The refusal path is still assertable here.
    const refused = await hub.fetch(new Request("https://rt.undal.app/v1/presence"));
    assert.equal(refused.status, 426);
  });
});

describe("the heartbeat frame", () => {
  test("a heartbeat is answered on the socket", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    clock.advance(750);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "hb", s: 3 }));
    assert.deepEqual(server.lastFrame(), { t: "hb_ack", s: 3, now: T0 + 750, deadline: T0 + 750 + 2_000 });
  });

  test("a message that is not JSON is answered with an error frame, not dropped", async () => {
    const { hub, server } = room();
    await hub.upgrade(upgrade());
    await hub.webSocketMessage(server as unknown as WebSocket, "hello");
    assert.deepEqual(server.lastFrame(), { t: "error", reason: "not_json" });
  });

  test("a frame that is not a heartbeat is refused by name", async () => {
    const { hub, server } = room();
    await hub.upgrade(upgrade());
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "bye" }));
    assert.deepEqual(server.lastFrame(), { t: "error", reason: "not_a_heartbeat" });
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "hb", s: "1" }));
    assert.deepEqual(server.lastFrame(), { t: "error", reason: "not_a_heartbeat" });
  });

  test("a heartbeat from a socket the room does not hold is acknowledged as unknown", async () => {
    const { hub, clock } = room();
    await hub.upgrade(upgrade());
    clock.advance(750);
    const stranger = new FakeWebSocket();
    await hub.webSocketMessage(stranger as unknown as WebSocket, JSON.stringify({ t: "hb", s: 1 }));
    assert.equal(stranger.sent.length, 0);
  });

  test("a binary heartbeat is decoded like a text one", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    clock.advance(750);
    const bytes = new TextEncoder().encode(JSON.stringify({ t: "hb", s: 9 })).buffer;
    await hub.webSocketMessage(server as unknown as WebSocket, bytes);
    assert.equal(server.lastFrame().s, 9);
  });
});

describe("the close and the alarm", () => {
  test("an unclean close schedules an absence one grace away and publishes nothing yet", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    await hub.webSocketClose(server as unknown as WebSocket, 1_006, "", false);
    assert.deepEqual(await hub.presence(), [{ actorId: "rider-a", deviceId: "phone-1", role: "RIDER" }]);
    clock.advance(PRESENCE_GRACE_MS);
    await hub.alarm();
    assert.deepEqual(await hub.presence(), []);
  });

  test("a deliberate close publishes immediately and closes the socket politely", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    await hub.webSocketClose(server as unknown as WebSocket, CLOSE_GOING_OFFLINE, "offline", true);
    await hub.alarm();
    assert.deepEqual(await hub.presence(), []);
    assert.deepEqual(server.closes, [{ code: 1_000, reason: "offline" }]);
    assert.equal(clock.nowMs(), T0);
  });

  test("a reconnect inside the grace keeps the device present", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    await hub.webSocketClose(server as unknown as WebSocket, 1_006, "", false);
    clock.advance(200);
    await hub.upgrade(upgrade());
    clock.advance(PRESENCE_GRACE_MS);
    await hub.alarm();
    assert.equal((await hub.presence()).length, 1);
  });

  test("a silence past the deadline is published and the socket closed with 4408", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    clock.advance(2_001);
    await hub.alarm();
    assert.deepEqual(await hub.presence(), []);
    assert.deepEqual(server.closes, [{ code: CLOSE_HEARTBEAT_TIMEOUT, reason: "heartbeat timeout" }]);
  });

  test("a heartbeat answering inside the deadline keeps the room quiet", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    for (let beat = 1; beat <= 4; beat += 1) {
      clock.advance(750);
      await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "hb", s: beat }));
    }
    await hub.alarm();
    assert.equal((await hub.presence()).length, 1);
    assert.equal(server.closes.length, 0);
  });

  test("an alarm on a room that never connected is quiet", async () => {
    const { hub } = room();
    await hub.alarm();
    assert.deepEqual(await hub.presence(), []);
  });
});

describe("identity on the upgrade", () => {
  test("all three headers are required", () => {
    const full = upgrade();
    assert.deepEqual(identityFrom(full), { actorId: "rider-a", actorType: "RIDER", deviceId: "phone-1" });
    for (const missing of ["X-Undal-Actor", "X-Undal-Actor-Type", "X-Undal-Device"]) {
      const headers = new Headers(full.headers);
      headers.delete(missing);
      assert.equal(identityFrom(new Request("https://rt.undal.app/v1/presence", { headers })), null);
    }
  });

  test("a blank header is not an identity", () => {
    const headers = new Headers(upgrade().headers);
    headers.set("X-Undal-Actor", "   ");
    assert.equal(identityFrom(new Request("https://rt.undal.app/v1/presence", { headers })), null);
  });

  test("each actor type has one presence role", () => {
    assert.equal(roleFor("RIDER"), "RIDER");
    assert.equal(roleFor("VENDOR_OWNER"), "PARTNER");
    assert.equal(roleFor("ADMIN"), "ADMIN");
    assert.equal(roleFor("CUSTOMER"), "CUSTOMER");
    assert.equal(roleFor("SOMETHING_ELSE"), "CUSTOMER");
  });
});

/** A receipt recorder that remembers what it was told. */
interface SeenReceipt {
  readonly orderCode: string;
  readonly deviceId: string;
  readonly receivedAtMs: number;
  readonly latencyMs?: number | null;
  readonly path?: string | null;
}

function receiptLog(): ReceiptRecorder & { readonly seen: SeenReceipt[] } {
  const seen: SeenReceipt[] = [];
  return {
    seen,
    async record(receipt: SeenReceipt): Promise<boolean> {
      seen.push(receipt);
      return true;
    },
  };
}

describe("the delivery receipt", () => {
  const UPGRADES = new Request("https://rt.undal.app/v1/presence?zone=zone-1", {
    headers: { Upgrade: "websocket", "X-Undal-Actor": "rider-a", "X-Undal-Actor-Type": "RIDER", "X-Undal-Device": "phone-1" },
  });

  test("an alarm_received frame is recorded against the session's device", async () => {
    const log = receiptLog();
    const { hub, server } = room(new FixedClock(T0), log);
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4", latencyMs: 1_400 }));
    assert.deepEqual(log.seen, [
      { orderCode: "UND-7K2M9QX4", deviceId: "phone-1", receivedAtMs: T0, latencyMs: 1_400, path: null },
    ]);
  });

  test("the device's measurement is forwarded as it was made", async () => {
    const log = receiptLog();
    const { hub, server } = room(new FixedClock(T0), log);
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(
      server as unknown as WebSocket,
      JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4", latencyMs: 2_250, path: "BOTH" }),
    );
    assert.equal(log.seen[0]?.latencyMs, 2_250);
    assert.equal(log.seen[0]?.path, "BOTH");
  });

  test("a measurement the room cannot read is dropped, and the receipt still goes", async () => {
    for (const frame of [
      { latencyMs: "1400", path: "FCM" },
      { latencyMs: 1_400, path: 7 },
      { latencyMs: 1_400, path: "A".repeat(40) },
    ]) {
      const log = receiptLog();
      const { hub, server } = room(new FixedClock(T0), log);
      await hub.upgrade(UPGRADES);
      await hub.webSocketMessage(
        server as unknown as WebSocket,
        JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4", ...frame }),
      );
      assert.equal(log.seen.length, 1, "the receipt is the load-bearing half of the frame");
      const seen = log.seen[0];
      assert.equal(seen?.latencyMs, typeof frame.latencyMs === "number" ? frame.latencyMs : null);
      assert.equal(seen?.path, typeof frame.path === "string" && frame.path.length <= 16 ? frame.path : null);
    }
  });

  test("the device is taken from the session, not from the frame", async () => {
    const log = receiptLog();
    const { hub, server } = room(new FixedClock(T0), log);
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(
      server as unknown as WebSocket,
      JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4", deviceId: "somebody-elses-phone" }),
    );
    assert.equal(log.seen[0]?.deviceId, "phone-1");
  });

  test("a receipt is not presence evidence: it does not move the heartbeat deadline", async () => {
    const clock = new FixedClock(T0);
    const log = receiptLog();
    const { hub, server } = room(clock, log);
    await hub.upgrade(UPGRADES);
    clock.set(T0 + 3_000);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4" }));
    // Past the 2 000 ms deadline, the sweep still finds the device silent.
    await hub.alarm();
    assert.equal(log.seen.length, 1);
    assert.equal(server.closes.length, 1);
  });

  test("a frame with no order is refused by name", async () => {
    const { hub, server } = room(new FixedClock(T0), receiptLog());
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "alarm_received" }));
    assert.deepEqual(server.lastFrame(), { t: "error", reason: "not_a_receipt" });
  });

  test("a receipt from a socket the room does not hold is refused", async () => {
    const log = receiptLog();
    const { hub, server } = room(new FixedClock(T0), log);
    await hub.upgrade(UPGRADES);
    const stranger = new FakeWebSocket();
    await hub.webSocketMessage(stranger as unknown as WebSocket, JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4" }));
    assert.deepEqual(stranger.lastFrame(), { t: "error", reason: "not_connected" });
    assert.deepEqual(log.seen, []);
  });

  test("a deployment with no receipt recorder does not answer the frame with an error", async () => {
    const { hub, server } = room(new FixedClock(T0), null);
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4" }));
    assert.deepEqual(server.sent, []);
  });

  test("a heartbeat still works after a receipt", async () => {
    const { hub, server } = room(new FixedClock(T0), receiptLog());
    await hub.upgrade(UPGRADES);
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "alarm_received", orderId: "UND-7K2M9QX4" }));
    await hub.webSocketMessage(server as unknown as WebSocket, JSON.stringify({ t: "hb", s: 1 }));
    assert.equal(server.lastFrame().t, "hb_ack");
  });
});

describe("an absence erases the live channel (D99)", () => {
  /** A D1 binding that records the statements it was asked to run. */
  function fakeD1(statements: string[]): D1Database {
    return {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return {
              async run() {
                return { results: [] };
              },
            };
          },
        };
      },
      async batch(list: readonly { run(): Promise<unknown> }[]) {
        for (const statement of list) await statement.run();
        return list.map(() => ({ meta: { changes: 0 } }));
      },
    } as unknown as D1Database;
  }

  /** A room over a D1-backed environment, with a pair the test holds both ends of. */
  function roomWithD1(statements: string[]): { hub: ZoneHub; server: FakeWebSocket; clock: FixedClock } {
    const clock = new FixedClock(T0);
    const state = fakeState();
    const server = new FakeWebSocket();
    const client = new FakeWebSocket();
    const pair: () => SocketPair = () => ({
      client: client as unknown as WebSocket,
      server: server as unknown as WebSocket,
    });
    const env = { ...environment(clock), RIDER_DB: fakeD1(statements) };
    return { hub: new ZoneHub(state, env, { clock, pair }), server, clock };
  }

  test("a rider whose socket goes silent is erased at the instant the absence is published", async () => {
    const statements: string[] = [];
    const { hub, server, clock } = roomWithD1(statements);
    await hub.upgrade(upgrade());
    clock.advance(2_001);
    await hub.alarm();
    assert.deepEqual(await hub.presence(), [], "the absence was published");
    assert.equal(statements.filter((sql) => sql.includes("DELETE FROM rider_positions")).length, 1);
    assert.equal(statements.filter((sql) => sql.includes("DELETE FROM rider_current")).length, 1);
    assert.deepEqual(server.closes, [{ code: CLOSE_HEARTBEAT_TIMEOUT, reason: "heartbeat timeout" }]);
  });

  test("a deliberate goodbye erases too: the rider pressed the button, the promise is the same", async () => {
    const statements: string[] = [];
    const { hub, server } = roomWithD1(statements);
    await hub.upgrade(upgrade());
    await hub.webSocketClose(server as unknown as WebSocket, CLOSE_GOING_OFFLINE, "offline", true);
    await hub.alarm();
    assert.equal(statements.filter((sql) => sql.includes("DELETE FROM rider_positions")).length, 1);
  });

  test("a room that never connected erases nothing, because nobody was absent", async () => {
    const statements: string[] = [];
    const { hub } = roomWithD1(statements);
    await hub.alarm();
    assert.deepEqual(statements, []);
  });

  test("without a binding the absence still publishes, because presence must not depend on D1", async () => {
    const { hub, server, clock } = room();
    await hub.upgrade(upgrade());
    clock.advance(2_001);
    await hub.alarm();
    assert.deepEqual(await hub.presence(), []);
  });
});
