/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Waking a sleeping phone (`15 §9`, D128).
 *
 * The assertions are the ones a rider would notice: the message goes to the v1 endpoint, it carries **data and no
 * platform alert object**, its priority is `high` (a data message at normal priority can sit in a dozing device's queue
 * until the offer has expired), and a failure is a `Result` the caller can record against the token rather than an
 * exception that abandons the rest of the wave.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { createFcmClient, fcmConfigured } from "../src/bindings/fcm.ts";

const realFetch = globalThis.fetch;
const realNow = Date.now;

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(make: () => Response): { readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return make();
  }) as typeof fetch;
  return { calls };
}

const CONFIG = { endpoint: "https://fcm.test", projectId: "undal-prod", accessToken: "ya29.token" };

describe("the push client (D128)", () => {
  test("a send goes to the v1 endpoint with the bearer token", async () => {
    const stub = stubFetch(() => Response.json({ name: "projects/undal-prod/messages/42" }));
    const result = await createFcmClient(CONFIG).send({ token: "tok-1", data: { orderCode: "UND-7K2M9QX4" } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, { messageId: "projects/undal-prod/messages/42" });
    assert.equal(stub.calls[0]?.url, "https://fcm.test/v1/projects/undal-prod/messages:send");
    const headers = stub.calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer ya29.token");
  });

  test("the message is data only, at high priority, with the token on the message", async () => {
    const stub = stubFetch(() => Response.json({ name: "projects/undal-prod/messages/43" }));
    await createFcmClient(CONFIG).send({ token: "tok-1", data: { orderCode: "UND-7K2M9QX4", secondsRemaining: "25" } });
    const body = JSON.parse(String(stub.calls[0]?.init.body)) as {
      message: { token: string; data: Record<string, string>; android: { priority: string } };
    };
    assert.equal(body.message.token, "tok-1");
    assert.deepEqual(body.message.data, { orderCode: "UND-7K2M9QX4", secondsRemaining: "25" });
    assert.equal(body.message.android.priority, "high", "a normal-priority data message can doze past the offer");
    assert.equal(Object.keys(body.message).includes("notification"), false, "the OS must not draw this alert");
  });

  test("an unregistered token is a failure carrying the status, not a throw", async () => {
    stubFetch(() => new Response("gone", { status: 404 }));
    const result = await createFcmClient(CONFIG).send({ token: "dead", data: {} });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "SERVICE_DEGRADED");
    const details = (result.ok ? {} : result.error.details) as { status?: number };
    assert.equal(details.status, 404, "the caller logs an unregistered token differently from a 5xx");
  });

  test("a 200 with no message name is a failure, not a send that maybe happened", async () => {
    stubFetch(() => Response.json({}));
    const result = await createFcmClient(CONFIG).send({ token: "tok-1", data: {} });
    assert.equal(result.ok, false);
  });

  test("a hung endpoint times out as a dependency timeout", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    const result = await createFcmClient({ ...CONFIG, timeoutMs: 5 }).send({ token: "tok-1", data: {} });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "DEPENDENCY_TIMEOUT");
  });

  test("absent credentials are a configuration state, not a broken deployment", () => {
    assert.equal(fcmConfigured({}), false);
    assert.equal(fcmConfigured({ FCM_PROJECT_ID: "p" }), false);
    assert.equal(fcmConfigured({ FCM_PROJECT_ID: "", FCM_ACCESS_TOKEN: "t" }), false);
    assert.equal(fcmConfigured({ FCM_PROJECT_ID: "p", FCM_ACCESS_TOKEN: "t" }), true);
  });
});
