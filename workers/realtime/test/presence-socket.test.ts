/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `GET /v1/presence` — the Worker's half of the socket, and the headers the room believes.
 *
 * The room trusts three headers. That trust is only defensible if the Worker sets them from a verified
 * token and cannot be reached another way, so the interesting tests here are the ones where a caller tries
 * to arrive with an identity of their own, and the ones where the zone is not theirs to be present in.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ACTOR_HEADER,
  ACTOR_TYPE_HEADER,
  DEVICE_HEADER,
  handlePresenceSocket,
  zoneAllowed,
} from "../src/routes/presence-socket.ts";
import type { AuthenticatedPrincipal } from "../src/auth/token.ts";
import { ZoneHub } from "../src/hubs/zone-hub.ts";
import type { SocketPair, UpgradeResult, ZoneHubEnv } from "../src/hubs/zone-hub.ts";
import { CoordinationRoom } from "../src/coordination/durable-object.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { FakeNamespace, fakeState } from "./support/fakes.ts";
import { T0 } from "./support/backends.ts";

/** One end of a fake socket, which the route tests never write to — they only need a pair to exist. */
class QuietSocket {
  accept(): void {}
  send(): void {}
  close(): void {}
}

/** A principal, as `authenticate` would return it. */
function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    actorId: "rider-a",
    actorType: "RIDER",
    role: null,
    zoneIds: ["zone-1"],
    deviceId: "phone-1",
    sessionId: "session-1",
    ...overrides,
  };
}

/** A namespace over real `ZoneHub`s, with the upgrades they accepted kept for assertions. */
function zoneNamespace(): {
  namespace: DurableObjectNamespace;
  accepted: UpgradeResult[];
  names: string[];
} {
  const clock = new FixedClock(T0);
  const accepted: UpgradeResult[] = [];
  const names: string[] = [];
  const coordination = new FakeNamespace(() => new CoordinationRoom(fakeState(), clock));
  const env: ZoneHubEnv = {
    COORDINATION_MODE: "durable-object",
    COORDINATION_ROOM: coordination as unknown as DurableObjectNamespace,
  };
  const namespace = new FakeNamespace<{ fetch(request: Request): Promise<Response> }>((name) => {
    const pair: () => SocketPair = () => ({
      client: new QuietSocket() as unknown as WebSocket,
      server: new QuietSocket() as unknown as WebSocket,
    });
    const hub = new ZoneHub(fakeState(), env, { clock, pair });
    return {
      // The room's own `fetch` builds a `101`, which Node refuses to construct; `upgrade` is the same
      // code minus the response, which is exactly what an assertion needs.
      fetch: async (request: Request) => {
        names.push(name);
        const result = await hub.upgrade(request);
        accepted.push(result);
        const sessions = await hub.presence();
        return new Response(JSON.stringify({ result, sessions }), {
          status: result.ok ? 200 : result.status,
          headers: { "content-type": "application/json" },
        });
      },
    };
  });
  return { namespace: namespace as unknown as DurableObjectNamespace, accepted, names };
}

/** An upgrade as a browser sends it, with an optional attempt to carry its own identity. */
function upgrade(query = "?zone=zone-1", headers: Record<string, string> = {}): Request {
  return new Request(`https://rt.undal.app/v1/presence${query}`, {
    headers: { Upgrade: "websocket", ...headers },
  });
}

/** The body of a refusal, parsed. */
async function body(response: Response): Promise<{ error?: { code: string; details?: Record<string, unknown> } }> {
  return (await response.json()) as { error?: { code: string; details?: Record<string, unknown> } };
}

describe("the zone the caller asks for", () => {
  test("a zone in the token is allowed", () => {
    assert.equal(zoneAllowed(principal(), "zone-1"), true);
  });

  test("a zone outside the token is not", () => {
    assert.equal(zoneAllowed(principal(), "zone-2"), false);
  });

  test("an unrestricted principal may be present anywhere", () => {
    assert.equal(zoneAllowed(principal({ zoneIds: null }), "zone-9"), true);
    assert.equal(zoneAllowed(principal({ zoneIds: [] }), "zone-9"), true);
  });
});

describe("the presence socket route", () => {
  test("a method other than GET is refused", async () => {
    const { namespace } = zoneNamespace();
    const response = await handlePresenceSocket(
      new Request("https://rt.undal.app/v1/presence?zone=zone-1", { method: "POST" }),
      { zoneHub: namespace, principal: principal(), requestId: "req-1" },
    );
    assert.equal(response.status, 501);
  });

  test("a plain GET with no upgrade is refused before any room is built", async () => {
    const { namespace, names } = zoneNamespace();
    const response = await handlePresenceSocket(new Request("https://rt.undal.app/v1/presence?zone=zone-1"), {
      zoneHub: namespace,
      principal: principal(),
      requestId: "req-1",
    });
    assert.equal(response.status, 422);
    assert.equal((await body(response)).error?.details?.reason, "expected a websocket upgrade");
    assert.deepEqual(names, []);
  });

  test("an upgrade with no zone is a client bug, not a privilege question", async () => {
    const { namespace, names } = zoneNamespace();
    const response = await handlePresenceSocket(upgrade(""), {
      zoneHub: namespace,
      principal: principal(),
      requestId: "req-1",
    });
    assert.equal(response.status, 422);
    assert.equal((await body(response)).error?.details?.reason, "no_zone");
    assert.deepEqual(names, []);
  });

  test("a zone the token does not carry is refused, and no socket is opened", async () => {
    const { namespace, names, accepted } = zoneNamespace();
    const response = await handlePresenceSocket(upgrade("?zone=zone-2"), {
      zoneHub: namespace,
      principal: principal(),
      requestId: "req-1",
    });
    assert.equal(response.status, 403);
    assert.equal((await body(response)).error?.code, "PERM_DENIED");
    assert.deepEqual(names, []);
    assert.deepEqual(accepted, []);
  });

  test("an accepted upgrade is addressed by zone and registers the device", async () => {
    const { namespace, names, accepted } = zoneNamespace();
    const response = await handlePresenceSocket(upgrade(), {
      zoneHub: namespace,
      principal: principal(),
      requestId: "req-1",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(names, ["zone:zone-1"]);
    const parsed = (await response.json()) as {
      result: { ok: boolean; session: { role: string } };
      sessions: { actorId: string; deviceId: string }[];
    };
    assert.equal(parsed.result.ok, true);
    assert.equal(parsed.result.session.role, "RIDER");
    assert.deepEqual(parsed.sessions, [{ actorId: "rider-a", deviceId: "phone-1", role: "RIDER" }]);
    assert.equal(accepted.length, 1);
  });

  test("the three identity headers come from the token, not from the caller", async () => {
    const { namespace, accepted } = zoneNamespace();
    const response = await handlePresenceSocket(
      upgrade("?zone=zone-1", {
        [ACTOR_HEADER]: "someone-else",
        [ACTOR_TYPE_HEADER]: "ADMIN",
        [DEVICE_HEADER]: "spoofed-device",
      }),
      { zoneHub: namespace, principal: principal(), requestId: "req-1" },
    );
    assert.equal(response.status, 200);
    const first = accepted[0];
    assert.ok(first !== undefined && first.ok);
    if (first.ok) {
      assert.equal(first.session.actorId, "rider-a");
      assert.equal(first.session.deviceId, "phone-1");
      assert.equal(first.session.role, "RIDER");
    }
  });

  test("a vendor owner arrives as a partner", async () => {
    const { namespace, accepted } = zoneNamespace();
    const response = await handlePresenceSocket(upgrade(), {
      zoneHub: namespace,
      principal: principal({ actorId: "vendor-a", actorType: "VENDOR_OWNER", deviceId: "tablet-1" }),
      requestId: "req-1",
    });
    assert.equal(response.status, 200);
    const first = accepted[0];
    assert.ok(first !== undefined && first.ok);
    if (first.ok) assert.equal(first.session.role, "PARTNER");
  });
});
