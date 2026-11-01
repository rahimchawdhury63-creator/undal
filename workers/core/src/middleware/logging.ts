/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { redact } from "../lib/redact.ts";

/**
 * Structured logs, JSON per line, redacted at the sink.
 *
 * Cloudflare's log push reads JSON lines; a Worker that logs prose produces a log stream
 * nobody can query by field. The redaction call here is the only place a log payload is
 * filtered, so a handler that logs a request body cannot leak a token by accident.
 */

/** The levels, in the order `LOG_LEVEL` is compared against. */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Whether a level is enabled for a configured threshold. */
export function levelEnabled(configured: string, level: LogLevel): boolean {
  const threshold = ORDER[(configured as LogLevel) in ORDER ? (configured as LogLevel) : "info"];
  return ORDER[level] >= threshold;
}

/**
 * Emit one line.
 *
 * `event` is a machine-readable name (`auth.login.failed`), and fields carry the
 * specifics. The request id is merged in by the caller, never formatted into the
 * message, so that every line for one request can be found with one query.
 */
export function logLine(
  configured: string,
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  if (!levelEnabled(configured, level)) return;
  const payload = redact({ level, event, ts: new Date().toISOString(), ...fields });
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
