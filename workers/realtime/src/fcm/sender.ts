/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The FCM v1 send (`15 §2.3`, D83).
 *
 * Only `undal-realtime` calls FCM. That is not a preference: it is what makes the payload audit tractable,
 * because there is exactly one module whose outgoing shape has to be checked, and it is why core and brain
 * have no Firebase secret at all.
 *
 * The sender's job is to turn FCM's answer into something the caller can act on, and the taxonomy is the
 * point. `UNREGISTERED` and `NOT_FOUND` mean the token is dead and must be deleted — a vendor with no
 * tokens left is an exception, because they are now unreachable and do not know it. `SENDER_ID_MISMATCH`
 * means the build and the project disagree, which is a configuration bug a retry will never fix.
 * `QUOTA_EXCEEDED` is a backoff. Everything else is transient and worth exactly three attempts at
 * 250/750/2000 ms, because the alarm it carries is measured in seconds.
 */

import type { FcmMessage } from "./payload.ts";
import type { TokenSource } from "./token.ts";

/** The only host this Worker may POST a push to. */
export const FCM_HOST = "https://fcm.googleapis.com";

/** How many times one message is attempted. */
export const SEND_ATTEMPTS = 3;

/** The wait before each retry, in order. The first attempt waits nothing. */
export const RETRY_BACKOFF_MS: readonly number[] = [250, 750, 2_000];

/** Why a send did not produce a message id. Every one of these is a decision somewhere else. */
export type SendFailure =
  | "UNREGISTERED"
  | "SENDER_ID_MISMATCH"
  | "QUOTA_EXCEEDED"
  | "REJECTED"
  | "TRANSIENT";

/** The outcome of one send. */
export type SendOutcome =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly reason: SendFailure; readonly detail: string };

/** What the sender is given. */
export interface PushSenderDeps {
  readonly projectId: string;
  readonly tokens: TokenSource;
  readonly fetch?: typeof fetch;
  /** Injected so a test does not wait three seconds to prove a retry happened. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The host, overridable only so a test can point at a stub. */
  readonly host?: string;
}

/** The sender. */
export interface PushSender {
  send(message: FcmMessage): Promise<SendOutcome>;
}

/** The endpoint for a project. Built from the constant host, never from a caller-supplied URL. */
export function sendEndpoint(projectId: string, host: string = FCM_HOST): string {
  return `${host}/v1/projects/${projectId}/messages:send`;
}

/** FCM's error body, as far as this module reads it. */
interface FcmErrorBody {
  readonly error?: {
    readonly status?: string;
    readonly message?: string;
    readonly details?: readonly { readonly errorCode?: string }[];
  };
}

/**
 * Classify a failed response.
 *
 * The body is read as text first and parsed second: a 500 from the edge is HTML, and a JSON parse that
 * throws would surface as a transient error with no detail at all. `errorCode` in `details` is the precise
 * one; `status` is the fallback because Google sometimes omits the detail list.
 */
function classify(status: number, raw: string): { reason: SendFailure; retry: boolean } {
  let body: FcmErrorBody = {};
  try {
    body = JSON.parse(raw) as FcmErrorBody;
  } catch {
    body = {};
  }
  const codes = (body.error?.details ?? []).map((detail) => detail.errorCode ?? "");
  const named = codes.find((code) => code !== "");
  if (named === "UNREGISTERED" || named === "NOT_FOUND" || body.error?.status === "NOT_FOUND") {
    return { reason: "UNREGISTERED", retry: false };
  }
  if (named === "SENDER_ID_MISMATCH") return { reason: "SENDER_ID_MISMATCH", retry: false };
  if (named === "QUOTA_EXCEEDED" || status === 429) return { reason: "QUOTA_EXCEEDED", retry: true };
  if (status >= 500) return { reason: "TRANSIENT", retry: true };
  return { reason: "REJECTED", retry: false };
}

/**
 * Build the sender.
 *
 * `sleep` is injected rather than `setTimeout`ed inline so a test of the retry ladder runs in milliseconds;
 * in production it is the runtime's timer, and the waits are the numbers in `15 §2.3`.
 */
export function createPushSender(deps: PushSenderDeps): PushSender {
  const transport = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const endpoint = sendEndpoint(deps.projectId, deps.host ?? FCM_HOST);

  return {
    async send(message: FcmMessage): Promise<SendOutcome> {
      let last: SendOutcome = { ok: false, reason: "TRANSIENT", detail: "no attempt was made" };
      for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 2_000;
          await sleep(wait);
        }
        let response: Response;
        try {
          const token = await deps.tokens.get();
          response = await transport(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ message }),
          });
        } catch (error) {
          // A transport failure is transient by definition: FCM was not reached, so nothing was decided.
          last = { ok: false, reason: "TRANSIENT", detail: error instanceof Error ? error.message : String(error) };
          continue;
        }
        if (response.ok) {
          const body = (await response.json()) as { name?: unknown };
          const name = typeof body.name === "string" ? body.name : "";
          return { ok: true, messageId: name };
        }
        const raw = await response.text();
        const verdict = classify(response.status, raw);
        last = { ok: false, reason: verdict.reason, detail: `${response.status} ${raw.slice(0, 200)}` };
        if (!verdict.retry) return last;
      }
      return last;
    },
  };
}
