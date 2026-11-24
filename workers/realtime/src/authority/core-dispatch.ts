/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Reporting a send to the Worker that owns the database (D86).
 *
 * The ladder records every push in its own Durable Object because that record is what it re-arms from. This
 * client is the other half: `15 §8` wants the platform to know, per device, whether alarms arrive, and only
 * `undal-core` may write TiDB. So the room reports the batch and moves on.
 *
 * The report is best-effort in the literal sense: a failure is counted and swallowed. A delivery log that
 * could fail an alarm would be a log that silences the thing it is auditing — and the alarm is the reason
 * the vendor gets paid.
 */

/** Where core records the log. */
export const DISPATCH_PATH = "/internal/fcm/dispatches";

/** How long the report waits before it is abandoned. */
export const CORE_DISPATCH_TIMEOUT_MS = 900;

/** One send, as the ladder knows it. */
export interface ReportedDispatch {
  readonly orderCode: string;
  readonly token: string;
  readonly attempt: number;
  readonly outcome: string;
  readonly messageId: string | null;
  readonly sentAtMs: number;
}

/** The port a room reports through. */
export interface DispatchRecorder {
  record(dispatches: readonly ReportedDispatch[]): Promise<boolean>;
}

/** What `createCoreDispatchRecorder` may be given, so a test can supply a transport. */
export interface CoreDispatchDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Build the recorder. `true` means core took the batch. */
export function createCoreDispatchRecorder(
  baseUrl: string,
  token: string,
  deps: CoreDispatchDeps = {},
): DispatchRecorder {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CORE_DISPATCH_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async record(dispatches: readonly ReportedDispatch[]): Promise<boolean> {
      if (dispatches.length === 0) return true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport(`${base}${DISPATCH_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ dispatches }),
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const answer = (await response.json()) as { ok?: boolean };
        return answer.ok === true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
