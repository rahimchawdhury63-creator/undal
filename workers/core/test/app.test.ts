/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createApp, matchRoute } from "../src/app.ts";
import { loadTokenKeys, signAccessToken, type TokenKeys } from "../src/auth/jwt.ts";
import { stubDb } from "../src/db/client.ts";
import { successResponse } from "../src/middleware/envelope.ts";
import type { RouteDefinition } from "../src/middleware/context.ts";
import { testEnv } from "./support.ts";

/**
 * The pipeline, from the outside: what a request meets before a handler runs.
 *
 * These assertions make the order of the middleware real — an unauthenticated request
 * never reaches a handler, a 501 names the path it refused, and a literal segment beats a
 * template, which is the difference between "latest" and an order code.
 */

const SUB = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const SID = "0193f2a1-7c3e-7890-abcd-ef01234567aa";
const DEV = "0193f2a1-7c3e-7890-abcd-ef01234567bb";

function bytesOf(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/gu, "");
  return Uint8Array.from([...hex.matchAll(/../gu)].map((match) => Number.parseInt(match[0], 16)));
}

function sessionRow(): Record<string, unknown> {
  return {
    id: bytesOf(SID),
    user_id: bytesOf(SUB),
    device_id: bytesOf(DEV),
    last_used_at: "2026-11-01 04:00:00.000000",
    revoked_at: null,
    status: "ACTIVE",
    actor_type: "CUSTOMER",
  };
}

/** A signing key and the secret the environment must carry in order to verify it. */
async function keyPair(): Promise<{ keys: TokenKeys; secret: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["generateKey"]>[0],
    true,
    ["sign", "verify"],
  );
  const { privateKey } = pair as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const secret = Buffer.from(JSON.stringify(jwk)).toString("base64url");
  return { keys: await loadTokenKeys(secret), secret };
}

const ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/ping",
    permission: "*",
    group: "CATALOGUE",
    run: async (ctx) => successResponse({ pong: true }, ctx.locale, ctx.requestId),
  },
  {
    method: "GET",
    path: "/v1/orders/{code}",
    permission: "*",
    group: "CATALOGUE",
    run: async (ctx, input) => successResponse({ code: input.params.code ?? null }, ctx.locale, ctx.requestId),
  },
  {
    method: "GET",
    path: "/v1/orders/latest",
    permission: "*",
    group: "CATALOGUE",
    run: async (ctx) => successResponse({ literal: true }, ctx.locale, ctx.requestId),
  },
];

const PROTECTED: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/admin/ledger",
    permission: "finance.ledger.read",
    group: "CATALOGUE",
    run: async (ctx) => successResponse({ seen: true }, ctx.locale, ctx.requestId),
  },
];

describe("undal-core pipeline", () => {
  test("/health answers with the envelope and the configured base URL", async () => {
    const app = createApp(ROUTES, { db: stubDb([]) });
    const response = await app(new Request("https://api.undal.app/health"), testEnv());
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; data: { worker: string; apiBase: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.worker, "undal-core");
    assert.equal(body.data.apiBase, "https://api.undal.app");
  });

  test("an unknown path answers 501 with the path it refused", async () => {
    const app = createApp(ROUTES, { db: stubDb([]) });
    const response = await app(new Request("https://api.undal.app/v1/nope"), testEnv());
    assert.equal(response.status, 501);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; messageBn: string; details: { path: string } };
    };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "NOT_IMPLEMENTED");
    assert.ok(body.error.messageBn.length > 0);
    assert.equal(body.error.details.path, "/v1/nope");
  });

  test("a literal segment wins over a template", () => {
    assert.deepEqual(matchRoute(ROUTES, "GET", "/v1/orders/latest")?.params, {});
    assert.equal(matchRoute(ROUTES, "GET", "/v1/orders/UND-1")?.params.code, "UND-1");
    assert.equal(matchRoute(ROUTES, "POST", "/v1/orders/UND-1"), null);
  });

  test("a protected route without a token is refused before its handler runs", async () => {
    let called = false;
    const routes: RouteDefinition[] = [
      {
        method: "GET",
        path: "/v1/admin/ledger",
        permission: "finance.ledger.read",
        group: "CATALOGUE",
        run: async (ctx) => {
          called = true;
          return successResponse({}, ctx.locale, ctx.requestId);
        },
      },
    ];
    const app = createApp(routes, { db: stubDb([]) });
    const response = await app(new Request("https://api.undal.app/v1/admin/ledger"), testEnv());
    assert.equal(response.status, 401);
    assert.equal(called, false);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "AUTH_TOKEN_MISSING");
  });

  test("an authenticated customer is refused an admin permission with 403", async () => {
    const { keys, secret } = await keyPair();
    const token = await signAccessToken(
      { sub: SUB, act: "CUSTOMER", role: null, scope: null, did: DEV, sid: SID, amr: null, imp: false },
      keys,
    );
    const app = createApp(PROTECTED, { db: stubDb([{ match: /FROM `sessions` s JOIN `users`/u, rows: [sessionRow()] }]) });
    const response = await app(
      new Request("https://api.undal.app/v1/admin/ledger", { headers: { authorization: `Bearer ${token}` } }),
      testEnv({ JWT_SIGNING_KEY: secret }),
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "PERM_DENIED");
  });

  test("a tampered token is refused as invalid, not as an outage", async () => {
    const { keys, secret } = await keyPair();
    const token = await signAccessToken(
      { sub: SUB, act: "ADMIN", role: "FINANCE", scope: null, did: DEV, sid: SID, amr: null, imp: false },
      keys,
    );
    const tampered = `${token.slice(0, -2)}xx`;
    const app = createApp(PROTECTED, { db: stubDb([]) });
    const response = await app(
      new Request("https://api.undal.app/v1/admin/ledger", { headers: { authorization: `Bearer ${tampered}` } }),
      testEnv({ JWT_SIGNING_KEY: secret }),
    );
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "AUTH_TOKEN_INVALID");
  });

  test("every failure carries the request id and refuses caching", async () => {
    const app = createApp(ROUTES, { db: stubDb([]) });
    const response = await app(
      new Request("https://api.undal.app/v1/nope", { headers: { "X-Undal-Request-Id": SUB } }),
      testEnv(),
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("X-Undal-Request-Id"), SUB);
  });
});
