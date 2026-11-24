/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The token generator.
 *
 * One JSON file becomes three artefacts: CSS custom properties (light and dark,
 * plus a system-preference block so a device that follows the OS needs no
 * JavaScript), a typed TypeScript object the apps import, and a flat JSON dump
 * for the Android theme generator. Everything downstream reads a token, so a
 * brand change is one file and one build — which only works if nothing can
 * drift. `--check` is that promise as a command: CI regenerates and fails on any
 * diff.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const checkOnly = process.argv.includes("--check");

/** Groups that become CSS custom properties. `meta`, `contrast_pairs` and the dark set are handled apart. */
const CSS_GROUPS = ["color", "font", "type", "space", "radius", "shadow", "motion", "z", "breakpoint", "layout"];

/** Flatten a nested object into `group-name-leaf` variable stems. */
function flatten(node, prefix, into) {
  for (const [key, value] of Object.entries(node)) {
    const stem = `${prefix}-${key}`;
    if (value !== null && typeof value === "object") {
      flatten(value, stem, into);
    } else {
      into[stem] = String(value);
    }
  }
  return into;
}

/** Build the variable map for one colour set, keeping the same stems as the light set. */
function colourVars(set) {
  const vars = {};
  flatten(set, "color", vars);
  return vars;
}

function declarations(vars) {
  return Object.entries(vars)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
}

function buildCss() {
  const light = colourVars(source.color);
  const dark = colourVars(source.colorDark);
  const rest = {};
  for (const group of CSS_GROUPS) {
    if (group === "color") continue;
    flatten(source[group], group, rest);
  }
  const darkShadows = Object.fromEntries(
    Object.entries(rest)
      .filter(([name]) => name.startsWith("shadow-") && name !== "shadow-none")
      .map(([name]) => [name, "none"]),
  );
  const darkRest = { ...rest, ...darkShadows, "shadow-highlight": "inset 0 1px 0 rgba(255, 255, 255, 0.06)" };
  const lightRest = { ...rest, "shadow-highlight": "none" };

  return `/*
 * Undal design tokens — GENERATED from packages/tokens/tokens.json.
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * Do not edit: run the token build. A hand edit fails CI.
 */

:root {
  color-scheme: light;
${declarations({ ...light, ...lightRest })}
}

[data-theme="dark"] {
  color-scheme: dark;
${declarations({ ...dark, ...darkRest })}
}

@media (prefers-color-scheme: dark) {
  [data-theme="system"] {
    color-scheme: dark;
${declarations({ ...dark, ...darkRest })}
  }
}
`;
}

function buildTypes() {
  const flat = {};
  for (const group of CSS_GROUPS) {
    flatten(source[group], group, flat);
  }
  const entries = Object.entries(flat)
    .map(([name, value]) => `  "${name}": ${JSON.stringify(value)},`)
    .join("\n");
  return `/*
 * Undal design tokens — GENERATED from packages/tokens/tokens.json.
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * Do not edit: run the token build.
 */

/** Every token by its CSS custom property stem, without the leading dashes. */
export const TOKENS = {
${entries}
} as const;

/** The name of any token; a typo is a compile error rather than a missing variable. */
export type TokenName = keyof typeof TOKENS;

/** The breakpoints the responsive contract is written against, in ascending order. */
export const BREAKPOINTS = ["xxs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;

/** Locale and currency facts every surface shares. */
export const LOCALE_FACTS = {
  currency: ${JSON.stringify(source.meta.currency)},
  currencySymbol: ${JSON.stringify(source.meta.currencySymbol)},
  timezone: ${JSON.stringify(source.meta.timezone)},
  locales: ${JSON.stringify(source.meta.locales)},
  banglaOpticalScale: ${JSON.stringify(String(source.font["bn-optical-scale"]))},
} as const;
`;
}

function buildJson() {
  const flat = { meta: source.meta, tokens: {}, contrast_pairs: source.contrast_pairs };
  for (const group of CSS_GROUPS) {
    flatten(source[group], group, flat.tokens);
  }
  flatten(source.colorDark, "color-dark", flat.tokens);
  return `${JSON.stringify(flat, null, 2)}\n`;
}

const artefacts = [
  ["dist/tokens.css", buildCss()],
  ["dist/tokens.json", buildJson()],
  ["src/generated/tokens.ts", buildTypes()],
];

let drifted = 0;
for (const [relative, contents] of artefacts) {
  const target = join(here, relative);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (checkOnly) {
    if (existing !== contents) {
      console.error(`token drift: ${relative} is not what tokens.json produces`);
      drifted += 1;
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
  console.log(`tokens: wrote ${relative}`);
}

if (checkOnly) {
  if (drifted > 0) {
    console.error(`${drifted} artefact(s) drifted`);
    process.exit(1);
  }
  console.log("tokens: all artefacts match tokens.json");
}
