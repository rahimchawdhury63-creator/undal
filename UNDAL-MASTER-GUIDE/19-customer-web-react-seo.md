# 19 · Customer Website (React + Vite + TypeScript, Prerendered, Cloudflare Pages)

The website is a **full peer** of the customer app (same W1 APIs, same ranking) and the **iOS answer** (D-01 scope).
Reference basis: file `02` §2.2.

## 19.1 Pages & routes (all public routes prerendered — §19.3)

```
/                      Home (location-aware feed; generic + popular for crawlers/first paint, hydrated personalisation)
/r/{vendor-slug}       Restaurant/menu (category tabs, in-menu search, sticky cart rail → bottom bar mobile)
/r/{slug}/reviews      Reviews
/cuisine/{slug}        Cuisine landing per zone-agnostic taxonomy (SEO)
/area/{zone-slug}      Zone landing (“Food delivery in {area}”) (SEO)
/offers                Flash Box + promotions index
/search                Search results (noindex)
/checkout, /cart       Transactional (noindex, auth-gated at order step)
/orders, /orders/{code}  History + live tracking (map via Leaflet + RTDB web SDK under file-06 lease rules)
/account/*             Profile, addresses, favourites, vouchers, rewards, notifications
/help, /legal/*        Help center, Terms, Privacy, Refund(COD-adjustment) policy EN/BN
/partner, /rider       Recruitment landings → app downloads + onboarding start (lead capture → Admin pipeline)
/app                   App download (QR + Play badge + direct APK release link)
```

Header (logo, address selector w/ map modal, search, account menu like reference dropdown, EN/বাংলা, cart), mode tabs
Delivery/Pick-up, footer (cities/zones links, company, legal, social). App-open smart banner (mobile web): “Open in Undal app”.

## 19.2 Responsive system (D-15)

Breakpoints `240,320,360,480,768,1024,1280,1600`; container queries for cards; feed grid 1→2→3→4 cols; filters:
left rail ≥1024, bottom-sheet below; cart: right rail ≥1024, sticky bar + drawer below; vendor menu 2-col ≥768 else 1-col;
no horizontal scroll at 240 px (tested, file `26`); touch + keyboard + screen-reader complete (focus rings, aria-live for cart/ETA).

## 19.3 Prerender + SEO pipeline (free, Actions-driven — D-18)

Build: Vite SPA build → **prerender step** (builder picks `vite-plugin-ssg`/custom Node renderer with route manifest —
document ADR) generating static HTML for `/`, `/r/*` (all approved vendors from Supabase snapshot), `/cuisine/*`, `/area/*`,
`/offers`, legal/help. Each page: unique `<title>`/description (templates + vendor data), canonical, OG/Twitter cards
(cover image), JSON-LD (`Restaurant`, `Menu`, `AggregateRating`, `BreadcrumbList`), hreflang EN/BN, real menu content in HTML
(no empty shell — crawlers see dishes/prices). `sitemap.xml` + `robots.txt` generated; `lastmod` from vendor `updated_at`.
Freshness: nightly scheduled rebuild + debounced deploy-hook on vendor/menu changes (W3, max 1/15 min, within Pages free builds).
Hydrated app then live-updates prices/availability; stale-price guard at cart (server truth). Images: ImgBB URLs with
width/height + lazy + `srcset` via ImgBB thumb variants where available; LCP image preloaded per vendor page.

## 19.4 Deep links / App Links (web ⇄ app one platform)

`https://{domain}/.well-known/assetlinks.json` (SHA-256 from the release keystore — injected by Actions from secrets,
never hand-copied) + Android `autoVerify` intent filters for `/r/*`, `/orders/*`, `/offers`, `/app`.
Installed app → links open natively at the right screen; not installed → web page with smart banner. QR codes (web download
card §2.2, invoice, print) encode these URLs. Domain-agnostic: everything derives from `UNDAL_WEB_DOMAIN` variable;
changing domains = variable + DNS + redeploy (runbook), old domain 301s via Cloudflare rules.

## 19.5 Web-specific systems

Auth (Supabase JS, same providers), cart sync with app (server cart), live tracking (RTDB JS SDK + polling fallback),
web push **not** in v1 (FCM web push needs extra config; inbox + email cover web-only users — documented honestly),
analytics = same first-party events (file `13` §4) with cookie consent (essential-only default).
Performance budgets (file `26`): LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 on reference Moto device/4G emulation in CI (Lighthouse).
