/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `GET /rt/stream` — the refusals first, because they are the ones a client can act on.
 *
 * A stream either starts with an authorized channel set and the replay it asked for, or it does not
 * start at all. There is no half-subscribed response, and the tests assert that a refusal is a JSON
 * envelope rather than an empty event stream that looks healthy.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DENY_ALL, handleStream, resolveSelf } from "../src/routes/stream.ts";
import type { ChannelAuthorizer, StreamPrincipal } from "../src/routes/stream.ts";
import { StreamHub } from "../src/sse/hub.ts";
import { MemoryFrameStore } from "../src/sse/store.ts";
import { BACKENDS } from "./support/backends.ts";

const RIDER: StreamPrincipal = { actorId: "rider-a", actorType: "RIDER" };
const CUSTOMER: StreamPrincipal = { actorId: "cust-a", actorType: "CUSTOMER" };

/** An authorizer that allows exactly the listed channels. */
function allowOnly(...keys: string[]): ChannelAuthorizer {
  return { allows: (_principal, channel) => keys.includes(`${channel.kind}:${channel.id}`) };
}

/** A GET with the cursor header, as a browser sends it. */
function get(query: string, lastEventId?: string): Request {
  return new Request(`https://rt.undal.app/rt/stream?${query}`, {
    method: "GET",
    headers: lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId },
  });
}

for (const backend of BACKENDS) {
  describe(`stream route/${backend.name}`, () => {
    test("a request with no channels is a 422, not an empty stream", async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(get(""), { coordinator, principal: RIDER, authorizer: allowOnly("rider:rider-a") });
      assert.equal(response.status, 422);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "VALIDATION_FAILED");
    });

    test("a malformed channel is refused before any subscription", async () => {
      const { coordinator } = backend.make();
      for (const query of ["channels=orders:A", "channels=order:", "channels=order:self", "channels=order:A,order:A"]) {
        const response = await handleStream(get(query), { coordinator, principal: RIDER, authorizer: allowOnly("order:A") });
        assert.equal(response.status, 422, query);
      }
    });

    test("a channel the principal may not watch is a 403", async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(get("channels=order:UND-7K2M9QX4"), {
        coordinator,
        principal: CUSTOMER,
        authorizer: DENY_ALL,
      });
      assert.equal(response.status, 403);
      const body = (await response.json()) as { error: { code: string; details: { channel: string } } };
      assert.equal(body.error.code, "PERM_DENIED");
      assert.equal(body.error.details.channel, "order:UND-7K2M9QX4");
    });

    test("a rider's self channel resolves to the rider, and only for a rider", async () => {
      assert.deepEqual(resolveSelf({ kind: "rider", id: "self" }, RIDER), { kind: "rider", id: "rider-a" });
      assert.equal(resolveSelf({ kind: "rider", id: "self" }, CUSTOMER), null);
      assert.equal(resolveSelf({ kind: "order", id: "self" }, RIDER), null);
      assert.deepEqual(resolveSelf({ kind: "order", id: "A" }, RIDER), { kind: "order", id: "A" });
    });

    test("a rider may watch their own channel and the stream starts", async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(get("channels=rider:self"), {
        coordinator,
        principal: RIDER,
        authorizer: allowOnly("rider:rider-a"),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
      await response.body?.cancel();
    });

    test("the authorized order channel replays from the log after the cursor", async () => {
      const built = backend.make();
      await built.coordinator.appendEvent({ orderId: "A", kind: "PLACED", actorType: "SYSTEM" });
      await built.coordinator.appendEvent({ orderId: "A", kind: "ACCEPTED", actorType: "SYSTEM" });
      const response = await handleStream(get("channels=order:A", "1"), {
        coordinator: built.coordinator,
        principal: CUSTOMER,
        authorizer: allowOnly("order:A"),
      });
      const reader = response.body?.getReader();
      const chunk = await reader?.read();
      const text = new TextDecoder().decode(chunk?.value as Uint8Array);
      assert.equal(text.includes("id: 2"), true);
      assert.equal(text.includes("event: order.accepted"), true);
      assert.equal(text.includes("id: 1"), false);
      await reader?.cancel();
    });

    test("a zone channel replays from the ring that holds it", async () => {
      const built = backend.make();
      const hub = new StreamHub();
      hub.record({ kind: "zone", id: "sylhet" }, { seq: 9, kind: "RIDER_ASSIGNED", data: { from: "ring" }, atMs: built.clock.nowMs() });
      const response = await handleStream(get("channels=zone:sylhet", "8"), {
        coordinator: built.coordinator,
        principal: CUSTOMER,
        authorizer: allowOnly("zone:sylhet"),
        store: new MemoryFrameStore(hub),
        clock: built.clock,
      });
      const reader = response.body?.getReader();
      const text = new TextDecoder().decode((await reader?.read())?.value as Uint8Array);
      assert.equal(text.includes('"from":"ring"'), true);
      await reader?.cancel();
    });

    test("a cursor that is not a number is refused rather than ignored", async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(get("channels=order:A", "abc"), {
        coordinator,
        principal: CUSTOMER,
        authorizer: allowOnly("order:A"),
      });
      assert.equal(response.status, 422);
    });

    test("a non-GET is a 501, matching the Worker's catch-all", async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(
        new Request("https://rt.undal.app/rt/stream?channels=order:A", { method: "POST" }),
        { coordinator, principal: CUSTOMER, authorizer: allowOnly("order:A") },
      );
      assert.equal(response.status, 501);
    });

    test("the refusal carries the request id back", async () => {
      const { coordinator } = backend.make();
      const request = new Request("https://rt.undal.app/rt/stream", {
        headers: { "X-Undal-Request-Id": "req-42" },
      });
      const response = await handleStream(request, { coordinator, principal: RIDER, authorizer: DENY_ALL });
      assert.equal(response.headers.get("X-Undal-Request-Id"), "req-42");
      const body = (await response.json()) as { meta: { requestId: string } };
      assert.equal(body.meta.requestId, "req-42");
    });

    test("a channel authorized per principal differs by principal", async () => {
      const { coordinator } = backend.make();
      const authorizer: ChannelAuthorizer = {
        allows: (principal, channel) => principal.actorId === "cust-a" && channel.id === "A",
      };
      const allowed = await handleStream(get("channels=order:A"), { coordinator, principal: CUSTOMER, authorizer });
      const denied = await handleStream(get("channels=order:A"), {
        coordinator,
        principal: { actorId: "cust-b", actorType: "CUSTOMER" },
        authorizer,
      });
      assert.equal(allowed.status, 200);
      assert.equal(denied.status, 403);
      await allowed.body?.cancel();
    });
  });
}
