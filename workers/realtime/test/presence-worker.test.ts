/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `/v1/presence` through the Worker's own `fetch`.
 *
 * The route's refusals only mean something if the Worker reaches them in the right order: a deployment
 * that has not bound a zone room, a deployment that has no public key, a request with no token, a token
 * that does not verify, a zone that is not the caller's. Only after all five does a socket exist, and the
 * last test is the one that proves it does.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import worker from "../src/index.ts";
import type { RealtimeEnv } from "../src/index.ts";
import { CoordinationRoom } from "../src/coordination/durable-object.ts";
import { ZoneHub } from "../src/hubs/zone-hub.ts";
import type { SocketPair, UpgradeResult, ZoneHubEnv } from "../src/hubs/zone-hub.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { FakeNamespace, fakeState } from "./support/fakes.ts";
import { base64url, keyPair, sign } from "./support/token.ts";

/** A socket end that accepts and says nothing. */
class QuietSocket {
  accept(): void {}
  send(): void {}
  close(): void {}
}

/** A namespace of zone rooms over in-memory state, keeping the upgrades each room accepted. */
class ZoneNamespace {
  private readonly rooms = new Map<string, ZoneHub>();
  private readonly clock: FixedClock;
  private readonly coordination: DurableObjectNamespace;
  readonly accepted: UpgradeResult[] = [];

  constructor(clock: FixedClock) {
    this.clock = clock;
    this.coordination = new FakeNamespace(
      () => new CoordinationRoom(fakeState(), clock),
    ) as unknown as DurableObjectNamespace;
  }

  private env(): ZoneHubEnv {
    return { COORDINATION_MODE: "durable-object", COORDINATION_ROOM: this.coordination };
  }

  idFromName(name: string): DurableObjectId {
    return {
      toString: () => name,
      name,
      equals: (other: DurableObjectId) => other.toString() === name,
    } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString();
    let hub = this.rooms.get(name);
    if (hub === undefined) {
      const pair: () => SocketPair = () => ({
        client: new QuietSocket() as unknown as WebSocket,
        server: new QuietSocket() as unknown as WebSocket,
      });
      hub = new ZoneHub(fakeState(), this.env(), { clock: this.clock, pair });
      this.rooms.set(name, hub);
    }
    const resolved = hub;
    return {
      // A `101` cannot be constructed outside the runtime, so the stub answers with the upgrade's result
      // instead — the assertions are about who got registered, not about the status line.
      fetch: async (request: Request) => {
        const result = await resolved.upgrade(request);
        this.accepted.push(result);
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : result.status,
          headers: { "content-type": "application/json" },
        });
      },
    } as unknown as DurableObjectStub;
  }
}

/** An environment with a public key, and optionally a zone namespace. */
async function environment(publicSecret: string | undefined, zones = true): Promise<{
  env: RealtimeEnv;
  namespace: ZoneNamespace;
}> {
  // The Worker verifies against the real clock, so the rooms are built with one too.
  const clock = new FixedClock(Date.now());
  const namespace = new ZoneNamespace(clock);
  const coordination = new FakeNamespace(
    () => new CoordinationRoom(fakeState(), clock),
  ) as unknown as DurableObjectNamespace;
  return {
    namespace,
    env: {
      PUBLIC_API_BASE: "https://api.undal.app",
      COORDINATION_MODE: "durable-object",
      ORDER_ROOM: coordination,
      COORDINATION_ROOM: coordination,
      ...(zones ? { ZONE_HUB: namespace as unknown as DurableObjectNamespace } : {}),
      ...(publicSecret === undefined ? {} : { JWT_PUBLIC_KEY: publicSecret }),
    },
  };
}

/** A websocket upgrade with a bearer token. */
function presenceRequest(query: string, token?: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://rt.undal.app/v1/presence?${query}`, {
    headers: {
      Upgrade: "websocket",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
  });
}

describe("/v1/presence through the Worker", () => {
  test("a deployment with no zone room says so instead of accepting a socket", async () => {
    const pair = await keyPair();
    const { env } = await environment(pair.secret, false);
    const token = await sign({}, pair, Date.now());
    const response = await worker.fetch(presenceRequest("zone=sylhet", token), env);
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "zone_hub_not_configured");
  });

  test("a deployment with no public key refuses rather than trusting anybody", async () => {
    const { env } = await environment(undefined);
    const response = await worker.fetch(presenceRequest("zone=sylhet"), env);
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "jwt_public_key_missing");
  });

  test("no token is 401", async () => {
    const pair = await keyPair();
    const { env } = await environment(pair.secret);
    const response = await worker.fetch(presenceRequest("zone=sylhet"), env);
    assert.equal(response.status, 401);
  });

  test("a token signed by another key is 401 and no room is built", async () => {
    const configured = await keyPair();
    const stranger = await keyPair();
    const token = await sign({}, stranger, Date.now());
    const { env, namespace } = await environment(configured.secret);
    const response = await worker.fetch(presenceRequest("zone=sylhet", token), env);
    assert.equal(response.status, 401);
    assert.deepEqual(namespace.accepted, []);
  });

  test("a verified token in its own zone opens the socket", async () => {
    const pair = await keyPair();
    const { env, namespace } = await environment(pair.secret);
    const token = await sign({ sub: "rider-a", act: "RIDER", did: "phone-1", scope: ["sylhet"] }, pair, Date.now());
    const response = await worker.fetch(presenceRequest("zone=sylhet", token), env);
    assert.equal(response.status, 200);
    const accepted = namespace.accepted[0];
    assert.ok(accepted !== undefined && accepted.ok);
    if (accepted.ok) {
      assert.equal(accepted.zoneId, "sylhet");
      assert.equal(accepted.session.actorId, "rider-a");
      assert.equal(accepted.session.deviceId, "phone-1");
      assert.equal(accepted.session.role, "RIDER");
    }
  });

  test("a zone outside the token is refused, and no socket is opened", async () => {
    const pair = await keyPair();
    const { env, namespace } = await environment(pair.secret);
    const token = await sign({ scope: ["sylhet"] }, pair, Date.now());
    const response = await worker.fetch(presenceRequest("zone=dhaka", token), env);
    assert.equal(response.status, 403);
    assert.deepEqual(namespace.accepted, []);
  });
});
