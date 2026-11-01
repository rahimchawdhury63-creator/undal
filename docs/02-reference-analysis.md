<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 02 — Reference Analysis

> **What this document is.** A forensic teardown of every reference asset in this repository, plus a
> structured inventory of the interaction patterns Undal is measured against. It ends with a
> decision table: for each pattern, what Undal **takes**, what it **improves**, and what it
> **rejects**. The design system in [`03`](03-brand-and-design-system.md) and the motion spec in
> [`04`](04-motion-and-interaction.md) are both derived from the conclusions here, so this is read
> first and argued with second.

---

## 1. The reference inventory

| Asset | Path | Format | What it establishes |
| --- | --- | --- | --- |
| Customer mark (dark) | `brand/undal-customer-logo.jpg` | 924 × 768 JPEG | Primary identity, customer surface |
| Customer mark (crimson) | `brand/undal-customer-logo-pink.jpg` | 924 × 768 JPEG | Alternate accent identity |
| Partner mark | `brand/undal-partner-logo.jpg` | 614 × 696 JPEG | Partner surface identity |
| Rider mark | `brand/undal-rider-logo.jpg` | 671 × 614 JPEG | Rider surface identity |
| Motion reference A | `assets/reference/motion-ref-a-warm-card-ui.mp4` | 720 × 540, 60 fps, 22.00 s | Warm, soft, card-based food-ordering motion language |
| Motion reference B | `assets/reference/motion-ref-b-modern-liquid-ui.mp4` | 720 × 1280, 60 fps, 15.37 s | Modern, high-contrast, physics-driven motion language |
| Alert loop | `assets/audio/undal_order_alert_loop.wav` | 44.1 kHz, mono, 16-bit, 8.000 s | The order alarm |

Both videos were decoded and sampled for this analysis. The findings in §3 and §4 are frame
observations, not impressions.

---

## 2. The logo system — what the marks actually tell us

### 2.1 The character

One bird, three costumes. This is a stronger system than three unrelated marks, and the
implementation must protect it:

| Mark | Costume | Props | Reads as |
| --- | --- | --- | --- |
| Customer | Flat-brim cap | Bindle sack over the shoulder, wing extended forward | "Your order is on its way to you" |
| Partner | Chef's toque with a flame motif, steam wisp rising above the ring | Bindle sack | "You are the kitchen" |
| Rider | Helmet with chin strap, two wheels beneath the body, three speed lines trailing | Bindle sack | "You are in motion" |

The bindle appears in all three. It is the connective tissue of the system and must never be
retouched out of any derivative asset.

### 2.2 Construction

Every mark is a **circular lockup**: a 1-unit stroke ring, the character centred in the upper two
thirds, and the wordmark in the lower third. The ring is open at the top in the partner mark to let
the steam escape — a small, confident detail that the app's splash animation should reproduce.

- **Wordmark**: a geometric, very round, low-contrast sans. Single-storey `a`, generous apertures,
  terminals cut horizontally. The closest free match is **Poppins SemiBold** with `-1.5%` tracking;
  **Nunito ExtraBold** is the fallback if the `l`'s tail feels too mechanical in Bangla pairings.
- **Role word** (`partner`, `rider`) sits below `undal` at **38% of the wordmark's cap height**,
  centred, in the same family at Medium weight.
- **Stroke weight**: ring stroke ≈ 2.6% of diameter. At 48 dp this is 1.25 dp, which is too thin —
  the app-icon variants must use a **thickened ring at 4.5%** below 96 dp. Specified as the
  `mark/ring-weight` token in [`03 §12`](03-brand-and-design-system.md).

### 2.3 Measured colour

The supplied files are photographs of printed boards under neutral grey light, so the raw pixel
values are desaturated and lifted. Dominant-colour extraction gives:

| Mark | Measured ink | Measured ground | Normalised brand value |
| --- | --- | --- | --- |
| Customer (dark) | `#162625` | `#CBCBC7` | **`#0C1F1C`** Undal Ink |
| Partner | `#15352C` / `#173B32` | `#CACBC7` | **`#0F4435`** Undal Forest |
| Rider | `#15372B` / `#0D3728` | `#D2D3CD` | **`#0F4435`** Undal Forest |
| Customer (crimson) | `#781725` (in shadow) | `#D7D4D2` | **`#A6192E`** Undal Crimson |

The normalisation applies a +12% luminance and +18% saturation correction to compensate for the
capture conditions, then snaps to a value that holds 4.5:1 contrast against `#FFFFFF`. The derivation
is reproducible — `scripts/brand/extract_palette.mjs` ships in the build and regenerates the table.

**The crucial read:** the partner and rider marks are the *same* green. The customer mark is a
near-black that reads as "green-black" beside them, and the crimson variant exists as an accent, not
as a second identity. So Undal's palette is **one deep forest green as the brand constant**, with
role-specific accents layered on top — which is exactly the structure the brief's "Uber Eats + Foodpanda"
direction needs, because it leaves the vivid green and the vivid magenta free to be *functional*
colours rather than fighting the logo. [`03 §2`](03-brand-and-design-system.md) builds on this.

### 2.4 What must be produced from these files

The JPEGs are raster photographs. They are the *source of truth for design*, not shippable assets.
Build response 3 (see [`35`](35-execution-plan.md)) must produce, by tracing:

| Asset | Format | Sizes |
| --- | --- | --- |
| `undal-mark-customer.svg` / `-partner` / `-rider` | SVG, single path per colour, viewBox 0 0 512 512 | vector |
| Adaptive icons | `ic_launcher_foreground.xml` + `ic_launcher_background.xml` (VectorDrawable) | per app |
| Legacy launcher PNGs | mdpi → xxxhdpi | 48 → 192 dp |
| Play Store icon | PNG | 512 × 512 |
| Feature graphic | PNG | 1024 × 500 |
| Favicon set | SVG + ICO + 180 Apple touch | web |
| Splash vector | `VectorDrawable` for `windowSplashScreenAnimatedIcon` | per app |
| OG / Twitter card | PNG | 1200 × 630 |
| Invoice letterhead | SVG embedded in the PDF | vector |
| Monochrome mark | SVG, `#000` | for themed icons on Android 13+ |

---

## 3. Motion reference A — `motion-ref-a-warm-card-ui.mp4`

**22.00 s · 720 × 540 · 60 fps · presented as a phone mockup floating on a saturated yellow field.**

This reference is about **warmth, roundness, and generous negative space**. It is the softer half of
Undal's motion vocabulary.

### 3.1 Scene-by-scene

| t | Scene | What happens |
| --- | --- | --- |
| 0.0 – 2.2 s | **Splash → Auth** | The device mockup settles from a slight scale-up. The app mark fades and scales in from 0.86 → 1.0. |
| 2.2 – 4.5 s | **Auth** | Logo, brand name, a small subtitle, then a two-tab segmented control (`Login` / `Signup`) with a **2 dp underline indicator** that slides between tabs. Below: two underline-style text fields (`Email address`, `Password` with a reveal eye), and a right-aligned `Forgot password?` in the accent colour. The field labels sit **above** the line in a small caps-ish grey, and the placeholder sits on the line. |
| 4.5 – 8.0 s | **Home — build-in** | Header `Let's eat Quality food 🤤` as a two-line display. A pill search field with a leading magnifier and a **separate square filter button** to its right. Below, a horizontally scrolling row of **category chips with emoji**: `🍔 Fast food`, `🍓 Fruit item`, `🥦 Veget…`. The selected chip is filled accent; the others are white with a hairline border. The cards stagger in bottom-up, ~60 ms apart. |
| 8.0 – 12.0 s | **Home — grid** | Two-column food cards. Each card is a white rounded rectangle with the **dish photograph overflowing past the card's top edge** — the image is a free-floating cut-out, not a cropped header. Below the image: dish name (two lines max), a muted descriptor, a `🔥 78 Calories` metadata chip in accent-tinted text, and the price with a **superscript currency glyph**. |
| 12.0 – 14.5 s | **Card → Detail transition** | The tapped card's dish image performs a **shared-element flight** to the detail hero position while the rest of the card fades and the detail sheet pushes in from the right with a parallax offset of about 0.35×. This is the single most important motion in the reference. |
| 14.5 – 18.0 s | **Detail** | Hero dish image, large and circular-cropped, with a subtle drop shadow. Overlapping its lower edge: a **floating pill stepper** `− 2 +` in the accent colour. Then the title (two lines) with the price right-aligned on the first line. Then a **metadata row of three items**: `⭐ 2.6`, `🔥 65 Calories`, `⏱ 20–30 min`. Then `Details` body copy, then an `Ingredients` row of circular ingredient thumbnails ending in a round accent `+` button. |
| 18.0 – 21.0 s | **Cart** | A back chevron, centred title `Cart Food`, avatar top-right. Rows: a circular dish thumbnail at the left overlapping the row's leading edge, name, descriptor, price, and a `− n +` pill on the right. A **leading radio dot** marks the row as selected for checkout. One row is shown **swiped left**, revealing a red trash affordance in a rounded well behind it. |
| 21.0 – 22.0 s | **Bottom bar** | Five-slot bottom navigation with a **raised circular centre action** carrying the cart badge. The raised button sits ~14 dp above the bar and casts its own shadow. |

### 3.2 Extracted principles

1. **Food photography breaks the frame.** Images are cut-outs that overflow their containers. This
   makes a grid of rectangles feel like a table of real objects. Undal adopts this for the **vendor
   hero cards** and the **dish detail hero**, with a transparent-PNG pipeline through imgbb and a
   graceful fall-back to a contained crop when the vendor uploads a rectangular photo (which most
   will). See [`17 §6`](17-customer-app.md).
2. **The stepper is a pill that floats, not a row of buttons.** `− n +` as one continuous capsule
   with the number animating as a **rolling digit** is more legible at a glance and more pleasant to
   press. Adopted platform-wide as `UndalStepper`.
3. **Metadata is iconographic and tinted, never plain grey.** `⭐ 2.6 · 🔥 65 Cal · ⏱ 20–30 min`. Undal
   maps this to `⭐ rating · 🕒 ETA · 🛵 fee · 📍 distance`, which is the metadata a delivery customer
   in Dhaka actually scans for.
4. **The shared-element flight is the signature.** It is what makes the app feel expensive. Undal
   implements it in Compose with `SharedTransitionLayout` and on the web with the View Transitions
   API, with a cross-fade fallback. [`04 §6`](04-motion-and-interaction.md).
5. **Underline fields with floating labels.** Lighter than boxed fields, and they survive narrow
   widths. Adopted for auth and onboarding; boxed fields are used in the admin panel where density
   matters more than air.
6. **Swipe-to-reveal destructive actions** with the action living in a rounded well *behind* the row,
   not painted on the row itself.

### 3.3 What Undal rejects from reference A

| Rejected | Why |
| --- | --- |
| The saturated yellow field | It is mockup presentation, not UI. Undal's canvas is `#FAFAF8`. |
| Calorie counts as primary metadata | Bangladeshi delivery customers optimise for price, time, and distance. Calories move to the nutrition section of the dish sheet. |
| Emoji inside category chips | Emoji render inconsistently across OEM fonts and break in Bangla. Undal uses a **custom 2-colour SVG icon set** for the 100+ cuisine categories. |
| The five-slot bar with a raised centre | The raised centre cart competes with reference B's floating cart pill, which is better. See §4.2. |
| Two-line dish descriptors on cards | At 200 px width (breakpoint floor) these truncate to nonsense. Undal drops the descriptor on cards below `sm`. |

---

## 4. Motion reference B — `motion-ref-b-modern-liquid-ui.mp4`

**15.37 s · 720 × 1280 · 60 fps · a device in-hand, scrolling a sushi catalogue.**

This reference is about **physics, density, and a floating control layer**. It is the sharper half of
Undal's motion vocabulary and it contributes the single best idea in either video.

### 4.1 Scene-by-scene

| t | Scene | What happens |
| --- | --- | --- |
| 0.0 – 1.5 s | **Rest state** | A translucent header: a faint city skyline illustration behind the words `San Francisco`, with `Delivery ⌄` beneath it as a mode switcher. A circular search button sits at the left, a circular heart at the right. The content sheet below is pure white with a large corner radius, floating over the header. |
| 1.5 – 5.0 s | **Scroll — header condensation** | As the sheet scrolls up, the header **condenses**: the city name shrinks and slides up into the same line as `Delivery`, the skyline fades, and the two circular buttons shrink by ~12% and gain a blurred backdrop. The transition is driven by scroll offset, continuously, not by a threshold snap. |
| 1.5 – 11.0 s | **Catalogue** | Section headers (`Philadelphia`, `Baked`, `Dragons`, `Maki`) are centred, large, and weight-heavy. Each section is a 2-up grid on a very light grey panel with ~28 dp radius. Cards carry: product photo, a **heart outline top-right**, a small **circular ingredient dot** at the mid-right indicating the dominant ingredient, name (two lines), price, and a circular `+`. |
| 6.0 – 8.0 s | **The `+` morph** | Tapping `+` causes the circular button to **stretch horizontally into a `− 1 +` capsule**, with the `+` glyph travelling to the capsule's right end and the `−` fading in at the left. Reversing to zero collapses it back. The motion is a spring, visibly overshooting by a few percent. |
| 8.0 – 11.0 s | **Horizontal section** | The `Dragons` section scrolls **horizontally** while the page scrolls vertically, with partially-visible cards bleeding off both edges. |
| 0.0 – 15.4 s | **The floating bottom bar** | Persistent. Three elements on a transparent strip: a **black circular** sections/menu button at the left, a **black capsule** in the centre showing a bag glyph, the item count, and a **white inner pill with the running total** (`$15` → `$25` → `$44`), and a **black circular** profile button at the right. The total's digits **roll** when it changes. The capsule widens slightly as the count grows. |

### 4.2 Extracted principles

1. **The floating cart capsule is the best idea in either reference, and Undal adopts it wholesale.**
   It is always reachable, it shows state without a badge, it does not consume a navigation slot, and
   the rolling total gives immediate, satisfying feedback for every tap on a `+`. Undal's version:
   black capsule, bag glyph, item count, and the running total in a white inner pill, with the digits
   rolling and a brief 1.04× scale pulse on change. It appears only when the cart is non-empty,
   springing up from below with a 260 ms `spring(0.72, 380)`.
2. **Continuous, scroll-driven header condensation**, never a threshold snap. Undal applies this to
   the customer home header (location + mode switcher) and the vendor storefront header (cover photo
   → compact title bar).
3. **The `+` → stepper morph.** A shared bounding-box animation, not a cross-fade. Compose:
   `animateContentSize` with a spring plus an `AnimatedContent` on the inner row. Web: a CSS grid
   `grid-template-columns` transition, which morphs without reflow jank.
4. **Sections as light panels.** Grouping cards onto a `#F4F4F2` panel with a large radius creates
   hierarchy with no borders and no shadows. Cheap to render, works at every width.
5. **Mixed scroll axes.** A vertical page containing horizontal rails, with cards deliberately
   bleeding off the edge to signal scrollability without a scrollbar.
6. **Favourites live on the card.** A heart on every card, not buried in a detail screen.

### 4.3 What Undal rejects from reference B

| Rejected | Why |
| --- | --- |
| Pure monochrome product cards | Undal's vendors are restaurants, not a single sushi brand. Cards need vendor identity: logo chip, cuisine tags, rating, ETA. |
| The ingredient dot | Ambiguous without a legend. Undal replaces it with **explicit dietary badges** (`🌿 Veg`, `🌶 Spicy`, `☪ Halal`) which matter far more in this market. |
| No ETA or fee on cards | Unacceptable for delivery. Undal puts `ETA · fee · distance` on every vendor card; it is the primary decision data. |
| The heart as the only right-side affordance | Undal needs a share action too, so the card's top-right becomes a two-slot cluster at `md` and above, heart-only below. |

---

## 5. Competitive pattern inventory

The brief names Foodpanda and Uber Eats as the bar. What follows is the inventory of patterns those
products established, organised by surface, with Undal's position on each. This is not a
pixel-copying exercise — it is a checklist that ensures no capability a Bangladeshi delivery customer
already expects is missing, and an argument for where Undal goes further.

### 5.1 Customer — discovery

| Pattern | Established behaviour | Undal's position |
| --- | --- | --- |
| Address-first launch | App opens to a location chip; everything is scoped to it | **Take.** Plus: Undal detects a zone change on launch and offers to switch, rather than silently showing nothing. |
| Delivery / Pick-up toggle | Segmented switch in the header that re-scopes the whole catalogue | **Take**, implemented as reference B's `Delivery ⌄` switcher. Pick-up removes the fee line entirely and switches the map to a walking route. |
| Cuisine category rail | Horizontal circular icons | **Improve.** 100+ categories with a searchable sheet, two-colour custom SVGs, and personalised ordering from the customer's own history. |
| Hero promotional carousel | Auto-advancing banners | **Improve and constrain.** Undal's carousel can only carry platform-funded promotions and vendor campaigns the vendor chose to run — it can never be sold. Auto-advance pauses on touch and respects reduce-motion. |
| Vendor card | Cover image, logo, name, rating, ETA, fee, tags | **Take and extend** with distance, a live-busy indicator, and an "opens at" state instead of hiding closed vendors. |
| "Free delivery" filter row | Quick filter chips above results | **Take.** Chips: `Free delivery`, `Under 30 min`, `Rating 4+`, `Pick-up`, `Flash Box`, `Open now`. |
| Infinite scroll with skeletons | Shimmer placeholders | **Take**, with a hard rule: skeletons only during a real fetch, never as a disguise for an empty result. See [`33`](33-empty-state-doctrine.md). |
| Search with suggestions | Typeahead over vendors and dishes | **Improve.** Undal searches vendors, dishes, and *cuisines* in one ranked list, with Bangla and transliterated-Bangla matching (`biriyani`, `বিরিয়ানি`, `biriani`). |
| Sort sheet | Relevance / rating / delivery time / distance | **Take.** Default is Undal's ten-stage rank, labelled honestly as `Best for you`. |
| Map view of vendors | Toggle to a map | **Improve.** MapLibre with vendor pins, live radius overlay, and the pin density clustered. |

### 5.2 Customer — vendor and ordering

| Pattern | Established behaviour | Undal's position |
| --- | --- | --- |
| Collapsing cover header | Cover photo collapses to a title bar on scroll | **Take**, continuously driven (reference B §4.2.2). |
| Sticky category tabs | Menu sections become sticky tabs that track scroll | **Take**, with two-way binding: scrolling moves the tab, tapping the tab scrolls. |
| Dish bottom sheet | Half-sheet with image, description, modifiers, quantity, add button | **Take**, with the shared-element flight from reference A §3.2.4. |
| Required / optional modifier groups | Radio for required, checkbox for optional, min/max enforcement | **Take**, fully modelled in the schema ([`06 §5`](06-data-model-cockroachdb.md)). |
| Special instructions | Free text per item | **Take**, with a 140-character limit and an allergy quick-chip row. |
| Out-of-stock items | Greyed with a label | **Take**, plus a "notify me" that uses the customer's existing FCM token at no cost. |
| Cart persistence per vendor | One open cart per vendor; switching warns | **Take.** Undal allows up to 3 parked carts and surfaces them in a drawer. |
| Upsell at checkout | "People also added…" | **Improve.** Driven by the Brain's co-occurrence matrix ([`13 §8`](13-ranking-personalization.md)), never by a paid slot. |
| Fee transparency sheet | Tap the fee to see the breakdown | **Take and go further.** Undal's sheet shows the *actual* distance, the surge multiplier in force, and the weather premium if any, with a one-line plain-Bangla explanation of each. |
| Tip selection | Preset chips plus custom | **Take**, never pre-selected (non-negotiable 18). Cash tips only; the amount is shown to the rider. |
| Scheduled delivery | Pick a future slot | **Reject for v1.** Out of scope per [`01 §8`](01-mission-and-non-negotiables.md). |

### 5.3 Customer — tracking

| Pattern | Established behaviour | Undal's position |
| --- | --- | --- |
| Status stepper | Horizontal node progress: placed → preparing → on the way → delivered | **Take**, as an animated vertical timeline on mobile and horizontal above `md`. |
| Live rider on a map | Moving marker with a route polyline | **Take.** Undal interpolates between sparse 100 m updates so the marker glides; see [`07 §6`](07-d1-live-tracking.md). |
| Rider card | Photo, name, vehicle, rating, call button | **Take**, with a masked-number call via the device dialler (no telephony cost). |
| ETA countdown | A single predicted time | **Improve.** Undal shows a **range** that narrows as confidence rises, which is honest and reduces anxiety. |
| Order detail accordion | Items, prices, address | **Take.** |
| Help entry point | Contextual support during an order | **Take**, routed into the dispute desk ([`21 §8`](21-admin-panel.md)). |

### 5.4 Partner app

| Pattern | Established behaviour | Undal's position |
| --- | --- | --- |
| Full-screen incoming order with looping sound | Takeover screen, alarm, accept/reject | **Take and make it the centrepiece.** [`15`](15-wakeup-alarm-fcm.md) and [`18 §5`](18-partner-app.md). |
| Preparation-time picker | `−` / `+` around a minute value | **Take and improve.** Undal pre-fills an intelligent default from the vendor's own measured prep history, the item mix, current load, and weather, then lets the vendor adjust in 5-minute steps up to **200 minutes**. The default is explained in one line: *"Suggested from your last 30 similar orders."* |
| Order list by state | Tabs: new / preparing / ready / completed | **Take.** |
| Busy mode | Temporarily extend all prep times | **Take**, with three levels (+10 / +20 / +30 min) and an auto-expiry. |
| Menu editor | Items, categories, prices, availability, photos | **Take**, with bulk availability toggles and a 1-tap "sold out until tomorrow". |
| Store open/closed toggle | Manual switch | **Improve.** Undal's presence engine flips it automatically on connectivity loss and nags the partner to re-open. [`14`](14-presence-and-heartbeat.md). |
| Dashboard | Today's orders, revenue, rating | **Take and extend** with the ten-stage rank inputs, so a partner can see *exactly* what would improve their position. No other platform shows this. |
| Payout statements | Weekly statement | **Take**, as a branded PDF with full line-by-line arithmetic. [`24`](24-finance-payouts-invoices.md). |

### 5.5 Rider app

| Pattern | Established behaviour | Undal's position |
| --- | --- | --- |
| Shift online/offline toggle | A single big switch | **Take**, gated behind selfie verification at shift start. |
| Offer card with countdown | Pickup, drop, distance, payout, a timer ring | **Take and extend.** Undal shows the **full payout breakdown** and the item list *before* acceptance. 25-second ring. |
| Reject with reason | Reason sheet | **Take**, with the critical constraint from the brief: **rejection is only permitted when another rider is available**, otherwise the rider is told why and given a 10-second reconsideration. |
| Batched order UI | Stacked stops in sequence | **Take.** [`12 §7`](12-batching-engine.md). |
| Navigation hand-off | Button to the maps app | **Take.** One tap builds a Google Maps intent with the vendor as waypoint and the customer as destination, falling back to `geo:` then to in-app MapLibre turn-by-turn. |
| Arrival geofence | Auto-detect arrival | **Take**, 80 m radius with a manual override. |
| Proof of pickup | Tap "picked up" | **Improve substantially.** Undal requires a **QR scan** of the code on the partner's order screen. Wrong order, wrong bag, and collusion all become hard. |
| Cash tracking | Running cash-in-hand | **Take and enforce** with the end-of-shift lock. [`25`](25-rider-cash-settlement.md). |
| Earnings screen | Daily/weekly totals | **Take**, with per-order breakdown matching the invoice exactly. |
| Heatmap of demand | Where to position | **Take.** Generated by the Brain's forecaster from the vendor's own order history; no external data. |

### 5.6 Admin

Enterprise delivery back-offices converge on nine domains. Undal implements all nine; the module
inventory is [`21`](21-admin-panel.md) and the counted feature register is
[`37`](37-feature-register.md).

| Domain | Undal's document |
| --- | --- |
| Governance, security, multi-tenancy | [`27`](27-security-rbac-audit.md) |
| Dispatch and logistics command | [`21 §4`](21-admin-panel.md), [`22`](22-admin-super-map.md) |
| Geofencing and pricing matrix | [`21 §6`](21-admin-panel.md) |
| Vendor and menu hub | [`21 §5`](21-admin-panel.md), [`23`](23-onboarding-kyc.md) |
| Finance, commissions, payouts | [`24`](24-finance-payouts-invoices.md), [`25`](25-rider-cash-settlement.md) |
| Live order tower and exceptions | [`21 §7`](21-admin-panel.md) |
| Marketing, growth, loyalty | [`21 §9`](21-admin-panel.md), [`13 §10`](13-ranking-personalization.md) |
| Support and disputes | [`21 §8`](21-admin-panel.md) |
| BI, analytics, forecasting | [`21 §10`](21-admin-panel.md), [`09 §9`](09-undal-brain-overview.md) |

---

## 6. The synthesis — Undal's design thesis

Reference A is **warm**. Reference B is **sharp**. Foodpanda is **dense and magenta**. Uber Eats is
**editorial and green**. Undal is none of these four and all of them:

> **Undal looks like a forest-green product with a magenta pulse, built out of soft white cards that
> float on a warm off-white canvas, where food photography breaks out of its containers and the only
> persistent chrome is a floating black capsule that always tells you what your order costs.**

Concretely, the synthesis resolves as:

| Dimension | Decision | Source |
| --- | --- | --- |
| Canvas | `#FAFAF8` warm off-white | Reference A's warmth, without the yellow |
| Surface | `#FFFFFF` cards, 20–28 dp radius, soft two-layer shadow | Both references |
| Grouping | `#F4F4F2` section panels with 28 dp radius | Reference B §4.2.4 |
| Brand constant | `#0F4435` Undal Forest | The logos |
| Primary action | `#D70F64` Undal Magenta | Foodpanda's energy, used for *actions only* |
| Live / success | `#06C167` Undal Live | Uber Eats' green, reserved for live state |
| Persistent chrome | Floating black cart capsule | Reference B §4.2.1 |
| Signature motion | Shared-element dish flight | Reference A §3.2.4 |
| Signature micro-motion | `+` → stepper morph | Reference B §4.2.3 |
| Header behaviour | Continuous scroll-driven condensation | Reference B §4.2.2 |
| Imagery | Cut-outs that overflow containers where available | Reference A §3.2.1 |
| Metadata language | `⭐ rating · 🕒 ETA · 🛵 fee · 📍 distance` | Market reality, not the references |
| Typography | Poppins (Latin) + Hind Siliguri (Bangla), optically matched | The wordmark |

The full token set, with every hex value, every type ramp step, every spacing unit, every radius,
every shadow and every one of the 50 breakpoints, is
[`03-brand-and-design-system.md`](03-brand-and-design-system.md).

The implementation of every animation named above — spring constants, durations, easing curves, the
Compose code and the CSS — is [`04-motion-and-interaction.md`](04-motion-and-interaction.md).

---

## 7. The alert sound

`assets/audio/undal_order_alert_loop.wav` — **8.000 s, 44 100 Hz, mono, 16-bit PCM, 352 800 frames.**

This file is **final and must ship unmodified**. Its properties matter:

| Property | Value | Why it matters |
| --- | --- | --- |
| Duration | Exactly 8.000 s | An integer number of frames at 44.1 kHz means the loop point is sample-exact — no click, no gap. |
| Channels | Mono | Halves the size and guarantees identical output on a single-speaker phone. |
| Format | Uncompressed PCM WAV | No decoder latency. The alarm must start within milliseconds, and a compressed format costs a decode priming delay. |
| Sample rate | 44.1 kHz | Matches the Android audio mixer's common rate; no resampling. |

### 7.1 How it is used

| Surface | Usage |
| --- | --- |
| Partner app | `AudioAttributes.USAGE_ALARM` + `CONTENT_TYPE_SONIFICATION`, `MediaPlayer.isLooping = true`, max alarm-stream volume, played from a foreground service. Loops until the partner accepts or rejects, with a hard ceiling of 120 s after which it falls back to a repeating 3-pulse every 20 s. |
| Rider app | Same, for offer arrival. Ceiling is the 25-second offer window. |
| Rider app, cash lock | **Not this file.** A separate, much quieter 1-second tick synthesised at build time, played every 4 s. See [`25 §5`](25-rider-cash-settlement.md). |
| Customer app | Not used. Customers get a standard notification tone. |
| Web | Not used. |

It is bundled in `res/raw/undal_order_alert_loop.wav` in both the Partner and Rider apps and is
**also** registered as the notification channel sound, so that on the rare path where the system
posts the notification before the service starts, the user still hears the right thing.

The complete audio architecture — focus handling, ducking, DND interaction, vibration pattern,
volume ramp, and the accessibility opt-out — is [`15 §7`](15-wakeup-alarm-fcm.md).

---

## 8. Reading on

Next: [`03-brand-and-design-system.md`](03-brand-and-design-system.md) — every token, derived from
the conclusions above.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
