/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import worker from "../src/index.ts";

const env = {
  PUBLIC_API_BASE: "https://api.undal.app",
  COORDINATION_MODE: "sql",
  ORDER_ROOM: {} as DurableObjectNamespace,
};

describe("undal-realtime", () => {
  test("/health names the live coordination backend", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), env);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { coordinationMode: string } };
    assert.equal(body.data.coordinationMode, "sql");
  });

  test("an unset mode is the free path, not a failure", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), {
      PUBLIC_API_BASE: env.PUBLIC_API_BASE,
      ORDER_ROOM: env.ORDER_ROOM,
    });
    const body = (await response.json()) as { data: { coordinationMode: string } };
    assert.equal(response.status, 200);
    assert.equal(body.data.coordinationMode, "sql");
  });

  test("a mode the Worker does not know is refused at the door", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), {
      ...env,
      COORDINATION_MODE: "dynamo",
    });
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "INTERNAL");
  });

  test("the paid backend is a mode, not the default", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), {
      ...env,
      COORDINATION_MODE: "durable-object",
    });
    const body = (await response.json()) as { data: { coordinationMode: string } };
    assert.equal(body.data.coordinationMode, "durable-object");
  });

  test("anything else is a JSON 501, never HTML", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/v1/stream"), env);
    assert.equal(response.status, 501);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  });
});
