/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The receipt report.
 *
 * The one thing worth asserting beyond "it posts" is what `false` means: core answering `recorded: 0` is not a
 * matched receipt, and the room should not pretend otherwise. Everything else is the same fail-silent contract
 * as the dispatch log.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RECEIPT_PATH, createCoreReceiptRecorder } from "../src/authority/core-receipts.ts";

const BASE = "https://api.undal.app";
const TOKEN = "internal-secret";
const RECEIPT = { orderCode: "UND-7K2M9QX4", deviceId: "0".repeat(31) + "1", receivedAtMs: 1_700_000_000_000 };

/** A transport that records what was sent and answers with a script. */
function stub(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer(String(input), init ?? {});
  }) as typeof fetch;
  return { calls, transport };
}

describe("reporting a receipt", () => {
  test("posts one receipt in the batch shape core expects", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { recorded: 1 } }));
    assert.equal(await createCoreReceiptRecorder(BASE, TOKEN, { fetch: transport }).record(RECEIPT), true);
    assert.equal(calls[0]?.url, `${BASE}${RECEIPT_PATH}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { receipts: [RECEIPT] });
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
  });

  test("a receipt core could not match is not a success", async () => {
    const { transport } = stub(async () => Response.json({ ok: true, data: { recorded: 0 } }));
    assert.equal(await createCoreReceiptRecorder(BASE, TOKEN, { fetch: transport }).record(RECEIPT), false);
  });

  test("a non-2xx answers false", async () => {
    const { transport } = stub(async () => new Response("nope", { status: 503 }));
    assert.equal(await createCoreReceiptRecorder(BASE, TOKEN, { fetch: transport }).record(RECEIPT), false);
  });

  test("a transport that throws answers false rather than throwing", async () => {
    const { transport } = stub(async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await createCoreReceiptRecorder(BASE, TOKEN, { fetch: transport }).record(RECEIPT), false);
  });

  test("a transport that never answers is abandoned and answers false", async () => {
    const { transport } = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    assert.equal(await createCoreReceiptRecorder(BASE, TOKEN, { fetch: transport, timeoutMs: 20 }).record(RECEIPT), false);
  });
});
