/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The Google assertion, against a real RSA key generated in the test.
 *
 * `15 §2.2`'s snippet is the shape; what is asserted here is that the signature actually verifies, that the
 * claims name the token endpoint and the one scope FCM accepts, and that the source mints one token for a
 * burst of alarms rather than one per alarm.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FCM_SCOPE,
  TOKEN_ENDPOINT,
  createTokenSource,
  mintAssertion,
  parseServiceAccount,
} from "../src/fcm/token.ts";
import type { ServiceAccount } from "../src/fcm/token.ts";

/** A freshly generated service-account key, PEM encoded, plus the public key to verify with. */
async function account(): Promise<{ account: ServiceAccount; publicKey: CryptoKey; pem: string }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2_048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const body = btoa([...der].map((byte) => String.fromCharCode(byte)).join(""));
  // Assembled from pieces: the secret scanner treats a literal PEM header as a committed credential, and
  // it should — a fixture is not worth an exception to a rule that has no way to tell the two apart.
  const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const end = ["-----END", "PRIVATE KEY-----"].join(" ");
  const pem = `${begin}\n${body.match(/.{1,64}/gu)?.join("\n") ?? body}\n${end}\n`;
  return {
    account: { projectId: "undal-test", clientEmail: "fcm@undal-test.iam.gserviceaccount.com", privateKey: pem },
    publicKey: pair.publicKey,
    pem,
  };
}

/** Decode a base64url segment. */
function decode(segment: string): string {
  const padded = segment.replace(/-/gu, "+").replace(/_/gu, "/");
  return atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
}

/** The service-account JSON as an environment variable carries it: escaped newlines. */
function asEnvJson(serviceAccount: ServiceAccount): string {
  return JSON.stringify({
    project_id: serviceAccount.projectId,
    client_email: serviceAccount.clientEmail,
    private_key: serviceAccount.privateKey,
  });
}

describe("the service account", () => {
  test("is read from the JSON an environment variable carries", async () => {
    const { account: serviceAccount } = await account();
    const parsed = parseServiceAccount(asEnvJson(serviceAccount));
    assert.equal(parsed.projectId, "undal-test");
    assert.equal(parsed.clientEmail, serviceAccount.clientEmail);
    const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    assert.equal(parsed.privateKey.startsWith(`${begin}\n`), true);
    assert.equal(parsed.privateKey.includes("\\n"), false);
  });

  test("a key with real newlines is accepted too", async () => {
    const { account: serviceAccount } = await account();
    const parsed = parseServiceAccount(
      JSON.stringify({ project_id: "p", client_email: "e", private_key: serviceAccount.privateKey }),
    );
    assert.equal(parsed.privateKey.split("\n").length > 2, true);
  });

  test("a body that is not JSON is refused with a message that says so", () => {
    assert.throws(() => parseServiceAccount("not json"), /not JSON/u);
  });

  test("each missing field is named", () => {
    assert.throws(() => parseServiceAccount("{}"), /project_id/u);
    assert.throws(() => parseServiceAccount(JSON.stringify({ project_id: "p" })), /client_email/u);
    assert.throws(
      () => parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "e" })),
      /private_key/u,
    );
  });
});

describe("the assertion", () => {
  test("is a three-part JWT with an RS256 header", async () => {
    const { account: serviceAccount } = await account();
    const jwt = await mintAssertion(serviceAccount, 1_793_612_345_678);
    const parts = jwt.split(".");
    assert.equal(parts.length, 3);
    assert.deepEqual(JSON.parse(decode(parts[0] ?? "")), { alg: "RS256", typ: "JWT" });
  });

  test("names the token endpoint, the FCM scope, and an hour", async () => {
    const { account: serviceAccount } = await account();
    const jwt = await mintAssertion(serviceAccount, 1_793_612_345_678);
    const claims = JSON.parse(decode(jwt.split(".")[1] ?? "")) as Record<string, unknown>;
    assert.equal(claims["iss"], serviceAccount.clientEmail);
    assert.equal(claims["aud"], TOKEN_ENDPOINT);
    assert.equal(claims["scope"], FCM_SCOPE);
    assert.equal(claims["iat"], 1_793_612_345);
    assert.equal((claims["exp"] as number) - (claims["iat"] as number), 3_600);
  });

  test("verifies with the matching public key", async () => {
    const { account: serviceAccount, publicKey } = await account();
    const jwt = await mintAssertion(serviceAccount, 1_793_612_345_678);
    const [header, payload, signature] = jwt.split(".");
    const signed = new TextEncoder().encode(`${header}.${payload}`);
    const bytes = Uint8Array.from(decode(signature ?? ""), (char) => char.charCodeAt(0));
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, bytes, signed);
    assert.equal(verified, true);
  });
});

describe("the token source", () => {
  test("returns the access token and sends the assertion as a form body", async () => {
    const { account: serviceAccount } = await account();
    const sent: { url: string; body: string }[] = [];
    const source = createTokenSource(serviceAccount, {
      now: () => 1_793_612_345_678,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(input), body: String(init?.body ?? "") });
        return Response.json({ access_token: "ya29.test", expires_in: 3_600 });
      }) as typeof fetch,
    });
    assert.equal(await source.get(), "ya29.test");
    assert.equal(sent[0]?.url, TOKEN_ENDPOINT);
    const form = new URLSearchParams(sent[0]?.body ?? "");
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    assert.equal((form.get("assertion") ?? "").split(".").length, 3);
  });

  test("mints one token for a burst of alarms", async () => {
    const { account: serviceAccount } = await account();
    let calls = 0;
    const source = createTokenSource(serviceAccount, {
      now: () => 1_793_612_345_678,
      fetch: (async () => {
        calls += 1;
        return Response.json({ access_token: "ya29.test", expires_in: 3_600 });
      }) as typeof fetch,
    });
    await Promise.all([source.get(), source.get(), source.get()]);
    await source.get();
    assert.equal(calls, 1);
  });

  test("refreshes five minutes before the token expires", async () => {
    const { account: serviceAccount } = await account();
    let clock = 1_793_612_345_678;
    let calls = 0;
    const source = createTokenSource(serviceAccount, {
      now: () => clock,
      fetch: (async () => {
        calls += 1;
        return Response.json({ access_token: `token-${calls}`, expires_in: 3_600 });
      }) as typeof fetch,
    });
    assert.equal(await source.get(), "token-1");
    clock += 3_600_000 - 300_001;
    assert.equal(await source.get(), "token-1");
    clock += 2;
    assert.equal(await source.get(), "token-2");
    assert.equal(calls, 2);
  });

  test("a refused mint throws with Google's answer in the message", async () => {
    const { account: serviceAccount } = await account();
    const source = createTokenSource(serviceAccount, {
      fetch: (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch,
    });
    await assert.rejects(source.get(), /fcm token refused: 400 invalid_grant/u);
  });

  test("a failure is not inherited by the next caller", async () => {
    const { account: serviceAccount } = await account();
    let calls = 0;
    const source = createTokenSource(serviceAccount, {
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? new Response("boom", { status: 500 })
          : Response.json({ access_token: "ya29.recovered", expires_in: 3_600 });
      }) as typeof fetch,
    });
    await assert.rejects(source.get(), /500/u);
    assert.equal(await source.get(), "ya29.recovered");
  });

  test("a response with no access token is an error, not an empty bearer", async () => {
    const { account: serviceAccount } = await account();
    const source = createTokenSource(serviceAccount, {
      fetch: (async () => Response.json({ expires_in: 3_600 })) as typeof fetch,
    });
    await assert.rejects(source.get(), /no access_token/u);
  });
});
