/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

export { BREAKPOINTS, LOCALE_FACTS, TOKENS, type TokenName } from "./generated/tokens.ts";
import { TOKENS, type TokenName } from "./generated/tokens.ts";

/**
 * A token as a CSS `var()` reference.
 *
 * Every component reads colour, spacing and motion through this, never as a literal: the
 * `token-purity` guardrail fails a hex value or a raw duration in a feature file, and a
 * theme switch only works because each surface names a variable instead of a colour.
 */
export function cssVar(name: TokenName): string {
  return `var(--${name})`;
}

/** The raw value of a token, for the rare place a CSS variable cannot reach (canvas, SVG attributes). */
export function tokenValue(name: TokenName): string {
  return TOKENS[name];
}

/**
 * The order-state vocabulary, as token names.
 *
 * Order state is the one colour language every surface shares — the customer timeline, the
 * partner console, the admin tower and the map ring all read this map, so a state cannot be
 * magenta in one place and amber in another.
 */
export const ORDER_STATE_TOKENS = {
  PLACED: "color-order-placed",
  ACCEPTED: "color-order-accepted",
  RIDER_SEARCH: "color-order-search",
  RIDER_ASSIGNED: "color-order-assigned",
  PICKED_UP: "color-order-picked",
  ARRIVED: "color-order-arrived",
  DELIVERED: "color-order-delivered",
  SETTLED: "color-order-settled",
  CANCELLED: "color-order-cancelled",
  DISPUTED: "color-order-disputed",
} as const satisfies Record<string, TokenName>;

/** The order states this platform moves through, as a union the UI switches on. */
export type OrderStateName = keyof typeof ORDER_STATE_TOKENS;

/**
 * The colour of an order state, as a CSS variable.
 *
 * Cancelled order states are many (customer, vendor, rider, timer, system) and all share one
 * colour, so the caller never has to enumerate them; anything unrecognised falls back to the
 * neutral state rather than rendering transparent.
 */
export function orderStateColour(state: string): string {
  if (state in ORDER_STATE_TOKENS) {
    return cssVar(ORDER_STATE_TOKENS[state as OrderStateName]);
  }
  if (state.startsWith("CANCELLED")) return cssVar("color-order-cancelled");
  return cssVar("color-status-neutral");
}
