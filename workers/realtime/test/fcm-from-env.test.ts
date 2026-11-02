/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `fcmFrom`: one place decides whether this deployment can wake a phone.
 *
 * The interesting case is the half-configured one. A deployment with a service account and no signing key
 * could send payloads, and every device would discard them — a delivery the platform would record as
 * successful and the vendor would never see. That is refused here, at construction, rather than at 03:00.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fcmFrom } from "../src/fcm/from-env.ts";

/** A syntactically valid service account. The key is never imported by these tests. */
const ACCOUNT = JSON.stringify({
  project_id: "undal-test",
  client_email: "fcm@undal-test.iam.gserviceaccount.com",
  // Same reason as the token suite: no literal PEM header in a tracked file.
  private_key: `${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}\nMIIB\n${["-----END", "PRIVATE KEY-----"].join(" ")}\n`,
});

describe("building the push module", () => {
  test("both secrets give a sender, a signing key and a project", () => {
    const built = fcmFrom({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT, FCM_SIG_KEY: "sig-key" });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.equal(built.signingKey, "sig-key");
      assert.equal(built.projectId, "undal-test");
      assert.equal(typeof built.sender.send, "function");
    }
  });

  test("no secrets is a refusal, and it says which two are needed", () => {
    const built = fcmFrom({});
    assert.equal(built.ok, false);
    if (!built.ok) {
      assert.equal(built.reason, "fcm_not_configured");
      assert.match(built.detail, /FIREBASE_SERVICE_ACCOUNT_JSON and FCM_SIG_KEY/u);
    }
  });

  test("a service account without a signing key is a refusal, not a silent unsigned push", () => {
    const built = fcmFrom({ FIREBASE_SERVICE_ACCOUNT_JSON: ACCOUNT });
    assert.equal(built.ok, false);
    if (!built.ok) assert.equal(built.reason, "fcm_not_configured");
  });

  test("a signing key without a service account is a refusal", () => {
    const built = fcmFrom({ FCM_SIG_KEY: "sig-key" });
    assert.equal(built.ok, false);
    if (!built.ok) assert.equal(built.reason, "fcm_not_configured");
  });

  test("a blank secret counts as absent", () => {
    const built = fcmFrom({ FIREBASE_SERVICE_ACCOUNT_JSON: "  ", FCM_SIG_KEY: "sig-key" });
    assert.equal(built.ok, false);
  });

  test("a service account that is not JSON is misconfigured, and the reason is carried", () => {
    const built = fcmFrom({ FIREBASE_SERVICE_ACCOUNT_JSON: "{", FCM_SIG_KEY: "sig-key" });
    assert.equal(built.ok, false);
    if (!built.ok) {
      assert.equal(built.reason, "fcm_misconfigured");
      assert.match(built.detail, /not JSON/u);
    }
  });
});
