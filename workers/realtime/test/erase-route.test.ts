/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Erasing a rider's live location (`07 §6`, D98).
 *
 * The tests that matter are the boring ones: erasing twice is a success, the rider's own route cannot name
 * another rider, and a deployment without D1 refuses rather than answering "erased" about nothing. A privacy
 * promise that answers `200` when it did not delete is worse than one that errors.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleEraseInternal, handleEraseSelf } from "../src/routes/erase.ts";
import type { PositionStore } from "../src/d1/store.ts";

const NOW = 1_762_000_200_000;

interface Recorder extends PositionStore {
  readonly erased: string[];
}

function storeOf(counts: { positions?: number; current?: number } = {}): Recorder {
  const erased: string[] = [];
  return {
    erased,
    async context() {
      return null;
    },
    async newest() {
      return null;
    },
    async write() {},
    async erase(riderId: string) {
      erased.push(riderId);
      // The second erasure of the same rider deletes nothing, which is what D1 reports.
      const first = erased.filter((id) => id === riderId).length === 1;
      return {
        positions: first ? (counts.positions ?? 37) : 0,
        current: first ? (counts.current ?? 1) : 0,
      };
    },
    async sweepStale(): Promise<{ riders: number; positions: number }> {
      return { riders: 0, positions: 0 };
    },
  };
}

const internal = (body: unknown, headers: Record<string, string> = { authorization: "Bearer s3cret" }): Request =>
  new Request("https://rt.undal.app/internal/erase", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the rider erases their own", () => {
  test("the counts are reported, because a claim an operator can check is worth more than a boolean", async () => {
    const store = storeOf({ positions: 37, current: 1 });
    const response = await handleEraseSelf("rider-1", { store, requestId: "req-1", nowMs: NOW });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.deepEqual(body.data.erased, { positions: 37, current: 1 });
    assert.equal(body.data.riderId, "rider-1");
    assert.equal(body.data.erasedAtMs, NOW);
    assert.deepEqual(store.erased, ["rider-1"]);
  });

  test("erasing twice is a success with zeros, not a 404 about a trail that is gone", async () => {
    const store = storeOf();
    await handleEraseSelf("rider-1", { store, requestId: "req-1", nowMs: NOW });
    const second = await handleEraseSelf("rider-1", { store, requestId: "req-2", nowMs: NOW + 500 });
    assert.equal(second.status, 200);
    const body = (await second.json()) as any;
    assert.deepEqual(body.data.erased, { positions: 0, current: 0 });
  });

  test("without D1 there is nothing to erase, and the route says so", async () => {
    const response = await handleEraseSelf("rider-1", { store: undefined, requestId: "req-1", nowMs: NOW });
    assert.equal(response.status, 501);
    const body = (await response.json()) as any;
    assert.equal(body.error.details.reason, "d1_not_configured");
  });
});

describe("core erases on someone else's behalf", () => {
  const context = (store: PositionStore | undefined, internalToken = "s3cret") => ({
    store,
    internalToken,
    requestId: "req-9",
    nowMs: NOW,
  });

  test("a force-end names the rider and gets the counts back", async () => {
    const store = storeOf({ positions: 12, current: 1 });
    const response = await handleEraseInternal(internal({ riderId: "rider-7", reason: "admin_force_end" }), context(store));
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.data.riderId, "rider-7");
    assert.equal(body.data.reason, "admin_force_end");
    assert.equal(body.data.erased.positions, 12);
    assert.deepEqual(store.erased, ["rider-7"]);
  });

  test("a reason longer than the field is cut, not stored", async () => {
    const response = await handleEraseInternal(internal({ riderId: "rider-7", reason: "x".repeat(200) }), context(storeOf()));
    const body = (await response.json()) as any;
    assert.equal(body.data.reason.length, 64);
  });

  test("no internal token configured means no internal erasure, whatever the caller sends", async () => {
    const store = storeOf();
    // Spreading rather than passing `undefined`: a default parameter swallows `undefined`, so the test would
    // quietly be asking with the token that is supposed to be missing.
    const response = await handleEraseInternal(internal({ riderId: "rider-7" }), { ...context(store), internalToken: undefined });
    assert.equal(response.status, 401);
    assert.deepEqual(store.erased, []);
  });

  test("the wrong bearer is refused, and the store is never asked", async () => {
    const store = storeOf();
    const response = await handleEraseInternal(
      internal({ riderId: "rider-7" }, { authorization: "Bearer nope" }),
      context(store),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(store.erased, []);
  });

  test("a body without a rider id is a bug in the caller, named as one", async () => {
    const store = storeOf();
    const response = await handleEraseInternal(internal({ reason: "admin_force_end" }), context(store));
    assert.equal(response.status, 422);
    const body = (await response.json()) as any;
    assert.equal(body.error.details.reason, "rider_id_required");
    assert.deepEqual(store.erased, []);
  });

  test("a body that is not JSON is refused before anything is deleted", async () => {
    const store = storeOf();
    const response = await handleEraseInternal(internal("{oops"), context(store));
    assert.equal(response.status, 422);
    assert.deepEqual(store.erased, []);
  });

  test("the two doors erase the same thing, which is why the second can be a no-op", async () => {
    const store = storeOf({ positions: 5, current: 1 });
    await handleEraseInternal(internal({ riderId: "rider-7", reason: "presence_offline" }), context(store));
    const self = await handleEraseSelf("rider-7", { store, requestId: "req-2", nowMs: NOW + 200 });
    const body = (await self.json()) as any;
    assert.equal(body.data.erased.positions, 0);
    assert.deepEqual(store.erased, ["rider-7", "rider-7"]);
  });
});
