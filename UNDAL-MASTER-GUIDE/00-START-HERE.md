# UNDAL — Master Build Guide · START HERE

> **Undal — Food Delivery & Pickup** · Multi-vendor · Cash on Delivery only · 100% free stack ·
> 3 Android apps (Customer / Partner / Rider) + Customer Website + Super Admin Web ·
> Supabase + Firebase RTDB/FCM + 3 Cloudflare Workers + ImgBB + OpenStreetMap · Bangladesh-first (BDT ৳, Asia/Dhaka, EN + বাংলা)

This folder is the **single source of truth** for building Undal. It was produced by deep analysis of
**170 reference screenshots** in [`../reference-images/`](../reference-images/) (Foodpanda Customer App,
Customer Web, Partner App, Rider App + Uber Eats rider offer screens) and the founder's full requirement brief.
**32 screenshots were pixel-inspected one-by-one** for this guide; the remaining 138 are inventoried in
Appendix A and **must each be opened by the builder AI** during its planning responses (see `27-builder-protocol-32-responses.md`).

---

## 1. How to use this guide (founder)

1. Read `01-vision-scope-decisions.md` — it locks every contradiction in the original brief into one decision each.
2. Do the **one-time accounts checklist** in `24-github-actions-cicd-secrets.md` §2 (all from your Android tablet browser — no PC, no local CLI, ever).
3. Copy the small block from [`../PASTE-THIS-PROMPT.md`](../PASTE-THIS-PROMPT.md) into Arena AI Agent Mode (or any builder AI with repo access).
4. The AI replies with **Plan Response 1 and 2** (understanding documents). Reply `continue` to advance through **Build Responses 1–30**.
5. Everything deploys automatically through GitHub Actions. You only ever: paste secrets, tap `continue`, download APKs from GitHub Releases.

## 2. How to use this guide (builder AI) — non-negotiable reading order

| Step | File | Why |
|---|---|---|
| 1 | `01-vision-scope-decisions.md` | Scope locks, decision log D-01…D-24, what Undal deliberately is NOT |
| 2 | `02-reference-screenshot-analysis.md` + Appendix A | Every reference screen, feature, UX pattern, and what Undal improves |
| 3 | `03-system-architecture.md` | The whole machine on one map |
| 4 | `05` → `15` (backend/data/algorithms) | Postgres, RTDB economy, FCM alert engine, Workers, money, fare, dispatch, ranking, maps, images |
| 5 | `16` → `20` (five frontends) | Screen-by-screen specs for all 3 apps + web + admin |
| 6 | `21` → `23` | KYC onboarding, order lifecycle/chat/reviews, payouts & rider cash |
| 7 | `24` → `26` | CI/CD & secrets, brand/design system, testing gates |
| 8 | `27-builder-protocol-32-responses.md` | Your marching orders: 2 plan + 30 build responses |
| 9 | `28-master-build-prompt.md` | The full master prompt (this guide in prompt form) |
| 10 | `appendices/` | Machine-checkable catalogues: DB dictionary, API catalogue, admin registry, cuisines, tests, errors |

## 3. The five surfaces

| # | Surface | Tech | Hosted / delivered by |
|---|---|---|---|
| 1 | Undal Customer App (Android) | Flutter + native Kotlin FCM/geo plugins | Signed APK + AAB from GitHub Actions Releases |
| 2 | Undal Partner App (Android) | Flutter + native Kotlin alarm engine | Signed APK + AAB from Actions |
| 3 | Undal Rider App (Android) | Flutter + native Kotlin alarm/geo/QR engine | Signed APK + AAB from Actions |
| 4 | Undal Customer Website | React + Vite + TypeScript, build-time prerender (SSG) | Cloudflare Pages |
| 5 | Undal Super Admin | React + Vite + TypeScript | Cloudflare Pages (separate project + its own Worker) |

Backend: **Supabase** (Postgres system-of-record, Auth, private Storage, SQL) · **Firebase RTDB** (ephemeral
realtime only) · **FCM** (data-only wake-ups) · **3 Cloudflare Workers** (API, Realtime-Dispatch, Admin-Ops) ·
**ImgBB** (public food imagery, proxied) · **OSM + Nominatim + OSRM** (maps/geocode/routing).

## 4. Golden rules (violation = failed build)

1. **Food only.** Delivery + Pickup from Restaurant / Home Kitchen / Cloud Kitchen. No groceries, no shops, no pharmacy in v1.
2. **COD only.** Cash on Delivery (and cash on pickup). No online payment gateway anywhere.
3. **Free tiers only.** Every service must run on its free plan. Each guide file carries its quota budget.
4. **No demo, no placeholder, no fake data, no `TODO`, no dead buttons.** If a feature cannot be finished in its assigned response, it is carried to the next response — never faked.
5. **Money is integer poisha** (100 poisha = ৳1) in every DB column, API field, and calculation. Floats for money are a build failure.
6. **No secret ever enters the repo, an APK, or web JS.** Secrets live only in GitHub Actions Secrets → injected into Workers/Pages at deploy.
7. **Files ≤ 500 lines**, every file header-documented, every public function documented.
8. **Server is truth.** Prices, fares, discounts, and order states are computed/validated in Workers + Postgres — never trusted from a client.
9. **Honesty over magic.** Where Android/Firebase physically cannot guarantee something (e.g., waking a *force-stopped* app), implement the strongest possible mechanism **plus** the documented fallback. Never claim the impossible (see `07-fcm-data-only-alert-engine.md` §2).
10. **Tablet-only operations.** Every founder task must be doable from an Android tablet browser. No local CLI steps anywhere.

## 5. Guide map (all files)

`00` Start Here · `01` Vision/Scope/Decisions · `02` Screenshot Analysis · `03` Architecture · `04` Monorepo ·
`05` Supabase/Postgres · `06` RTDB Realtime Economy · `07` FCM Alert Engine · `08` 3 Workers · `09` Auth/RBAC/Security ·
`10` Money/Commission/Invoices · `11` Rider Fare & Surge · `12` Assignment/Batching/Presence · `13` Ranking (10-stage) ·
`14` Maps/Zones · `15` Images · `16` Customer App · `17` Partner App · `18` Rider App · `19` Customer Web + SEO ·
`20` Super Admin · `21` Onboarding/KYC · `22` Orders/Chat/Reviews · `23` Payouts & Rider Cash · `24` Actions CI/CD & Secrets ·
`25` Brand & Design System · `26` Testing & Quality Gates · `27` Builder Protocol (32 responses) · `28` Master Build Prompt ·
`appendices/A–N` catalogues · `brand/` logo SVGs · `sounds/` order-alert loop · `env/` example env/secret files.

**Word-count & coverage honesty:** this guide's exact word count is printed by `wc -w` in the delivery report and in
`appendices/L-guide-coverage-report.md`. Appendices are generated from structured catalogues (real schemas, real endpoint
lists, real screenshot filenames) — never lorem-filler. Where the founder asked for “100,000+ words”, the protocol in file
`27` additionally requires the builder AI to expand its two planning responses into `docs/understanding/` inside the product
repo, so total project documentation grows past that mark during the build itself, with every section tied to shipped code.
