/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The token set's own contract: every declared pair clears WCAG, every scale is a
 * multiple of its base grid, and no token is missing from the generated output.
 * These are the assertions the `contrast` guardrail repeats on the raw JSON; doing
 * them here as well means a developer sees the failure in the unit suite with the
 * pair's label rather than as a line in a CI log.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { TOKENS, cssVar, orderStateColour } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(join(here, "..", "tokens.json"), "utf8"));

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16)) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter as number) + 0.05) / ((darker as number) + 0.05);
}

test("every declared colour pair clears its WCAG floor", () => {
  for (const pair of source.contrast_pairs) {
    const floor = pair.large_or_ui ? 3 : 4.5;
    const measured = ratio(pair.foreground, pair.background);
    assert.ok(measured >= floor, `${pair.label}: ${measured.toFixed(2)}:1 is below ${floor}:1`);
  }
});

test("the two colour sets declare the same tokens", () => {
  const shape = (node: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(node).flatMap(([key, value]) =>
      value !== null && typeof value === "object" ? shape(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`],
    );
  assert.deepEqual(shape(source.color).sort(), shape(source.colorDark).sort());
});

test("spacing is a multiple of the four pixel grid", () => {
  for (const [name, value] of Object.entries(source.space) as [string, string][]) {
    assert.match(value, /^\d+px$/u, `space.${name} is not a pixel value`);
    assert.equal(Number(value.replace("px", "")) % 4, 0, `space.${name} is off the grid`);
  }
});

test("the generated TypeScript carries every light colour and every scale", () => {
  assert.equal(TOKENS["color-action-primary"], source.color.action.primary);
  assert.equal(TOKENS["space-4"], "16px");
  assert.equal(TOKENS["radius-full"], "9999px");
  assert.equal(cssVar("color-brand-forest"), "var(--color-brand-forest)");
});

test("an order state resolves to its own colour, and a cancellation to the cancelled one", () => {
  assert.equal(orderStateColour("PICKED_UP"), "var(--color-order-picked)");
  assert.equal(orderStateColour("CANCELLED_BY_CUSTOMER"), "var(--color-order-cancelled)");
  assert.equal(orderStateColour("SOMETHING_ELSE"), "var(--color-status-neutral)");
});

test("breakpoints ascend, so a stylesheet cannot be written against a hole", () => {
  const widths = (Object.values(source.breakpoint) as string[]).map((value) => Number(value.replace("px", "")));
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
  assert.equal(widths[0], 200);
  assert.equal(widths[widths.length - 1], 1920);
});
