# 02 · Reference Screenshot Analysis (170 images)

**Method & honesty note.** Inventory: `CUSTOMER_APP 42 · CUSTOMER_WEB_APP 25 · PARTNER_APP 62 · RIDER_APP 45`
(files on disk; 170 images + 4 empty `.txt` markers). For this guide, **32 images were opened and pixel-inspected**
(8 customer app, 8 partner, 8 rider, 8 customer web/app mixed flows — filenames cited inline like
`[CUST Screenshot_20261021-174248.png]`). Everything below about those screens is direct observation.
The other 138 files are listed with flow-grouping in **Appendix A**; the builder AI must open every one in
Plan Responses 1–2 and extend this analysis in `docs/understanding/` before writing UI code (file `27`).
**Rule: copy the *workability*, never the brand.** Foodpanda pink `#D70F64`, panda mascot, “pandapro/pandabox/pandamart”
names, Delivery Hero marks — none may appear in Undal. Undal design language is defined in file `25`.

---

## 2.1 CUSTOMER APP — observed system (42 files)

### 2.1.1 First-run & permissions
- `[CUST …124707.png]` Location-priming screen before the OS prompt: 3D pin mascot, two benefit rows
  (“Finding the best restaurants and shops near you”, “Faster and more accurate delivery”), full-width bottom CTA.
  Layered on top: notification-priming modal “Stay in the loop!” (`Maybe Later` ghost / `Enable` filled).
  → **Undal:** identical pattern (prime → OS prompt), both localised EN/BN, skippable, re-ask only contextually
  (e.g., after first order). *Improve:* explain alarm-grade order updates, not “deals”, as the primary reason.
- Address pinning `[CUST …125102.png]`: full-screen map (Surma River, Sylhet — R280/Kumargaon area visible),
  centre pin, bottom sheet with reverse-geocoded label, edit-pencil, info banner
  “Your rider will deliver to the pinned location…”, `Confirm location` CTA, my-location FAB + satellite toggle.
  → **Undal:** OSM map (no satellite layer on free OSM — replace with zone-overlay toggle), draggable pin,
  Nominatim reverse geocode with cache, manual search, “outside delivery zone” hard-stop state with nearest-zone hint.

### 2.1.2 Home / discovery (the money screen)
- `[CUST …174248.png]` + `[CUST …174315.png]` (two states of Food home): magenta header with address label
  (“Home · WR6F+W42, Sylhet R280” — note Plus Code fallback usage), favourite-heart shortcut, pill search bar.
  Row 1 — *shortcuts:* Offers / pandamart / Grocery / Pick-up (badge “Up to −25%”) / Convenience / Health & Beauty /
  New restaurants / Super restaurants. Row 2 — *cuisine rail* with appetising cut-out food photography
  (Snacks, Chicken, Fried Chicken [selected, dark outline], Pizza, Biryani, Burgers, Cakes, Fast Food… second state:
  Fast Food, Rice Dishes, Bangladeshi, Cafe, Kebab, Pasta, Soups, Sweets). Row 3 — *filter chips:* tune icon, Sort ▾,
  Offers ▾, ★ Ratings 4.0+, pro benefits, Super restaurant; section title “Explore restaurants nearby” + Reset.
  Restaurant cards: 16:9 hero photo, heart FAB top-right, “Ad” disclosure chip bottom-right, PRO strip
  (“10% off”) under photo, name + ★rating (count bucketed: 100+/500+/20k+), “From 55 min · ৳৳ · cuisines”,
  delivery-fee line with strikethrough→“Free”, stacked offer pills (“25% off Tk 299”, “10% off Tk 50”).
  Persistent Flash-Deals banner above bottom nav with live **MM:SS countdown tiles** (“Save 25% … 44:41”) + dismiss ×.
  Bottom nav (5): Food / Grocery / Search / Carts (badge count) / Account.
  → **Undal mapping:** shortcuts become food-only: Offers / **Pick-up** / **Flash Box** / New Kitchens / Home Kitchens /
  Top Rated / Near Me. **No “Ad” chip will ever exist** (D-12) — instead an honesty chip system:
  “Home Kitchen”, “Cloud Kitchen”, “Free delivery”, “Flash Box 25%”. Keep: bucketed rating counts, fee strikethrough,
  offer pills (max 2 + “+n”), countdown module (driven by real campaign end-times from Admin).
  Bottom nav: Home / Search / Orders / Cart / Account (Orders promoted — tracking is core, Grocery deleted).
- Empty-result state `[CUST …174315.png]` second card area is blank white when the “Sweets” filter yields one result —
  a visible dead-space flaw. → **Undal must never dead-end:** suggest widening radius, show “more kitchens opening soon
  in {zone}”, list nearest open alternatives, and a notify-me capture. (Documented as anti-pattern AP-1.)

### 2.1.3 Search
- `[CUST …125032.png]`: search field, “Popular cuisines” icon rail (Biryani, Fast Food, Bangladeshi, Pizza, Burgers,
  Cakes, Cafe, Khichuri), “Featured on foodpanda — Sponsored” restaurant mini-cards with From-time, “Popular searches
  in restaurants” chips (pizza, burger, kfc, ice cream, dominos…), “Popular searches in shops” chips.
  → **Undal:** three-scope search (Restaurants / Cuisines / Dishes) with dish-level results deep-linking into the vendor
  menu scrolled to the item; trending chips computed from real 7-day query logs per zone; “Featured” = 10-stage ranking
  top picks labelled “Top rated near you” — never “Sponsored”. Bangla + Banglish transliteration matching
  (বিরিয়ানি = biriyani = briyani) via trigram + synonym table (Appendix D notes).

### 2.1.4 Pick-up discovery
- `[CUST …125201.png]`: Pick-up header, map strip card with restaurant pins + `View map`, cuisine rail, same filter chips,
  cards show walking time + distance (“6 min · 523 m away”) instead of delivery fee.
  → **Undal:** identical dual-mode architecture; one `fulfilment_mode` toggle persists into cart/checkout;
  pickup cards show “ready in ~15 min” from live vendor prep averages; full-map mode clusters OSM pins.

### 2.1.5 Cart → Checkout (3-step spine: Menu → Cart → Checkout)
- Cart `[WEB/mobile …121752.png]`: step tracker (1 Menu · 2 Cart · 3 Checkout), Delivery/Pick-up segmented control
  (Pick-up shows “10% off” incentive), line item with thumb, trash/qty stepper, price + strikethrough list price,
  “Add more items”, Subtotal / Standard delivery (Free + reason “free delivery for your first order”) / Platform Fee ৳5
  with ⓘ explainer, “Apply a voucher” full-width button, **Cutlery toggle default OFF** (“Thanks for reducing waste!”),
  sticky footer: Total (incl. fees and tax) + strikethrough pre-discount total + “See summary”, CTA “Review payment and address”.
  → **Undal:** keep all; single-restaurant cart with destructive-switch confirm (“Your cart has items from X. Start fresh?”);
  platform fee configurable (default ৳5, can be ৳0 by zone); cutlery choice stored per-order and printed on vendor ticket.
- Checkout `[CUST …125102/125110 set]`: Delivery address card (mini-map, area label, Change), delivery-instructions field,
  contactless toggle (disabled with hint for COD), Delivery options radio: **Priority 10–20 min +৳20** vs **Standard 15–25 min**,
  “Tip your rider” chips (Not now / ৳20 / ৳30…, “Most common” marker, save-for-next-order), Payment method = Cash (৳141),
  Order summary lines, `Confirm address` CTA. A PRO upsell modal interrupts checkout → **Undal: forbidden pattern (AP-2)** —
  never interrupt checkout with upsells; offers appear pre-cart or post-order only.
  → **Undal checkout keeps:** address/instructions, Priority-vs-Standard (Priority = dispatch queue priority + direct
  (unbatched) delivery, fee configurable), rider tip (100% to rider, cash — clearly labelled “pay tip in cash to rider”),
  COD as the only payment row, itemised summary identical to server recomputation.

### 2.1.6 Ratings & reviews
- `[CUST …125000.png]`: aggregate card (3.7 big number, stars, “All ratings (100+)”, 5→1 distribution bars),
  sort chips (Top reviews / Newest / Highest / Lowest), review cards (name, stars, relative time, BN/EN text,
  “Helpful n” thumbs). Reviews are raw/unfiltered (angry Bangla text visible) → moderation exists but is light.
  → **Undal:** same layout; add verified-order badge, dish-tags (“ordered: Chicken Biryani”), photo reviews (ImgBB),
  vendor reply threaded inline, report → Admin moderation queue, profanity soft-filter EN/BN, helpful-vote anti-abuse (1/user).

### 2.1.7 Account
- Logged-in `[CUST …125201/125206 set]`: name + View profile, subscription banner, 3 tiles (Orders / Favourites / Addresses),
  Wallet (Refund account ৳0), “Perks for you” (pro, rewards, Vouchers, Invite friends), General (Help center, Become a partner,
  for business, Terms & policies), Log out, version footer. Logged-out: “50% on your first order!” + Sign up/Log in CTA.
  → **Undal:** Orders (live + history + reorder), Favourites, Addresses (Home/Office/Other with pins), Vouchers,
  Undal Rewards points, Invite (referral → voucher both sides), Help (in-app ticket chat), Become a Partner / Ride with Undal
  (deep-links to onboarding web flow in the Partner/Rider apps), language toggle EN/বাংলা, delete-account (self-serve, GDPR-style).

## 2.2 CUSTOMER WEB — observed system (25 files, desktop layout on tablet)

- Global header `[WEB …132753.png]`: logo, address selector centre, user menu (pandapay, Subscribe, Orders & reordering,
  Profile, Vouchers, rewards, Help, Logout), EN switcher, favourites, cart with badge. Mode tabs: Delivery / Pick-up /
  pandamart / Shops + right-aligned search. Left **Filters rail** (Sort by radio: Relevance / Fastest delivery / Distance /
  Top rated; quick filters below). Hero campaign carousel “Get 25% off — Max ৳110, Min ৳170” with countdown chip + restaurant
  mini-cards. “Your favourite cuisines” rail, “Your daily deals”, then card grid. Persistent left **app-download QR card**
  (“Unlock more app-only deals”) — Undal keeps this (QR → App Links URL → APK/Play listing).
- Restaurant page `[WEB …121752/121759 set]` (real Sylhet store “Undal cdo6” on foodpanda.com.bd!): sticky category tab bar
  with counts — Snacks (8), Dessert (6), Pasta & Noodles (3), Bhorta & Bhaji (10), Curry (8), Fish (3), Set Meal (13), Rice (4) —
  in-menu search, 2-column item cards (name, pink discounted price + strikethrough, “1:1 – …” portion-prefixed description,
  photo right with circular **+** add button overlapping corner, 🌶 spicy marker), right sticky cart panel (“Hungry? You haven't
  added anything”, Total incl. fees and tax, disabled `Go to checkout`).
  → **Undal web = same information architecture**, prerendered per restaurant for SEO (`/r/{slug}` + `/r/{slug}/{item}`),
  portion string becomes structured data (serves, weight), spicy/veg/halal as filterable attributes, cart panel becomes
  bottom bar under 1024 px. URL pattern in screenshot (`/restaurant/cdo6/undal-cdo6?lat=&lng=`) → Undal uses clean
  `/r/undal-sylhet` + stored user location (no coords in shareable URLs — privacy improvement).

## 2.3 PARTNER APP — observed system (62 files; tablet UI, store “Undal (CDO6)”)

Bottom nav (5): **Live Orders / Overview / Menu / Ads / More**. Persistent top banner: “You are closed — outside opening
hours” (pink) + outlet switcher pill + dark-mode toggle. → Undal keeps the always-visible open/closed truth banner;
adds **connection truth**: “Connected · alerts armed” vs “Offline — you may miss orders” (Undal differentiator, file `17`).

- **Live Orders** `[PARTNER …125815.png]`: “New 0” queue header, empty-state illustration “No orders yet”.
  Order detail `[PARTNER …142135/143724.png]`: header actions (Print, Support-headset), status banner
  “Order marked as ready at 14:21”, public order `#155` + code `cdo6-2643-bb0v`, Customer name row, Rider row with live
  proximity text (“(SYL) is nearby” / “Rider is on the way”) + progress bar + embedded mini-map, item lines
  (1× Crispy Fried Chicken ৳141…), instruction banner (“PLEASE DO NOT PROVIDE CUTLERY”), money block
  (Subtotal ৳541.00, VAT (Incl.) ৳25.76, Discount/Voucher −৳108.20, Funded by you −৳108.20, Total ৳432.80, Cash On Delivery).
  → **Undal order ticket** adds: prep countdown ring, QR pickup code panel, call/chat customer + rider buttons,
  item-option detail lines, and the accept sheet with −/+ prep stepper (D-22). Print = Android print framework + 58/80 mm
  thermal ESC/POS over Bluetooth/USB (free libraries; optional feature-flagged).
- **Order History + timeline** `[PARTNER …190131.png]`: date-range + Filters, table (Status pill COMPLETED/CANCELLED,
  Order ID, datetime), slide-over with **full event timeline** (Order received “Accepted in 16 sec” → Rider near pickup →
  Rider at store → Ready to pick up → Picked up “15 min avoidable wait time” in red → In delivery → Delivered vs estimated),
  then Order details + Subtotal / Discount funded by you / Commission lines.
  → **Undal adopts this forensic timeline verbatim as a concept** — every order carries an immutable `order_events` ledger
  (file `22`); “avoidable wait” analytics feed vendor/rider scores transparently.
- **Menu manager** `[PARTNER …130432.png]`: Delivery Menu ▾, Products/Options segmented tabs, search + filter + overflow,
  “Add a category”, category accordions with product counts, unavailable-count badges (grey 7/4/6/1), edit pencils.
  Expanded `[PARTNER …130618.png]`: Add button, item rows (thumb, name, description, “No options”, BDT price, availability toggle),
  and the **product-type chooser sheet**: Simple product / Product with sizes (Regular/Large, Soup/Dry) / **Bundles** (New) —
  with warning “Once a product is created, you cannot switch between different types”.
  → **Undal menu model (file `17` §4):** categories → items → variant groups (sizes) → option groups (add-ons, min/max rules) →
  bundles (fixed + choice slots). Availability: instant toggle, “unavailable until tomorrow / date” snooze, sold-out auto-off.
  *Improve on reference:* allow type conversion via duplicate-as-new-type wizard (no dead ends), bulk price edit, menu import
  from photo (manual-entry assist — OCR is out of free scope; provide fast structured entry + Admin-assisted onboarding).
- **Promotions** `[PARTNER …130026.png]`: tabs Create/Performance, recommendation cards (“Offer 15% Discount… Boost now”),
  “Create your own”: **pandabox** (new-customer targeting) + Full menu discount; Advertising upsell row.
  → **Undal:** Flash Box opt-in card, Full-menu %, Category %, BOGO, Free-delivery-over-৳X, First-order — each with live
  margin preview (“on a ৳300 order you keep ৳… after 15% + tax”) — transparency the reference lacks.
- **Ads analytics** `[PARTNER …125906/130154.png]`: Visibility card (Avg position 34 without ad vs 6 with ad ↑28),
  Impressions 9.23K / Menu views 702 / CTR 8% / Avg CPC ৳3.26, daily bar chart, Customer insights
  (New 93% / Occasional 7% / Frequent / Reactivated + CAC maths), Conversion section.
  → **Undal Growth tab keeps every chart** but reframes: position explained by the 10 ranking factors with per-factor
  scores and “how to improve” actions (e.g., “prep time 28 min vs zone median 18 min”). **No CPC metric exists to display.**
- **Reviews (partner side)** `[PARTNER …143724 set]`: Store rating 2.8 ↓0.2, 21 reviews, star histogram, **AI “Reviews summary”**
  card (“…inconsistent food quality… overly salty, spicy…”), filters (date-range calendar popover: Last 30d/3m/6m custom range,
  Star rating, “Awaiting replies (6)”), review rows with order code + date, Reply / View order / Dispute actions.
  → **Undal:** same, minus paid AI — summary = computed tag-cloud from review aspect tags (taste/packaging/portion/value)
  chosen by reviewers via chips; dispute → Admin queue with evidence (order timeline auto-attached).

## 2.4 RIDER APP — observed system (45 files)

Sources are mixed: Foodpanda Rider (roadrunner) screens incl. YouTube-vlog stills (low-res, blurred PII — patterns still
legible), Play-Store shots, and **Uber Driver/Eats offer card**. PII blurred in sources must never be reproduced.

- **Go online / Start session** `[RIDER …154439.png]`: map-first home (zone heat-shaded), bottom sheet “Offline — Start session”.
  Session sheet `[RIDER …152955.png]`: Vehicle Type (Bicycle), Bag Type (Standard box), Privacy-policy consent checkbox.
  → **Undal pre-flight checklist:** vehicle confirmed, bag photo (weekly), face selfie check (random + shift-start per
  founder spec), battery/GPS/notification/alarm-permission health panel, zone confirmation (“You are in Sylhet Sadar zone”).
- **Shift & extension** `[RIDER extension-on-status-screen-en.webp]`: Status tab (Ready), Current Shift card (date, 13:00–13:15,
  Ongoing), “Available for Shift Extension” toggle; tabs Status / Deliveries / Map / History / Wallet.
  → **Undal:** free-login shifts (no pre-booked slots in v1 — simpler for BD fleet) + optional scheduled shifts per zone;
  extension opt-in identical; shift-end triggers cash-remittance gate if cash-in-hand > 0 (file `23`).
- **New-order offer (the critical screen)** `[RIDER …154120.png]` (Foodpanda): “New order / Decline”, acceptance-rate banner
  (“Your acceptance rate is 100%”), map with pickup + dropoff pins, Pickup block (vendor name, full address, 2 min),
  Drop-off block (address, building, apartment, 14 min), **fare “30.34 Tk”**, `Accept order` CTA, countdown progress.
  Uber variant `[RIDER …153510.png]`: full-map route polyline, fare big (“$16.05”), rating, “4 min (1.1 mi) away → 20 min
  (7.3 mi) trip”, Accept / Decline(×).
  → **Undal offer card (file `18` §4) is best-of-both + founder rules:** fare with **itemised breakdown** (base + distance +
  surge + weather + bonus estimate), pickup/dropoff distances + ETAs, item count + COD amount to collect, batch badge when
  bundled, 30 s countdown ring, Accept / Reject-with-reason (D-23). Offer arrives via the alarm engine (file `07`) full-screen.
- **Active delivery** `[RIDER …153844/154107.png]`: map with vendor pin, `Arrived at the vendor` CTA; dropoff sheet with
  customer masked name + address + `Navigate`. → **Undal step-machine:** Go to vendor → Arrived → **Scan vendor QR** →
  Picked up (photo optional) → Go to customer → Arrived → Collect ৳X cash → Delivered (PIN/photo proof optional per zone).
  Navigate = Google-Maps intent (D-10) + in-app OSRM polyline fallback. Call/chat buttons at every step.
- **Feedback loops** `[RIDER …153207.png]`: post-delivery “Why bad?” chips (Poor packaging, Wrong address/pin,
  Difficult entrance, No parking, “Vendor clicked 'ready' too soon”) + comment + anonymous note.
  → **Undal:** rider→vendor and rider→customer micro-feedback feeds scores (never shown as blame to the other party).

## 2.5 Cross-cutting UX laws extracted (apply to all 5 Undal surfaces)

1. **One primary CTA per screen**, full-width, bottom-sticky, thumb-reachable; destructive actions never share its style.
2. **Money always itemised** with strikethrough-before/discount-after and “incl. fees and tax” totals — no surprise charges.
3. **Time is a range, distance is human** (“15–25 min”, “523 m away”, “From 50 min”) — never false-precision promises.
4. **Status is colour + text + icon** (never colour alone) — WCAG-safe for colour-blind riders/vendors.
5. **Every list screen has**: loading skeleton, empty state with next action, error state with retry, offline banner.
6. **Cards over tables on mobile; tables with slide-over detail on tablet/desktop** (partner order history pattern).
7. **Relative times + absolute on tap** (“2 weeks ago” → exact), bucketed counts (100+, 20k+) for social proof.
8. **BN/EN mixed content is normal** — fonts must render Bengali beautifully (Hind Siliguri / Baloo Da 2, file `25`); never truncate Bangla mid-glyph.
9. **Anti-patterns banned:** AP-1 dead-end empty screens, AP-2 checkout-interrupting upsells, AP-3 “Ad” cards disguised in organic lists, AP-4 permission requests without priming, AP-5 silent failures (every failure speaks + offers retry/support).

## 2.6 What Undal adds that no reference screen has (differentiation backlog → built in v1)

- **“Why this rank?”** transparency for vendors + “Why this fare?” itemisation for riders + “Why this ETA?” for customers.
- **Alarm-health dashboard** in Partner/Rider apps (“Alerts: ARMED ✓ / AT RISK — tap to fix”) with one-tap OEM whitelist flows.
- **Home Kitchen trust layer:** kitchen photos, hygiene self-checklist badge, “cooks to order” honest prep ranges.
- **COD cash transparency:** rider sees exact change math (“Collect ৳432 — if customer gives ৳500, return ৳68”).
- **Bengali-first voice notes** in chat (record/send/play) for low-literacy riders/vendors — stored via private bucket, auto-expire 30 days.
- **Offline order queue honesty:** partner app shows “3 actions waiting to sync” — actions queue locally, sync on reconnect, conflicts surfaced not hidden.
