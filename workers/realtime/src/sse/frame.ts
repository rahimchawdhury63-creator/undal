/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The wire format of the event stream (`05 §4.3`, `08 §9`).
 *
 * Server-Sent Events is a text format with exactly four fields, and every one of its sharp edges comes
 * from a client that parses it strictly: a `data:` line cannot contain a raw newline, an event name
 * that is not `[a-z]` and dots is silently dropped by some clients, and a stream that stops sending
 * anything is closed by whatever proxy is in the middle. This module is the whole format, written
 * once, so a handler builds strings and never bytes.
 */

/** A comment line every twenty seconds keeps intermediaries from closing an idle stream. */
export const KEEPALIVE_INTERVAL_MS = 20_000;

/** What a handler sends. `data` is serialised as one line of JSON. */
export interface StreamFrame {
  readonly id: number;
  readonly event: string;
  readonly data: unknown;
}

/** The event-name shape: lowercase, dotted, at most 64 characters. */
const EVENT_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/u;

/** Format one frame. The trailing blank line is what tells the client the frame is complete. */
export function formatFrame(frame: StreamFrame): string {
  validateFrame(frame);
  const payload = JSON.stringify(frame.data);
  if (payload === undefined) throw new RangeError(`event ${frame.event} has no payload`);
  return `id: ${String(frame.id)}\nevent: ${frame.event}\ndata: ${payload}\n\n`;
}

/** The keepalive comment. It carries no id, so it never advances the client's resume cursor. */
export function formatKeepalive(): string {
  return ": keepalive\n\n";
}

/** Any comment, for a stream that wants to say something without being an event. */
export function formatComment(text: string): string {
  const flat = text.replace(/[\r\n]+/gu, " ");
  return `: ${flat}\n\n`;
}

/** Refuse a frame a strict client would choke on, rather than sending it and hoping. */
export function validateFrame(frame: StreamFrame): void {
  if (!Number.isInteger(frame.id) || frame.id < 1) {
    throw new RangeError(`not an event id: ${String(frame.id)}`);
  }
  if (!EVENT_NAME.test(frame.event)) throw new RangeError(`not an event name: ${frame.event}`);
}

/**
 * Read the client's resume cursor.
 *
 * `Last-Event-ID` is the protocol's own header and the one a browser sends by itself; the query
 * parameter exists for clients that cannot set headers, and a value that is not a positive integer is
 * refused rather than coerced. `null` means "start from now", which is different from `0`, meaning
 * "send me everything you still have".
 */
export function parseLastEventId(header: string | null, parameter: string | null = null): number | null {
  const raw = header ?? parameter;
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/u.test(raw.trim())) throw new RangeError(`not an event id: ${raw}`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`not an event id: ${raw}`);
  return value;
}

/** The headers an event stream must carry, including the one that stops nginx buffering it. */
export function streamHeaders(requestId: string): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "X-Undal-Request-Id": requestId,
  };
}

/** A frame as UTF-8 bytes, for the writer that takes bytes. */
export function encodeFrame(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
