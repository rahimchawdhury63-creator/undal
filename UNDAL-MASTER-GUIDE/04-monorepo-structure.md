# 04 · Monorepo Structure & Coding Constitution

## 4.1 Repository layout (single repo: `undal`)

```
undal/
├─ README.md                        ← front door (from this guide)
├─ PASTE-THIS-PROMPT.md             ← founder's one-block starter
├─ UNDAL-MASTER-GUIDE/              ← this guide (kept forever, versioned)
├─ reference-images/                ← 170 source screenshots (read-only input)
├─ apps/
│  ├─ customer_app/                 ← Flutter (com.undal.customer)
│  ├─ partner_app/                  ← Flutter (com.undal.partner)
│  ├─ rider_app/                    ← Flutter (com.undal.rider)
│  ├─ customer_web/                 ← React+Vite+TS (Pages: undal-web)
│  └─ admin_web/                    ← React+Vite+TS (Pages: undal-admin)
├─ workers/
│  ├─ api/                          ← W1 undal-api
│  ├─ realtime/                     ← W2 undal-realtime
│  └─ admin/                        ← W3 undal-admin (+ cron)
├─ packages/
│  ├─ shared_ts/                    ← types, money, errors, validation (web+workers)
│  └─ undal_core/                   ← Dart: models, API client, design tokens (3 apps)
├─ supabase/
│  ├─ migrations/                   ← numbered SQL, applied by Actions only
│  ├─ seed/                         ← taxonomy seeds (cuisines, reasons) — NO fake restaurants
│  └─ tests/                        ← pgTAP / SQL assertion scripts
├─ firebase/
│  ├─ database.rules.json           ← RTDB rules (deployed by Actions)
│  └─ README.md                     ← console click-paths for founder (tablet)
├─ infra/
│  ├─ cloudflare/                   ← wrangler.toml per worker/pages notes
│  └─ scripts/                      ← CI helper scripts (Node/Python, documented)
├─ docs/
│  ├─ understanding/                ← builder's Plan Response 1–2 documents
│  ├─ adr/                          ← architecture decision records (from D-01…)
│  ├─ runbooks/                     ← ops playbooks (tablet-friendly)
│  └─ api/                          ← generated OpenAPI + Postman-free curl examples
└─ .github/workflows/               ← the entire factory floor (file 24)
```

Package IDs / slugs are placeholders for the founder's real domain: the build must derive web origins,
deep-link hosts, and app IDs from **GitHub Variables** (`UNDAL_WEB_DOMAIN`, `UNDAL_ADMIN_DOMAIN`, `UNDAL_APP_ID_PREFIX`)
so switching from subdomain → purchased domain is a variable change + redeploy, never a code hunt.

## 4.2 Coding constitution (all languages)

1. **≤500 lines/file** (excluding generated files, which live in `*.g.*` / `generated/` and are never hand-edited).
   Split by feature, not by “utils2”. CI fails the build on violation (file `26`).
2. **File header block:** purpose, owner surface, key invariants. **Every public API documented** (DartDoc / TSDoc / SQL `COMMENT ON`).
   Comments explain *why*, code shows *what*. No commented-out code in `main`.
3. **No placeholders:** forbidden strings in CI grep-gate: `TODO`, `FIXME`, `lorem`, `example.com` (outside tests), `coming soon`
   (in UI copy), empty `onPressed: () {}` / `onClick={() => {}}`. A button that renders must work.
4. **Errors are typed:** shared error-code catalogue (Appendix G); user copy EN+BN for every code; raw exceptions never reach UI.
5. **Money:** `Poisha` integer type (Dart class / TS branded number / SQL `bigint` + `*_poisha` suffix). Division rounding:
   half-up, documented at each money boundary (file `10`).
6. **State machines, not flags:** order/rider/vendor/invoice states transition only via guarded functions (file `22` diagram).
7. **Feature-first folders:** `features/orders/{data,domain,presentation}` in Flutter; `features/orders/{api,components,pages}` in React.
8. **Localisation from line 1:** no hardcoded UI strings (ARB for Flutter, i18n JSON for React) EN + BN keys paired (Appendix H seed).
9. **Accessibility:** semantic labels, ≥48 dp targets, dynamic type to 200%, contrast ≥4.5:1 (checked tokens in file `25`).
10. **Performance budgets:** app cold-start ≤2.5 s mid-phone; list screens 60 fps (const widgets, cached images);
    web JS ≤200 KB gz initial route; images always sized (no layout shift).
11. **Tests ride with code:** each Build Response ships its tests in the same response (matrix in file `26`).
12. **Branch discipline:** work on the session branch → PR → CI green → merge to `main` → auto-deploy. Direct pushes to `main` disabled.

## 4.3 Naming & ID conventions

- DB: `snake_case`, tables plural (`orders`, `order_items`), PK `id uuid`, FK `{table}_id`, timestamps `*_at timestamptz`,
  money `*_poisha bigint`, geo `lat/lng double precision` + `geohash text`.
- Public order code: `UD-{zone2}-{yyyymmdd}-{seq}` (human, phone-readable) + internal UUID (never exposed sequentially).
- API: `/v1/...` REST + RPC-style action endpoints for transitions (`POST /v1/orders/{id}/accept`); error envelope
  `{ error: { code, message_en, message_bn, details? }, request_id }`.
- RTDB keys: short (`o/{orderId}`, `r/{riderId}`, `v/{vendorId}`) to save bytes (file `06`).
- FCM `data.type` enum in file `07` is the single registry — new types require guide + code change together.

## 4.4 Environments

`prod` only at launch + `staging` Supabase/Firebase projects (both free) wired to preview Pages deployments.
GitHub Environments (`staging`, `production`) hold per-env secrets; PR previews never touch prod data.
Seed data = taxonomy only (cuisines, cancel reasons, settings defaults). **Fake restaurants/orders are forbidden** —
staging test fixtures live in `supabase/tests/fixtures/` and are purged by test teardown.
