/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The delivery report.
 *
 * The battery below is short because the contract is: a batch goes to core, `true` means it was taken, and
 * everything else is `false` and forgotten. The one thing worth being careful about is that a failure is
 * never thrown — a log that can fail an alarm silences the thing it is auditing.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DISPATCH_PATH, createCoreDispatchRecorder } from "../src/authority/core-dispatch.ts";
import type { ReportedDispatch } from "../src/authority/core-dispatch.ts";

const BASE = "https://api.undal.app";
const TOKEN = "internal-secret";

const BATCH: readonly ReportedDispatch[] = [
  { orderCode: "UND-7K2M9QX4", token: "phone-1", attempt: 1, outcome: "SENT", messageId: "m1", sentAtMs: 1_700_000_000_000 },
  { orderCode: "UND-7K2M9QX4", token: "tablet-1", attempt: 1, outcome: "UNREGISTERED", messageId: null, sentAtMs: 1_700_000_000_000 },
];

/** A transport that records what was sent and answers with a script. */
function stub(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer(String(input), init ?? {});
  }) as typeof fetch;
  return { calls, transport };
}

describe("reporting a batch", () => {
  test("posts the whole batch under the internal token", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { recorded: 2 } }));
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport }).record(BATCH), true);
    assert.equal(calls[0]?.url, `${BASE}${DISPATCH_PATH}`);
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { dispatches: BATCH });
  });

  test("an empty batch is not sent at all", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true }));
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport }).record([]), true);
    assert.equal(calls.length, 0);
  });

  test("a non-2xx answers false", async () => {
    const { transport } = stub(async () => new Response("nope", { status: 500 }));
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport }).record(BATCH), false);
  });

  test("an envelope with ok:false answers false", async () => {
    const { transport } = stub(async () => Response.json({ ok: false, error: { code: "VALIDATION_FAILED" } }));
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport }).record(BATCH), false);
  });

  test("a transport that throws answers false rather than throwing", async () => {
    const { transport } = stub(async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport }).record(BATCH), false);
  });

  test("a transport that never answers is abandoned and answers false", async () => {
    const { transport } = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    assert.equal(await createCoreDispatchRecorder(BASE, TOKEN, { fetch: transport, timeoutMs: 20 }).record(BATCH), false);
  });
});
