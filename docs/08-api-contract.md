<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 08 — API Contract

> 412 endpoints across three Workers. This document is the contract: a client that follows it and a
> server that implements it cannot disagree. The OpenAPI 3.1 document is **generated from the Zod
> schemas**, not hand-written, so it can never drift — `packages/api-types` is the shared source and
> both the TypeScript clients and the Kotlin clients are generated from it.

---

## 1. Conventions

| Aspect | Rule |
| --- | --- |
| Base URL | `https://api.undal.app` (from `PUBLIC_API_BASE` — never hardcoded) |
| Version | Path-prefixed: `/v1/...`. A breaking change mints `/v2`; `/v1` is supported for 180 days. |
| Content type | `application/json; charset=utf-8` everywhere, except media upload (`multipart/form-data`) |
| Auth | `Authorization: Bearer <opaque-session-token>` |
| Device binding | `X-Undal-Device: <fingerprint>` required on every authenticated request |
| App identity | `X-Undal-App: customer\|partner\|rider\|web\|admin` and `X-Undal-App-Version: 1.4.2` |
| Correlation | `X-Undal-Request-Id`: client may supply; server echoes |
| Idempotency | `Idempotency-Key: <uuid>` required on every `POST`, `PATCH`, `DELETE` that mutates |
| Locale | `Accept-Language: bn\|en`; drives `message` vs `messageBn` selection and content localisation |
| Time | All timestamps ISO-8601 with `Z`. Clients convert to Asia/Dhaka for display. |
| Money | Always an integer field named `*Paisa`. **No endpoint ever returns a decimal money value.** |
| Pagination | Cursor-based: `?cursor=<opaque>&limit=<1..100>`. Response carries `meta.nextCursor`. |
| Sorting | `?sort=field:asc,other:desc` from a per-endpoint allowlist |
| Partial responses | `?fields=a,b,c` on list endpoints that support it |
| Compression | `br` preferred, `gzip` accepted |

### 1.1 The envelope

Defined in [`05 §3.4`](05-system-architecture.md). Every response, without exception, matches it.

### 1.2 HTTP status usage

| Status | Meaning in Undal |
| --- | --- |
| `200` | Success with a body |
| `201` | Resource created; `Location` header set |
| `202` | Accepted; the work is asynchronous and `data.trackingId` is returned |
| `204` | Success, no body (only on `DELETE`) |
| `400` | Validation failure. `error.field` names the first offending path. |
| `401` | No session, expired session, or device mismatch |
| `403` | Authenticated but not permitted. `error.details.requiredPermission` names it. |
| `404` | Not found **or** not visible to this actor — the two are deliberately indistinguishable |
| `409` | State conflict (wrong order state, idempotency conflict, duplicate unique key) |
| `410` | Resource existed and is gone (an expired offer, a retired zone) |
| `422` | Semantically invalid: schema-valid but business-rule-violating |
| `429` | Rate limited. `Retry-After` set. |
| `451` | Blocked for legal/compliance reasons (a banned actor) |
| `500` | Unhandled. Logged with a fingerprint. `error.code = "INTERNAL"`. |
| `503` | A dependency is down and the request cannot be served degraded |

---

## 2. Authentication

### 2.1 The model

No OTP, no email verification ([`01 §8`](01-mission-and-non-negotiables.md)). Security comes from
four layers working together, specified fully in [`27 §3`](27-security-rbac-audit.md):

1. **Argon2id** password hashing (`m=19456, t=2, p=1`), implemented in WASM in the Worker.
2. **Device binding.** A session is bound to a device fingerprint at issue; presenting it from a
   different fingerprint invalidates it and alerts the user.
3. **Progressive rate limiting** on the login path, keyed by phone **and** by IP, with exponential
   lockout.
4. **Session integrity.** Opaque 256-bit tokens, SHA-256 hashed at rest, 30-day sliding expiry for
   customers, **12 hours** for partners and riders, **4 hours** for admins with TOTP re-challenge.

### 2.2 Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/register` | — | Create account. Multi-step; see §2.3. |
| `POST` | `/v1/auth/login` | — | Phone + password → session |
| `POST` | `/v1/auth/login/google` | — | Google OAuth code exchange. **Only enabled when `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured**; otherwise returns `501 OAUTH_NOT_CONFIGURED` and the UI hides the button. |
| `POST` | `/v1/auth/refresh` | Bearer | Slide the expiry, rotate the token |
| `POST` | `/v1/auth/logout` | Bearer | Revoke this session |
| `POST` | `/v1/auth/logout/all` | Bearer | Revoke every session for this user |
| `GET` | `/v1/auth/sessions` | Bearer | List active sessions with device, IP, last used |
| `DELETE` | `/v1/auth/sessions/{id}` | Bearer | Revoke one |
| `POST` | `/v1/auth/password/change` | Bearer | Requires the current password |
| `POST` | `/v1/auth/password/reset/request` | — | Admin-mediated reset; see §2.4 |
| `POST` | `/v1/auth/device/register` | Bearer | Register or refresh the FCM token and capability flags |
| `PATCH` | `/v1/auth/device/capabilities` | Bearer | Update battery-optimisation posture (doc 15 §9) |
| `POST` | `/v1/auth/totp/enrol` | Bearer (admin) | Begin TOTP enrolment, returns the provisioning URI |
| `POST` | `/v1/auth/totp/verify` | Bearer (admin) | Confirm enrolment with a code |
| `POST` | `/v1/auth/totp/challenge` | Bearer (admin) | Satisfy a step-up challenge |
| `GET` | `/v1/auth/me` | Bearer | The current actor, roles, permissions, and feature flags |

### 2.3 Registration is multi-step

The brief: *"the user can register and login, using email o auth ... phone, password, it's will be
multiple step so they will set up location."*

```
POST /v1/auth/register          { step: "IDENTITY", phone, password, name }
  → 201 { registrationId, nextStep: "LOCATION" }

POST /v1/auth/register          { step: "LOCATION", registrationId,
                                  point: {lat, lon}, line1, landmark, label }
  → 200 { registrationId, nextStep: "PREFERENCES", zone: {...} | null }

POST /v1/auth/register          { step: "PREFERENCES", registrationId,
                                  locale, dietary: [...], notificationsOptIn }
  → 201 { session, user, address }
```

Each step is independently idempotent and the partial registration is held in KV with a 30-minute
TTL, so a dropped connection mid-flow does not lose the user's work. If the chosen location is
outside every `ACTIVE` zone, the `LOCATION` step still succeeds and returns `zone: null`; the
customer lands in the "we're not here yet" empty state ([`33 §6`](33-empty-state-doctrine.md)) with
a one-tap "tell me when you launch here" that records the point for the expansion report.

### 2.4 Password reset without email or SMS

Without a verified channel, a self-service reset is an account-takeover primitive. Undal's reset is
therefore **assisted**:

1. The user submits their phone and a short statement.
2. A `support_tickets` row of kind `PASSWORD_RESET` is created.
3. An admin with `identity.reset_password` calls the user back on the registered number, verifies
   identity against their order history (last order code, last delivery address, approximate
   total), and issues a **single-use, 15-minute reset token**.
4. Every step is audited. The admin cannot see or set the password; they can only mint the token.

This is slower than an email link and it is honest about what a free-tier platform can secure.

---

## 3. Catalogue

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/catalog/zones/resolve?lat&lon` | optional | Which zone is this point in? |
| `GET` | `/v1/catalog/home` | optional | The ranked home feed for a point. **The main discovery call.** |
| `GET` | `/v1/catalog/vendors` | optional | Filtered, paginated vendor list |
| `GET` | `/v1/catalog/vendors/{slug}` | optional | Vendor detail + full menu in one response |
| `GET` | `/v1/catalog/vendors/{slug}/availability` | optional | Lightweight open/closed/busy poll |
| `GET` | `/v1/catalog/items/{id}` | optional | Item with modifier groups |
| `GET` | `/v1/catalog/search?q=` | optional | Unified vendor + item + cuisine search |
| `GET` | `/v1/catalog/search/suggest?q=` | optional | Typeahead, ≤ 60 ms |
| `GET` | `/v1/catalog/categories` | — | The 112 cuisine categories with icons |
| `GET` | `/v1/catalog/vendors/{slug}/reviews` | optional | Paginated reviews |
| `POST` | `/v1/catalog/vendors/{slug}/favourite` | Bearer | Toggle favourite |

### 3.1 `GET /v1/catalog/home`

The single most important read in the platform.

**Request**
```
GET /v1/catalog/home?lat=24.8949&lon=91.8687&fulfilment=DELIVERY&limit=24
Accept-Language: bn
```

**Response (abridged)**
```jsonc
{
  "ok": true,
  "data": {
    "zone": { "id": "…", "code": "SYL-CENTRAL", "name": "Sylhet Central",
              "nameBn": "সিলেট কেন্দ্রীয়", "status": "ACTIVE" },
    "serviceable": true,
    "sections": [
      { "kind": "CATEGORY_RAIL", "items": [ /* 112 categories, personally ordered */ ] },
      { "kind": "QUICK_FILTERS", "items": ["FREE_DELIVERY","UNDER_30","RATING_4_PLUS",
                                            "PICKUP","FLASH_BOX","OPEN_NOW"] },
      { "kind": "CAMPAIGN_CAROUSEL", "items": [ /* only vendor-run campaigns */ ] },
      { "kind": "VENDOR_LIST", "title": "Best for you", "titleBn": "আপনার জন্য সেরা",
        "rankVersion": "r10.3.1", "traceId": "…",
        "items": [
          {
            "id": "…", "slug": "…", "name": "…", "nameBn": "…",
            "kind": "RESTAURANT",
            "coverUrl": "…", "coverBlurhash": "…", "logoUrl": "…",
            "ratingAvg": 4.6, "ratingCount": 318,
            "etaMinMinutes": 24, "etaMaxMinutes": 34,
            "deliveryFeePaisa": 5400,
            "distanceM": 1840,
            "openState": "OPEN",
            "opensAt": null,
            "tags": ["BIRIYANI","BENGALI"],
            "dietary": ["HALAL"],
            "flashBox": { "active": true, "discountBps": 2500,
                          "remaining": 14 },
            "rankReason": "NEARBY_AND_FAST"
          }
        ]
      }
    ],
    "emptyState": null
  },
  "meta": { "requestId": "…", "ts": "…", "nextCursor": "…" }
}
```

Note `rankReason`. Every ranked vendor carries a machine-readable reason, rendered in the UI as a
small honest label (*"Close to you and usually fast"*). This is the anti-advertising commitment made
visible: a customer can always see **why** something is where it is, and no reason can ever be
"paid".

Note `emptyState`. When there are no vendors, the server returns the designed empty state's kind so
the client renders the right one rather than guessing. Kinds: `NO_ZONE`, `ZONE_INACTIVE`,
`NO_VENDORS_IN_ZONE`, `ALL_CLOSED`, `NO_RESULTS_FOR_FILTER`, `OUTSIDE_DELIVERY_RADIUS`.

### 3.2 `GET /v1/catalog/vendors/{slug}`

Returns the vendor **and the entire menu** in one response, because a second round trip to load the
menu is the difference between a storefront that feels instant and one that does not. A large
menu (400 items, 60 modifier groups) serialises to ~140 KB, ~22 KB after Brotli. Cached in KV for
60 s and in the client's Room database indefinitely with an ETag.

```
GET /v1/catalog/vendors/the-burger-junction-sylhet
If-None-Match: "v7-1762000000"
→ 304 Not Modified     (the common case)
```

---

## 4. Cart and quoting

Carts are **client-owned**. The server never stores a cart; it only prices one. This removes an
entire class of sync bugs and means an offline customer can build a cart freely.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/orders/quote` | optional | Price a cart. Returns the full fee breakdown. |
| `POST` | `/v1/orders/validate` | Bearer | Pre-flight: availability, hours, radius, minimums |

### 4.1 `POST /v1/orders/quote`

**Request**
```jsonc
{
  "vendorId": "…",
  "fulfilment": "DELIVERY",
  "deliveryPoint": { "lat": 24.8981, "lon": 91.8712 },
  "items": [
    { "itemId": "…", "quantity": 2,
      "modifiers": [ { "groupId": "…", "modifierId": "…" } ],
      "note": "কম ঝাল" }
  ],
  "promoCode": "FIRST50",
  "tipPaisa": 0
}
```

**Response**
```jsonc
{
  "ok": true,
  "data": {
    "quoteId": "…",
    "expiresAt": "2026-11-01T08:38:00Z",
    "lines": [
      { "kind": "SUBTOTAL",         "labelEn": "Items",            "labelBn": "আইটেম",            "amountPaisa":  45000 },
      { "kind": "DISCOUNT",         "labelEn": "FIRST50",          "labelBn": "FIRST50",          "amountPaisa":  -5000,
        "fundedBy": "PLATFORM" },
      { "kind": "DELIVERY_FEE",     "labelEn": "Delivery",         "labelBn": "ডেলিভারি",          "amountPaisa":   6200,
        "explain": { "distanceM": 3800, "baseFarePaisa": 4000, "perKmPaisa": 1400,
                     "surgeBps": 10000, "weather": "CLEAR", "trafficDelayS": 0 } },
      { "kind": "SMALL_ORDER_FEE",  "labelEn": "Small order fee",  "labelBn": "ছোট অর্ডার ফি",     "amountPaisa":   2500,
        "explain": { "thresholdPaisa": 10000, "riderSharePaisa": 500, "vendorSharePaisa": 500 } },
      { "kind": "TAX",              "labelEn": "Tax (5%)",         "labelBn": "কর (৫%)",          "amountPaisa":    713 },
      { "kind": "ROUNDING",         "labelEn": "Rounding",         "labelBn": "রাউন্ডিং",          "amountPaisa":    -13 }
    ],
    "totalPaisa": 49400,
    "etaMinMinutes": 32,
    "etaMaxMinutes": 44,
    "fareSource": "BRAIN",
    "traceId": "…",
    "warnings": []
  }
}
```

The `explain` object on every fee line is what powers the fee-transparency sheet
([`02 §5.2`](02-reference-analysis.md)). The customer can see the actual routed distance and the
actual surge multiplier. No competitor in this market does that.

A quote is valid for **5 minutes**. `POST /v1/orders` must carry the `quoteId`; if it has expired
the order is re-quoted and the response is `409 QUOTE_EXPIRED` with the new quote attached so the
client can show a single "the fee changed from ৳62 to ৳68 — continue?" prompt rather than silently
charging more.

---

## 5. Orders

| Method | Path | Actor | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/orders` | Customer | Place an order |
| `GET` | `/v1/orders` | Customer | My orders, paginated |
| `GET` | `/v1/orders/{code}` | Customer, Vendor, Rider, Admin | Order detail, scoped to the caller's view |
| `GET` | `/v1/orders/{code}/track` | Customer | Lightweight tracking payload |
| `POST` | `/v1/orders/{code}/cancel` | Customer | Cancel |
| `POST` | `/v1/orders/{code}/rate` | Customer | Rate vendor and rider. Implemented (D137) |
| `POST` | `/v1/orders/{code}/dispute` | Customer | Open a dispute |
| `POST` | `/v1/orders/{code}/accept` | Vendor | Accept with a prep time |
| `POST` | `/v1/orders/{code}/reject` | Vendor | Reject with a reason |
| `PATCH` | `/v1/orders/{code}/prep-time` | Vendor | Extend before pickup |
| `POST` | `/v1/orders/{code}/ready` | Vendor | Mark ready early |
| `GET` | `/v1/orders/{code}/qr` | Vendor | The pickup QR payload |
| `POST` | `/v1/orders/{code}/offer/{offerId}/accept` | Rider | Claim an offer. Implemented (D113) |
| `POST` | `/v1/orders/{code}/offer/{offerId}/reject` | Rider | Decline with a reason. Implemented (D114) |
| `POST` | `/v1/orders/{code}/pickup` | Rider | Submit the scanned QR |
| `POST` | `/v1/orders/{code}/arrive` | Rider | Mark arrived |
| `POST` | `/v1/orders/{code}/deliver` | Rider | Complete with cash collected |
| `POST` | `/v1/orders/{code}/unassign` | Rider, Admin | Drop the order |

### 5.1 `POST /v1/orders`

**Request** carries the `quoteId` plus everything needed to reconstruct the order, so the server
never trusts client-computed money:

```jsonc
{
  "quoteId": "…",
  "vendorId": "…",
  "fulfilment": "DELIVERY",
  "addressId": "…",
  "items": [ /* must hash-match the quote */ ],
  "promoCode": "FIRST50",
  "tipPaisa": 0,
  "customerNote": "Ring the bell twice",
  "contactPhoneOverride": null
}
```

**The server re-prices from scratch** and compares to the quote. If they differ by more than zero
paisa, the order is rejected with `409 QUOTE_MISMATCH` and the recomputed quote. There is no path
by which a client can influence the price.

**Response `201`**
```jsonc
{
  "ok": true,
  "data": {
    "code": "UND-7K2M9QX4",
    "state": "PLACED",
    "placedAt": "…",
    "totalPaisa": 49400,
    "etaMinAt": "…", "etaMaxAt": "…",
    "vendor": { "name": "…", "phone": "…", "point": {…} },
    "streamToken": "…"          // authorises the SSE subscription for this order
  }
}
```

**Effects fired on commit**

| Effect | Target | Latency |
| --- | --- | --- |
| `FCM_PUSH` kind `ORDER_NEW` | Every valid token on the vendor's devices | fired before the response serialises |
| `SSE_BROADCAST` `order.placed` | `OrderHub`, `ZoneHub`, admin tower | < 50 ms |
| `BRAIN_DISPATCH_PREWARM` | Brain, non-blocking | asynchronous — candidate riders are pre-scored while the vendor is still deciding, so assignment after `ACCEPTED` is instant |
| `LEDGER_POST` `ORDER_PLACED` | Ledger (memo entry, no money moves yet) | in-transaction |
| `WATCHDOG_ARM` | `OrderHub` alarm at +10 s, +20 s, +120 s | in-transaction |

The pre-warm is a genuine advantage: by the time a vendor taps Accept, the candidate rider set is
already scored and cached, so `ACCEPTED → RIDER_SEARCH → offer delivered` typically completes in
under 400 ms.

### 5.2 `POST /v1/orders/{code}/accept` (vendor)

```jsonc
{ "prepTimeSeconds": 1500, "source": "VENDOR_SET" }
```

Guards: caller owns the vendor · order is `PLACED` · `300 ≤ prepTimeSeconds ≤ 12000` (5 to 200
minutes, from the brief) · the vendor is not `UNREACHABLE`.

Response includes `suggestedPrepTimeSeconds` for comparison and records both, so the Brain learns
how far vendors deviate from its suggestion and recalibrates
([`09 §7`](09-undal-brain-overview.md)).

### 5.3 `POST /v1/orders/{code}/pickup` (rider)

```jsonc
{ "scannedPayload": "UNDAL:v1:UND-7K2M9QX4:1762000123:9f2a…", "point": {…} }
```

The QR payload is `UNDAL:v1:{code}:{issuedAtEpoch}:{hmac}` where the HMAC is over the first four
fields with a per-order key derived from `ORDER_QR_SECRET`. Validation:

| Check | Failure code |
| --- | --- |
| HMAC valid | `QR_INVALID` |
| Code matches the order in the path | `QR_WRONG_ORDER` — the error names which order it *is* |
| Issued within the last 4 hours | `QR_EXPIRED` |
| Caller is the assigned rider | `QR_WRONG_RIDER` |
| Rider within 150 m of `pickup_point` | `QR_TOO_FAR` |
| Order is `RIDER_ASSIGNED` | `ORDER_NOT_ACCEPTABLE` |

`QR_WRONG_ORDER` naming the actual order is a deliberate usability choice: a rider holding two bags
needs to know which one they just scanned, not merely that they were wrong.

### 5.4 `POST /v1/orders/{code}/deliver` (rider)

```jsonc
{
  "cashCollectedPaisa": 49400,
  "varianceReason": null,          // required if cashCollectedPaisa != totalPaisa
  "point": {…},
  "proofKind": "NONE",             // NONE | PHOTO | SIGNATURE — vendor/zone configurable
  "proofUrl": null
}
```

A variance posts a `CASH_VARIANCE` ledger entry against the rider's account and raises an admin
exception if it exceeds ৳20 or if the rider has three variances in a week. Small variances are
normal (a customer with no change); systematic ones are not.

---

## 6. State transitions → effects

The complete effect table. This is what [`06 §7.3`](06-data-model-tidb.md)'s transitions
actually do.

| Transition | FCM | SSE events | Ledger | Other |
| --- | --- | --- | --- | --- |
| `→ PLACED` | `ORDER_NEW` → vendor | `order.placed` | memo | Dispatch pre-warm; watchdogs armed |
| `→ ACCEPTED` | `ORDER_ACCEPTED` → customer | `order.accepted` | — | Dispatch opened; ETA recomputed and pushed |
| `→ REJECTED` | `ORDER_REJECTED` → customer | `order.rejected` | reverse memo | Vendor reliability score updated; customer offered 3 alternatives |
| `→ AUTO_CANCELLED` | → customer, → vendor | `order.cancelled` | reverse memo | Vendor auto-paused; admin exception; customer offered alternatives |
| `→ RIDER_SEARCH` | `OFFER_NEW` → wave-1 riders | `order.searching` | — | Offer timers armed |
| `→ RIDER_ASSIGNED` | `ORDER_ASSIGNED` → customer, vendor; `OFFER_WITHDRAWN` → other riders | `order.assigned`, `rider.channel.open` | — | Location channel authorised for customer and vendor |
| `→ PICKED_UP` | `ORDER_PICKED_UP` → customer | `order.picked_up` | — | Vendor's board clears the row |
| `→ ARRIVED` | `RIDER_ARRIVED` → customer | `order.arrived` | — | Customer's screen switches to "he's here" |
| `→ DELIVERED` | `ORDER_DELIVERED` → customer, vendor | `order.delivered`, `rider.channel.close` | **full posting set** | Rating prompt armed at +90 s; settle timer at +15 min |
| `→ SETTLED` | — | `order.settled` | — | Enters the payout period; invoice marked dirty |
| `→ CANCELLED_BY_*` | → all affected | `order.cancelled` | compensating | Cost attribution recorded |
| `→ REASSIGNING` | `ORDER_REASSIGNING` → customer | `order.reassigning` | — | Rider penalised if at fault; dispatch reopened at wave 1 |
| `→ DISPUTED` | → admin | `order.disputed` | freeze | Settlement blocked; ticket created |

---

## 7. Partner endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/partner/dashboard` | Today's KPIs, live board, rank inputs |
| `GET` | `/v1/partner/orders` | Order list by state |
| `GET` | `/v1/partner/orders/live` | The active board (SSE-backed) |
| `POST` | `/v1/partner/presence/heartbeat` | The 1 Hz presence ping |
| `POST` | `/v1/partner/open-state` | Open, busy(level), pause(until), close |
| `GET`/`POST`/`PATCH`/`DELETE` | `/v1/partner/menu/sections[/{id}]` | Menu sections |
| `GET`/`POST`/`PATCH`/`DELETE` | `/v1/partner/menu/items[/{id}]` | Items |
| `PATCH` | `/v1/partner/menu/items/{id}/availability` | Sold out / available / hidden |
| `POST` | `/v1/partner/menu/items/bulk-availability` | Bulk toggle |
| `GET`/`POST`/`PATCH`/`DELETE` | `/v1/partner/menu/modifier-groups[/{id}]` | Modifier groups |
| `GET`/`PATCH` | `/v1/partner/profile` | Name, description, cuisine, photos |
| `GET`/`PUT` | `/v1/partner/hours` | Weekly hours, validated against the 4h×5d minimum |
| `GET`/`POST`/`DELETE` | `/v1/partner/holidays` | Closures |
| `GET` | `/v1/partner/stats` | Performance over a window |
| `GET` | `/v1/partner/rank-explain` | **Why am I ranked where I am**, with per-stage contributions |
| `GET` | `/v1/partner/invoices` | Weekly statements |
| `GET` | `/v1/partner/invoices/{id}/pdf` | Signed Cloudinary URL, 10-minute expiry |
| `GET`/`POST` | `/v1/partner/campaigns` | Flash Box campaigns |
| `GET` | `/v1/partner/reviews` | Reviews with a reply affordance |
| `POST` | `/v1/partner/reviews/{id}/reply` | Reply once |

`/v1/partner/rank-explain` deserves emphasis. It returns the vendor's score at each of the ten
ranking stages, the population median for each, and a prioritised list of the three changes that
would most improve their position. A platform that does not sell position can afford to be
completely transparent about how position is earned, and that transparency is itself a product.

---

## 8. Rider endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/rider/shift/start` | Begin a shift; requires a selfie. Implemented (D109) — see below |
| `POST` | `/v1/rider/shift/selfie` | Upload the shift selfie (proxied to imgbb) |
| `POST` | `/v1/rider/shift/end` | End a shift; triggers the cash lock if owing. Implemented (D110) |
| `POST` | `/v1/rider/shift/break` | Enter/leave break. Implemented (D111) |
| `GET` | `/v1/rider/shift/current` | Current shift state and totals. Implemented (D111) |
| `POST` | `/v1/rider/presence/heartbeat` | Presence ping |
| `GET` | `/v1/rider/offers` | Pending offers (the FCM payload is authoritative; this is reconciliation). Implemented (D115) |
| `GET` | `/v1/rider/orders/active` | Active order(s), batched if applicable |
| `GET` | `/v1/rider/earnings` | Today / week / custom window with per-order breakdown |
| `GET` | `/v1/rider/invoices` | Weekly invoices |
| `GET` | `/v1/rider/invoices/{id}/pdf` | Signed URL |
| `GET` | `/v1/rider/cash` | Cash in hand, settlement status, deadline. Implemented (D140) |
| `POST` | `/v1/rider/cash/settle` | Submit a settlement, full or `partial: true` (see [`25`](25-rider-cash-settlement.md)). Implemented (D141, partial D151) |
| `GET` | `/v1/rider/cash/breakdown` | The deliveries behind `cash_in_hand`, with the arithmetic that proves it (see [`25 §8`](25-rider-cash-settlement.md)). Implemented (D150) |
| `POST` | `/v1/rider/cash/declare` | Declare an emergency (24 h lift) or a robbery (lift with no expiry) (see [`25 §7`](25-rider-cash-settlement.md)). Implemented (D148–D149); `DISPUTE` answers `501` |
| `POST` | `/v1/finance/cash/settlements/{id}/escalate` | Release the rider, keep the debt, hand the claim to a senior reviewer (see [`25 §6.1`](25-rider-cash-settlement.md)). Step-up. Implemented (D146) |
| `GET` | `/v1/finance/cash/settlements` | The reviewer's queue: pending claims, oldest first, with evidence. Implemented (D145) |
| `POST` | `/v1/finance/cash/settlements/{id}/approve` | Reviewer's decision on a settlement, full or partial amount (see [`25 §6.1`](25-rider-cash-settlement.md)). Step-up. Implemented (D143, partial D147) |
| `POST` | `/v1/finance/cash/settlements/{id}/reject` | Refuse a settlement, reason from the register (see [`25 §6.2`](25-rider-cash-settlement.md)). Implemented (D144) |
| `GET` | `/v1/rider/heatmap` | Demand surface for positioning |
| `GET` | `/v1/rider/stats` | Acceptance, completion, rating, on-time |
| `GET`/`PATCH` | `/v1/rider/profile` | Profile and payout details |
| `GET` | `/v1/rider/penalties` | Penalties with appeal status |
| `POST` | `/v1/rider/penalties/{id}/appeal` | Appeal |

`/v1/rider/shift/start` (D109) is the route every live-tracking promise hangs from, so its contract is worth
stating exactly. The body is `{ selfieUrl, point: { lat, lon }, zoneId? }`: the selfie must be an https URL of
at most 512 characters (it is the imgbb link from `26`, and the on-device checks in `19 §3.1` are the
verification), and `point` is where the rider is standing. The zone defaults to the rider's home zone; any other
zone needs a live `rider_zone_assignments` row. The refusals are each a screen in the app: `SHIFT_KYC_PENDING`
(409) while the application is under review, `AUTH_ACCOUNT_SUSPENDED` (451) when it is suspended,
`SHIFT_ALREADY_OPEN` (409, with `shift_id`) for a second tap, `SHIFT_ZONE_NOT_ASSIGNED` (409) for a zone the
rider does not hold, and `SHIFT_SELFIE_REQUIRED` (422) when the selfie is missing or not https.

`/v1/rider/shift/end` (D110) is its pair and closes the loop the brief cares about most. The body is
`{ point?, reason? }` — both optional, because a rider who has lost location still gets to end their shift — and
the answers are the shift's own totals: `{ shiftId, shiftState, endedAt, onlineSeconds, cashOutstandingPaisa,
settlementRequired, liveLocationErased }`. Three refusals: `SHIFT_NOT_FOUND` (404) when nothing is open,
`SHIFT_ORDERS_ACTIVE` (409, with `active_orders`) when food is still in the rider's hands, and
`SHIFT_ALREADY_CLOSED` (409) when two ends race and this one lost. A rider who owes cash ends in
`CASH_LOCKED`, which is the state that refuses their next shift with `SHIFT_CASH_OVERDUE`; one who does not ends
in `OFFLINE`. The live channel is erased **before** the response (`07 §6.1`), and an erasure that fails does not
fail the end: it is logged and reported as `{ positions: 0, current: 0 }`, with the zone sweep (D107) as the
one-minute fuse. Trapping a rider online because realtime is cold is a worse bug than a trail that outlives its
shift by a minute.

`GET /v1/rider/shift/current` (D111) is the screen both of those write to and the app reads on every launch. It
answers `{ shiftState, shift, cashOutstandingPaisa, settlementRequired }`, where `shift` is `null` when nothing is
open — **a `200` with `null`, not a `404`** — because an offline rider is the normal case and a client that has
learned "error means go to the shift screen" is a client that shows the wrong screen to most of its users. When a
shift is open it carries `{ shiftId, zoneId, vehicle, startedAt, onlineSeconds, ordersCompleted, distanceM }`.

`POST /v1/rider/shift/break` (D111) takes `{ onBreak: boolean }` and answers `{ shiftId, shiftState, onBreak }`.
It exists as a route rather than a `PATCH` because the button appears on two screens and the audit trail wants to
say which one was pressed: `rider.shift.break.start` or `rider.shift.break.end`. No open shift is
`SHIFT_NOT_FOUND` (404) and writes nothing. The cadence that a break implies is not in this answer — the device
pushes `state: "BREAK"` with its flush and realtime answers with the profile (`07 §3.3`), so the two systems agree
on one flag rather than two.

The answer to a start is `{ shiftId, riderId, zoneId, vehicle, shiftState: "ONLINE", startedAt }`. Opening a shift writes
`rider_shifts` **and** the rider's live D1 row, and the second write is synchronous: a shift that exists in TiDB
but not in D1 is a rider dispatch can see and the map cannot, whose every flush is refused. If that write fails
the shift is undone (`DELETE` the row, put `shift_state` back to `OFFLINE`) and the caller gets
`503 SERVICE_DEGRADED { component: "realtime", reason: "live_position_unavailable" }` — a shift that cannot be
tracked does not exist, and the rider taps again.
| `GET` | `/v1/rider/diagnostics` | Location uploads, FCM health, battery posture |

---

## 9. Realtime — SSE

```
GET /rt/stream?channels=order:UND-7K2M9QX4,rider:self
Authorization: Bearer …
Last-Event-ID: 4821
Accept: text/event-stream
```

```
id: 4822
event: order.assigned
data: {"code":"UND-7K2M9QX4","riderId":"…","riderName":"…","vehicle":"MOTORBIKE","etaMinAt":"…"}

id: 4823
event: rider.position
data: {"riderId":"…","lat":24.8951,"lon":91.8702,"bearing":84,"speed":5.2,"t":1762000148120}

: keepalive
```

A `: keepalive` comment every 20 seconds keeps intermediaries from closing the connection. The
client reconnects with `Last-Event-ID` and the hub replays from its in-memory ring (last 200
events, 5-minute window); beyond that the client does a full reconciling fetch.

Between the opening replay and the keepalive, the response **tails** each of its channels (`sse/stream.ts`,
D103): once a second the route asks the ring for frames after that channel's cursor and writes them. Without
it the response was a replay followed by keepalives — a customer who connected during a quiet minute never
learned the vendor had accepted, because nothing pulled the frames recorded after the response began. Each
channel keeps its own cursor, since each numbers its own frames (D101), and a gap is admitted with one
`: gap: reconcile` comment per episode rather than one per tick.

Two rules make that replay honest (`sse/ring.ts`, D100). A frame whose id arrives **after** a higher id
— two requests for one order can be in flight at once — is recorded where its id belongs rather than
appended, so `Last-Event-ID` replay stays in the order a client can apply. And a cursor the ring has
never reached answers `complete: false` rather than "nothing was missed": a fresh isolate, an evicted
room and a lost snapshot are indistinguishable from a channel that never spoke, so the client is told to
reconcile instead of being shown a silence it will read as "nothing happened".

A third rule is about where a sequence comes from (`sse/fanout.ts`, D101). Core numbers an order's events
with that order's own log sequence, and on the **order** channel that number is the frame id — so a
`Last-Event-ID` is also a row in `order_state_events`. The **zone** channel carries every order in the zone,
where per-order numbers repeat; it is numbered by its own ring instead. Copying the order's sequence onto it
would make two orders' frames share an id, and the ring replaces a duplicate id rather than refusing it, so
the admin map would silently lose one of them.

### 9.1 Event catalogue (46 events)

| Group | Events |
| --- | --- |
| Order | `order.placed` `order.accepted` `order.rejected` `order.searching` `order.assigned` `order.picked_up` `order.arrived` `order.delivered` `order.settled` `order.cancelled` `order.reassigning` `order.disputed` `order.prep_time_changed` `order.eta_changed` `order.items_changed` |
| Offer | `offer.new` `offer.withdrawn` `offer.expired` `offer.claimed_by_other` |
| Rider | `rider.position` `rider.online` `rider.offline` `rider.break` `rider.channel.open` `rider.channel.close` `rider.signal_lost` `rider.signal_restored` `rider.cash_locked` `rider.cash_cleared` |
| Vendor | `vendor.open` `vendor.busy` `vendor.paused` `vendor.closed` `vendor.unreachable` `vendor.reachable` `vendor.item_sold_out` |
| Zone | `zone.surge_changed` `zone.weather_changed` `zone.supply_warning` |
| Admin | `admin.exception_raised` `admin.exception_cleared` `admin.metric_tick` `admin.audit_entry` |
| Session | `session.revoked` `session.permissions_changed` |
| System | `system.config_changed` `system.degraded` `system.recovered` |

Every event payload is defined by a Zod schema in `packages/api-types/src/events/`, and the Kotlin
sealed class hierarchy is generated from it, so an event the server can send that the client cannot
parse is a compile error rather than a runtime surprise.

---

## 10. Brain endpoints (internal only)

Not internet-routable. Reachable only via service binding from Core and Realtime.

| Method | Path | Purpose | Timeout | Fallback |
| --- | --- | --- | --- | --- |
| `POST` | `/brain/fare` | Quote a delivery | 400 ms | Static tier table |
| `POST` | `/brain/dispatch` | Rank candidate riders | 400 ms | Nearest eligible |
| `POST` | `/brain/batch` | Evaluate bundling | 250 ms | No batch |
| `POST` | `/brain/rank` | Order a vendor set | 300 ms | Distance, then rating |
| `POST` | `/brain/preptime` | Suggest a prep time | 200 ms | Vendor's configured default |
| `POST` | `/brain/forecast` | Demand surface for a zone | 1 000 ms | Last computed surface |
| `GET` | `/brain/explain/{traceId}` | Replay and explain a decision | — | — |
| `GET` | `/brain/health` | Engine version, feature-store freshness | — | — |

---

## 11. Error code registry

185 codes. The complete list lives in `packages/api-types/src/errors.ts` and is generated into both
clients. The groups and representative members (the count is 185 rather than 184 because `SHIFT_ORDERS_ACTIVE`
was added by D110: `25 §2` blocks ending a shift with deliveries live and the table had no code for it):

| Prefix | Count | Examples |
| --- | --- | --- |
| `AUTH_` | 21 | `AUTH_INVALID_CREDENTIALS` `AUTH_SESSION_EXPIRED` `AUTH_DEVICE_MISMATCH` `AUTH_LOCKED_OUT` `AUTH_TOTP_REQUIRED` `OAUTH_NOT_CONFIGURED` |
| `PERM_` | 8 | `PERM_DENIED` `PERM_ZONE_OUT_OF_SCOPE` `PERM_ROLE_EXPIRED` |
| `VALIDATION_` | 14 | `VALIDATION_FAILED` `VALIDATION_PHONE_INVALID` `VALIDATION_COORDINATES_INVALID` |
| `CATALOG_` | 17 | `CATALOG_VENDOR_NOT_FOUND` `CATALOG_ITEM_SOLD_OUT` `CATALOG_VENDOR_CLOSED` `CATALOG_OUTSIDE_RADIUS` |
| `QUOTE_` | 9 | `QUOTE_EXPIRED` `QUOTE_MISMATCH` `QUOTE_BELOW_MINIMUM` `QUOTE_NO_ZONE` |
| `ORDER_` | 31 | `ORDER_NOT_ACCEPTABLE` `ORDER_ALREADY_CANCELLED` `ORDER_PREP_TIME_OUT_OF_RANGE` `ORDER_NOT_YOURS` |
| `OFFER_` | 11 | `OFFER_EXPIRED` `OFFER_CLAIMED` `OFFER_REJECT_NOT_ALLOWED` `OFFER_REASON_REQUIRED` |
| `QR_` | 6 | `QR_INVALID` `QR_WRONG_ORDER` `QR_EXPIRED` `QR_TOO_FAR` `QR_WRONG_RIDER` |
| `SHIFT_` | 13 | `SHIFT_SELFIE_REQUIRED` `SHIFT_CASH_OVERDUE` `SHIFT_ALREADY_OPEN` `SHIFT_ZONE_INACTIVE` `SHIFT_ORDERS_ACTIVE` |
| `CASH_` | 9 | `CASH_TRXID_DUPLICATE` `CASH_AMOUNT_MISMATCH` `CASH_SELFIE_REQUIRED` |
| `MONEY_` | 13 | `MONEY_INVOICE_UNBALANCED` `MONEY_PERIOD_CLOSED` `MONEY_ALREADY_PAID` |
| `KYC_` | 10 | `KYC_DOCUMENT_REQUIRED` `KYC_ALREADY_SUBMITTED` `KYC_REJECTED` |
| `MEDIA_` | 8 | `MEDIA_TOO_LARGE` `MEDIA_UNSUPPORTED_TYPE` `MEDIA_UPLOAD_FAILED` |
| `ZONE_` | 7 | `ZONE_SELF_INTERSECTING` `ZONE_OVERLAPS` `ZONE_HAS_ACTIVE_ORDERS` |
| `RATE_` | 3 | `RATE_LIMITED` `RATE_LIMITED_LOGIN` `RATE_LIMITED_GLOBAL` |
| `SYSTEM_` | 5 | `INTERNAL` `SERVICE_DEGRADED` `DEPENDENCY_TIMEOUT` `IDEMPOTENCY_CONFLICT` `NOT_IMPLEMENTED` |

Each code has: a stable string, an HTTP status, an English message, a Bangla message, a `retryable`
flag, and a documented `details` shape. Adding a code requires adding all six, enforced by the type.

---

## 12. Rate limits

Token bucket per actor, per route group, stored in KV.

| Group | Anonymous | Customer | Partner | Rider | Admin |
| --- | --- | --- | --- | --- | --- |
| Auth (login/register) | 5/min per IP **and** 5/15min per phone | — | — | — | — |
| Catalogue read | 60/min | 120/min | — | — | 300/min |
| Search | 20/min | 40/min | — | — | 120/min |
| Quote | 10/min | 30/min | — | — | — |
| Order write | — | 6/min | 60/min | 60/min | 120/min |
| Presence heartbeat | — | — | 90/min | 90/min | — |
| Location batch | — | — | — | 30/min | — |
| Media upload | — | 10/min | 30/min | 20/min | 60/min |
| Admin write | — | — | — | — | 120/min |
| SSE connections | 2 | 4 | 4 | 4 | 10 |

Exceeding a limit returns `429` with `Retry-After`. The partner and rider apps treat `429` on
heartbeat as a signal to back off rather than as an error, because a retry storm from a thousand
phones is precisely how a free tier dies.

---

## 13. Idempotency, precisely

```
POST /v1/orders
Idempotency-Key: 0193f2a1-7c3e-7890-abcd-ef0123456789
```

1. Key is scoped to `(user_id, route, key)`. The same key on a different route is a different
   operation.
2. On first use, the key is reserved in KV with a 60-second lease and the request proceeds.
3. The response — status, headers, body — is stored under the key with a **24-hour** TTL.
4. A repeat with the same key and the same body hash replays the stored response byte for byte,
   with `X-Undal-Idempotent-Replay: true`.
5. A repeat with the same key and a **different** body hash returns `409 IDEMPOTENCY_CONFLICT`.
6. A repeat while the lease is still held (the original is in flight) returns `409` with
   `retryable: true` and `Retry-After: 1`.

The Android clients generate the key once per user intent and reuse it across retries, which is the
entire point: a rider tapping "Delivered" on a flaky connection must never complete the order twice.

---

## 14. Reading on

Next: [`09-undal-brain-overview.md`](09-undal-brain-overview.md) — the decision engine.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
