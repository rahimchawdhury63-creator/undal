/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRouter, json } from "../src/router.ts";

const env = { PUBLIC_API_BASE: "https://api.undal.app", LOG_LEVEL: "info" };

describe("undal-core dispatcher", () => {
  test("/health answers with the envelope and the configured base URL", async () => {
    const route = createRouter([], env);
    const response = await route(new Request("https://api.undal.app/health"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; data: { worker: string; apiBase: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.worker, "undal-core");
    assert.equal(body.data.apiBase, "https://api.undal.app");
  });

  test("an unknown path answers JSON, not HTML", async () => {
    const route = createRouter([], env);
    const response = await route(new Request("https://api.undal.app/v1/nope"));
    assert.equal(response.status, 501);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    const body = (await response.json()) as { ok: boolean; error: { code: string; messageBn: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "NOT_IMPLEMENTED");
    assert.ok(body.error.messageBn.length > 0);
  });

  test("every response is uncacheable and carries the request id", async () => {
    const response = await json({ ok: true }, 200, "req-9");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("X-Undal-Request-Id"), "req-9");
  });

  test("a registered route is dispatched and stamped", async () => {
    const route = createRouter(
      [
        {
          method: "GET",
          path: "/v1/ping",
          handler: async () => new Response("{}", { status: 200 }),
        },
      ],
      env,
    );
    const response = await route(new Request("https://api.undal.app/v1/ping"));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("X-Undal-Request-Id"));
  });
});
