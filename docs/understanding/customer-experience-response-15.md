# Build Response 15 · Customer Experience `c-22..c-40`

**Date:** 2026-10-24  
**Branch:** `arena/f81366de-undal`  
**Status:** Implemented and verified. Local JavaScript/TypeScript, SQL/PGlite, quality-gate, and bootstrap checks passed; GitHub Actions run [#40088758939](https://github.com/rahimchawdhury63-creator/undal/actions/runs/40088758939) passed all four jobs, including Flutter analysis/widget tests, on commit `ddcb83f`.

## Implemented surfaces

| Screen(s) | Current implementation | Server/privacy boundary |
|---|---|---|
| `c-22` | Order status, OSM map, fresh rider dot, route geometry when W2 returns valid OSRM geometry, ETA explanation, cash reminder, order summary and order-help ticket. W2 RTDB leases are released on exit; the client falls back to ETag W1 polling. | W1 order detail/live endpoints enforce participant scope and hide home-kitchen private delivery pins; W2 grants the participant-scoped room and rate-limited polling fallback. Stale rider coordinates are discarded. |
| `c-23` | Pickup-ready QR and four-digit fallback code. | Only renders a well-formed customer-visible pickup token for `fulfilment=pickup`; the documented operating rule is QR handover with no counter cash exchange. |
| `c-24..c-25` | Text chat with the assigned rider or kitchen, phone/link-filter notice, polling, send/error feedback. | W1 enforces participant/24-hour chat policy. Chat messages are persisted by W1; this client polls because this route has no RTDB message fan-out. |
| `c-26..c-27` | Server-backed Live/History orders and immutable receipt timeline, integer-poisha totals, COD method, help request, live-menu reorder link when W1 returns a public slug. | W1 order snapshots/events only; private `pickup_qr_nonce`, unapproved handover data, and home-kitchen delivery coordinates are not exposed. |
| `c-28` | Verified-delivery vendor and assigned-rider ratings; existing review snapshots prevent duplicate UI submission. | W1 customer-owned `GET /v1/orders/{id}/review` and verified-order write route. Public photo uploads are not exposed in this screen yet. |
| `c-29` | W1 favourites, privacy-filtered public kitchen cards, unavailable-row removal, pending/error feedback. | W1 joins favourite IDs to the safe public vendor-card view; no exact home-kitchen address or coordinates are returned. |
| `c-30..c-31` | Server address-book list, select/default/edit/delete and map-pin editor. Address text is manually entered; blank or fewer-than-three-character values cannot be saved. | W1 persists owner-scoped addresses and resolves the active service zone. No reverse-geocoding/autocomplete request is made. The initial unauthenticated pin is only a coarse Sylhet Sadar service-area center, not a fabricated home address. |
| `c-32` | Eligible server voucher wallet; selection returns to Cart with the code for checkout revalidation. | W1 wallet eligibility and checkout quote remain authoritative; the client does not invent balances or voucher eligibility. |
| `c-33..c-34` | Explicit, non-interactive policy gate; no fabricated point balance, invitation code, or reward state. | Pending founder approval in [ADR-0007](../adr/ADR-0007-customer-growth-and-account-closure-policy.md). |
| `c-35` | Bilingual server inbox, unread state and mark-read action. | W1 notification records only. Notification preference controls are not present in the current W1 contract. |
| `c-36..c-37` | COD/pickup/privacy FAQs, persisted support tickets and text replies, loading/error feedback. Guest contact actions route to sign-in. | W1 customer-owned support operations. |
| `c-38..c-39` | Profile-name edit and English/বাংলা preference persistence. | W1 editable profile fields only; phone/email remain owned by the authentication method. Avatar upload is not exposed in this implementation. |
| `c-40` | Confirmed, private account-deletion support request with explicit progress and failure feedback. | This does **not** immediately delete the account or erase data. W1 has no deletion endpoint; retention/anonymization needs founder approval in ADR-0007. |

## Checkout safeguard carried forward from `c-20`

The initial `area-sylhet-sadar` address is only a coarse service-area center. Delivery quoting and COD placement now reject the generic `Sylhet Sadar, Sylhet` label until the customer enters a specific house, road, or area; checkout disables placement and offers the address editor. Pickup remains independent of a delivery address. The W1 address is created or updated during quote/cart synchronization, and a widget test verifies no address/cart/quote request is sent while the generic label is active.

## Explicitly deferred, not represented as working controls

The current W1/W2 contracts do not provide a safe masked-call relay, tokenized shareable live-tracking page, PDF invoice endpoint, public review-photo uploader in this form, profile-avatar uploader, or notification-preference API. These actions are not shown as enabled/dead buttons. Chat attachments and other private evidence remain Cloudinary-only under ADR-0006; public review photos and avatars, if added, must go through W1 ImgBB with metadata scrubbing. Do not substitute direct phone numbers, client GPS access, untrusted image URLs, or local sample values.

## Automated verification added

- Flutter parser/service tests cover exact integer-poisha parsing, pickup-token visibility, OSRM precision-5 polyline parsing, RTDB `put` SSE decoding, and the authenticated review route. A W1-backed favourite test confirms IDs change only after a successful server toggle; an unavailable W1 does not fabricate local favourites.
- Flutter widget coverage checks `c-22`, `c-23`, and `c-26` guest entry, and proves c-20 blocks the generic Sylhet Sadar label before any address/cart/quote write, leaves the place-order button disabled, and opens a blank address editor.
- W1 PGlite tests cover safe favourite cards, hidden home-kitchen private fields, customer review retrieval, outsider denial, and the public `vendor_slug` needed to reorder from a receipt.
- Final local `npm run ci:all`, `npm audit`, and `git diff --check` passed; gates audited 304 authored text files with zero violations and npm reported zero vulnerabilities. Flutter/Dart are unavailable locally.
- Final GitHub Actions run [#40088758939](https://github.com/rahimchawdhury63-creator/undal/actions/runs/40088758939) on `ddcb83f` passed 4/4 jobs: Flutter Analyze/widget tests (all four packages), PostgreSQL migrations/pgTAP, TypeScript/web/PGlite/fuzz/gates/gitleaks, and keystore/bootstrap dry-run.
