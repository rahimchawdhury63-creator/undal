# Appendix E · API Catalogue (Workers W1/W2/W3 — guide file 08)

Envelope: success `{data, request_id}` · error `{error:{code,message_en,message_bn,details?}, request_id}` (Appendix G).
All mutating order/money endpoints require `Idempotency-Key`; all list endpoints cursor-paginate. OpenAPI generated from code in Build Responses 6-11.
**Endpoints catalogued: 73.**


## W1 undal-api

| Method | Path | Auth | Rate/Idempotency | Purpose |
|---|---|---|---|---|
| GET | `/healthz` | public | - | shallow health |
| GET | `/v1/home/feed` | anon|customer | 60/min/ip | ranked feed (file 13) |
| GET | `/v1/vendors/{slug}` | anon | 120/min | vendor page data |
| GET | `/v1/vendors/{slug}/menu` | anon | 120/min | full menu |
| GET | `/v1/vendors/{slug}/reviews` | anon | 60/min | reviews paged |
| GET | `/v1/search` | anon | 60/min | 3-scope search |
| GET | `/v1/zones/resolve` | anon | 60/min | lat/lng -> zone verdict |
| POST | `/v1/cart` | customer | 30/min | create/switch cart |
| PATCH | `/v1/cart/items` | customer | 60/min | add/update/remove lines |
| POST | `/v1/cart/validate` | customer | 30/min | server reprice |
| POST | `/v1/cart/voucher` | customer | 10/min | apply voucher |
| DELETE | `/v1/cart/voucher` | customer | 10/min | remove voucher |
| POST | `/v1/orders` | customer | 5/min + Idempotency-Key | PLACE order (COD) |
| GET | `/v1/orders` | any-role | 60/min | my orders (scoped) |
| GET | `/v1/orders/{code}` | participant | 60/min | order detail |
| GET | `/v1/orders/{code}/live` | participant | 30/min | polling fallback payload |
| POST | `/v1/orders/{id}/accept` | vendor | 30/min + Idem | vendor accept + prep |
| POST | `/v1/orders/{id}/reject` | vendor | 30/min + Idem | vendor reject + reason |
| POST | `/v1/orders/{id}/ready` | vendor | 30/min + Idem | mark ready |
| POST | `/v1/orders/{id}/pickup-verify` | rider|customer | 20/min + Idem | QR/code verify |
| POST | `/v1/orders/{id}/arrived-vendor` | rider | 30/min + Idem |  |
| POST | `/v1/orders/{id}/picked-up` | rider | Idem | via QR pipeline |
| POST | `/v1/orders/{id}/arrived-customer` | rider | Idem | starts wait clock |
| POST | `/v1/orders/{id}/delivered` | rider | Idem | finalize + ledger |
| POST | `/v1/orders/{id}/failed-delivery` | rider | Idem | protocol-checked |
| POST | `/v1/orders/{id}/cancel` | customer|vendor | Idem | window-guarded |
| POST | `/v1/orders/{id}/review` | customer|rider|vendor | 10/min | submit rating |
| POST | `/v1/reviews/{id}/reply` | vendor | 10/min |  |
| GET/POST | `/v1/addresses` | customer | 30/min | CRUD addresses |
| POST | `/v1/favourites/{vendorId}` | customer | 30/min | toggle |
| GET/POST | `/v1/chats/{orderId}/messages` | participant | 60/min | order chat |
| POST | `/v1/support/threads` | any-role | 10/min | open ticket |
| POST | `/v1/images/public` | vendor|customer | 30/day/vendor | ImgBB proxy upload (file 15) |
| POST | `/v1/images/private-upload-url` | any-role | 20/min | signed upload URL |
| POST | `/v1/images/private-view-url` | owner|admin-perm | 20/min | signed view + audit |
| GET | `/v1/notifications` | any-role | 60/min | inbox |
| POST | `/v1/devices/token` | any-role | 10/min | register FCM token |
| GET | `/v1/config/public` | anon | 120/min | runtime flags, min app version |

## W2 undal-realtime

| Method | Path | Auth | Rate/Idempotency | Purpose |
|---|---|---|---|---|
| POST | `/v1/presence/ping` | vendor|rider | 12/min/device batched | heartbeat ingest |
| POST | `/v1/realtime/token` | any-role | 10/min | RTDB custom token |
| POST | `/v1/dispatch/order-placed` | INTERNAL HMAC | - | W1->W2 trigger |
| POST | `/v1/offers/{id}/accept` | rider | Idem | accept offer |
| POST | `/v1/offers/{id}/reject` | rider | Idem | reject + reason (D-23) |
| POST | `/v1/riders/session/start` | rider | Idem | pre-flight pass -> online |
| POST | `/v1/riders/session/end` | rider | Idem | cash-gate check |
| POST | `/v1/geo/geocode` | any-role | 30/min | Nominatim proxy+cache |
| POST | `/v1/geo/reverse` | any-role | 30/min |  |
| POST | `/v1/geo/route` | any-role | 60/min | OSRM proxy+cache |
| GET | `/v1/zone/{id}/sdr` | internal|admin | - | supply/demand snapshot |
| POST | `/v1/alerts/test` | vendor|rider|admin | 5/min | Alarm-Health test alarm |
| GET | `/v1/cashgate/config` | rider | 10/min | receiving numbers (authed only) |

## W3 undal-admin

| Method | Path | Auth | Rate/Idempotency | Purpose |
|---|---|---|---|---|
| GET | `/v1/admin/dashboard/kpis` | admin:dashboard.view | 60/min |  |
| GET/POST/PATCH | `/v1/admin/zones` | admin:3.zones | 30/min | polygon CRUD |
| GET | `/v1/admin/dispatch/board` | admin:2.* | 60/min | live board data |
| POST | `/v1/admin/orders/{id}/reassign` | admin:2.interventions | Idem |  |
| POST | `/v1/admin/orders/{id}/cancel` | admin:2.interventions | Idem |  |
| GET | `/v1/admin/kyc/queue` | admin:4.pipeline | 60/min |  |
| POST | `/v1/admin/kyc/{type}/{id}/decide` | admin:4.pipeline | Idem | approve/fix/reject |
| GET | `/v1/admin/invoices` | admin:5.invoices | 60/min |  |
| POST | `/v1/admin/invoices/{id}/verify` | admin:5.invoices | Idem | recompute check |
| POST | `/v1/admin/invoices/{id}/pay` | admin:5.invoices | Idem | TrxID + proof |
| POST | `/v1/admin/invoices/generate` | admin:5.invoices | Idem | manual lazy-gen trigger |
| GET | `/v1/admin/remittances` | admin:5.remittances | 60/min |  |
| POST | `/v1/admin/remittances/{id}/decide` | admin:5.remittances | Idem |  |
| CRUD | `/v1/admin/campaigns + /vouchers + /banners` | admin:7.* | 30/min |  |
| GET | `/v1/admin/support/threads` | admin:8.* | 60/min |  |
| POST | `/v1/admin/reviews/{id}/moderate` | admin:8.reviews | Idem |  |
| GET/PATCH | `/v1/admin/settings` | admin:1.platform_settings | 30/min | versioned |
| CRUD | `/v1/admin/users + /roles` | admin:1.* | 30/min |  |
| GET | `/v1/admin/audit` | admin:1.audit_logs | 60/min |  |
| GET | `/v1/admin/health/deep` | admin:1.health | 12/min | cached deep checks |
| GET | `/v1/admin/reports/{key}` | admin:9.* | 30/min | BI + CSV export |
| POST | `/v1/admin/nudges/send` | admin:7.nudges | approval flow | segmented FCM+inbox |
