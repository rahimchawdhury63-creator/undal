/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The push module, built from the environment in one place.
 *
 * The same shape as `coordinatorFrom`: one function decides whether this deployment can send a push at
 * all, and says why it cannot rather than handing back an object that will fail later with a stack trace.
 * An unconfigured deployment is a deployment where an alarm falls back to the socket and the operator's
 * exception, and the operator should be able to read that from one log line.
 *
 * Nothing here constructs a token source eagerly beyond a closure: no RSA key is imported until the first
 * alarm of the isolate, and a Worker that never sends a push never pays for the import.
 */

import { createTokenSource, parseServiceAccount } from "./token.ts";
import { createPushSender } from "./sender.ts";
import type { PushSender } from "./sender.ts";

/** The bindings and secrets the push module reads. */
export interface FcmEnv {
  /** The service account, as JSON. A secret, held by this Worker and nobody else. */
  readonly FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  /** The HMAC key the Android client verifies a payload with. */
  readonly FCM_SIG_KEY?: string;
}

/** A configured sender, or the reason there is none. */
export type FcmBuilt =
  | {
      readonly ok: true;
      readonly sender: PushSender;
      /** The key payloads are signed with, so a caller cannot build one with a different key. */
      readonly signingKey: string;
      readonly projectId: string;
    }
  | { readonly ok: false; readonly reason: "fcm_not_configured" | "fcm_misconfigured"; readonly detail: string };

/**
 * Build the sender.
 *
 * Both secrets are required. A sender with a service account but no signing key would send payloads the
 * device cannot verify, which is worse than not sending: the device would discard the alarm and the
 * platform would record a successful delivery. That is the one failure mode this module refuses to have.
 */
export function fcmFrom(env: FcmEnv, deps: { fetch?: typeof fetch; now?: () => number } = {}): FcmBuilt {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const signingKey = env.FCM_SIG_KEY;
  if (raw === undefined || raw.trim() === "" || signingKey === undefined || signingKey.trim() === "") {
    return {
      ok: false,
      reason: "fcm_not_configured",
      detail: "FIREBASE_SERVICE_ACCOUNT_JSON and FCM_SIG_KEY are both required to send a push",
    };
  }
  let account;
  try {
    account = parseServiceAccount(raw);
  } catch (error) {
    return {
      ok: false,
      reason: "fcm_misconfigured",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const tokens = createTokenSource(account, {
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  return {
    ok: true,
    sender: createPushSender({ projectId: account.projectId, tokens, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) }),
    signingKey,
    projectId: account.projectId,
  };
}
