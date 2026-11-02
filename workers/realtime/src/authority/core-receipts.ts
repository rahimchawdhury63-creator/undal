/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A device heard the alarm, and the platform finds out (`15 §8`, D86).
 *
 * The chain closes here: realtime sends a push and logs it, the device's `alarm_received` frame arrives on the
 * presence socket, and the gap between `sent_at` and `received_at` becomes the number the device matrix is
 * built from. The socket is the only place the receipt can arrive — the app does not call the API to say it
 * rang — and the row is written by core, because only core may write TiDB.
 *
 * Like the dispatch report, this is best-effort and answers `false` rather than throwing. A receipt is
 * evidence about an alarm that has already fired; failing anything because the evidence did not arrive would
 * be punishing the wrong party.
 */

/** Where core records receipts. */
export const RECEIPT_PATH = "/internal/fcm/receipts";

/** How long a receipt waits before it is abandoned. */
export const RECEIPT_TIMEOUT_MS = 700;

/** One receipt. */
export interface AlarmReceipt {
  /** The public order code the device named in its frame. */
  readonly orderCode: string;
  /** The device's canonical 32-hex id, from the socket's session rather than the frame. */
  readonly deviceId: string;
  /** When the frame arrived, by the room's clock. */
  readonly receivedAtMs: number;
}

/** The port a room reports a receipt through. */
export interface ReceiptRecorder {
  record(receipt: AlarmReceipt): Promise<boolean>;
}

/** What `createCoreReceiptRecorder` may be given, so a test can supply a transport. */
export interface CoreReceiptDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Build the recorder. `true` means core matched it to a dispatch row. */
export function createCoreReceiptRecorder(
  baseUrl: string,
  token: string,
  deps: CoreReceiptDeps = {},
): ReceiptRecorder {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? RECEIPT_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async record(receipt: AlarmReceipt): Promise<boolean> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport(`${base}${RECEIPT_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ receipts: [receipt] }),
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const answer = (await response.json()) as { ok?: boolean; data?: { recorded?: number } };
        return answer.ok === true && (answer.data?.recorded ?? 0) > 0;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
