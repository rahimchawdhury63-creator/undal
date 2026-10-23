# 16 · Customer App (Flutter Android) — Screen-by-Screen Spec

Reference basis: file `02` §2.1. Brand/tokens: file `25`. Every screen lists: purpose · key elements · data · states
(loading/empty/error/offline) · deep link. Navigation: bottom tabs **Home · Search · Orders · Cart(badge) · Account**.

## 16.1 Onboarding & auth
- **Splash → value carousel (3, skippable)** → **Location prime → OS permission → Address pin** (search / GPS / drag-pin,
  zone verdict; file `14`) → optional **Notification prime**. Guest browsing allowed; auth intercepted at checkout/favourite.
- **Auth hub:** Continue with Google · Email+password · Phone+password · provider plugins (D-09, rendered from settings) ·
  Sign-up multi-step (credentials → profile → address) with step dots + resume-later. Errors use Appendix-G copy EN/BN.
  Login success returns to the intercepted action (never dumps user at Home).

## 16.2 Home (Delivery) / Pickup twin
Header: address switcher (label + area, chevron → Addresses), favourites shortcut. Search pill → Search tab.
Shortcut rail: Offers · Pick-up ⇄ Delivery · Flash Box · New Kitchens · Home Kitchens · Top Rated · Free Delivery.
Cuisine rail (taxonomy images, selected state ring). Filter chip row: Filters sheet (Sort: Recommended/Fastest/Nearest/
Top rated/Price low→high · Offers only · Rating 4.0+/4.5+ · Veg · Open now · Max delivery fee) + active-filter clear.
Modules (ranked pool, file `13`): Flash Box countdown strip (real campaign clock) · Order again · Explore near you (main feed) ·
Home kitchens rail · Under-30-min rail. **Vendor card** (anatomy locked): cover, heart, chips (Home Kitchen/Cloud Kitchen/
Flash Box 25%/Free delivery), name, ★ avg (count bucket), ETA range · price tier ৳–৳৳৳ · cuisines, fee line
(strikethrough→Free), ≤2 offer pills. Closed vendors: greyed + “Opens {time}” + Notify me. Infinite scroll (paged RPC),
skeleton cards, pull-refresh, offline = last cached feed + banner (ordering disabled with explanation).

## 16.3 Search
Scopes All/Restaurants/Dishes; recent searches (on-device, clearable); trending chips (zone, real logs); popular cuisines;
results: vendor cards + dish rows (photo, price, vendor, “Add” quick flow into item sheet); Bangla/Banglish matching;
zero-result recovery (did-you-mean + near alternatives — anti-pattern AP-1).

## 16.4 Vendor page
Hero cover + logo, name, rating→Reviews, cuisines, ETA/fee/min-order chips, open-hours, address/pickup point + map mini,
vendor-type trust card (home kitchen: kitchen photos, about the cook). Sticky: in-menu search + category tabs (scroll-spy).
Item rows/cards: photo, name EN/BN, desc 2-line, price + compare-at, badges (spicy🌶×n, veg, popular), Add/stepper.
**Item sheet:** gallery, variant radio (sizes), option groups (checkbox/radio with min/max enforcement + live price),
special instructions, qty stepper, Add-to-cart ৳total CTA. Bundle builder: slot-by-slot choices with progress.
Business-info sheet (hours table, licence-display name), Reviews screen (§2.1.6 + photo reviews + vendor replies).
Share (App-Link URL), Favourite, Report. Closed-state: menu browsable, ordering disabled + opens-at.

## 16.5 Cart & checkout
Cart (single-vendor law + switch-confirm): fulfilment segmented control, ETA, line items (options summary, edit = reopen sheet,
stepper/trash), Add-more (back to vendor), voucher entry (wallet list + code field, why-invalid reasons), cutlery toggle
(default OFF), bill itemisation exactly as file `10`, stale-cart reprice notice. Checkout: address card + instructions +
pin micro-adjust; delivery options (Standard / Priority +fee, honest ETAs); tip chips (None/10/20/30/custom, “paid in cash
to rider”); payment row = **Cash on Delivery** (pickup: Pay at counter); place-order CTA with total; idempotent submit
(double-tap safe) → confirmation → **Live tracking**.

## 16.6 Live order tracking (hero screen)
Map (vendor pin, rider live dot interpolated, customer pin, route), status timeline (Placed → Accepted · prep countdown →
Rider assigned (name/photo/vehicle/rating) → Picked up → Arriving → Delivered), ETA range + “why” explainer, order summary
collapsible, actions: Chat rider/vendor · Call (masked) · Help (issue flows: late, wrong item, cancel-request per window rules) ·
Share live tracking link (web viewer, tokenised). Pickup mode: prep progress + “Ready — show code” screen (4-digit + QR
for counter handover). Post-delivery: rate vendor + rider (stars + aspect chips + photo + comment), tip-thanks state, reorder.

## 16.7 Orders, Account & more
Orders tab: Live (pinned) + History (status pills, reorder, rate, invoice/receipt view, help-per-order).
Account: profile edit, Addresses CRUD (map pin), Favourites, Vouchers, **Undal Rewards** (points balance/history,兑换 to vouchers),
Invite friends (code + share sheet, reward status), Notifications inbox + preferences, Language EN/বাংলা, Help Center
(FAQs + support chat tickets), Become a Partner / Ride with Undal (store/deep links), Legal (Terms/Privacy, EN/BN),
Delete account, Logout, version + update prompt (force-upgrade gate from settings).
Global: offline banner, session-expired gentle re-auth, crash-report opt-in, deep links for every entity (Appendix E routes).
