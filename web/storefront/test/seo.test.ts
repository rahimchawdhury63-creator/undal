/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeHtml, jsonLdScript, renderHead, type Meta } from "../src/lib/seo.ts";

/** A page description with the fields under test. */
function meta(overrides: Partial<Meta> = {}): Meta {
  return { title: "Undal", description: "Food delivery", path: "/r/kacchi-house", locale: "bn", ...overrides };
}

describe("head rendering", () => {
  it("escapes an attribute so a vendor name cannot break out of the tag", () => {
    assert.equal(escapeHtml('Kacchi "House" & <b>'), "Kacchi &quot;House&quot; &amp; &lt;b&gt;");
  });

  it("emits a canonical link, both hreflang alternates and x-default", () => {
    const head = renderHead(meta(), "https://undal.app");
    assert.match(head, /<link rel="canonical" href="https:\/\/undal\.app\/r\/kacchi-house" \/>/u);
    assert.match(head, /hreflang="bn"/u);
    assert.match(head, /hreflang="en"/u);
    assert.match(head, /hreflang="x-default"/u);
  });

  it("marks private pages noindex", () => {
    assert.match(renderHead(meta({ path: "/cart", noindex: true }), "https://undal.app"), /name="robots" content="noindex, nofollow"/u);
  });

  it("omits robots entirely on an indexable page", () => {
    assert.doesNotMatch(renderHead(meta(), "https://undal.app"), /name="robots"/u);
  });

  it("cannot be closed early by a name containing a script end tag", () => {
    const script = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    assert.equal(script.includes("</script><script>"), false);
    assert.match(script, /\\u003c\/script>/u);
  });

  it("declares the locale's Open Graph locale code", () => {
    assert.match(renderHead(meta({ locale: "en" }), "https://undal.app"), /og:locale" content="en_US"/u);
    assert.match(renderHead(meta(), "https://undal.app"), /og:locale" content="bn_BD"/u);
  });
});
