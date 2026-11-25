/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The localisation contract: both catalogues carry the same keys, every pattern
 * compiles, Bengali is genuinely Bengali, money groups in lakh, and time is
 * Dhaka time whatever the machine's clock is set to.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ERRORS } from "@undal/contracts";

import {
  CATALOGUES,
  LOCALES,
  createTranslator,
  formatMessage,
  isLocale,
  negotiateLocale,
  otherLocale,
  toBengaliDigits,
} from "../src/index.ts";
import { compile, MessageFormatError } from "../src/message.ts";

const BENGALI = /[\u0980-\u09FF]/u;

test("both catalogues carry exactly the same keys", () => {
  assert.deepEqual(Object.keys(CATALOGUES.en).sort(), Object.keys(CATALOGUES.bn).sort());
  assert.ok(Object.keys(CATALOGUES.en).length > 300, "the catalogue is suspiciously small");
});

test("every message compiles in both locales, so no customer meets a raw brace", () => {
  for (const locale of LOCALES) {
    for (const [key, pattern] of Object.entries(CATALOGUES[locale])) {
      assert.doesNotThrow(() => compile(pattern), `${locale}:${key} does not compile`);
    }
  }
});

test("every Bengali message is written in Bengali, except pure placeholders", () => {
  for (const [key, pattern] of Object.entries(CATALOGUES.bn)) {
    let withoutPlaceholders = pattern;
    while (/\{[^{}]*\}/u.test(withoutPlaceholders)) {
      withoutPlaceholders = withoutPlaceholders.replace(/\{[^{}]*\}/gu, "");
    }
    // A message that is only a number and a glyph ("{rating} ★ ({count})") has nothing to translate.
    if (!/\p{L}/u.test(withoutPlaceholders)) continue;
    assert.match(withoutPlaceholders, BENGALI, `${key} has no Bengali characters`);
  }
});

test("arguments are substituted and the same input renders the same output", () => {
  assert.equal(formatMessage("Order {code}", "en", { code: "UND-7Q2" }), "Order UND-7Q2");
  assert.equal(formatMessage("অর্ডার {code}", "bn", { code: "UND-7Q2" }), "অর্ডার UND-7Q2");
});

test("plurals pick the right branch in both languages and read # as the count", () => {
  assert.equal(formatMessage("{count, plural, one {# item} other {# items}}", "en", { count: 1 }), "1 item");
  assert.equal(formatMessage("{count, plural, one {# item} other {# items}}", "en", { count: 4 }), "4 items");
  assert.equal(formatMessage("{count, plural, one {# আইটেম} other {# আইটেম}}", "bn", { count: 2 }), "2 আইটেম");
});

test("an unsupported format or unbalanced brace fails loudly rather than rendering", () => {
  assert.throws(() => compile("{n, select, a {x} other {y}}"), MessageFormatError);
  assert.throws(() => compile("{broken"), MessageFormatError);
  assert.throws(() => compile("{n, plural, one {x}}"), MessageFormatError);
});

test("a missing argument is a programming error, not a silent blank", () => {
  assert.throws(() => formatMessage("Order {code}", "en", {}), MessageFormatError);
});

test("money groups in lakh and crore, never in Western thousands", () => {
  const en = createTranslator("en");
  assert.equal(en.money(54_900), "৳" + " " + "549.00");
  assert.equal(en.money(1_00_00_000_00), "৳" + " " + "1,00,00,000.00");
  assert.equal(en.money(1_23_456), "৳" + " " + "1,234.56");
  assert.equal(en.money(-18_000), "−৳" + " " + "180.00");
  assert.equal(en.money(32_000, { symbol: false }), "320.00");
});

test("Bangla can show Bengali numerals, and phone-number-like strings never do", () => {
  const bn = createTranslator("bn");
  assert.equal(bn.money(54_900, { numerals: "bengali" }), "\u09f3\u2009" + toBengaliDigits("549.00"));
  assert.equal(toBengaliDigits("0123456789"), "০১২৩৪৫৬৭৮৯");
  assert.equal("UND-7Q2".replace(/[0-9]/gu, (d) => toBengaliDigits(d)), "UND-৭Q২");
});

test("dates render in Asia/Dhaka no matter the machine's timezone", () => {
  const en = createTranslator("en");
  const midnightUtc = "2026-11-24T00:30:00.000Z";
  const rendered = en.dateTime(midnightUtc, "time");
  assert.match(rendered, /6:30/u, `expected 6:30 AM Dhaka, got ${rendered}`);
  assert.equal(en.dateTime(null), "—");
  assert.equal(en.dateTime("not a date"), "—");
});

test("durations and distances read naturally in both languages", () => {
  assert.equal(createTranslator("en").minutes(18), "18 min");
  assert.equal(createTranslator("en").minutes(65), "1 h 5 min");
  assert.equal(createTranslator("bn").minutes(18), "১৮ মিনিট");
  assert.equal(createTranslator("en").distance(850), "850 m");
  assert.equal(createTranslator("en").distance(1234), "1.2 km");
});

test("relative time is coarse and localised", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  assert.match(createTranslator("en").relative("2026-11-24T11:58:00.000Z", now), /2 minutes ago|2 min\. ago/u);
});

test("error copy comes from the registry in both languages, for every code", () => {
  for (const code of Object.keys(ERRORS)) {
    const en = createTranslator("en").errorMessage(code);
    const bn = createTranslator("bn").errorMessage(code);
    assert.ok(en.length > 0, `${code} has no English copy`);
    assert.match(bn, BENGALI, `${code} has no Bengali copy`);
  }
  assert.equal(createTranslator("en").errorMessage("NOT_A_CODE"), CATALOGUES.en["state.error.body"]);
});

test("language negotiation prefers Bangla on a tie and on a Bangladeshi browser", () => {
  assert.equal(negotiateLocale("bn-BD,bn;q=0.9,en;q=0.8"), "bn");
  assert.equal(negotiateLocale("en-US,en;q=0.9,bn;q=0.8"), "en");
  assert.equal(negotiateLocale("fr-FR"), "bn");
  assert.equal(negotiateLocale(null), "bn");
  assert.equal(negotiateLocale("en-GB;q=0.9,bn;q=0.9"), "bn");
});

test("locale helpers round-trip and reject nonsense", () => {
  assert.equal(isLocale("bn"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(otherLocale("bn"), "en");
  assert.equal(otherLocale("en"), "bn");
});
