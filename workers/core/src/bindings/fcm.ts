/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Waking a sleeping phone (`15 §9`, D128).
 *
 * The SSE ring (D127) reaches a rider whose app is open. This reaches a rider whose phone is in their pocket — which
 * is most riders, most of the time — and it is deliberately tiny: one HTTP call, one message, no retry logic, because
 * the retry story belongs to the caller that knows how long an offer lives.
 *
 * **Data only, high priority.** The message carries `data` and no platform alert object: letting the OS draw the
 * alert means the full-screen intent never appears on several Android builds and a rider misses an order worth
 * ৳1 800 (`fcm-payload-purity`). `android.priority` is `high` so the message is delivered while the device is dozing —
 * a normal-priority data message can sit in the queue until the offer has expired, which is worse than not sending it.
 *
 * **A failure is a `Result`, never a throw.** The caller records the outcome against the token (`fcm_dispatches`) and
 * carries on with the rest of the wave: one dead token is not a reason to leave seven riders un-rung.
 */

import { fail, ok, type Failure, type Result } from "../lib/result.ts";

/** The Google endpoint, overridable so tests never leave the process. */
export const FCM_DEFAULT_ENDPOINT = "https://fcm.googleapis.com";

/** How long one send may take before it is abandoned. Short: an offer lives twenty-five seconds. */
export const FCM_TIMEOUT_MS = 1_500;

/** What a send needs beyond the credentials. */
export interface FcmConfig {
  readonly endpoint: string;
  readonly projectId: string;
  readonly accessToken: string;
  readonly timeoutMs?: number;
}

/** One message: a token and the data the app draws its own alarm from. */
export interface FcmMessage {
  readonly token: string;
  /** String-valued pairs, which is what the wire format requires of `data`. */
  readonly data: Readonly<Record<string, string>>;
}

/** What a send answers. */
export interface FcmSender {
  send(message: FcmMessage): Promise<Result<{ readonly messageId: string }>>;
}

/** Build the client. A new one per call site, for the reason `announce` does: the token is a binding, not state. */
export function createFcmClient(config: FcmConfig): FcmSender {
  const timeoutMs = config.timeoutMs ?? FCM_TIMEOUT_MS;
  return {
    async send(message) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${config.endpoint}/v1/projects/${config.projectId}/messages:send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token: message.token,
              data: message.data,
              android: { priority: "high" },
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          // The status is what tells an unregistered token (404) from a transient failure (5xx), and the caller logs
          // them differently, so it travels in the details rather than as a string in a message.
          return fail("SERVICE_DEGRADED", { details: { status: response.status, component: "fcm" } });
        }
        const body = (await response.json()) as { name?: unknown };
        if (typeof body.name !== "string" || body.name === "") {
          return fail("SERVICE_DEGRADED", { details: { component: "fcm", reason: "no_message_name" } });
        }
        return ok({ messageId: body.name });
      } catch (error) {
        return fail("DEPENDENCY_TIMEOUT", { details: { component: "fcm", error: String(error) } });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Whether a deployment can push at all. Absent credentials are a configuration state, not an error (D85's rule). */
export function fcmConfigured(env: {
  readonly FCM_PROJECT_ID?: string;
  readonly FCM_ACCESS_TOKEN?: string;
}): boolean {
  return (
    env.FCM_PROJECT_ID !== undefined &&
    env.FCM_PROJECT_ID !== "" &&
    env.FCM_ACCESS_TOKEN !== undefined &&
    env.FCM_ACCESS_TOKEN !== ""
  );
}

/**
 * The wire's `data` object, from a payload that carries numbers and booleans (`15 §9`, D131).
 *
 * FCM accepts only string values in `data`, and a number sent as a number is a message the runtime rejects
 * outright — so the conversion has to happen exactly once, at the boundary, rather than in every caller. `null`
 * and `undefined` are *dropped* rather than stringified: `String(undefined)` is the word `"undefined"`, which the
 * app would draw as a payout.
 */
export function fcmData(source: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    data[key] = String(value);
  }
  return data;
}

/**
 * The HTTP status behind a failed send, or `null` when there was no response at all.
 *
 * The distinction is the whole retry policy (`15 §8`, D131): a **404** is Google saying the token is gone and a
 * retry can only fail again; a **5xx** or a timeout is the network having a bad minute, and the same send a
 * second later often lands. A `null` means the call never reached an answer — an abort or a socket error — and
 * that is transient by definition.
 */
export function fcmStatus(failure: Failure): number | null {
  const status = failure.details?.["status"];
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}
