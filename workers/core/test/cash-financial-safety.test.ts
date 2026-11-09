/* Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { loadTokenKeys, signAccessToken } from "../src/auth/jwt.ts";
import { stubDb } from "../src/db/client.ts";
import type { Ctx, Env, RouteDefinition } from "../src/middleware/context.ts";
import { bodyHashOf } from "../src/middleware/idempotency.ts";
import { CASH_REVIEW_ROUTES } from "../src/routes/cash-review.ts";
import { CASH_WRITE_OFF_ROUTES } from "../src/routes/cash-write-off.ts";
import { FakeKv, testEnv } from "./support.ts";

const USER = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const SESSION = "0193f2a1-7c3e-7890-abcd-ef01234567aa";
const DEVICE = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
const ID = "0193f2a1-7c3e-7890-abcd-ef01234567cc";
const APPROVE = "/v1/finance/cash/settlements/{id}/approve";
const WRITE_OFF = "/v1/finance/cash/riders/{id}/write-off";
const routes = [...CASH_REVIEW_ROUTES, ...CASH_WRITE_OFF_ROUTES];
const bytes = (uuid: string): Uint8Array => Uint8Array.from(uuid.replace(/-/gu, "").match(/../gu) ?? [], (part) => parseInt(part, 16));

function route(path: string): RouteDefinition {
  const found = routes.find((candidate) => candidate.path === path);
  assert.ok(found);
  return found;
}

function directCtx(db: ReturnType<typeof stubDb>, env: Env): Ctx {
  const url = new URL(`https://api.undal.test/v1/finance/cash/riders/${ID}/write-off`);
  return {
    env, db, url, request: new Request(url), requestId: ID, ip: "1.2.3.4", userAgent: "test", keys: [],
    principal: { userId: USER, actorType: "ADMIN", role: "SUPER_ADMIN", zoneScope: null, sessionId: SESSION,
      deviceId: DEVICE, stepUpAtMs: Date.now(), impersonating: false },
    locale: "en", startedAtMs: 0, waitUntil: () => undefined,
  } as Ctx;
}

test("both cash financial routes are marked for the pre-replay gate", () => {
  assert.equal(route(APPROVE).unsafeCashFinancialWrite, true);
  assert.equal(route(WRITE_OFF).unsafeCashFinancialWrite, true);
  assert.equal(route("/v1/finance/cash/settlements/{id}/reject").unsafeCashFinancialWrite, undefined);
  assert.equal(route("/v1/finance/cash/settlements/{id}/escalate").unsafeCashFinancialWrite, undefined);
});

test("production, preview, unknown and absent opt-in fail closed before cash queries", async () => {
  const settings: Partial<Env>[] = [
    { ENVIRONMENT: "production", ALLOW_UNSAFE_CASH_WRITES: "true" },
    { ENVIRONMENT: "preview", ALLOW_UNSAFE_CASH_WRITES: "true" },
    { ENVIRONMENT: "staging" }, { ENVIRONMENT: "test" },
    { ENVIRONMENT: "test", ALLOW_UNSAFE_CASH_WRITES: "TRUE" },
    { ENVIRONMENT: undefined as unknown as Env["ENVIRONMENT"], ALLOW_UNSAFE_CASH_WRITES: "true" },
  ];
  for (const config of settings) {
    for (const path of [APPROVE, WRITE_OFF]) {
      const db = stubDb([]);
      const response = await route(path).run(directCtx(db, testEnv(config)), { params: { id: ID }, body: {}, reason: null });
      assert.equal(response.status, 503, `${path}: ${JSON.stringify(config)}`);
      const body = await response.json() as { error: { code: string; details: { component: string } } };
      assert.equal(body.error.code, "SERVICE_DEGRADED");
      assert.equal(body.error.details.component, "cash_financial_writes");
      assert.equal(db.calls.length, 0);
    }
  }
});

test("explicit opt-in works only in staging or test, on isolated data", async () => {
  for (const environment of ["test", "staging"] as const) {
    for (const path of [APPROVE, WRITE_OFF]) {
      const db = stubDb([]);
      const response = await route(path).run(
        directCtx(db, testEnv({ ENVIRONMENT: environment, ALLOW_UNSAFE_CASH_WRITES: "true" })),
        { params: { id: "bad-id" }, body: {}, reason: null },
      );
      assert.equal(response.status, 422, "reached normal validation, not the safety refusal");
      assert.equal(db.calls.length, 0);
    }
  }
});

test("authenticated production requests cannot replay a cached financial success", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" } as unknown as Parameters<SubtleCrypto["generateKey"]>[0], true, ["sign", "verify"]) as CryptoKeyPair;
  const secret = Buffer.from(JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey))).toString("base64url");
  const keys = await loadTokenKeys(secret);
  const token = await signAccessToken({ sub: USER, act: "ADMIN", role: "SUPER_ADMIN", scope: null, did: DEVICE,
    sid: SESSION, amr: Date.now(), imp: false }, keys);
  const session = { id: bytes(SESSION), user_id: bytes(USER), device_id: bytes(DEVICE),
    last_used_at: new Date().toISOString().replace("T", " ").replace("Z", "000"),
    revoked_at: null, status: "ACTIVE", actor_type: "ADMIN" };
  const db = stubDb([{ match: /FROM `sessions` s JOIN `users`/u, rows: [session] }]);
  const kv = new FakeKv();
  const scenarios = [
    { path: WRITE_OFF, url: `https://api.undal.test/v1/finance/cash/riders/${ID}/write-off`, body: { amountPaisa: 100, reason: "SYSTEM_RECONCILIATION" } },
    { path: APPROVE, url: `https://api.undal.test/v1/finance/cash/settlements/${ID}/approve`, body: {} },
  ];
  for (const scenario of scenarios) {
    await kv.put(`idem:${USER}:${scenario.path}:old-key`, JSON.stringify({ state: "DONE", bodyHash: await bodyHashOf(scenario.body), status: 200, body: "{\"old\":true}" }));
  }
  const env = testEnv({ ENVIRONMENT: "production", ALLOW_UNSAFE_CASH_WRITES: "true", JWT_SIGNING_KEY: secret, RATE_LIMIT: kv as unknown as Env["RATE_LIMIT"] });
  const app = createApp(routes, { db });
  for (const scenario of scenarios) {
    const request = new Request(scenario.url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": "old-key" },
      body: JSON.stringify(scenario.body),
    });
    const response = await app(request, env);
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "SERVICE_DEGRADED");
    assert.equal(response.headers.get("X-Undal-Idempotent-Replay"), null);
  }
  assert.equal(db.calls.length, 2, "authentication only; no cash query");
  assert.equal(kv.entries.size, 2, "blocked requests neither overwrite nor create idempotency records");
});


test("an unauthenticated request is refused before the safety gate", async () => {
  const db = stubDb([]);
  const app = createApp(routes, { db });
  const request = new Request(`https://api.undal.test/v1/finance/cash/riders/${ID}/write-off`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  const response = await app(request, testEnv({ ENVIRONMENT: "production" }));
  assert.equal(response.status, 401);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "AUTH_TOKEN_MISSING");
  assert.equal(db.calls.length, 0);
});

test("rejection and escalation retain their normal validation when the gate is closed", async () => {
  for (const path of ["/v1/finance/cash/settlements/{id}/reject", "/v1/finance/cash/settlements/{id}/escalate"]) {
    const db = stubDb([]);
    const response = await route(path).run(directCtx(db, testEnv({ ENVIRONMENT: "production" })), { params: { id: "bad" }, body: {}, reason: null });
    assert.equal(response.status, 422);
    assert.equal(db.calls.length, 0);
  }
});
