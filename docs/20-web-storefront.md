<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 20 — Web Storefront

> React + Vite + TypeScript on Cloudflare Pages. It is not a brochure and not a download page. It
> is a **complete ordering platform** — because iOS users cannot install the Android apps, and the
> brief is explicit that they must be able to order. It is also the SEO surface, which means it
> must serve real HTML to a crawler that runs no JavaScript.

---

## 1. What the website is for

| Audience | Need | Served by |
| --- | --- | --- |
| **iOS customers** | Order food. Everything an Android customer can do | The full storefront, §4 |
| **Desktop customers** | Browse comfortably on a big screen | A genuine desktop layout, not a stretched phone |
| **Search engines** | Indexable vendor and cuisine pages | Pre-rendered HTML, [`31`](31-seo-prerender-deeplinks.md) |
| **Android customers arriving from a link** | Open the app | App Links; the page is the fallback, not the destination |
| **iOS vendors and riders** | Manage their business | The partner and rider web consoles, §8 |
| **Prospective partners and riders** | Sign up | Onboarding flows, [`23`](23-onboarding-kyc.md) |

---

## 2. Stack

| Concern | Choice | Note |
| --- | --- | --- |
| Framework | **React 19** + TypeScript, strict | |
| Build | **Vite 6** | |
| Routing | **React Router 7** in data mode | Loaders give us the data-before-render shape pre-rendering needs |
| State | **TanStack Query** for server state; **Zustand** for cart and UI | No Redux; the cart is the only genuinely global client state |
| Styling | **CSS Modules + CSS custom properties** generated from `design/tokens.json` | The same tokens that generate the Android theme ([`16 §7`](16-android-foundation.md)) |
| Animation | **Motion** (Framer Motion's successor), plus raw CSS where it is cheaper | |
| Maps | **Leaflet** with OSM raster tiles; **MapLibre GL JS** where WebGL is available | The brief names Leaflet; MapLibre is the progressive upgrade |
| Forms | **React Hook Form** + Zod, sharing schemas with the API contract | |
| i18n | **Lingui** | Compile-time extraction, no runtime cost for the default locale |
| Pre-render | **vite-plugin-ssg** against the route manifest | [`31`](31-seo-prerender-deeplinks.md) |
| Hosting | **Cloudflare Pages** | Free tier; `_routes.json` keeps static assets off the Worker |
| Testing | Vitest, Testing Library, Playwright | |

Bundle budget: **≤ 160 KB gzipped** for the initial route, **≤ 42 KB** for the critical CSS.
Enforced by `lighthouse-budget` in CI, which fails the build on a regression.

---

## 3. Routing

```
/                              Home — zone-aware vendor list
/bn/                           Bengali mirror of every route
/r/:vendorSlug                 Vendor page                      [pre-rendered]
/r/:vendorSlug/:itemSlug       Item deep link                   [pre-rendered]
/c/:cuisineSlug                Cuisine landing                  [pre-rendered]
/a/:areaSlug                   Area landing — "Food delivery in Zindabazar"  [pre-rendered]
/a/:areaSlug/:cuisineSlug      Area × cuisine                   [pre-rendered]
/search                        Search
/cart                          Cart
/checkout                      Checkout
/o/:orderCode                  Order detail
/track/:orderCode              Live tracking
/account/*                     Account area
/partner/*                     Partner web console
/rider/*                       Rider web console
/join/restaurant               Vendor signup
/join/rider                    Rider signup
/about  /terms  /privacy  /licence  /help  /contact
/app                           Get-the-app page with QR codes
```

The `/a/:areaSlug/:cuisineSlug` cross-product is the SEO workhorse: "biriyani delivery in
Zindabazar" is a real query with real intent, and a pre-rendered page that answers it with actual
local vendors ranks. The route manifest is generated from the live vendor and zone data at build
time, so the set grows with the platform and never contains a page about a vendor who does not
exist.

---

## 4. The storefront

Visually identical in character to the Android app — same tokens, same motion language, same
component vocabulary — adapted to pointer input and large viewports.

### 4.1 Desktop layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  undal   📍 Shibganj, Sylhet ▾    🔍 Search          বাংলা  🛒 3  👤 │
├──────────────┬───────────────────────────────────────────────────────┤
│              │  ⚡ Flash Box                                         │
│  FILTERS     │  ┌────────┐┌────────┐┌────────┐┌────────┐            │
│              │  └────────┘└────────┘└────────┘└────────┘            │
│  Sort        │                                                       │
│  ○ Recommend │  All restaurants                        43 nearby    │
│  ○ Nearest   │  ┌──────────────┐┌──────────────┐┌──────────────┐   │
│  ○ Fastest   │  │   [photo]    ││   [photo]    ││   [photo]    │   │
│  ○ Top rated │  │ Rahman's     ││ Khan's Kitchen││ Panshi       │   │
│              │  │ 4.6★ (212)   ││ 4.4★ (89)    ││ 4.7★ (501)   │   │
│  Cuisine     │  │ 18min · 1.2km││ 24min · 2.1km││ 15min · 0.8km│   │
│  ☐ Bengali   │  │ ৳30 delivery ││ ৳45 delivery ││ ৳25 delivery │   │
│  ☐ Chinese   │  └──────────────┘└──────────────┘└──────────────┘   │
│  ☐ Fast food │  …                                                   │
│              │                                                       │
│  Dietary     │                                                       │
│  ☐ Veg       │                                                       │
│  ☐ Halal     │                                                       │
│              │                                                       │
│  Price       │                                                       │
│  ৳ ৳৳ ৳৳৳ ৳৳৳৳│                                                      │
└──────────────┴───────────────────────────────────────────────────────┘
```

The grid is `repeat(auto-fill, minmax(280px, 1fr))` — a genuine responsive grid that goes from one
column at 320 px to six at 1920 px without a single media query for the card count.

### 4.2 Parity with the Android app

Everything in [`17`](17-customer-app.md) exists here: three-step registration, address pinning on
a Leaflet map, the vendor page with scroll-synced category tabs, the item sheet with option
groups, the cart with itemised and explainable fee lines, the quote-then-reprice diff, live
tracking with an interpolated rider marker, order history, disputes, the taste profile with
one-tap deletion, and account deletion.

Four things differ, each for a real reason:

| Difference | Why |
| --- | --- |
| No alarm | A browser cannot wake a locked phone. Customers do not need one |
| Tracking uses SSE, with a 10 s poll fallback | No persistent socket when a tab is backgrounded on iOS Safari |
| Camera capture for dispute photos uses `<input capture>` | No CameraX |
| The cart lives in `localStorage` as well as on the server | A guest cart must survive a refresh before there is an account |

### 4.3 The cart capsule

The Android floating capsule ([`04 §5`](04-motion-and-interaction.md)) becomes a bottom-fixed bar
below 840 px and a sticky right-hand panel above it. On desktop the panel shows the full itemised
total, live, so the fee breakdown is visible without a click.

---

## 5. Responsive behaviour

The brief: *"responsive with zero structural break from 200px up."* The website carries the same
contract as the apps.

| Band | Layout |
| --- | --- |
| **200–319 px** | Single column. Logo becomes the mark only. Search collapses to an icon. Horizontal padding drops to 8 px. Vendor cards become list rows with a 64 px thumbnail. Everything remains reachable and nothing overflows |
| 320–383 | Single column, 12 px padding, full search field |
| 384–599 | Single column, 16 px padding, 16:9 card images |
| 600–839 | Two-column vendor grid, persistent bottom cart bar |
| 840–1023 | Filter rail appears, three-column grid |
| 1024–1279 | Four columns, sticky cart panel |
| 1280–1599 | Five columns, wider rail |
| 1600–1919 | Six columns, max content width 1 560 px |
| 1920–3840 | Content centred at 1 560 px with generous margins; **the layout stops growing** because a 3 000 px-wide line of text is unreadable |

**No fixed pixel widths anywhere** except icons, avatars and deliberate media aspect boxes. The
`no-fixed-width` CI job greps compiled CSS for `width:` with a `px` value above 64 outside an
allowlist. The `responsive-matrix` job screenshots every route at the 50 tested widths in both
themes and both languages and fails on overflow, clipping, or any touch target below 44 px.

### 5.1 Why 200 px

It is below any real device, which is the point: a layout that survives 200 px survives a Samsung
Fold's cover screen, a split-screen browser, a 400% browser zoom (which WCAG requires and which
reflows a 1 280 px viewport to an effective 320 px), and a car-dashboard browser. Designing to the
absurd floor removes an entire category of bug.

---

## 6. Performance

| Metric | Budget | How |
| --- | --- | --- |
| **LCP** | ≤ 1.8 s on 4G | Pre-rendered HTML, inlined critical CSS, the hero image as a `<link rel=preload>` with `fetchpriority=high` |
| **CLS** | ≤ 0.02 | Every image has intrinsic dimensions; fonts load with `size-adjust` metrics so the fallback occupies identical space |
| **INP** | ≤ 160 ms | No synchronous work over 50 ms; list virtualisation above 60 items |
| **TTFB** | ≤ 220 ms | Static from Cloudflare's edge |
| Initial JS | ≤ 160 KB gzip | Route-level code splitting; the home route pulls no map code |
| Critical CSS | ≤ 42 KB | CSS Modules, no utility framework, no unused rules |
| Fonts | 2 families, 4 weights, subset | Self-hosted WOFF2, Latin + Bengali subsets, `font-display: swap` with matched fallback metrics |
| Lighthouse | ≥ 95 on all four categories | `lighthouse-budget` in CI, failing the build below threshold |

### 6.1 Images

All vendor and item images come from **imgbb** ([`26`](26-media-pipeline.md)), which returns
multiple sizes. The `<img>` uses `srcset` across those sizes with `sizes` matching the grid, plus
`loading="lazy"` below the fold and `decoding="async"` everywhere. A blur-hash placeholder,
computed at upload and stored alongside the URL, renders as a tiny inline data URI so a card never
shows a grey rectangle.

When the browser sends `Save-Data: on` or reports `effectiveType` of `2g`/`slow-2g`, the component
drops to the smallest variant and disables the hero image entirely on the home route.

---

## 7. Offline and resilience

A service worker, registered after first paint, with a deliberately narrow scope:

| Asset | Strategy |
| --- | --- |
| App shell, JS, CSS, fonts | Cache-first with a versioned cache name |
| Vendor list | Stale-while-revalidate, 5 min |
| Vendor page data | Stale-while-revalidate, 30 min |
| Images | Cache-first, 100-entry LRU |
| API mutations | **Never cached.** Network-only, with an honest failure |
| Tracking | Network-only |

An offline banner appears on connection loss. Cached routes remain browsable with their fetch time
shown. Checkout refuses to proceed offline and says why, because a silently queued food order is
worse than a visible failure.

---

## 8. Partner and rider web consoles

iOS vendors and riders are not second-class, but they are honestly informed about what a browser
cannot do.

### 8.1 Partner console (`/partner`)

Everything in [`18`](18-partner-app.md) except the alarm:

- Live order board with Web Push (which works on iOS 16.4+ for installed PWAs) and an in-page
  audio alert while the tab is open.
- Menu management, hours, performance, invoices, device health, staff.
- QR display for handover, rotating on the same 60-second schedule.

The signup flow shows this before an iOS vendor commits:

```
   ⚠  You're using an iPhone

   The Undal Partner app for Android plays a loud
   looping alarm when an order arrives, even if the
   phone is locked and the app is closed. Safari
   cannot do that.

   On iPhone you will get:
     ✓ Everything else — orders, menu, hours, money
     ✓ A notification, if you add Undal to your
       Home Screen and allow notifications
     ✗ No loud alarm when the browser is closed

   Most restaurants keep a cheap Android tablet for
   this. If you can, we strongly recommend it.

   [ Continue on iPhone ]   [ How to use an Android tablet ]
```

That screen is more valuable than any feature on it. A vendor who learns this on day one buys a
tablet; one who learns it after missing four orders leaves.

### 8.2 Rider console (`/rider`)

A browser cannot run a reliable background location service, so the rider console is **not** a way
to work a shift. It provides: earnings, invoices, payout account, documents, performance, cash
settlement history, and profile. Shift start is disabled with a clear explanation and a link to
the Android app.

This is stated plainly at rider signup. An iOS-only rider cannot ride for Undal, and pretending
otherwise would waste their time and the platform's.

---

## 9. Accessibility

| Requirement | Implementation |
| --- | --- |
| WCAG 2.2 AA | The target, verified in CI |
| Contrast | 4.5:1 body, 3:1 large and UI. The `contrast` job checks every token pair actually used |
| Keyboard | Every interactive element reachable and operable; a visible focus ring that is never removed; a skip-to-content link |
| Screen readers | Semantic HTML first, ARIA only where semantics run out. Tested with NVDA and VoiceOver |
| Live regions | Cart totals, order status and form errors announce politely |
| Motion | `prefers-reduced-motion` honoured per [`04 §12`](04-motion-and-interaction.md) |
| Zoom | 400% zoom reflows without horizontal scrolling — the same contract as the 200 px band |
| Forms | Every input labelled; errors associated by `aria-describedby`; never colour alone |
| Language | `lang` on `<html>` and on any mixed-script span, so Bengali in an English page is pronounced correctly |

`a11y` runs axe-core over every pre-rendered route and over 24 interactive states, and fails the
build on any serious or critical violation.

---

## 10. Security

| Control | Value |
| --- | --- |
| CSP | `default-src 'self'; img-src 'self' https://i.ibb.co https://res.cloudinary.com data:; connect-src 'self' https://api.{domain}; frame-ancestors 'none'; script-src 'self'` — no `unsafe-inline`, no `unsafe-eval`; styles use nonces |
| HSTS | `max-age=63072000; includeSubDomains; preload` |
| Other headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying everything except geolocation and camera on the routes that need them |
| Tokens | Access token in memory only; refresh token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie |
| CSRF | Double-submit token on all cookie-authenticated mutations |
| Third-party scripts | **Zero.** No analytics SDK, no tag manager, no chat widget, no font CDN. Everything is first-party and self-hosted |

Zero third-party scripts is both a privacy position and a performance one: it is why the CSP can
be this strict and why the bundle budget is achievable.

---

## 11. The `/app` page

Where app-install links land, and where the brief's logos appear:

- Three cards, one per app, each with its logo from `brand/`, a short description, a Play Store
  button, and a **direct `.apk` download** from the latest GitHub release.
- A QR code per app, generated client-side.
- The honest iOS note from §8.1.
- System requirements and approximate download size.

The direct APK download matters in Bangladesh, where sideloading is common and Play Store access
is sometimes awkward. The page includes a short, non-condescending guide to installing from an
APK, including the "unknown sources" prompt.

---

## 12. Testing

| Test | Count |
| --- | --- |
| Component unit tests | 310 |
| Route integration (Testing Library) | 96 |
| End-to-end (Playwright, Chromium/Firefox/WebKit) | 48 journeys |
| Pre-render verification — HTML contains real content with JS off | every pre-rendered route |
| Responsive matrix, 50 widths × 2 themes × 2 languages | every route |
| Lighthouse budgets | every route |
| axe-core | every route + 24 interactive states |
| CSP violation monitor | report-only endpoint in staging; zero violations required to promote |
| Bundle size | per-route budgets |
| Visual regression | 1 200 snapshots |

---

## 13. Reading on

Next: [`21-admin-panel.md`](21-admin-panel.md) — two thousand counted features.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
