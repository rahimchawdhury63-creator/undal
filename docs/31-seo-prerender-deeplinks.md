<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 31 — SEO, Pre-rendering and Deep Links

> The brief: *"SEO optimised, the site must serve full HTML to crawlers, not an empty shell"* and
> *"deep links so that website links open the installed app."* Both are solved problems with a
> specific right answer, and both are commonly got wrong by shipping a React app that returns
> `<div id="root"></div>` to Googlebot.

---

## 1. Why pre-rendering, not SSR

| Option | Verdict |
| --- | --- |
| Client-side only | **Rejected.** Google renders JavaScript, but on a delayed second pass, and other crawlers (Bing, Yandex, social-card scrapers, WhatsApp link previews — which matter enormously in Bangladesh) largely do not |
| Server-side rendering per request | **Rejected.** It needs always-on compute, costs money, adds latency, and gains nothing for pages that change a few times a day |
| **Static pre-rendering at build time** | **Chosen.** Real HTML from Cloudflare's edge in ~40 ms, zero runtime cost, free tier, and the content is genuinely crawlable |
| ISR / on-demand revalidation | Partially adopted: a Pages Function regenerates a single vendor page on demand when that vendor changes, via a webhook from `undal-core` |

---

## 2. What is pre-rendered

The route manifest is generated at build time from live data via `GET /v1/public/sitemap-data`:

| Route pattern | Count (launch) | Refresh |
| --- | --- | --- |
| `/` | 1 | Every build |
| `/a/{area}` | 14 | Every build |
| `/a/{area}/{cuisine}` | ~380 | Every build |
| `/c/{cuisine}` | 118 | Every build |
| `/r/{vendor}` | 43 | On change + every build |
| `/r/{vendor}/{item}` | ~1 200 | On change + every build |
| Static pages | 9 | Every build |
| Bengali mirrors of all of the above | ×2 | |
| **Total** | **~3 530 HTML files** | |

Build time for 3 530 pages: **about 95 seconds**. Cloudflare Pages' free tier allows 20 000 files
per deployment, so there is room for roughly five times the launch catalogue before any
restructuring is needed — and the plan for that point is documented in
[`39`](39-risk-register-and-truths.md).

---

## 3. What a crawler receives

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Rahman's Biriyani House — Kacchi, Tehari &amp; Bengali food delivery in Zindabazar, Sylhet | Undal</title>
  <meta name="description" content="Order Kacchi Biriyani, Morog Polao and Bengali food from Rahman's Biriyani House in Zindabazar, Sylhet. 4.6★ from 212 orders. Delivery in about 18 minutes. Cash on delivery.">
  <link rel="canonical" href="https://undal.example/r/rahmans-biriyani-house">
  <link rel="alternate" hreflang="en" href="https://undal.example/r/rahmans-biriyani-house">
  <link rel="alternate" hreflang="bn" href="https://undal.example/bn/r/rahmans-biriyani-house">
  <link rel="alternate" hreflang="x-default" href="https://undal.example/r/rahmans-biriyani-house">

  <meta property="og:type" content="restaurant.restaurant">
  <meta property="og:title" content="Rahman's Biriyani House — Zindabazar, Sylhet">
  <meta property="og:description" content="4.6★ · Bengali · delivery in ~18 min · cash on delivery">
  <meta property="og:image" content="https://i.ibb.co/…/cover.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">

  <style>/* 38KB of critical CSS, inlined */</style>
  <link rel="preload" as="image" href="https://i.ibb.co/…/cover.jpg" fetchpriority="high">
  <link rel="preconnect" href="https://api.undal.example" crossorigin>
  <script type="application/ld+json">{ /* §4 */ }</script>
</head>
<body>
  <main>
    <h1>Rahman's Biriyani House</h1>
    <p>Bengali · Biriyani · Rice dishes — Zindabazar, Sylhet</p>
    <p>4.6 out of 5 from 212 orders · about 18 minutes · ৳30 delivery</p>

    <h2>Menu</h2>
    <h3>Biriyani</h3>
    <ul>
      <li><h4>Kacchi Biriyani (Full)</h4>
          <p>Slow-cooked mutton with aromatic basmati rice, potato and borhani.</p>
          <p>৳320.00</p></li>
      <li><h4>Morog Polao</h4>
          <p>Fragrant chicken pulao cooked in ghee with whole spices.</p>
          <p>৳260.00</p></li>
      …
    </ul>

    <h2>Opening hours</h2>
    <table>…</table>

    <h2>Delivery area</h2>
    <p>Rahman's Biriyani House delivers to Zindabazar, Shibganj, Ambarkhana and
       nearby areas of Sylhet.</p>
  </main>
  <script type="module" src="/assets/hydrate-a3f9c21.js" defer></script>
</body>
</html>
```

The full menu, with prices and descriptions, is in the HTML. Hours are a real table. The delivery
area is a sentence a human would write. This is what "not an empty shell" means, and the
`prerender-verify` job asserts it: it fetches every pre-rendered route with JavaScript disabled
and fails if the `<main>` contains fewer than 400 characters of text, or if the `<h1>` is empty,
or if no price appears on a vendor page.

---

## 4. Structured data

JSON-LD, validated against schema.org in CI.

| Page | Types |
| --- | --- |
| Vendor | `Restaurant` with `address`, `geo`, `openingHoursSpecification`, `aggregateRating`, `servesCuisine`, `priceRange`, `hasMenu` |
| Item | `MenuItem` with `offers`, `nutrition` where known, `suitableForDiet` for veg |
| Area | `ItemList` of `Restaurant` |
| Cuisine | `CollectionPage` + `ItemList` |
| Home | `Organization`, `WebSite` with `SearchAction` |
| All | `BreadcrumbList` |

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Rahman's Biriyani House",
  "image": "https://i.ibb.co/…/cover.jpg",
  "address": { "@type": "PostalAddress", "streetAddress": "Zindabazar Main Road",
               "addressLocality": "Sylhet", "addressRegion": "Sylhet",
               "addressCountry": "BD" },
  "geo": { "@type": "GeoCoordinates", "latitude": 24.8949, "longitude": 91.8687 },
  "servesCuisine": ["Bengali", "Biriyani"],
  "priceRange": "৳৳",
  "aggregateRating": { "@type": "AggregateRating",
                       "ratingValue": "4.6", "reviewCount": "212" },
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Saturday"],
      "opens": "11:00", "closes": "15:00" }
  ],
  "hasMenu": { "@type": "Menu", "hasMenuSection": [ /* … */ ] },
  "potentialAction": {
    "@type": "OrderAction",
    "target": { "@type": "EntryPoint",
                "urlTemplate": "https://undal.example/r/rahmans-biriyani-house",
                "actionPlatform": ["http://schema.org/DesktopWebPlatform",
                                   "http://schema.org/AndroidPlatform"] },
    "deliveryMethod": ["http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"]
  }
}
```

**No rating is published for a vendor with fewer than 5 ratings.** `aggregateRating` is omitted
entirely in that case, because a schema.org rating of 5.0 from one review is the kind of thing
that gets a site's rich results penalised, and it is also simply untrue.

---

## 5. URLs

| Rule | Example |
| --- | --- |
| Lowercase, hyphenated, ASCII-transliterated slugs | `rahmans-biriyani-house` |
| Bengali content at a `/bn/` prefix, slugs still transliterated | `/bn/r/rahmans-biriyani-house` |
| No IDs in public URLs | Slugs resolve through a `vendor_slugs` table |
| Slug changes keep the old one as a 301 | Permanently; slugs are never reused |
| No trailing slash | Enforced by a Pages redirect |
| No query parameters in canonical URLs | Filters use the hash or client state |
| Short, stable order URLs | `/o/UND-7K2M9QX4` |

Slug generation handles Bengali: `বিরিয়ানি ঘর` → `biriyani-ghor`, using a transliteration table
rather than a generic Unicode slugifier, because the generic ones produce nonsense for Bengali
conjuncts.

---

## 6. Sitemaps and robots

```
/sitemap.xml                index
  /sitemap-core.xml         static pages
  /sitemap-vendors.xml      vendor pages, lastmod from the vendor's updated_at
  /sitemap-items.xml        item pages, chunked at 10,000
  /sitemap-areas.xml        area and area×cuisine pages
  /sitemap-bn.xml           every Bengali mirror
```

Every entry carries a real `lastmod` from the database. `changefreq` and `priority` are omitted —
search engines ignore them and a wrong value is worse than none.

```
# robots.txt
User-agent: *
Allow: /
Disallow: /account/
Disallow: /checkout
Disallow: /cart
Disallow: /o/
Disallow: /track/
Disallow: /partner/
Disallow: /rider/
Disallow: /api/

Sitemap: https://undal.example/sitemap.xml
```

Order and tracking URLs are disallowed because they are personal. They are additionally protected
by `noindex` headers and by authentication — robots.txt is a request, not a control.

---

## 7. Content quality

Thin pages do not rank, and a page listing three restaurants is thin. Each page type carries real,
non-duplicated content:

| Page | Unique content |
| --- | --- |
| Vendor | The full menu with descriptions, hours, delivery areas served, and a generated 2–3 sentence summary built from real attributes (cuisines, signature items, speed, rating) — not spun text |
| Area | A description of the area, the number of restaurants, the cuisines available, typical delivery times, and the top cuisines by actual order volume |
| Area × cuisine | The restaurants serving that cuisine there, with their signature dishes named |
| Cuisine | What the cuisine is, typical dishes with short genuine descriptions, and where to find it |

The generated summaries are templated from real data with enough variation that no two read
identically, and every factual claim in them is derived from the database. A page about a
restaurant that has no menu items says so and is marked `noindex` until it does — an empty page
indexed is worse than no page.

---

## 8. Performance as SEO

Core Web Vitals are a ranking factor and the budgets in [`20 §6`](20-web-storefront.md) are set
accordingly: LCP ≤ 1.8 s, CLS ≤ 0.02, INP ≤ 160 ms. The `lighthouse-budget` job fails the build
below 95 in any category, measured on a simulated 4G connection with 4× CPU throttling — not on a
fast desktop, which would be a meaningless measurement for the actual audience.

---

## 9. Android App Links

> *"deep links so that website links open the installed app."*

### 9.1 The digital asset link

Generated by the Pages build from `ANDROID_SHA256_FINGERPRINT`:

```jsonc
// /.well-known/assetlinks.json  — served with Content-Type: application/json
[
  { "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app",
                "package_name": "com.undal.customer",
                "sha256_cert_fingerprints": ["AB:CD:…:EF"] } },
  { "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app",
                "package_name": "com.undal.partner",
                "sha256_cert_fingerprints": ["AB:CD:…:EF"] } },
  { "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app",
                "package_name": "com.undal.rider",
                "sha256_cert_fingerprints": ["AB:CD:…:EF"] } }
]
```

The fingerprint comes from the release keystore and is emitted by `generate-keystore.yml`
([`28 §4`](28-cicd-github-actions.md)). A mismatch silently breaks App Links, so a CI job fetches
the deployed `assetlinks.json` after every web deploy and compares it to the fingerprint in
secrets, failing loudly on a difference. This is the single most common way App Links break in
practice.

### 9.2 Path ownership

| Path | App |
| --- | --- |
| `/r/*`, `/c/*`, `/a/*`, `/o/*`, `/track/*` | Customer |
| `/partner/*` | Partner |
| `/rider/*` | Rider |
| `/`, `/about`, `/app`, legal pages | **Browser** — never intercepted |

The home page is deliberately not claimed. A user who taps a link to the home page expects a web
page; hijacking it into an app is the behaviour that makes people disable App Links entirely.

### 9.3 Verification and fallback

`android:autoVerify="true"` makes Android fetch `assetlinks.json` at install time. If verification
fails (no network at install, a CDN hiccup), the link opens the browser and the web page shows an
unobtrusive banner:

```
  ┌───────────────────────────────────────────┐
  │ 📱 Open in the Undal app        [ Open ]  │
  │                                       ✕   │
  └───────────────────────────────────────────┘
```

The banner tries an `intent://` URL with a `browser_fallback_url`, and if the app is not installed
it routes to `/app`. It is dismissible, remembers the dismissal for 30 days, and never appears on
a desktop browser.

### 9.4 Deferred deep linking

Someone without the app taps a link to a specific restaurant, installs the app, and opens it —
they should land on that restaurant, not the home screen. Without a paid attribution service this
requires a modest approach:

| Mechanism | How |
| --- | --- |
| Play Install Referrer | `/app` appends `?referrer=r%2Frahmans-biriyani-house` to the Play Store URL. The app reads it on first launch via the Install Referrer API and routes accordingly |
| Clipboard hint | **Not used.** Reading the clipboard on launch is hostile and Android 12+ shows a toast for it |
| Fingerprint matching | **Not used.** It is privacy-invasive and unreliable |

The Install Referrer path covers the Play Store case, which is the majority. A sideloaded APK gets
the home screen, and that is an acceptable limitation stated plainly rather than solved by
something creepy.

### 9.5 Web-to-app parity

Every deep-linkable web route has an app destination, and every app screen reachable by deep link
has a web URL. A link is never a dead end:

| Situation | Behaviour |
| --- | --- |
| Vendor outside the user's zone | A specific screen: *"Rahman's delivers in Sylhet. You're set to Dhaka."* with a one-tap location switch |
| Vendor deleted | *"This restaurant is no longer on Undal"* plus nearby alternatives |
| Someone else's order | A clean "not found", never a permission error that confirms the order exists |
| Expired tracking link | The order summary instead |

---

## 10. Social sharing

| Platform | Handling |
| --- | --- |
| WhatsApp | The dominant sharing channel in Bangladesh. `og:image` at 1 200 × 630, `og:title` and `og:description` present on every page; the scraper runs no JavaScript, which is precisely why pre-rendering matters |
| Facebook | Same tags, validated against the sharing debugger in CI |
| Twitter/X | `summary_large_image` |
| Messenger | Inherits Facebook's tags |
| Native share sheet | The app shares the canonical web URL, never a deep-link scheme, so the recipient gets something that works whether or not they have the app |

The share image for a vendor is their cover photo with a generated overlay containing the vendor
name, rating and the Undal mark — composed at build time and uploaded to imgbb, so no runtime
image service is needed.

---

## 11. Multilingual SEO

| Concern | Treatment |
| --- | --- |
| URL strategy | Path prefix `/bn/`, which is unambiguous for crawlers and shareable |
| `hreflang` | Reciprocal `en`, `bn` and `x-default` on every page pair |
| Content | Genuinely translated, not machine-mangled. A vendor's Bengali name is used where supplied, and transliterated where not |
| `lang` attributes | On `<html>` and on any mixed-script span |
| Sitemap | Bengali pages listed with their own `lastmod` |
| Default | English, because `x-default` must point somewhere and English has broader reach for a first-time visitor |

---

## 12. Testing

| Test | Count |
| --- | --- |
| `prerender-verify` — real content with JS off | Every pre-rendered route |
| Structured data validation | Every page type, against schema.org |
| `hreflang` reciprocity | Every page pair |
| Canonical correctness | Every route |
| Sitemap validity and completeness | 5 sitemaps |
| robots.txt | 1 |
| `assetlinks.json` matches the keystore fingerprint | 1 CI job, post-deploy |
| App Link routing | 14 paths × installed/not-installed |
| Unclaimed paths open the browser | 5 |
| Deferred deep link via Install Referrer | 6 |
| Dead-end handling | 4 situations in §9.5 |
| Open Graph rendering | Validated against Facebook's and WhatsApp's scrapers |
| Slug generation, including Bengali | 120 fixtures |
| 301 on a changed slug | 4 |
| Lighthouse SEO category | Every route, ≥ 95 |

---

## 13. Reading on

Next: [`32-localization-and-currency.md`](32-localization-and-currency.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
