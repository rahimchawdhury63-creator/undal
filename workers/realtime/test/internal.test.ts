/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The internal surface core calls: one broadcast, one presence question, and the token in front of both.
 *
 * These handlers are the specification of what core may rely on, so the tests are written from core's
 * side: the shape of the body it sends, the envelope it reads back, and the fact that a wrong token never
 * reaches a coordinator at all.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleInternal } from "../src/routes/internal.ts";
import type { InternalContext } from "../src/routes/internal.ts";
import { StreamHub } from "../src/sse/hub.ts";
import { MemoryFrameStore } from "../src/sse/store.ts";
import { parseChannels } from "../src/sse/channels.ts";
import type { OpenShiftInput } from "../src/d1/store.ts";
import { BACKENDS, T0 } from "./support/backends.ts";
import type { Backend } from "./support/backends.ts";

const TOKEN = "internal-secret-for-tests";

/** A context over one backend, with a hub. */
function contextFor(backend: Backend, token: string | null = TOKEN): InternalContext & { hub: StreamHub } {
  const hub = new StreamHub();
  return {
    coordinator: backend.coordinator,
    store: new MemoryFrameStore(hub),
    internalToken: token === null ? undefined : token,
    clock: backend.clock,
    hub,
  };
}

/** A POST with an optional bearer token. */
function post(path: string, body: unknown, token: string | null = TOKEN): Request {
  return new Request(`https://rt.undal.app${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

for (const backend of BACKENDS) {
  describe(`internal routes/${backend.name}`, () => {
    test("a broadcast that names its audience reaches three channels (D104)", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", {
          zoneId: "zone-1",
          orderId: "UND-7K2M9QX4",
          event: "order.placed",
          payload: {},
          seq: 1,
          audience: { vendorUserId: "vendor-user-1" },
        }),
        context,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: { recorded: number } };
      assert.equal(body.data.recorded, 3, "order, zone and the vendor's own channel");
      const vendor = await context.store?.replay({ kind: "vendor", id: "vendor-user-1" }, 0, T0);
      assert.equal(vendor?.frames.length, 1);
    });

    test("a broadcast with no audience reaches two, and does not invent a third", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", { zoneId: "zone-1", orderId: "UND-7K2M9QX4", event: "order.placed", payload: {} }),
        context,
      );
      const body = (await response.json()) as { data: { recorded: number } };
      assert.equal(body.data.recorded, 2);
    });

    test("a call with no configured secret is refused, not accepted", async () => {
      const context = contextFor(backend.make(), null);
      const response = await handleInternal(post("/internal/broadcast", { zoneId: "z", orderId: "o", event: "order.placed" }), context);
      assert.equal(response.status, 403);
    });

    test("a missing token is refused with the reason an operator needs", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(post("/internal/broadcast", {}, null), context);
      assert.equal(response.status, 403);
      const body = (await response.json()) as { error: { code: string; details: { reason: string } } };
      assert.equal(body.error.code, "PERM_DENIED");
      assert.equal(body.error.details.reason, "MISSING_TOKEN");
    });

    test("a wrong token is refused and nothing is broadcast", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", { zoneId: "z", orderId: "o", event: "order.placed" }, "not-the-secret"),
        context,
      );
      assert.equal(response.status, 403);
      assert.equal(context.hub.ring({ kind: "order", id: "o" }).length(), 0);
    });

    test("a broadcast lands on the order channel and the zone channel", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", {
          zoneId: "zone-1",
          orderId: "UND-7K2M9QX4",
          event: "order.assigned",
          payload: { riderId: "r1" },
        }),
        context,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: { recorded: number; orderId: string } };
      assert.equal(body.data.recorded, 2);
      assert.equal(body.data.orderId, "UND-7K2M9QX4");
      const order = context.hub.replay({ kind: "order", id: "UND-7K2M9QX4" }, 0, T0);
      assert.deepEqual(order.frames, [{ id: 1, event: "order.assigned", data: { riderId: "r1" } }]);
      assert.equal(context.hub.replay({ kind: "zone", id: "zone-1" }, 0, T0).frames.length, 1);
    });

    test("the stored spelling of an event is accepted too", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", { zoneId: "zone-1", orderId: "o1", event: "RIDER_ASSIGNED", payload: {} }),
        context,
      );
      assert.equal(response.status, 200);
      assert.equal(context.hub.replay({ kind: "order", id: "o1" }, 0, T0).frames[0]?.event, "order.assigned");
    });

    test("an event the catalogue does not carry is refused before it reaches a handler", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        post("/internal/broadcast", { zoneId: "zone-1", orderId: "o1", event: "order.teleported", payload: {} }),
        context,
      );
      assert.equal(response.status, 422);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "VALIDATION_FAILED");
      assert.equal(context.hub.ring({ kind: "order", id: "o1" }).length(), 0);
    });

    test("a body that is not a broadcast is refused", async () => {
      const context = contextFor(backend.make());
      for (const body of [{}, { zoneId: "z" }, { zoneId: "z", orderId: "o" }, { zoneId: 1, orderId: "o", event: "order.placed" }]) {
        const response = await handleInternal(post("/internal/broadcast", body), context);
        assert.equal(response.status, 422);
      }
    });

    test("a broadcast with a sequence number keeps it as the stream id", async () => {
      const context = contextFor(backend.make());
      await handleInternal(
        post("/internal/broadcast", { zoneId: "z", orderId: "o1", event: "order.placed", payload: {}, seq: 4821 }),
        context,
      );
      assert.equal(context.hub.replay({ kind: "order", id: "o1" }, 0, T0).frames[0]?.id, 4_821);
    });

    test("presence answers online for a rider who just beat", async () => {
      const built = backend.make();
      const context = contextFor(built);
      await built.coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
      const response = await handleInternal(post("/internal/presence", { zoneId: "zone-1", riderId: "rider-a" }), context);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: { online: boolean; lastSeenAt: string | null } };
      assert.equal(body.data.online, true);
      assert.equal(body.data.lastSeenAt, new Date(T0).toISOString());
    });

    test("presence answers offline once the deadline has passed", async () => {
      const built = backend.make();
      const context = contextFor(built);
      await built.coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
      // The width belongs to the backend: two seconds for a row written per beat, one stamp window for the
      // `sql` backend's stamped rows (D89).
      built.clock.advance(built.coordinator.presenceWindowMs + 1);
      const response = await handleInternal(post("/internal/presence", { zoneId: "zone-1", riderId: "rider-a" }), context);
      const body = (await response.json()) as { data: { online: boolean; lastSeenAt: string | null } };
      assert.equal(body.data.online, false);
      assert.equal(body.data.lastSeenAt, new Date(T0).toISOString(), "the row still says when it last heard");
    });

    test("presence keeps answering online while a stamped row is between beats", async () => {
      const built = backend.make();
      const context = contextFor(built);
      await built.coordinator.declarePresence({ actorId: "rider-a", deviceId: "d1", role: "RIDER", zoneId: "zone-1" });
      built.clock.advance(built.coordinator.presenceWindowMs);
      const response = await handleInternal(post("/internal/presence", { zoneId: "zone-1", riderId: "rider-a" }), context);
      const body = (await response.json()) as { data: { online: boolean } };
      assert.equal(body.data.online, true, "the last stamp is still inside the window");
    });

    test("presence answers null for a rider who was never seen", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(post("/internal/presence", { zoneId: "zone-1", riderId: "ghost" }), context);
      const body = (await response.json()) as { data: { online: boolean; lastSeenAt: string | null } };
      assert.deepEqual(body.data, { online: false, lastSeenAt: null });
    });

    test("presence without a zone is refused, because presence is per zone", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(post("/internal/presence", { riderId: "rider-a" }), context);
      assert.equal(response.status, 422);
    });

    test("a method this surface does not serve is a loud 501", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(
        new Request("https://rt.undal.app/internal/broadcast", { method: "GET", headers: { authorization: `Bearer ${TOKEN}` } }),
        context,
      );
      assert.equal(response.status, 501);
    });

    test("an unknown internal path is a 501, not a silent success", async () => {
      const context = contextFor(backend.make());
      const response = await handleInternal(post("/internal/telepathy", {}), context);
      assert.equal(response.status, 501);
    });

    test("a channel the client asks for can be replayed from what core broadcast", async () => {
      const context = contextFor(backend.make());
      await handleInternal(
        post("/internal/broadcast", { zoneId: "zone-1", orderId: "o1", event: "order.accepted", payload: {} }),
        context,
      );
      const channels = parseChannels("order:o1");
      const replay = context.hub.replay(channels[0] as { kind: "order"; id: string }, 0, T0);
      assert.equal(replay.complete, true);
      assert.equal(replay.frames.length, 1);
    });
  });
}

describe("the internal secret", () => {
  test("a token is compared in constant time over digests, not by string equality", async () => {
    const { constantTimeEqual } = await import("../src/lib/secret.ts");
    assert.equal(await constantTimeEqual("abc", "abc"), true);
    assert.equal(await constantTimeEqual("abc", "abd"), false);
    assert.equal(await constantTimeEqual("abc", "abcd"), false);
    assert.equal(await constantTimeEqual("", ""), true);
  });
});

describe("opening a shift's first row (D108)", () => {
  /** A store that records what it was asked to open, and refuses to be more than that. */
  function positions(opened: OpenShiftInput[] = []): NonNullable<InternalContext["positions"]> {
    return {
      async open(input) {
        opened.push(input);
      },
      async context() {
        return null;
      },
      async newest() {
        return null;
      },
      async write() {
        /* not exercised here */
      },
      async erase() {
        return { positions: 0, current: 0 };
      },
      async sweepStale() {
        return { riders: 0, positions: 0 };
      },
    };
  }

  const body = {
    riderId: "rider-a",
    shiftId: "shift-1",
    zoneId: "zone-1",
    vehicle: "MOTORBIKE",
    point: { lat: 24.894215, lon: 91.868912 },
  };

  test("a shift opens with a seed row whose deadline is the idle ceiling, twice", async () => {
    const backend = BACKENDS[0]!.make();
    const opened: OpenShiftInput[] = [];
    const response = await handleInternal(post("/internal/shift/open", body), {
      ...contextFor(backend),
      positions: positions(opened),
    });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { opened: boolean; shiftId: string; staleAfterMs: number } };
    assert.equal(parsed.data.opened, true);
    assert.equal(parsed.data.shiftId, "shift-1");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.state, "ONLINE", "a shift starts online, not on an order");
    assert.equal(opened[0]!.latE7, 248_942_150);
    assert.equal(opened[0]!.lonE7, 918_689_120);
    assert.equal(opened[0]!.accuracyM, 100, "a selfie's location must not look like a GPS fix");
    assert.equal(opened[0]!.staleAfterMs, parsed.data.staleAfterMs);
    assert.ok(opened[0]!.staleAfterMs > opened[0]!.nowMs, "a seed that is already stale is a marker that never appears");
  });

  test("without a live-position database the route says so rather than pretending", async () => {
    const response = await handleInternal(post("/internal/shift/open", body), contextFor(BACKENDS[0]!.make()));
    assert.equal(response.status, 501);
    const parsed = (await response.json()) as { error: { details?: { reason?: string } } };
    assert.equal(parsed.error.details?.reason, "live_positions_not_configured");
  });

  test("a body that is not a shift is refused before anything is written", async () => {
    const opened: OpenShiftInput[] = [];
    const response = await handleInternal(
      post("/internal/shift/open", { ...body, vehicle: "HOVERBOARD" }),
      { ...contextFor(BACKENDS[0]!.make()), positions: positions(opened) },
    );
    assert.equal(response.status, 422);
    assert.deepEqual(opened, []);
  });
});
