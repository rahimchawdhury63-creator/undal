# Undal — Food Delivery & Pickup 🍲

**Bangladesh's most honest food platform.** Multi-vendor · **Food only** (Restaurants, Home Kitchens, Cloud Kitchens) ·
**Cash on Delivery only** · Real-time everything · **No ads / no paid ranking** · Built entirely on **free infrastructure**.

> 📋 **Status:** Master blueprint complete. Product code is built by following the protocol below.
> 👉 **Start building:** copy the block in **[PASTE-THIS-PROMPT.md](PASTE-THIS-PROMPT.md)** to your AI agent.

![Undal](UNDAL-MASTER-GUIDE/brand/undal-logo-primary.svg)

## What gets built (5 surfaces, 1 backend)

| Surface | Tech |
|---|---|
| Customer App (Android) | Flutter + Kotlin |
| Partner App (Android) | Flutter + Kotlin alarm engine |
| Rider App (Android) | Flutter + Kotlin geo/QR/alarm |
| Customer Website | React + Vite + TS (prerendered SEO) → Cloudflare Pages |
| Super Admin | React + Vite + TS → Cloudflare Pages |

Backend (all free tiers): **Supabase** (Postgres/Auth/Storage) · **Firebase RTDB + FCM** (data-only) ·
**3 Cloudflare Workers** · **ImgBB** (public photos) · **OpenStreetMap + OSRM + Nominatim** ·
Everything deploys via **GitHub Actions** (including signed APK/AAB) — founder operates from an Android tablet.

## Economics (locked, transparent)

Vendor: **15% commission**, 5% VAT-inclusive extraction, **৳0 listing fee**, paid **Saturdays**.
Rider: dynamic fare (base + ৳14/km motorbike · ৳8/km bicycle + surge/weather/traffic) **+ 3% bonus every order**, paid **Fridays** via bKash.

## Repository map

| Path | What |
|---|---|
| [`PASTE-THIS-PROMPT.md`](PASTE-THIS-PROMPT.md) | The one block to start the AI build |
| [`UNDAL-MASTER-GUIDE/`](UNDAL-MASTER-GUIDE/00-START-HERE.md) | 29-file production blueprint + 12 appendices + brand/sounds/env |
| [`reference-images/`](reference-images/) | 170 Foodpanda/Uber-Eats reference screenshots (builder input) |

## The blueprint in one breath

`00` Start · `01` Locked decisions D-01…D-24 · `02` Screenshot deep-analysis · `03` Architecture · `04` Monorepo ·
`05` Postgres · `06` RTDB connection economy · `07` FCM never-miss-an-order engine · `08` 3 Workers · `09` Auth/RBAC/Security ·
`10` Money & invoices · `11` Fare & surge · `12` Smart dispatch/batching · `13` 10-stage no-ads ranking · `14` OSM/zones ·
`15` Images · `16–20` Five frontends screen-by-screen · `21` KYC · `22` Order lifecycle/QR/chat · `23` Payouts/cash ·
`24` Actions CI/CD · `25` Brand · `26` Testing gates · `27` 2-plan + 30-build protocol · `28` Master prompt ·
Appendices A–L: screenshot inventory, DB dictionary, admin registry, 117-cuisine taxonomy, API catalogue,
**machine-computed money/fare golden vectors**, error codes EN/BN, i18n seed, glossary, launch copy, runbooks, coverage.

Real food. Real-time. No games. — আসল খাবার, সত্যিকারের দ্রুত।
