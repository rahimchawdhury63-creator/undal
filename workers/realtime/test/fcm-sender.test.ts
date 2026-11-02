/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The sender: FCM's five answers, and what each of them decides.
 *
 * A push that fails is not an error to retry blindly — `UNREGISTERED` means a token to delete,
 * `SENDER_ID_MISMATCH` means a build pointing at the wrong project, `QUOTA_EXCEEDED` means wait. The suite
 * asserts the classification, the number of attempts it costs, and the waits between them, because those
 * waits are a budget the alarm is spent against.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RETRY_BACKOFF_MS, SEND_ATTEMPTS, createPushSender, sendEndpoint } from "../src/fcm/sender.ts";
import type { FcmMessage } from "../src/fcm/payload.ts";
import type { TokenSource } from "../src/fcm/token.ts";

const MESSAGE: FcmMessage = {
  token: "device-token",
  data: { v: "1", orderId: "UND-7K2M9QX4" },
  android: { priority: "high", ttl: "120s", collapse_key: "order_UND-7K2M9QX4", direct_boot_ok: true },
};

/** A token source that always answers, and counts how often it was asked. */
function tokens(): TokenSource & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async get(): Promise<string> {
      calls += 1;
      return "ya29.test";
    },
  };
}

/** A sender over a scripted transport, with the sleeps recorded rather than waited. */
function sender(
  answers: readonly (() => Promise<Response>)[],
  tokenSource: TokenSource = tokens(),
): {
  send: ReturnType<typeof createPushSender>["send"];
  readonly waits: number[];
  readonly urls: string[];
  readonly auth: (string | null)[];
  readonly bodies: string[];
} {
  const waits: number[] = [];
  const urls: string[] = [];
  const auth: (string | null)[] = [];
  const bodies: string[] = [];
  let index = 0;
  const built = createPushSender({
    projectId: "undal-test",
    tokens: tokenSource,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      auth.push(new Headers(init?.headers).get("authorization"));
      bodies.push(String(init?.body ?? ""));
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      if (answer === undefined) throw new Error("no answer scripted");
      return answer();
    }) as typeof fetch,
  });
  return { send: built.send, waits, urls, auth, bodies };
}

/** An FCM error body, shaped like the real one. */
function fcmError(status: number, errorCode?: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        // Google names the HTTP status in `status` and the precise cause in `details`. A 404 with no
        // detail list is still a NOT_FOUND, which is the case the classifier must not miss.
        status: errorCode === "UNREGISTERED" || (errorCode === undefined && status === 404)
          ? "NOT_FOUND"
          : (errorCode ?? "INVALID_ARGUMENT"),
        message: "nope",
        details: errorCode === undefined ? [] : [{ errorCode }],
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("the endpoint", () => {
  test("is the v1 messages endpoint for the project", () => {
    assert.equal(sendEndpoint("undal-test"), "https://fcm.googleapis.com/v1/projects/undal-test/messages:send");
  });
});

describe("a send that works", () => {
  test("returns the message id and posts the message under a bearer token", async () => {
    const harness = sender([async () => Response.json({ name: "projects/undal-test/messages/1234" })]);
    const outcome = await harness.send(MESSAGE);
    assert.deepEqual(outcome, { ok: true, messageId: "projects/undal-test/messages/1234" });
    assert.equal(harness.urls[0], "https://fcm.googleapis.com/v1/projects/undal-test/messages:send");
    assert.equal(harness.auth[0], "Bearer ya29.test");
    assert.deepEqual(JSON.parse(harness.bodies[0] ?? ""), { message: MESSAGE });
    assert.deepEqual(harness.waits, []);
  });

  test("the payload crosses the wire with no notification block", async () => {
    const harness = sender([async () => Response.json({ name: "n" })]);
    await harness.send(MESSAGE);
    assert.equal((harness.bodies[0] ?? "").includes("notification"), false);
  });
});

describe("a send that fails", () => {
  test("a 500 is retried three times, at the documented waits, then given up", async () => {
    const harness = sender([async () => new Response("upstream", { status: 500 })]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "TRANSIENT");
    assert.equal(harness.urls.length, SEND_ATTEMPTS);
    assert.deepEqual(harness.waits, [RETRY_BACKOFF_MS[0], RETRY_BACKOFF_MS[1]]);
    assert.deepEqual([...RETRY_BACKOFF_MS], [250, 750, 2_000]);
  });

  test("a transport that throws is retried like a 500", async () => {
    const harness = sender([
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => Response.json({ name: "recovered" }),
    ]);
    const outcome = await harness.send(MESSAGE);
    assert.deepEqual(outcome, { ok: true, messageId: "recovered" });
    assert.deepEqual(harness.waits, [250]);
  });

  test("UNREGISTERED is not retried: the token is dead", async () => {
    const harness = sender([async () => fcmError(404, "UNREGISTERED")]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "UNREGISTERED");
    assert.equal(harness.urls.length, 1);
  });

  test("NOT_FOUND without an error code is still a dead token", async () => {
    const harness = sender([async () => fcmError(404)]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "UNREGISTERED");
    assert.equal(harness.urls.length, 1);
  });

  test("SENDER_ID_MISMATCH is not retried: it is a build pointing at the wrong project", async () => {
    const harness = sender([async () => fcmError(403, "SENDER_ID_MISMATCH")]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "SENDER_ID_MISMATCH");
    assert.equal(harness.urls.length, 1);
  });

  test("QUOTA_EXCEEDED is retried with backoff", async () => {
    const harness = sender([async () => fcmError(429, "QUOTA_EXCEEDED")]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "QUOTA_EXCEEDED");
    assert.equal(harness.urls.length, SEND_ATTEMPTS);
  });

  test("a 400 with nothing recognisable is a rejection, not a retry", async () => {
    const harness = sender([async () => fcmError(400)]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "REJECTED");
    assert.equal(harness.urls.length, 1);
  });

  test("an HTML error body is classified from its status, not parsed", async () => {
    const harness = sender([async () => new Response("<html>oops</html>", { status: 502 })]);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "TRANSIENT");
  });

  test("a failure to mint a token is a transient send failure, not a throw", async () => {
    const broken: TokenSource = {
      async get(): Promise<string> {
        throw new Error("token refused");
      },
    };
    const harness = sender([async () => Response.json({ name: "never" })], broken);
    const outcome = await harness.send(MESSAGE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, "TRANSIENT");
    assert.equal(harness.urls.length, 0);
  });
});
