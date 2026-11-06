<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 17 — Customer App

> `com.undal.customer` · 68 screens · the app that has to feel better than Foodpanda on a 4-year-old
> phone over a 3G connection. Logo: `brand/undal-customer-logo.jpg` (the pink variant
> `undal-customer-logo-pink.jpg` is the adaptive-icon foreground).

---

## 1. The shape of the app

```
  ┌──────────┬──────────┬──────────┬──────────┐
  │   Home   │  Search  │  Orders  │ Account  │   ← 4 tabs, always
  └──────────┴──────────┴──────────┴──────────┘
       ╰─ floating black cart capsule, above the bar, when the cart is non-empty
```

Four tabs. Not five, not a centre FAB. The cart is a **floating capsule**
([`04 §5`](04-motion-and-interaction.md)), not a tab, because the cart is a transient state and a
tab is a place.

---

## 2. Screen inventory

| Group | Screens | Notes |
| --- | --- | --- |
| **Onboarding** | 6 | Splash, value carousel (3 cards, skippable), language, permissions |
| **Auth** | 9 | Entry, login, register step 1/2/3, forgot-password, Google, error recovery |
| **Location** | 7 | Map pin, search, current location, address form, label, saved list, edit |
| **Home** | 8 | Main, zone picker, category grid, "all vendors", collections, cuisine list, nearby, closed-vendors |
| **Search** | 5 | Entry, suggestions, results, filters sheet, no-results |
| **Vendor** | 7 | Vendor page, item sheet, info sheet, reviews, photos, closed-state, pre-order |
| **Cart** | 6 | Cart, tip sheet, note sheet, promo sheet, address select, pickup toggle |
| **Checkout** | 4 | Review, placing, placed-confirmation, failure |
| **Tracking** | 6 | Live map, stage detail, rider contact, order detail, bundle notice, help |
| **Orders** | 5 | List, past detail, reorder sheet, rate order, dispute |
| **Account** | 9 | Profile, edit, addresses, taste profile, language, notifications, help, legal, delete |
| **System** | 6 | Offline, update-required, maintenance, zone-unavailable, generic error, deep-link resolver |
| **Total** | **68** | |

Each is specified below only where it carries a decision worth recording; the full
screen-by-screen state table lives in [`36`](36-acceptance-criteria.md).

---

## 3. Onboarding and authentication

### 3.1 The first 20 seconds

The app opens to the **home screen**, not to a login wall. A customer can browse every vendor,
open every menu, build a cart and see every price without an account. Authentication is demanded
exactly once: at checkout, because a delivery needs a name, a phone number and an address.

This is the single highest-impact product decision in the customer app. A login wall in front of
a marketplace costs more customers than any feature gains.

### 3.2 Registration — three steps

Per [`08`](08-api-contract.md), and matching the brief's *"multi-step registration with location
setup"*:

```
  ① IDENTITY            ② LOCATION              ③ PREFERENCES
  ─────────────         ──────────────          ───────────────
  Name                  Map with a pin          Language
  Phone  (+880)         Search                  Veg / halal defaults
  Email  (optional)     Use current location    Notification choices
  Password              House / flat / floor
                        Landmark
  ━━━━━━━━━━━━━━━━━━    Label: Home/Work/Other  ━━━━━━━━━━━━━━━━━━
  ●○○                   ●●○                     ●●●
```

Rules:
- **No OTP. No email verification.** The brief is explicit and the implementation contains no code
  path for either.
- Progress is stored server-side in KV for 30 minutes, so closing the app mid-registration and
  returning resumes exactly where it stopped.
- Step 2 is skippable **only** if the user is checking out with pickup.
- The phone field is a real `+880` input with Bangladeshi operator-prefix validation
  (`013|014|015|016|017|018|019`), formatted as `01XXX-XXXXXX` while typing.
- Password: minimum 8 characters, checked against a 10 000-entry common-password list bundled in
  the app. Strength is shown as a four-segment bar with honest labels, not a percentage.

### 3.3 Google sign-in

Rendered **only** when the server reports `features.googleAuth = true`, which is true only when
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured. When they are not, the
button is absent — not greyed out, not showing an error. A disabled button is a promise the app
cannot keep.

### 3.4 Forgot password

With no email and no OTP, recovery is admin-mediated: the user submits their phone number, support
verifies identity by whatever means the operator chooses, and an admin issues a single-use,
15-minute reset token delivered by the support channel. The screen says exactly this, so nobody
waits for an SMS that is not coming.

---

## 4. Home

```
┌─────────────────────────────────────────┐
│  📍 Home · Shibganj, Sylhet        ▾  👤│  ← condenses on scroll (04 §7)
│  ┌───────────────────────────────────┐  │
│  │ 🔍  Search for biriyani, tea …    │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  🍛  🍜  🍔  ☕  🍰  🥘  🍕  🧃  →      │  ← cuisine chips, horizontal
├─────────────────────────────────────────┤
│  ⚡ Flash Box                    See all│
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ -25%   │ │ -25%   │ │ -25%   │       │
│  └────────┘ └────────┘ └────────┘       │
├─────────────────────────────────────────┤
│  Order again                            │
│  ┌──────────────────────────────┐       │
│  │ Rahman's · Kacchi · ৳320     │       │
│  └──────────────────────────────┘       │
├─────────────────────────────────────────┤
│  All restaurants              43 nearby │
│  ┌─────────────────────────────────┐    │
│  │ [photo]  Rahman's Biriyani      │    │
│  │          4.6 ★ (212) · 18 min   │    │
│  │          1.2 km · ৳30 delivery  │    │
│  │          Why am I seeing this? ⓘ│    │
│  └─────────────────────────────────┘    │
│  …                                      │
└─────────────────────────────────────────┘
```

### 4.1 The vendor card

| Element | Rule |
| --- | --- |
| Photo | 16:9, Coil, blur-hash placeholder, never a grey box |
| Name | 1 line, ellipsised, never truncated mid-word |
| Rating | Wilson-bounded star + raw count in parentheses. **A vendor with fewer than 5 ratings shows "New" instead of a star**, because 5.0 from one order is a lie |
| ETA | From the Brain's prediction, as a single number, not a range, on the card; the range appears at checkout |
| Distance | Routed, not straight-line, for the top 40 |
| Delivery fee | The real computed fee for *this* customer's address. Never "from ৳X" |
| Badges | Max 2: `Flash Box`, `New`, `Free delivery`, `Closed`, `Busy`, `Opens 17:00` |
| `Why am I seeing this?` | Opens the rank explanation ([`13 §12`](13-ranking-personalization.md)) |
| No sponsored slot | There is nowhere on this card for one |

### 4.2 Flash Box

The brief's 25% vendor-funded campaign. It is **opt-in per vendor**, the discount is funded by the
vendor and deducted on their invoice ([`24`](24-finance-payouts-invoices.md)), and it is shown
honestly: the struck-through original and the new price, with "25% off, paid by the restaurant"
in the detail sheet. It is a discount, not an advertising slot — it does not change ranking beyond
the `flash_box_active` boolean, which is a non-magnitude signal
([`13 §1`](13-ranking-personalization.md)).

### 4.3 Empty home

Zero vendors is a first-class state, not an error:

```
            ╭────────────────╮
            │  [illustration] │
            ╰────────────────╯

      No restaurants here yet

   Undal hasn't reached Shibganj yet. We're
   working on it — be the first to know.

        [ Notify me when we're live ]
        [ Change location ]

   Know a restaurant that should be here?
        [ Suggest a restaurant ]
```

Three paths forward and no dead end. [`33`](33-empty-state-doctrine.md) specifies all 44 empty
states; the home one is the most important because it is the one a new city sees first.

---

## 5. Vendor page

The signature screen. [`04 §4`](04-motion-and-interaction.md) specifies the motion; this is the
structure.

```
  ╔═══════════════════════════════════╗
  ║   [ hero photo, parallax 0.35× ]  ║   ← collapses to a 56dp bar
  ║                              ♡    ║
  ╠═══════════════════════════════════╣
  ║  Rahman's Biriyani House          ║
  ║  4.6 ★ (212) · Bengali · ৳৳       ║
  ║  📍 1.2 km  ⏱ 18 min  🛵 ৳30      ║
  ║  ─────────────────────────────    ║
  ║  🌿 Veg options  ☪ Halal          ║
  ╠═══════════════════════════════════╣
  ║ [Popular][Biriyani][Curry][Drinks]║   ← sticky tabs, scroll-synced
  ╠═══════════════════════════════════╣
  ║  POPULAR                          ║
  ║  ┌─────────────────────────┐      ║
  ║  │ Kacchi Biriyani (Full)  │ ╭──╮ ║
  ║  │ Mutton, aromatic rice…  │ │img│║
  ║  │ ৳320        ⭐ 94% liked │ ╰──╯ ║
  ║  │                      ⊕  │      ║
  ║  └─────────────────────────┘      ║
  ╚═══════════════════════════════════╝
```

| Decision | Rationale |
| --- | --- |
| Tabs are scroll-synced **both ways** | Tapping a tab scrolls; scrolling moves the tab. Anything less feels broken |
| The `⊕` morphs to `− 1 +` in place | [`04 §6`](04-motion-and-interaction.md); a grid-column spring, never a layout jump |
| Item photos are optional | A vendor without photos shows a tinted monogram tile, never a broken-image icon |
| `% liked` instead of stars for items | Item-level star ratings are too sparse to be meaningful; "94% of people who ordered this liked it" with a minimum of 20 orders is honest |
| Unavailable items are shown, greyed, at the bottom of their section | Hiding them makes customers think the menu changed |
| Closed vendors are fully browsable | Browsing a closed restaurant is how customers plan |

### 5.1 The item sheet

A bottom sheet, not a screen, because it is a decision and not a destination. Contains: photo,
full description, allergen and dietary tags, required option groups (radio), optional add-ons
(checkbox with price deltas), a quantity stepper, a free-text note, and a sticky
**"Add to cart · ৳420"** button whose amount updates with a digit roll on every change.

Option-group validation is inline and immediate: a required group that is unanswered shows a
red-bordered prompt the moment the user tries to add, and the sheet scrolls to it.

---

## 6. Cart and checkout

### 6.1 The cart

One vendor at a time. Adding an item from a second vendor prompts: *"Start a new order from
Khan's? Your cart from Rahman's will be saved."* — and it genuinely is saved, in a parked-carts
list, recoverable for 24 hours.

```
┌───────────────────────────────────────┐
│  Rahman's Biriyani House              │
│  ─────────────────────────────────    │
│  1 ×  Kacchi Biriyani (Full)   ৳320   │
│         − 1 +                         │
│  1 ×  Borhani                   ৳60   │
│  1 ×  Firni                     ৳70   │
│  ─────────────────────────────────    │
│  + Add more items                     │
├───────────────────────────────────────┤
│  🛵 Delivery    |    🏪 Pick-up        │  ← segmented, animated
├───────────────────────────────────────┤
│  📍 Home · House 42, Shibganj    Edit │
│  ⏱ Arrives 14:38 – 14:46              │
│  📝 Add a note for the restaurant     │
│  💝 Tip your rider          ৳0  ▾     │
├───────────────────────────────────────┤
│  Subtotal                      ৳450.00│
│  Delivery fee                   ৳70.42│  ⓘ
│  Tax                             ৳4.39│  ⓘ
│  Rounding                       −৳0.81│  ⓘ
│  ───────────────────────────────────  │
│  Total (cash)                 ৳549.00 │
├───────────────────────────────────────┤
│   ◀━━━━━━ SLIDE TO ORDER ━━━━━━▶      │
│        💵 Pay ৳549.00 in cash          │
└───────────────────────────────────────┘
```

### 6.2 Every line is explained

Each ⓘ opens a sheet with the **actual computation**, from the server's `explain{}` block:

```
  Delivery fee · ৳70.42

  Base fare (motorbike)             ৳40.00
  Surge ×1.272                      +৳10.88
  Distance 3.8 km (first 2 km free) +৳25.20
  Traffic                            ৳0.00
  ──────────────────────────────────────────
  Rider's share                     ৳65.20
  Platform                           ৳5.22
  ──────────────────────────────────────────
  Total                             ৳70.42

  ৳65.20 of this goes to Karim, your rider.

  Surge is higher right now because there
  are fewer riders than orders in your area.
  It changes every 90 seconds.
```

Showing the rider's share is not decoration. It reframes the delivery fee from "the app's tax" to
"the person on the motorbike", which is what it mostly is.

### 6.3 Cash-on-delivery, stated plainly

The order button says **"Pay ৳549.00 in cash"**. The confirmation screen says *"Have ৳549 ready —
your rider carries change for up to ৳1 000."* There is no payment-method selector, because there
is exactly one method, and a selector with one option is a lie about future options.

### 6.4 Repricing

The quote is valid for 5 minutes. At slide-to-order the server re-prices; if anything moved
(surge changed, an item went unavailable, the vendor closed), the client receives
`409 QUOTE_MISMATCH` and shows a **diff sheet**:

```
      Prices changed while you were deciding

      Delivery fee    ৳70.42  →  ৳78.10
                               (surge rose)
      Total          ৳549.00  →  ৳557.00

      [ Order at the new price ]
      [ Go back ]
```

Never a silent re-charge. Never a generic "please try again".

---

## 7. Tracking

```
╔═══════════════════════════════════════╗
║  [ MapLibre, OSM, rider + route ]     ║
║                                       ║
║              🛵                        ║
║         ╱                             ║
║     🏪  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  📍       ║
║                                       ║
║  © OpenStreetMap contributors         ║
╠═══════════════════════════════════════╣
║  ● Order placed            14:08      ║
║  ● Restaurant accepted     14:09      ║
║  ● Rider assigned          14:10      ║
║  ◉ Picked up               14:22      ║  ← current, pulsing
║  ○ Delivered               ~14:38     ║
╠═══════════════════════════════════════╣
║  🛵  Karim R.  ·  ★ 4.8               ║
║      Honda · DHA-METRO-LA-12-3456     ║
║      [ 📞 Call ]  [ 💬 Message ]      ║
╠═══════════════════════════════════════╣
║  Arriving 14:36 – 14:41               ║
║  3 items · ৳549.00 in cash            ║
╚═══════════════════════════════════════╝
```

| Decision | Rationale |
| --- | --- |
| The rider marker interpolates | Teleporting markers are the most common tracking bug; [`04 §8`](04-motion-and-interaction.md) |
| Staleness is shown, not hidden | After 20 s: a soft "updating" pulse. After 60 s: "Last seen 1 min ago". After 180 s: a grey marker and an honest explanation. [`07 §11`](07-d1-live-tracking.md) |
| The ETA is a **range**, always | A single-minute promise is a promise that will be broken |
| Calls are masked | The call button dials a proxy number; neither party sees the other's real number. Where no masking provider is configured, it dials directly and the app says so in the privacy screen |
| Bundles are disclosed | [`12 §8`](12-batching-engine.md) |
| The map is not the whole screen | The timeline matters more than the map after pickup; the sheet is draggable and remembers its position |

### 7.1 Live updates

SSE from `undal-realtime`, with a WebSocket upgrade where available, falling back to a 10-second
poll only if both fail. The connection is held only while the tracking screen is foregrounded;
background updates arrive as ordinary (non-alarm) notifications.

---

## 8. After delivery

### 8.1 Rating

One screen, three taps maximum, appearing as a sheet on next app open rather than as a push:

```
        How was it?

   Food from Rahman's
   😞  😐  🙂  😊  🤩

   Karim's delivery
   😞  😐  🙂  😊  🤩

   [ optional: what went well / wrong ]
   [ tag chips: Hot · Fast · Polite · Packaging ]

              [ Done ]    Skip
```

Separate ratings for food and delivery, because conflating them punishes a rider for a cold
kitchen and a vendor for a slow rider. Skipping is one tap and carries no nagging.

Those two sentences are now two rows (D137). `POST /v1/orders/{id}/rate` writes one `order_ratings` row per
`(order, target)` — the table's own unique key is the anti-manipulation rule `27 §4` states as "one rating per
order" — with `stars` 1–5, an optional 500-character comment, and up to six chips from the sheet's set. The window
opens when the order reaches `DELIVERED` and lasts seven days; before delivery the rating does not exist yet, so the
request is a `404` rather than a refusal. A second tap is answered with the first rating (`created: false`, no new
row, no audit entry) instead of a new code: the answer the customer gave is the answer the order has.

### 8.2 Disputes

A "Something was wrong" entry on every past order, leading to a structured flow: category (missing
item / wrong item / cold / late / damaged / rider conduct / other), affected items, optional photo
(uploaded to Cloudinary as a sensitive document — [`26`](26-media-pipeline.md)), and a free-text
box. It produces a ticket in the support desk ([`27`](27-security-rbac-audit.md)) with the order's
full evidence attached, and the customer sees its status.

---

## 9. Account

| Screen | Contents |
| --- | --- |
| Profile | Name, phone, email, photo, member since, order count |
| Addresses | List with map thumbnails, labels, default, add/edit/delete |
| **Taste profile** | The derived cuisine distribution in plain language, per-cuisine delete, and a single "Clear all personalisation" action ([`13 §13`](13-ranking-personalization.md)) |
| Language | English / বাংলা, plus a numerals preference |
| Notifications | Per-category toggles; order-status notifications cannot be disabled while an order is active, and the screen explains why |
| Help | Searchable FAQ, order-specific help, contact |
| Legal | Terms, privacy, **the PASVL-1.0 licence in full**, OSM attribution, open-source notices |
| Delete account | A real, working, two-step deletion that removes personal data within 24 hours and anonymises the order history. Not a support email address |

---

## 10. Localisation

| Aspect | Treatment |
| --- | --- |
| Languages | English, Bengali — complete, no partial strings. `i18n-completeness` fails the build on a missing key in either |
| Bengali typography | Hind Siliguri at 1.07× optical size; line height 1.55 vs 1.45 for Latin, because conjuncts need vertical room |
| Numerals | User preference; money defaults to Latin digits even in Bengali, addresses and times follow the language |
| Dates | `আজ ২:৩৮ PM` / `Today 2:38 PM`; relative within 24 h, absolute beyond |
| Currency | `৳` always precedes, with a thin space: `৳ 549.00`. Lakh/crore grouping |
| Pluralisation | ICU plural rules for both languages |
| RTL | Not required, but the layout uses `start`/`end` throughout so it would work |

---

## 11. Deep links

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="${WEB_HOST}" />
  <data android:pathPrefix="/r/" />      <!-- restaurant -->
  <data android:pathPrefix="/o/" />      <!-- order      -->
  <data android:pathPrefix="/c/" />      <!-- cuisine    -->
  <data android:pathPrefix="/track/" />
</intent-filter>
```

App Links are verified via `/.well-known/assetlinks.json`, generated by the Pages build from the
release keystore's SHA-256 fingerprint ([`31`](31-seo-prerender-deeplinks.md)). A website link
opens the installed app; with no app installed it opens the responsive web page, which is a
complete ordering experience in its own right.

The deep-link resolver screen handles the unhappy paths: a link to a vendor outside the user's
zone, a link to a deleted vendor, a link to someone else's order. Each gets a specific, honest
screen rather than a dump onto the home tab.

---

## 12. Performance on a bad network

The customer app is tested on a throttled profile: **400 kbps down, 300 ms RTT, 2% packet loss** —
a realistic Bangladeshi 3G edge case.

| Behaviour | Budget |
| --- | --- |
| Home renders from cache | < 300 ms, always, regardless of network |
| Vendor list refresh | Visible within 2.5 s or the stale list stays with a "refreshing" chip |
| Vendor photos | Progressive, blur-hash first, 320 px variant on slow networks (`Save-Data` and `NetworkCapabilities` bandwidth estimate both honoured) |
| Checkout | Works offline up to the final slide, which then queues with an honest "we'll place this the moment you're back" |
| Tracking | Degrades to the timeline with last-known positions; never a blank map |

Image variants come from imgbb's resized URLs ([`26`](26-media-pipeline.md)), chosen client-side by
measured bandwidth.

---

## 13. Reading on

Next: [`18-partner-app.md`](18-partner-app.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
