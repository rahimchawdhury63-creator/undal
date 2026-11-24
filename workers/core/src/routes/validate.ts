/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { parseCartBody, priceCartBody } from "../pricing/cart-service.ts";

/**
 * Pre-flight: can this cart be ordered at all? (`08 §4`)
 *
 * The checkout screen asks before the customer taps, and it asks for *every* reason at once. A
 * refusal here is not an error — it is the answer to a question, so the endpoint returns `200` with a
 * list of checks and never a 4xx for a basket that cannot be placed. That shape is what lets the app
 * grey out the button and show "you are 1.2 km outside this kitchen's delivery area" *before* the
 * customer has committed to anything, instead of after they have waited for a spinner to fail.
 *
 * The checks come from the same pricing service as the quote, so a cart that validates here cannot
 * fail for a reason the quote would have found — the two answers can never disagree.
 */

/** One check, named for the app and answered with the code the quote would have returned. */
export interface Check {
  readonly name: "VENDOR_OPEN" | "ITEMS_AVAILABLE" | "MINIMUM_MET" | "ADDRESS_SERVABLE";
  readonly ok: boolean;
  readonly code: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Which check a refusal code belongs to, so the app can highlight the right field. */
function checkFor(code: string): Check["name"] {
  if (code === "CATALOG_VENDOR_CLOSED") return "VENDOR_OPEN";
  if (code === "QUOTE_ADDRESS_OUT_OF_RANGE") return "ADDRESS_SERVABLE";
  if (code === "QUOTE_BELOW_MINIMUM") return "MINIMUM_MET";
  return "ITEMS_AVAILABLE";
}

/** Validate a cart. */
async function validate(ctx: Ctx, body: unknown): Promise<Response> {
  const parsed = parseCartBody(ctx, body);
  if (!parsed.ok) {
    // A malformed body *is* an error: there is no cart to have an opinion about.
    return parsed.response;
  }

  const priced = await priceCartBody(ctx, parsed.value);
  if (priced.ok)
    return successResponse(
      {
        canPlace: true,
        checks: [
          { name: "VENDOR_OPEN", ok: true, code: null, details: {} },
          { name: "ITEMS_AVAILABLE", ok: true, code: null, details: {} },
          { name: "MINIMUM_MET", ok: true, code: null, details: { minOrderPaisa: Number(priced.value.vendor.min_order_paisa) } },
          { name: "ADDRESS_SERVABLE", ok: true, code: null, details: { distanceM: priced.value.distanceM } },
        ] satisfies Check[],
        prepTimeS: priced.value.priced.prepTimeS,
      },
      ctx.locale,
      ctx.requestId,
    );

  // The pricing service already answers with the envelope the client renders for a refusal; the
  // pre-flight unpacks it rather than re-deciding, so the two endpoints cannot drift apart.
  const failure = (await priced.response.json()) as { error: { code: string; details?: Record<string, unknown> } };
  const code = failure.error.code;
  const failing = checkFor(code);

  return successResponse(
    {
      canPlace: false,
      checks: [
        { name: "VENDOR_OPEN", ok: failing !== "VENDOR_OPEN", code: failing === "VENDOR_OPEN" ? code : null, details: failing === "VENDOR_OPEN" ? (failure.error.details ?? {}) : {} },
        {
          name: "ITEMS_AVAILABLE",
          ok: failing !== "ITEMS_AVAILABLE",
          code: failing === "ITEMS_AVAILABLE" ? code : null,
          details: failing === "ITEMS_AVAILABLE" ? (failure.error.details ?? {}) : {},
        },
        { name: "MINIMUM_MET", ok: failing !== "MINIMUM_MET", code: failing === "MINIMUM_MET" ? code : null, details: failing === "MINIMUM_MET" ? (failure.error.details ?? {}) : {} },
        {
          name: "ADDRESS_SERVABLE",
          ok: failing !== "ADDRESS_SERVABLE",
          code: failing === "ADDRESS_SERVABLE" ? code : null,
          details: failing === "ADDRESS_SERVABLE" ? (failure.error.details ?? {}) : {},
        },
      ] satisfies Check[],
      prepTimeS: null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The pre-flight route. */
export const VALIDATE_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/orders/validate",
    permission: "order.create",
    // Bearer only, and it writes nothing: it answers a question about a cart.
    readOnly: true,
    group: "QUOTE",
    maxBodyBytes: 8_192,
    run: async (ctx, input) => validate(ctx, input.body),
  },
];
