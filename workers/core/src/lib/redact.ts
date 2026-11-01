/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Remove secrets from anything on its way to a log.
 *
 * Redaction at the sink — the logger, the error reporter — rather than at every call
 * site is the only version that survives a new developer adding a `console.log` that
 * includes a request body. A phone number is personal data under the platform's own
 * policy; a token in a log line is a session someone can take.
 */

/** Key fragments whose values never reach a log, matched case-insensitively. */
const SENSITIVE = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "otp",
  "totp",
  "signature",
  "signing",
  "nid",
  "private_key",
  "cvv",
] as const;

/** Fields that are personal data: kept, but masked, so support can still correlate. */
const MASKED = ["phone", "email", "msisdn", "lat", "lon", "ip", "address", "account"] as const;

/** How deep `redact` walks before it stops and says so. */
export const REDACT_MAX_DEPTH = 6;

/** Whether a key names a secret. */
export function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE.some((fragment) => lowered.includes(fragment));
}

/**
 * Mask a value while keeping enough of it to correlate two log lines.
 *
 * `01712345678` becomes `0171***5678`: a support agent can match a customer's
 * number against a ticket, and a leaked log cannot be used to call them.
 */
export function mask(value: string): string {
  if (value.length <= 4) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function redactInto(value: unknown, depth: number): unknown {
  if (depth > REDACT_MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactInto(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (isSensitiveKey(key)) output[key] = "[redacted]";
    else if (typeof child === "string" && MASKED.some((fragment) => lowered.includes(fragment)))
      output[key] = mask(child);
    else output[key] = redactInto(child, depth + 1);
  }
  return output;
}

/** Strip the obvious secrets from a free-text string, which is where they usually hide. */
export function redactString(line: string): string {
  return line
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gu, "Bearer [redacted]")
    .replace(/\b\+?8801[3-9]\d{8}\b/gu, (match) => mask(match))
    .replace(/(["']?(?:password|token|secret)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/giu, "$1[redacted]");
}

/** A structured value safe to log at any depth. */
export function redact(value: unknown): unknown {
  return redactInto(value, 0);
}
