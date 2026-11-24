/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The ladder's front door.
 *
 * Four refusals and two forwards, which is the whole file: an unauthenticated caller cannot arm a ladder, a
 * deployment with no room says so rather than pretending, and a body with no order cannot be addressed to a
 * room. Everything else about the ladder is the room's business and is tested there.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleLadder } from "../src/routes/ladder.ts";
import type { LadderContext } from "../src/routes/ladder.ts";

const TOKEN = "internal-secret";
const ORDER = "UND-7K2M9QX4";

/** A namespace that records what was asked of it and answers with the request it saw. */
function namespace(): { readonly stub: DurableObjectNamespace; readonly seen: { name: string; request: Request; body: string }[] } {
  const seen: { name: string; request: Request; body: string }[] = [];
  const stub = {
    idFromName: (name: string) => ({ toString: () => name, name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) =>
      ({
        fetch: async (request: Request) => {
          seen.push({ name: id.toString(), request, body: request.method === "GET" ? "" : await request.text() });
          return Response.json({ orderCode: ORDER, nextAlarmAtMs: 1 });
        },
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
  return { stub, seen };
}

/** A context, with the token on the request unless the test says otherwise. */
function context(overrides: Partial<LadderContext> = {}): LadderContext {
  return { namespace: undefined, internalToken: TOKEN, requestId: "req-1", ...overrides };
}

/** A request carrying the internal token. */
function post(path: string, body: unknown, token: string | null = TOKEN): Request {
  return new Request(`https://rt.undal.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

const BEGIN = { orderCode: ORDER, zoneId: "sylhet", push: { type: "ORDER_NEW" }, devices: ["phone-1"] };

describe("routing", () => {
  test("a path that is not the ladder's is not this handler's", async () => {
    const response = await handleLadder(new Request("https://rt.undal.app/internal/presence"), context());
    assert.equal(response, null);
  });
});

describe("refusals", () => {
  test("a caller without the token is refused, and nothing is forwarded", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(post("/internal/ladder/begin", BEGIN, null), context({ namespace: namespaceStub.stub }));
    assert.equal(response?.status, 403);
    assert.deepEqual(namespaceStub.seen, []);
  });

  test("a deployment with no ladder room says so", async () => {
    const response = await handleLadder(post("/internal/ladder/begin", BEGIN), context());
    assert.equal(response?.status, 501);
    const body = (await response?.json()) as { error: { details: { reason: string } } };
    assert.equal(body.error.details.reason, "ladder_not_configured");
  });

  test("a begin with no order cannot be addressed to a room", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(
      post("/internal/ladder/begin", { zoneId: "sylhet", push: {}, devices: [] }),
      context({ namespace: namespaceStub.stub }),
    );
    assert.equal(response?.status, 422);
    assert.deepEqual(namespaceStub.seen, []);
  });

  test("a begin with no devices list is refused", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(
      post("/internal/ladder/begin", { orderCode: ORDER, zoneId: "sylhet", push: {} }),
      context({ namespace: namespaceStub.stub }),
    );
    assert.equal(response?.status, 422);
  });

  test("a seen with no order is refused", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(
      post("/internal/ladder/seen", { atMs: 1 }),
      context({ namespace: namespaceStub.stub }),
    );
    assert.equal(response?.status, 422);
  });

  test("a state read with no order is refused", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(
      new Request("https://rt.undal.app/internal/ladder/state", { headers: { authorization: `Bearer ${TOKEN}` } }),
      context({ namespace: namespaceStub.stub }),
    );
    assert.equal(response?.status, 422);
  });
});

describe("forwards", () => {
  test("begin addresses the order's own room", async () => {
    const namespaceStub = namespace();
    const response = await handleLadder(post("/internal/ladder/begin", BEGIN), context({ namespace: namespaceStub.stub }));
    assert.equal(response?.status, 200);
    assert.equal(namespaceStub.seen[0]?.name, `ladder:${ORDER}`);
    assert.equal(JSON.parse(namespaceStub.seen[0]?.body ?? "{}").orderCode, ORDER);
  });

  test("seen forwards only the instant", async () => {
    const namespaceStub = namespace();
    await handleLadder(post("/internal/ladder/seen", { orderCode: ORDER, atMs: 42 }), context({ namespace: namespaceStub.stub }));
    assert.equal(namespaceStub.seen[0]?.name, `ladder:${ORDER}`);
    assert.deepEqual(JSON.parse(namespaceStub.seen[0]?.body ?? "{}"), { atMs: 42 });
  });

  test("a reply is the same shape as a seen", async () => {
    const namespaceStub = namespace();
    await handleLadder(post("/internal/ladder/reply", { orderCode: ORDER }), context({ namespace: namespaceStub.stub }));
    assert.equal(namespaceStub.seen[0]?.request.method, "POST");
    assert.match(namespaceStub.seen[0]?.request.url ?? "", /\/reply$/u);
  });

  test("state reads through, with no body", async () => {
    const namespaceStub = namespace();
    const request = new Request(`https://rt.undal.app/internal/ladder/state?order=${ORDER}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const response = await handleLadder(request, context({ namespace: namespaceStub.stub }));
    assert.equal(response?.status, 200);
    assert.equal(namespaceStub.seen[0]?.request.method, "GET");
  });
});
