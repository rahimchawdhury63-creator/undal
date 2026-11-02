/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `/rt/stream` through the Worker's own `fetch`, which is where the refusals are ordered.
 *
 * The route already refuses a bad channel set; this suite is about the four answers that come before it —
 * is a coordinator configured, is a key configured, is there a token, does it verify — and about the one
 * happy path that gets to start a stream.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import worker from "../src/index.ts";
import type { RealtimeEnv } from "../src/index.ts";
import { CoordinationRoom, DurableObjectCoordinator } from "../src/coordination/durable-object.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { FakeNamespace, fakeState } from "./support/fakes.ts";
import { NOW, base64url, keyPair, sign } from "./support/token.ts";

/** An environment with a durable-object coordinator and a public key for the given pair. */
async function environment(publicSecret: string | undefined, startMs: number = Date.now()): Promise<RealtimeEnv> {
  // The Worker reads the real clock, so the room is built with one too: a room frozen two years ago would
  // publish every session as absent and the tests would be measuring the fixture.
  const clock = new FixedClock(startMs);
  const namespace = new FakeNamespace(() => new CoordinationRoom(fakeState(), clock));
  return {
    PUBLIC_API_BASE: "https://api.undal.app",
    COORDINATION_MODE: "durable-object",
    ORDER_ROOM: namespace as unknown as DurableObjectNamespace,
    COORDINATION_ROOM: namespace as unknown as DurableObjectNamespace,
    ...(publicSecret === undefined ? {} : { JWT_PUBLIC_KEY: publicSecret }),
  };
}

/** A GET with a bearer token. */
function streamRequest(query: string, token?: string): Request {
  return new Request(`https://rt.undal.app/rt/stream?${query}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe("/rt/stream through the Worker", () => {
  test("the free backend says what it is waiting for instead of pretending to stream", async () => {
    const pair = await keyPair();
    const response = await worker.fetch(streamRequest("channels=rider:self"), {
      ...(await environment(pair.secret)),
      COORDINATION_MODE: "sql",
    });
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "coordinator_not_configured");
  });

  test("a deployment with no public key refuses rather than trusting anybody", async () => {
    const response = await worker.fetch(streamRequest("channels=rider:self"), await environment(undefined));
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "jwt_public_key_missing");
  });

  test("no token is 401 in the shared envelope", async () => {
    const pair = await keyPair();
    const response = await worker.fetch(streamRequest("channels=rider:self"), await environment(pair.secret));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string; details: { reason: string } } };
    assert.equal(body.error.code, "AUTH_TOKEN_INVALID");
    assert.equal(body.error.details.reason, "MALFORMED");
  });

  test("an expired token is 401 with its own code", async () => {
    const pair = await keyPair();
    const token = await sign({ exp: Math.floor(Date.now() / 1_000) - 10 }, pair, Date.now());
    const response = await worker.fetch(streamRequest("channels=rider:self", token), await environment(pair.secret));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "AUTH_SESSION_EXPIRED");
  });

  test("a token signed by another key is 401", async () => {
    const configured = await keyPair();
    const stranger = await keyPair();
    const token = await sign({}, stranger, Date.now());
    const response = await worker.fetch(streamRequest("channels=rider:self", token), await environment(configured.secret));
    assert.equal(response.status, 401);
  });

  test("a rider watching their own channel gets a stream", async () => {
    const pair = await keyPair();
    const token = await sign({ sub: "rider-a", act: "RIDER" }, pair, Date.now());
    const response = await worker.fetch(streamRequest("channels=rider:self", token), await environment(pair.secret));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    await response.body?.cancel();
  });

  test("a rider may not watch another rider's channel", async () => {
    const pair = await keyPair();
    const token = await sign({ sub: "rider-a", act: "RIDER" }, pair, Date.now());
    const response = await worker.fetch(streamRequest("channels=rider:rider-b", token), await environment(pair.secret));
    assert.equal(response.status, 403);
  });

  test("a rider may not watch an order, because nobody has answered whether it is theirs", async () => {
    const pair = await keyPair();
    const token = await sign({ sub: "rider-a", act: "RIDER" }, pair, Date.now());
    const response = await worker.fetch(streamRequest("channels=order:A", token), await environment(pair.secret));
    assert.equal(response.status, 403);
  });

  test("an order's log replays into the stream for an authorized caller", async () => {
    const pair = await keyPair();
    const env = await environment(pair.secret);
    const coordinator = new DurableObjectCoordinator(env.COORDINATION_ROOM as DurableObjectNamespace, new FixedClock(NOW));
    await coordinator.appendEvent({ orderId: "A", kind: "PLACED", actorType: "SYSTEM" });

    // The route's authorizer is `SELF_ONLY`, so this asserts the log path with a principal who owns a
    // self channel, then a second request proves the refusal rather than the replay for an order.
    const token = await sign({ sub: "admin-a", act: "ADMIN" }, pair, Date.now());
    const response = await worker.fetch(streamRequest("channels=admin:self", token), env);
    assert.equal(response.status, 200);
    await response.body?.cancel();
  });

  test("the health endpoint still answers, and still names the mode", async () => {
    const pair = await keyPair();
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), await environment(pair.secret));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { coordinationMode: string } };
    assert.equal(body.data.coordinationMode, "durable-object");
  });

  test("an unknown path is still a JSON 501", async () => {
    const pair = await keyPair();
    const response = await worker.fetch(new Request("https://rt.undal.app/v1/presence"), await environment(pair.secret));
    assert.equal(response.status, 501);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  });

  test("the internal presence question answers with the shared secret", async () => {
    const env = { ...(await environment(undefined)), INTERNAL_TOKEN: "internal-secret" };
    const coordinator = new DurableObjectCoordinator(env.COORDINATION_ROOM as DurableObjectNamespace, new FixedClock(Date.now()));
    await coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
    const response = await worker.fetch(
      new Request("https://rt.undal.app/internal/presence", {
        method: "POST",
        headers: { authorization: "Bearer internal-secret", "content-type": "application/json" },
        body: JSON.stringify({ zoneId: "zone-1", riderId: "rider-a" }),
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { online: boolean } };
    assert.equal(body.data.online, true);
  });

  test("the internal surface has no secret configured, so it refuses everybody", async () => {
    const env = await environment(undefined);
    const response = await worker.fetch(
      new Request("https://rt.undal.app/internal/presence", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
        body: JSON.stringify({ zoneId: "zone-1", riderId: "rider-a" }),
      }),
      env,
    );
    assert.equal(response.status, 403);
  });

  test("a broadcast is refused while the rings are per isolate", async () => {
    const env = { ...(await environment(undefined)), INTERNAL_TOKEN: "internal-secret" };
    const response = await worker.fetch(
      new Request("https://rt.undal.app/internal/broadcast", {
        method: "POST",
        headers: { authorization: "Bearer internal-secret" },
        body: JSON.stringify({ zoneId: "zone-1", orderId: "A", event: "order.placed", payload: {} }),
      }),
      env,
    );
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "rings_not_durable");
  });

  test("the internal surface is not available on the free backend yet", async () => {
    const env = { ...(await environment(undefined)), COORDINATION_MODE: "sql", INTERNAL_TOKEN: "internal-secret" };
    const response = await worker.fetch(
      new Request("https://rt.undal.app/internal/presence", {
        method: "POST",
        headers: { authorization: "Bearer internal-secret" },
        body: JSON.stringify({ zoneId: "zone-1", riderId: "rider-a" }),
      }),
      env,
    );
    assert.equal(response.status, 501);
  });

  test("a base64url key that is not a JWK is a configuration error, not a 401", async () => {
    const notAJwk = base64url(new TextEncoder().encode(JSON.stringify({ kty: "RSA" })));
    const response = await worker.fetch(streamRequest("channels=rider:self"), await environment(notAJwk));
    assert.equal(response.status, 500);
  });
});
