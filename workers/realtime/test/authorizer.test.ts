/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The production channel authorizer: five kinds, five questions.
 *
 * The matrix is the point. Each channel kind is asserted for each actor type, and both halves matter — a
 * rider who may watch their own channel and a rider who may not watch a vendor's — because an authorizer
 * that allows too little is an outage and one that allows too much is a data leak that looks like an
 * outage nobody reported.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { channelAuthorizer } from "../src/routes/authorizer.ts";
import { handleStream } from "../src/routes/stream.ts";
import type { ChannelAuthorizer, StreamPrincipal } from "../src/routes/stream.ts";
import type { OrderViewer, WatchQuestion } from "../src/authority/order-viewer.ts";
import { NO_ORDERS } from "../src/authority/order-viewer.ts";
import type { Channel } from "../src/sse/channels.ts";
import { BACKENDS } from "./support/backends.ts";

const RIDER: StreamPrincipal = { actorId: "rider-a", actorType: "RIDER" };
const VENDOR: StreamPrincipal = { actorId: "vendor-a", actorType: "VENDOR_OWNER" };
const CUSTOMER: StreamPrincipal = { actorId: "cust-a", actorType: "CUSTOMER" };
const ADMIN: StreamPrincipal = { actorId: "admin-a", actorType: "ADMIN" };
const SCOPED_ADMIN: StreamPrincipal = { actorId: "admin-a", actorType: "ADMIN", zoneIds: ["sylhet"] };

const channel = (kind: Channel["kind"], id: string): Channel => ({ kind, id });

/** A viewer that records every question and answers from a set of allowed codes. */
function viewerAllowing(...codes: string[]): OrderViewer & { readonly asked: WatchQuestion[] } {
  const asked: WatchQuestion[] = [];
  return {
    asked,
    async mayWatch(question: WatchQuestion): Promise<boolean> {
      asked.push(question);
      return codes.includes(question.orderId);
    },
  };
}

describe("identity channels", () => {
  test("a rider may watch their own channel and nobody else's", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(RIDER, channel("rider", "rider-a")), true);
    assert.equal(await authorizer.allows(RIDER, channel("rider", "rider-b")), false);
  });

  test("a rider may not watch their own id under another kind", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(RIDER, channel("vendor", "rider-a")), false);
    assert.equal(await authorizer.allows(RIDER, channel("admin", "rider-a")), false);
  });

  test("a vendor owner and an admin each own their kind", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(VENDOR, channel("vendor", "vendor-a")), true);
    assert.equal(await authorizer.allows(VENDOR, channel("rider", "vendor-a")), false);
    assert.equal(await authorizer.allows(ADMIN, channel("admin", "admin-a")), true);
    assert.equal(await authorizer.allows(ADMIN, channel("admin", "admin-b")), false);
  });

  test("a customer has no identity channel at all", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(CUSTOMER, channel("rider", "cust-a")), false);
    assert.equal(await authorizer.allows(CUSTOMER, channel("vendor", "cust-a")), false);
    assert.equal(await authorizer.allows(CUSTOMER, channel("admin", "cust-a")), false);
  });
});

describe("zone channels", () => {
  test("only an admin may watch a zone", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(ADMIN, channel("zone", "sylhet")), true);
    assert.equal(await authorizer.allows(RIDER, channel("zone", "sylhet")), false);
    assert.equal(await authorizer.allows(VENDOR, channel("zone", "sylhet")), false);
    assert.equal(await authorizer.allows(CUSTOMER, channel("zone", "sylhet")), false);
  });

  test("a scoped admin is limited to the zones the token names", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(SCOPED_ADMIN, channel("zone", "sylhet")), true);
    assert.equal(await authorizer.allows(SCOPED_ADMIN, channel("zone", "dhaka")), false);
  });
});

describe("order channels", () => {
  test("a customer is allowed an order core vouches for", async () => {
    const viewer = viewerAllowing("UND-7K2M9QX4");
    const authorizer = channelAuthorizer(viewer);
    assert.equal(await authorizer.allows(CUSTOMER, channel("order", "UND-7K2M9QX4")), true);
    assert.deepEqual(viewer.asked, [{ actorId: "cust-a", actorType: "CUSTOMER", orderId: "UND-7K2M9QX4" }]);
  });

  test("a caller core does not vouch for is refused", async () => {
    const authorizer = channelAuthorizer(viewerAllowing());
    assert.equal(await authorizer.allows(CUSTOMER, channel("order", "UND-7K2M9QX4")), false);
    assert.equal(await authorizer.allows(RIDER, channel("order", "UND-7K2M9QX4")), false);
    assert.equal(await authorizer.allows(VENDOR, channel("order", "UND-7K2M9QX4")), false);
  });

  test("a deployment wired to nobody refuses order channels without asking", async () => {
    const authorizer = channelAuthorizer(NO_ORDERS);
    assert.equal(await authorizer.allows(CUSTOMER, channel("order", "UND-7K2M9QX4")), false);
  });

  test("an admin is allowed without a hop", async () => {
    const viewer = viewerAllowing();
    const authorizer = channelAuthorizer(viewer);
    assert.equal(await authorizer.allows(ADMIN, channel("order", "UND-7K2M9QX4")), true);
    assert.deepEqual(viewer.asked, []);
  });
});

describe("the stream route under the production authorizer", () => {
  const riderSelf = "channels=rider:self";

  for (const backend of BACKENDS) {
    test(`an allowed order channel starts a stream (${backend.name})`, async () => {
      const { coordinator } = backend.make();
      const authorizer: ChannelAuthorizer = channelAuthorizer(viewerAllowing("UND-7K2M9QX4"));
      const response = await handleStream(
        new Request(`https://rt.undal.app/rt/stream?channels=order:UND-7K2M9QX4`, {
          headers: { authorization: "Bearer x" },
        }),
        { coordinator, principal: CUSTOMER, authorizer },
      );
      assert.equal(response.status, 200);
      await response.body?.cancel();
    });

    test(`a denied order channel is 403 (${backend.name})`, async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(
        new Request(`https://rt.undal.app/rt/stream?channels=order:UND-7K2M9QX4`),
        { coordinator, principal: CUSTOMER, authorizer: channelAuthorizer(viewerAllowing()) },
      );
      assert.equal(response.status, 403);
    });

    test(`a rider's own channel still works without an order viewer (${backend.name})`, async () => {
      const { coordinator } = backend.make();
      const response = await handleStream(new Request(`https://rt.undal.app/rt/stream?${riderSelf}`), {
        coordinator,
        principal: RIDER,
        authorizer: channelAuthorizer(NO_ORDERS),
      });
      assert.equal(response.status, 200);
      await response.body?.cancel();
    });
  }
});
