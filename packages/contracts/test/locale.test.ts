/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseAcceptLanguage, pickLocalized } from "../src/common/locale.ts";

describe("locale — Bangla by default, English on request", () => {
  test("defaults to Bangla when the header is missing", () => {
    assert.equal(parseAcceptLanguage(null), "bn");
    assert.equal(parseAcceptLanguage(""), "bn");
  });

  test("honours a regional tag", () => {
    assert.equal(parseAcceptLanguage("bn-BD"), "bn");
    assert.equal(parseAcceptLanguage("en-GB,en;q=0.9"), "en");
  });

  test("respects quality ordering, not list ordering", () => {
    assert.equal(parseAcceptLanguage("en;q=0.4,bn;q=0.9"), "bn");
    assert.equal(parseAcceptLanguage("bn;q=0.4,en;q=0.9"), "en");
  });

  test("skips languages Undal does not speak", () => {
    assert.equal(parseAcceptLanguage("fr-FR,de;q=0.8,en;q=0.5"), "en");
    assert.equal(parseAcceptLanguage("fr-FR,de;q=0.8"), "bn");
  });

  test("ignores q=0, which means 'never send me this'", () => {
    assert.equal(parseAcceptLanguage("en;q=0,bn;q=0.1"), "bn");
  });

  test("picks copy for the chosen locale", () => {
    assert.equal(pickLocalized("Delivered", "ডেলিভারি হয়েছে", "bn"), "ডেলিভারি হয়েছে");
    assert.equal(pickLocalized("Delivered", "ডেলিভারি হয়েছে", "en"), "Delivered");
  });
});
