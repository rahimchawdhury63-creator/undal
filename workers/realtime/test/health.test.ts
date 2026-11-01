/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import worker from "../src/index.ts";

const env = {
  PUBLIC_API_BASE: "https://api.undal.app",
  PRESENCE_BACKEND: "sql",
  ORDER_ROOM: {} as DurableObjectNamespace,
};

describe("undal-realtime", () => {
  test("/health names the live presence backend", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/health"), env);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { presenceBackend: string } };
    assert.equal(body.data.presenceBackend, "sql");
  });

  test("anything else is a JSON 501, never HTML", async () => {
    const response = await worker.fetch(new Request("https://rt.undal.app/v1/stream"), env);
    assert.equal(response.status, 501);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  });
});
