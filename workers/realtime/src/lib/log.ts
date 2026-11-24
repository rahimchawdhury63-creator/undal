/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Structured logs with the personal data removed before it is written.
 *
 * A log line is a copy of production data that nobody remembers creating. The rule in `27 §6` is that
 * a phone number, an email, a token or a precise position never appears in one; enforcing that at the
 * call site means enforcing it in every call site, so this module redacts by key name and by pattern
 * and the call sites pass whole objects.
 */

/** The levels, in increasing severity. `debug` is never enabled in production. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric weight, so "at least warn" is a comparison rather than a list. */
const WEIGHT: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values never leave the process. Matched case-insensitively, as substrings. */
const SENSITIVE_KEYS = [
  "phone",
  "email",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "otp",
  "nid",
  "trxid",
  "lat",
  "lon",
  "address",
] as const;

/** A field name worth keeping but not worth printing in full. */
const MASKED = "«redacted»";

/** A logger with one destination and one minimum level. */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** A child logger that adds fields to every line — the request id, usually. */
  child(fields: Record<string, unknown>): Logger;
}

/** Where a line goes. `console` in production, an array in a test. */
export interface LogSink {
  write(line: string): void;
}

const CONSOLE_SINK: LogSink = {
  write: (line: string): void => {
    // eslint-disable-next-line no-console -- this is the one place a console call is the point.
    console.log(line);
  },
};

/** Whether a key is on the never-print list. */
function isSensitive(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => lowered.includes(sensitive));
}

/**
 * A phone number, masked to its last four digits.
 *
 * Keeping the tail is deliberate: support needs to confirm *which* number called, and the last four
 * digits are enough to do that without being a contactable number in a log dump.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/gu, "");
  if (digits.length < 4) return MASKED;
  return `••••${digits.slice(-4)}`;
}

/** Redact a value, recursively, without mutating the caller's object. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "«deep»";
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && /^\+?\d{10,15}$/u.test(value)) return maskPhone(value);
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitive(key) && typeof entry === "string" && key.toLowerCase().includes("phone")
      ? maskPhone(entry)
      : isSensitive(key)
        ? MASKED
        : redact(entry, depth + 1);
  }
  return output;
}

/**
 * Build a logger.
 *
 * The timestamp is `new Date().toISOString()` rather than a passed clock: a log line's timestamp is
 * the moment the line was written, and pretending otherwise would make a delayed write look early.
 */
export function createLogger(
  level: LogLevel = "info",
  sink: LogSink = CONSOLE_SINK,
  base: Record<string, unknown> = {},
): Logger {
  const minimum = WEIGHT[level];
  const emit = (lineLevel: LogLevel, message: string, fields: Record<string, unknown> = {}): void => {
    if (WEIGHT[lineLevel] < minimum) return;
    sink.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: lineLevel,
        msg: message,
        // `redact` is typed for any value; here the argument is an object and the result is one too.
        ...(redact({ ...base, ...fields }) as Record<string, unknown>),
      }),
    );
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createLogger(level, sink, { ...base, ...fields }),
  };
}

/** A level from configuration, defaulting to `info` rather than failing a deploy on a typo. */
export function parseLevel(raw: string | undefined): LogLevel {
  switch ((raw ?? "").toLowerCase()) {
    case "debug":
      return "debug";
    case "warn":
      return "warn";
    case "error":
      return "error";
    default:
      return "info";
  }
}
