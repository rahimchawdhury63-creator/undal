# 01 · Vision, Scope & Locked Decisions

## 1.1 One-sentence vision

**Undal is Bangladesh's most honest food platform: food-only, COD-only, zero paid ranking, real-time everything,
built entirely on free infrastructure — proving a world-class delivery platform needs intelligence, not money.**

Tagline (EN): *“Real food. Real-time. No games.”* · Tagline (BN): *“আসল খাবার, সত্যিকারের দ্রুত।”*
(“Undal” evokes the Sylheti/Bangla warmth of a home stove — প্রতিটি অর্ডার যেন বাড়ির রান্নাঘর থেকে.)

## 1.2 Who it serves (4 actor families)

| Actor | Surfaces | Core promise |
|---|---|---|
| Customer | Android app + Website (iOS users use the website) | Find great food near me, order in under a minute, watch it arrive live, pay cash |
| Partner (Restaurant / Home Kitchen / Cloud Kitchen) | Android Partner app | Never miss an order (alarm-grade alerts), full menu control, fair 15% + 5% — no ads tax |
| Rider (Motorbike / Bicycle) | Android Rider app | Fair transparent fare, smart nearby offers, weekly Friday payout, no cash-out charge burden |
| Undal Ops (Super Admin + staff roles) | Admin web | Total live control: zones, dispatch, money, moderation — from any browser |

## 1.3 Scope LOCK — v1 IN

- Food **delivery** + **pickup** only; vendor types: `RESTAURANT`, `HOME_KITCHEN`, `CLOUD_KITCHEN`.
- Multi-vendor, multi-zone (polygon delivery zones drawn in Admin), single country (BD), single currency (BDT), EN + BN UI.
- COD for delivery; cash-on-pickup for pickup orders. Rider collects cash; weekly settlements via bKash/Nagad/Bank (manual send, system-generated invoices).
- Real-time: order status, rider live tracking, chat (customer↔rider, customer↔vendor, rider↔vendor), presence, dispatch.
- Discovery: geo + 10-stage performance ranking (file `13`), search (restaurants/cuisines/dishes), filters, favourites, reorder, vouchers, vendor-funded + platform-funded discounts, **Flash Box** campaigns (25% class), pickup discounts, first-order offers — all rule-driven from Admin, **no CPC/ads ranking ever**.
- Ratings/reviews for vendors + riders; vendor replies; moderation.
- Full KYC onboarding pipelines (file `21`) with Admin verification queues.
- Super Admin enterprise panel (file `20`) across the 9 domains in the founder brief, adapted to free-stack reality.

## 1.4 Scope LOCK — v1 OUT (explicitly forbidden to build)

Groceries / pandamart-style shops / pharmacy / convenience · online payments (cards, bKash online checkout, wallets holding customer money) ·
paid ads / CPC / sponsored ranking · iOS native apps (website serves iOS) · dine-in reservations · pre-order scheduling beyond “order now”
(home kitchens are on-demand per founder rule) · multi-country/multi-currency code paths (schema keeps `currency='BDT'` constant, no dead branches) ·
phone-OTP login (paid SMS — replaced by email+password, Google OAuth, phone-as-identifier + password; see D-09).

## 1.5 Decision log (every contradiction in the brief, resolved once, forever)

| ID | Conflict in brief | **LOCKED DECISION** | Rationale |
|---|---|---|---|
| D-01 | “ONLY FOOD” vs “Undal – food and groceries” | **Food only.** Brand lockup: **“Undal — Food Delivery & Pickup.”** Remove “groceries” from all copy/store listings. Existing grocery tabs in reference screenshots are *not* copied. | Founder's first line + title; groceries would double catalog/ops complexity and break free-tier budgets. |
| D-02 | Sensitive docs: “convert to SVG in DB” vs “Cloudinary unsigned preset” | **Neither.** Sensitive docs → **Supabase Storage PRIVATE bucket** + RLS + short-lived signed URLs (free 1 GB; docs are small JPEG/PDF). Raster→SVG is technically harmful (bloat, no security). *Unsigned* presets let anyone upload and URLs are public-guessable — unacceptable for NID/licences. Cloudinary **signed** upload (signed by Worker) is documented as the overflow alternative in file `15`. | Security law #1: identity documents are never public. |
| D-03 | ImgBB API key pasted in chat/brief | **Treat as burned. Founder must rotate it** (imgbb.com → API → regenerate) and store only as GitHub secret `IMGBB_API_KEY`. The key value must **never** appear in this repo, guide, code, or screenshots again. All uploads go **client → Worker-1 proxy → ImgBB** so the key exists only inside the Worker. | A key pasted in plaintext is compromised forever. Proxying also enables rate-limit/compression. |
| D-04 | “Alert must play even if app is killed, 100% guaranteed” | Implement the **strongest legal Android mechanism** (high-priority data-only FCM → native foreground alarm service → full-screen intent → alarm-stream loop) **+ OEM autostart whitelist onboarding + presence-based auto-cancel/re-offer fallbacks**. Honest limit: a **force-stopped** app (Settings → Force Stop, or aggressive OEM killers before whitelisting) receives *nothing* until reopened — this is Android OS design; no app on Earth (including Foodpanda/Uber) bypasses it. Undal's fallback chain (file `07` §7) makes the *order* safe even when a *device* is unreachable. | Engineering honesty; promising the impossible would ship a lie. |
| D-05 | “Offline detection in 2 seconds” | Heartbeat every **10 s** while online-in-app; dispatch treats silence **>25 s** as *stale* (not offered new orders), **>60 s** as offline; vendor-unreachable order auto-cancel at **120 s** exactly as founder specified. Thresholds are Admin-configurable. 2-second detection over BD mobile networks would false-offline half the fleet. | Physics of mobile networks; same end-result (no order sent into a black hole) without false positives. |
| D-06 | “Invoices auto-generate, no cron, never fails” | **Cloudflare Cron Triggers (free)** on Worker-3 generate rider invoices Fri 00:05 and vendor invoices Sat 00:05 Asia/Dhaka, **plus** idempotent lazy generation: the first read after a period closes generates any missing invoice inside a DB transaction. Double-path = cannot be missed, cannot duplicate (`UNIQUE(period, payee)`). | “No cron” is impossible for time-triggered work; dual-path *is* the never-fails design. |
| D-07 | “3% rider bonus from the vendor 5% tax” | Bonus = **3% of discounted food subtotal**, credited to rider on each delivered order, funded from Undal's collected 5% tax share (Undal keeps 2% of that stream; 15% commission untouched). Never deducted from customer. Exact ledger in file `10` §4. | Founder's numbers; needs one exact base definition or invoices will disagree. |
| D-08 | Tax 5%: on top or included? | Menu prices are **VAT-inclusive** (exactly like reference screenshots: “VAT (Incl.) ৳25.76” extracted from ৳541). Tax amount = `round(subtotal_after_discount × 5/105)`. Customer never sees tax added on top. | Matches BD foodpanda presentation in screenshots; avoids checkout price shock. |
| D-09 | Auth: “Google + 10 more OAuth, phone, no OTP” | Supabase Auth: **email+password ON, Google ON**; Facebook, Apple, GitHub, Discord, Twitter/X, Microsoft, Spotify, Twitch, LinkedIn, GitLab **coded as config-gated provider buttons, default OFF**, enabled from Admin → Settings → Auth Providers (founder adds provider keys in Supabase dashboard). Phone = profile identifier + password login (phone+password), **no SMS OTP** on free tier. Multi-step signup ends with address pin (customers). | Free-tier reality + founder's plugin idea, made concrete. |
| D-10 | Maps: “OSM” + “rider opens Google Maps” | In-app maps/rendering/routing/geocoding = **OSM + OSRM + Nominatim** (free, with caching + usage-policy compliance, file `14`). Rider “Navigate” button fires Android intent `google.navigation:q=lat,lng` with `geo:` fallback — uses whatever maps app the rider has; costs Undal nothing. | Best of both; zero Google Maps API billing. |
| D-11 | “Flash box 25% like pandabox” | Feature name: **Undal Flash Box** — vendor-opt-in campaign: 25% off (configurable 5–40%), min-order + max-cap, funding split vendor/platform set per campaign (default vendor-funded), shown as a timed home-feed module with countdown (as screenshots' “Save 25% Flash Deals 44:15”). | Keeps the beloved mechanic, drops the trademark. |
| D-12 | Partner app reference has **Ads/CPC** tab | **Undal has NO ads product.** The 4th Partner tab becomes **Growth**: free analytics (impressions, menu views, conversion, customer mix — same charts as screenshots) + ranking-factor transparency (“why you rank here”) + promotion builder. Ranking is never purchasable. | Founder: “no ads or CPC… Undal will be authentic.” This is Undal's #1 differentiator. |
| D-13 | Customer reference has pandapro/subscription, pandapay wallet | v1 **OUT** (paid subscription + stored-money wallet contradict COD-only/free rules and need payment rails). Replaced by: free **Undal Rewards** (points → vouchers, no cash value stored) + voucher engine. PRO-style discount badges in screenshots map to Flash Box/vendor promotions. Schema leaves a clean seam for a future membership. | COD-only lock; no fake wallet balances. |
| D-14 | “2000+ admin features” | Appendix C enumerates the **actual Admin feature registry** (every screen × capability × permission) with a truthful machine count. The panel covers all 9 founder domains deeply; the registry — not marketing — is the contract. Builder must implement 100% of `P0` rows before any `P1`. | Counts you can audit beat counts you can only claim. |
| D-15 | “100% responsive 200px → 50 breakpoints” | 8 canonical breakpoints `240 / 320 / 360 / 480 / 768 / 1024 / 1280 / 1600+` px, fluid type/space scales between them, tested matrix in file `26`. No layout may horizontally scroll at 240 px. | 50 breakpoints is unmaintainable; 8 + fluid = truly unbreakable. |
| D-16 | Rider fixed cash-remittance screen | Blocking **in-app** gate (cannot go online / accept orders until remittance submitted) with ticking reminder sound at shift-end window — **plus** support-override code path and emergency exit (call support). Never a device-level lock (Android forbids true kiosk lock for consumer apps; safety/legal). | Same enforcement power, compliant implementation. |
| D-17 | Languages for Android: “Flutter, Dart, Kotlin, Java and more” | **Flutter/Dart** for UI/business logic; **Kotlin** for native modules (FCM alarm service, foreground geo service, QR/CameraX bridge, OEM intents). No Java (Kotlin supersedes it; one native language = fewer defects). TypeScript (web/Workers), SQL (Postgres). | Modern, minimal, hireable stack. |
| D-18 | SEO “prerender, full content for crawlers” | Build-time SSG prerender of all public routes + per-restaurant/menu pages generated from Supabase at build (nightly + on-demand rebuild webhook), dynamic `<head>`/OG/JSON-LD, sitemap.xml, robots. App-open banner + **Android App Links** (`assetlinks.json`) so web links open the app when installed. | File `19` gives the exact pipeline on free Pages/Actions minutes. |
| D-19 | Weather/traffic inputs for fare engine (free?) | Weather: **Open-Meteo API** (free, no key) cached per zone 15 min by Worker-2. Traffic delay: derived from OSRM free-flow duration vs live rider ETA telemetry in-zone (self-calibrating), Admin manual override per zone (“rain/storm mode”). No paid traffic API. | Keeps the founder's fare schema 100% while staying free. |
| D-20 | Realtime chat + location + presence all on RTDB Spark (100 conns) | **Connection economy** (file `06`): RTDB only for *active-order* participants (≤3 conns/order, auto-detach on completion); idle presence = Worker heartbeat → Supabase; chat history = Supabase (RTDB only carries live fan-out while order active, then persisted). Sized math included; scale path (second RTDB instance sharding by zone) documented. | The only way Spark survives real usage. |
| D-21 | “World-first / proven best” claims | Marketing may say “Bangladesh's most transparent food platform.” Engineering docs use **measurable SLAs** instead (alert latency p95, dispatch time, invoice accuracy tests). Quality is proven by the test gates in file `26`, not adjectives. | Credibility with partners/riders/regulators. |
| D-22 | Prep time “max 200 minutes, +/− like Foodpanda” | Accept-order sheet: smart default (file `12` §5) with −/+ stepper **5–200 min**, quick chips (10/15/20/30/45/60), reason required >60 min. Customer ETA recomputes instantly. | Founder spec, bounded against abuse. |
| D-23 | Rider reject rules | Reject allowed **only if ≥1 eligible backup rider exists in-zone** (else button becomes “Request reassign” → dispatcher logic + Admin alert); reason mandatory (chip + optional text); rejections feed the assignment score, never instant punishment. | Founder spec; protects the customer. |
| D-24 | Pickup for home kitchens: brief says home-chef “pick-up not supported” (copied Foodpanda note) vs platform “delivery and pickup” | **Pickup is per-vendor opt-in** for all three vendor types; default ON for restaurants, default OFF for home kitchens (privacy of home address — pickup shows only an Admin-approved pickup point label + pin they choose). | Safety for home chefs; founder's platform-level pickup promise kept. |

## 1.6 Business constants (v1 defaults — all Admin-editable, nothing hard-coded)

Commission **15%** · Tax (VAT-incl. extraction) **5%** · Rider bonus **3%** (from tax stream) · Monthly listing fee **৳0** ·
Per-km rider rate: Motorbike **৳14/km**, Bicycle **৳8/km** · Bicycle max radius **4 km**, Motorbike **12 km** (zone-tunable) ·
Vendor payout day **Saturday**, Rider payout day **Friday** (Asia/Dhaka) · Payout rails: bKash Send Money (recommended, cash-out charge added on top by Undal), Nagad, Bank ·
Prep stepper 5–200 min · Vendor-unreachable auto-cancel 120 s · Min opening: 4 h/day, 5 days/week (both vendor tracks) ·
Rider age ≥18 · Android min SDK 26 (Android 8) target latest stable.

## 1.7 Success definition for v1 (measurable)

Order placed → vendor alarm starts **p95 ≤ 5 s** on whitelisted devices · order → rider assigned **p95 ≤ 45 s** in staffed zones ·
live-tracking point age **≤ 8 s** while order active · invoice math **0** mismatches across property-based tests (file `26`) ·
web LCP **≤ 2.5 s** on Moto G-class 4G · free-tier headroom dashboards green at 500 orders/day (file `06` capacity table).
