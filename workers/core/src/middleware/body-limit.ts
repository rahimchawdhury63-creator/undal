/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * Read a JSON body, refusing anything larger than the route declared.
 *
 * A Worker that reads `request.json()` without a cap will happily buffer the largest
 * body the plan allows, and the free tier's memory is 128 MB shared with everything
 * else the isolate is doing. The cap is per route, so a media metadata post can differ
 * from an order draft, and the refusal is a 413 with a code rather than a crash.
 */

/** The default cap for a JSON body: 64 KiB, which is generous for every route but media. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Parse a JSON body within `maxBytes`.
 *
 * Content-Type is checked rather than sniffed: a form post that reaches a JSON route is a
 * client bug, and answering it with a validation error names the field instead of leaving
 * the caller to wonder why every property is missing.
 */
export async function readJsonBody(request: Request, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<Result<unknown>> {
  if (maxBytes === 0) return ok(undefined);
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return fail("VALIDATION_JSON_INVALID", { details: { expected: "application/json", actual: contentType } });
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return fail("VALIDATION_TOO_LONG", { details: { maxBytes } });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return fail("VALIDATION_TOO_LONG", { details: { maxBytes } });
  if (text.trim() === "") return ok(undefined);
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return fail("VALIDATION_JSON_INVALID");
  }
}
