# 01b · Customer App Per-Image Deep Analysis — Part 2 (Files #22–#41)

> **Owner:** Builder AI (`Plan Response 1`) · **Governing Guide Files:** `01`, `02`, `11`, `12`, `13`, `14`, `16`, `22`, `25`, `Appendix A`  
> **Scope:** Pixel-by-pixel visual inspection of `reference-images/CUSTOMER_APP/` files **#22 through #41** (all 20 opened directly via vision, including `images (6).jpeg`, `images (7).jpeg`, and `unnamed*.webp`).  
> **Companion index:** [`01-customer-surface-analysis.md`](./01-customer-surface-analysis.md) · **Part 1 (#01–#21):** [`01a-customer-app-screens-01-21.md`](./01a-customer-app-screens-01-21.md)

---

## Per-Image Findings (#22–#41)

### #22 · `Screenshot_20261017-125206.png`
- **Screen & Flow:** Saved Delivery Addresses List (`Account → Addresses`).
- **Key Elements:** Header `← Addresses`, 7 saved address rows each with left pin/home icon, bold label (`Home`, `kulaura`, `shaad and co. Er pichoner 5 tala building (tower Wala building) Baroigram Road`, `...Sylhet-Sunamganj Sarak`, `R280`, `beanibazar`), subline with Plus Code / road (`WR6F+W42, Sylhet R280 Sylhet`), 3rd line **`Note to rider: ...`**, right edit pencil `✎` + delete trash `🗑` icons, sticky bottom CTA `Add New Address`.
- **Data Fields:** `customer_addresses` (`id`, `label`, `lat`, `lng`, `geohash`, `address_text`, `delivery_instructions`, `zone_id`, `is_default`).
- **Actions:** Select active address, edit pin/text (`c-31`), delete with confirmation, `Add New Address`.
- **States:** Populated list. **CRITICAL BANGLADESH UX DISCOVERY:** Look at how real Sylhet/Moulvibazar users actually type addresses: Banglish landmark descriptions (`"Shaad er pichoner road er 5 tala tower Wala building"`), Plus Codes (`WR6F+W42`), and duplicate entries (`R280` twice) with no visual badge showing which saved address is currently **Default** or **Inside/Outside Delivery Zone**!
- **Undal Verdict — IMPROVE (`c-30`, `c-31`, `File 14`):** Elevate **`Landmark / Building colour & floor for rider`** (`যেমন: শাদ অ্যান্ড কোং-এর পিছনের ৫ তলা বিল্ডিং`) as a guided primary input; display `Default` chip + live **`✓ Delivery available ({Zone})`** vs **`Outside zone`** badge on each row so travelling between Sylhet & Kulaura never causes checkout surprises!

### #23 · `Screenshot_20261017-125224.png`
- **Screen & Flow:** Orders History Screen (`Account / Bottom Nav → Orders`).
- **Key Elements:** Top bar `× Orders` + cart icon `[1]`, heading `Past orders`, stacked order cards:
  1. `SylhetBites` — thumbnail dimmed with **`Cancelled`** overlay text, `Cancelled on 19 Jun 16:47`, `Stick noodles with egg`, `Tk 104` (no reorder button).
  2. `BD Five Star - Ambarkhana` — `Delivered on 15 Jun 20:40`, `Mini Crispy Chicken Burger - Pack of 4`, `Tk 164`, full-width CTA **`Select items to reorder`**, footer strip `You rated this ★ 1.0`.
  3. `SylhetBites` — `Delivered on 08 Apr 21:26`, `Chana bhaji`, `Tk 75`, footer `You rated this ★ 5.0` (`Select items to reorder` omitted because store/item inactive).
  4. `Domino's Pizza - Chef's Table Sylhet` — `Delivered on 27 Mar 19:01`, `Chicken Keema Dopeyaja`, `Tk 370`, `Select items to reorder`, `You rated this ★ 3.0`.
- **Data Fields:** `orders` (`public_code`, `status`, `delivered_at`/`cancelled_at`, `cod_collect_poisha`), `order_items` summary, customer `reviews.stars`, item availability check for reorder.
- **Actions:** Tap card → Order Receipt `#24`; tap `Select items to reorder` → pre-populates cart checking current availability & prices; tap `Rate order` if unrated.
- **States:** History only (no active order). Notice cancelled card shows `"Cancelled"` with **zero explanation why** (`Vendor unreachable` vs `Customer cancelled`).
- **Undal Verdict — IMPROVE (`c-26`, `File 22`):** Pin active live orders prominently at top (`Live now`); show human **cancel reason chip** (`Cancelled — kitchen unreachable` EN/BN); enable `Select items to reorder` cleanly handling price changes or sold-out items via a transparent diff sheet.

### #24 · `Screenshot_20261017-125237.png`
- **Screen & Flow:** Past Order Detail & Receipt Screen (`Orders → Tap Domino's Order #xisi-2613-795k`).
- **Key Elements:** Hero vendor banner with `←` and top-right **`Help`** pill button; centered `Order #xisi-2613-795k`, `Delivered on 27 Mar 19:01 · You rated this ★ 3.0`; route summary (`Order from Domino's Pizza - Chef's Table Sylhet` → dotted line → `Delivered to R280, Sylhet`); itemised bill:
  - `1x Chicken Keema Dopeyaja    Tk 299`
  - `Subtotal                     Tk 299`
  - `Delivery fee                 Tk 39`
  - **`Container charges          Tk 29`** *(stealth surcharge!)*
  - `Platform Fee                 Tk 3`
  - `Total (incl. VAT)            Tk 370`
  - `Paid with: cash on delivery  Tk 370`
  Sticky bottom CTA `Select items to reorder`.
- **Data Fields:** Immutable `orders` money snapshot + `order_items` snapshot + `address_snapshot` + `vendor_snapshot`.
- **Actions:** `Help` → opens order-linked support/dispute flow (`Missing item / Quality issue`); `Select items to reorder`; copy order code.
- **States:** Terminal delivered receipt.
- **Undal Verdict — IMPROVE (`c-27`, `AP-8` Ban Hidden Container Charges):** Look how `Tk 299` silently ballooned by **+23.7% (`+Tk 71`)** via surprise `Container charges Tk 29`! Undal (`File 10 §10.2`) forbids hidden container fees — `COD_COLLECT = food_payable + delivery_fee + platform_fee + tip`, plus shows extracted VAT (`5/105` informational line) and full **`Order Timeline`** timestamps (`Placed → Accepted → Ready → Picked up → Delivered`).

### #25 · `Screenshot_20261017-125252.png`
- **Screen & Flow:** Home Delivery Feed — Organic Vertical Kitchen Cards (`Home → Scroll to Main List`).
- **Key Elements:** Sticky search pill + filter chip bar (`Tune`, `Sort ▾`, `Offers ▾`, `★ Ratings 4.0+`, `pro benefits`, `Super restaurant`), full-width 16:9 restaurant cards (`Palki Restaurant - Ambarkhana ★4.1 (5k+)`, `Panchini Restaurant ★3.7 (100+)`, `Sultan's Dine -Sylhet ★4.7 (5k+) · Price Match`, `Himur Vojon Bilash ★3.6 (500+)`), each showing heart button top-right, ETA (`From 25 min`), price tier (`৳`–`৳৳৳`), primary cuisine, `~~Tk65~~ Free` delivery line, max 2 offer pills (`Tk. 165 off Tk. 550: dealnao`, `15% off`), and floating `Save 25% [42]:[55]` banner.
- **Data Fields:** Paged `get_home_feed` output (`File 13`).
- **Actions:** Toggle `♡` favourite, open filter sheet, tap vendor card, dismiss Flash strip.
- **States:** Smooth vertical infinite-scroll feed; notice `Price Match` parity label on `Sultan's Dine`.
- **Undal Verdict — KEEP CARD ANATOMY (`c-08`, `File 16 §16.2`):** This card density and visual hierarchy (`16:9 photo + heart + name + ★rating(bucket) + ETA·tier·cuisine + fee strikethrough + ≤2 offer pills`) is battle-tested and crystal clear. Adopt `Price Honesty` policy (menu prices match dine-in/kitchen prices — reported markups flagged in `4.menu_moderation`).

### #26 · `Screenshot_20261017-125310.png`
- **Screen & Flow:** Pick-up Discovery Feed (`Home Shortcut → Pick-up`).
- **Key Elements:** Header `← Pick-up / Selected location` + `♡`, search pill `Search for restaurants & cuisines`, **embedded map preview card** showing user location black pin + pink cutlery vendor pins along Surma River / Kumargaon + `Discover restaurants around you` + **`View map`** button, cuisine rail, filter strip, `Explore restaurants nearby` list (`Panchini Restaurant · 🕒 6 min · 🚶 523 m away`, `Himur Vojon Bilash · 🕒 7 min · 🚶 936 m away`), floating Flash banner `[42]:[30]`.
- **Data Fields:** Vendors filtered by `accepts_pickup = true` (`D-24`), distance in metres/km, prep/walk estimate, pickup discount pills (`10% off Tk 50`).
- **Actions:** `View map` → full-screen map `#33`; select vendor with `fulfilment = pickup` persisted into Cart!
- **States:** Active Pick-up browse mode.
- **Undal Verdict — KEEP & IMPROVE (`c-09`, `D-24`):** Separate **Kitchen Ready Time** (`Ready in ~15 min`) from **Distance** (`523 m away`) so users never confuse walking time with cooking time! Hide exact street/flat of `HOME_KITCHEN` vendors unless `accepts_pickup = true` with an approved `pickup_point_label` (`D-24`).

### #27 · `Screenshot_20261017-125330.png`
- **Screen & Flow:** Multi-Cart Index Screen (`Bottom Nav → Carts [1]`).
- **Key Elements:** Header `← All carts / Deliver to: Sylhet`, single card (`Panchini Restaurant · 25-35 mins · Free`, item thumbnail + `+` button, `Saving Tk24`, `Tk136 ~~Tk160~~`, `ooo` menu button, full-width button `View your cart`), 75% blank whitespace below.
- **Data Fields:** Active cart summary.
- **Actions:** `View your cart` → opens actual Cart `#14`; `ooo` → delete cart; `+` → return to store menu.
- **States:** Single cart present (huge wasted empty screen requiring an extra tap on every order!).
- **Undal Verdict — IMPROVE BY SIMPLIFYING (`c-18`, `File 16 §16.5`):** Because Undal enforces the **Single Active Vendor Cart Law** (`D-01` food-only, zero multi-vertical shop carts), tapping the bottom **`Cart`** tab opens the **full Cart (`c-18`) directly in ONE tap**! When empty, `Cart` renders a warm Undal illustration + **`Browse kitchens near you`** + **`Reorder past favourites`** rail (`AP-1` zero dead space).

### #28 · `Screenshot_20261021-174248.png`
- **Screen & Flow:** Home Feed — Cuisine Filter Active (`Fried Chicken` Selected).
- **Key Elements:** Header `Home · WR6F+W42, Sylhet R280` + `♡`, cuisine rail with **`Fried Chicken` outlined in rounded dark-bordered active box**, filter chips + `Reset` button right-aligned on `Explore restaurants nearby`, results: `BD Five Star - Ambarkhana ★3.6 [Ad]`, `Miss Fries ★4.1 [Ad]`, floating countdown `[44]:[41]`.
- **Data Fields:** `cuisine = 'fried_chicken'` filter applied to feed RPC.
- **Actions:** Tap active cuisine again or tap `Reset` to clear filter.
- **States:** Filtered feed active (`Reset` visible).
- **Undal Verdict — KEEP UX / DROP ADS (`c-08`):** Selected cuisine ring + instant `Reset` action is super intuitive; results in Undal are strictly organic `rank_v1`.

### #29 · `Screenshot_20261021-174254.png`
- **Screen & Flow:** Home Feed — Cuisine Filter Switched (`Chicken` Selected, 6s after `#28`).
- **Key Elements:** `Chicken` highlighted in cuisine rail; top results `Yokoso ★4.8 [Ad]`, `BD Five Star - Ambarkhana ★3.6 [Ad]`; floating countdown `[44]:[36]`.
- **Data Fields:** `cuisine = 'chicken_deshi' | 'fried_chicken'` hierarchy match.
- **Actions:** Seamless single-tap switching across horizontal cuisine tiles without full page reload.
- **States:** Fast in-place list swap.
- **Undal Verdict — KEEP (`Appendix D` Parent-Child Taxonomy):** Tapping parent cuisine (`Fish`, `Chicken`, `Bangladeshi`) in Undal automatically matches child cuisines (`fish` → `ilish`, `rui_curry`, `seafood`, `prawn`) thanks to `cuisine_taxonomy.parent_key`!

### #30 · `Screenshot_20261021-174300.png`
- **Screen & Flow:** Home Feed — Cuisine Filter Broken by Paid Ads (`Rice Dishes` Selected).
- **Key Elements:** User explicitly selected **`Rice Dishes`**, yet result #1 is **`Yokoso · Chicken [Ad]`** (crab dish photo!) and result #2 is **`The Magician · Fast Food [Ad]`**!
- **Data Fields:** Ad auction overriding user filter intent.
- **Actions:** User forced to scroll past irrelevant ads just to see actual rice kitchens.
- **States:** Broken relevance due to CPC ads (`AP-3`).
- **Undal Verdict — PROVEN DIFFERENTIATOR (`D-12`, `RNK-01`):** In Undal, Stage 1 + filter predicate is a **strict hard filter** (`'rice_dishes' = ANY(cuisines)` or matching dish in menu) — never polluted by unrelated kitchens.

### #31 · `Screenshot_20261021-174306.png`
- **Screen & Flow:** Home Feed — Cuisine Filter Active (`Kebab` Selected).
- **Key Elements:** `Kebab` selected in cuisine rail (`Fast Food`, `Rice Dishes`, `Bangladeshi`, `Cafe`, **`Kebab`**, `Pasta`, `Soups`, `Sweets`), results `Woondaal King Kebab ★4.5 (3k+) [Ad]`, `Lahori Dine ★4.3 (100+) [Ad]`, partial 3rd card `Panchini` below.
- **Data Fields:** Filtered vendor cards with `PRO` discount strip + max 2 promo chips.
- **Actions:** Filter switch / card tap.
- **States:** Populated filtered state.
- **Undal Verdict — KEEP VISUAL RHYTHM (`c-08`):** Smooth horizontal scroll position retention on the cuisine rail when tapping items near the right edge (`Kebab` → `Sweets`).

### #32 · `Screenshot_20261021-174315.png`
- **Screen & Flow:** Home Feed — Sparse Single-Result Dead Space (`Sweets` Selected).
- **Key Elements:** `Sweets` selected; only **1 kitchen** matches (`Panshi Restaurant ★4.3 (20k+) · Bangladeshi`), leaving **~55% of the tablet screen completely blank white** above the floating banner `[44]:[15]`.
- **Data Fields:** Filtered list (`count = 1`).
- **Actions:** Only `Reset` top-right (easy to miss when staring at blank white lower screen!).
- **States:** **Sparse-result UX anti-pattern (`AP-1`)**.
- **Undal Verdict — IMPROVE (`AP-1` Recovery Module):** Whenever filtered results `< 3`, Undal renders a helpful recovery footer right below the matching card(s): **`That's all for Sweets open right now in {Zone}`** + primary chip **`Clear filter`** + **`Kitchens opening later today`** + **`Popular desserts from nearby kitchens`** dish rail!

### #33 · `Screenshot_20261021-174335.png`
- **Screen & Flow:** Full-Screen Interactive Pick-up Map (`Pick-up → View map`).
- **Key Elements:** Full-screen map of **SUST (Shahjalal University of Science & Technology) / Temukhi / Akhalia Ghat / Surma River**, top bar `← Pick-up`, floating top pill **`Search this area`**, selected pin expanded as **`Shotabdhi Restaurant`** label under cutlery icon, unselected pins rendered as **live discount callout pills (`10% off Tk 50`, `30% Pick-up from Tk 50`, `15% off Tk 50`)**, recenter FAB, bottom sheet `Explore Pick-up options nearby` + cuisine filter strip + synced horizontal store cards (`Shotabdhi Restaurant ★2.9 (8) · 13 min · 511 m`, `Panchini ★3.5 · 5 min · 523 m`, `Mithai- Sylhet-University Gate · 5 min · 1.0 km`).
- **Data Fields:** Bounding-box pickup vendors, pin coordinates, top offer label, distance, rating.
- **Actions:** Pan map + tap `Search this area`; tap pin → scrolls bottom carousel to matching vendor card; tap card → opens store.
- **States:** Map + synced horizontal sheet.
- **Undal Verdict — KEEP & IMPLEMENT IN OSM (`c-10`, `File 14`):** Pin-to-carousel two-way sync + `Search this area` + promo badges on map pins is awesome discovery UX on `flutter_map` + Leaflet!

### #34 · `Screenshot_20261021-174417.png`
- **Screen & Flow:** Search Results — `Shops` Tab (`"ice cream"` in `Shops`).
- **Key Elements:** `Shops` tab active under `"ice cream"`, `Selected for you` shelf (`Savoy`, `Igloo` tubs/cones), `3 shops with "ice cream"` (`pandamart (Sylhet)`, `Unimart - Sylhet`) with horizontal packaged SKU shelves (`Polar`, `Savoy`, `Bellissimo`).
- **Data Fields:** Retail shop inventory.
- **Actions:** Shop SKU add.
- **States:** Active `Shops` tab.
- **Undal Verdict — DROP TAB (`D-01`), REUSE GROUPED VENDOR+DISH PATTERN:** No `Shops` tab in Undal, **HOWEVER** the visual layout — *Vendor header row (`logo + name + ETA + fee + >`) above a horizontal strip of that vendor's matching dishes* — is the **ideal layout for Undal's `Dishes` search scope (`c-12`)**, letting users compare matching dishes grouped cleanly by kitchen!

### #35 · `images (6).jpeg`
- **Screen & Flow:** Live Order Tracking — Stage: `PREPARING` (`Post-Checkout → Live Order`).
- **Key Elements:** Header `× Your order` + `Help` link; animated chef illustration; `Estimated delivery time` **`15 - 25 mins`**; **5-segment step bar** (segment 1 solid, segments 2–5 grey); status message *"Preparing your food. Your rider will pick it up once it's ready."*; card **`Contact your rider / Ask for contactless delivery`** with chat icon; **intrusive third-party ad carousel (`Sponsored · SingSaver Win over S$25k in prizes · Apply Now`)** + `Donate a meal` card below.
- **Data Fields:** `orders.status`, `eta_range`, `order_events`, RTDB `o/{orderId}`.
- **Actions:** `Help` → issue flow; `Chat` → order chat (`c-24`/`c-25`); `×` minimize to persistent live order pill on Home.
- **States:** Early active order (`PREPARING`).
- **Undal Verdict — IMPROVE (`c-22`, `AP-3` Ban Tracking Ads):** **Zero third-party ads anywhere in Undal — especially on the anxious post-order screen!** Replace ad clutter with: live OSM map showing kitchen pin, **real kitchen prep countdown**, **`"Why this ETA?"` honest breakdown**, collapsible item + COD cash summary (`"Keep ৳438 ready in cash"`), and dual **Chat Kitchen / Chat Rider** actions.

### #36 · `images (7).jpeg`
- **Screen & Flow:** Live Order Tracking — Stage: `OUT_FOR_DELIVERY` **with Batched Intermediate Stop** (`Live Tracking`).
- **Key Elements:** Top map showing street grid, rider icon at top of route polyline leading to black customer pin, floating dark pill on map **`Rider is making a stop >`**, GPS FAB, `Help` pill top-right; bottom sheet showing helmet avatar, masked rider name (`...ad · Motorbike`), button **`Chat with your rider >`**, purple `pandapro` upsell banner (`DROP`), `Order details` (`Order number #o4...-2524-...e4`).
- **Data Fields:** RTDB `o/{orderId}/loc` interpolated coordinates, `batch_position`, intermediate stop state, masked rider info (`name`, `vehicle_type`, `rating_avg`).
- **Actions:** Tap `Rider is making a stop >` explainer sheet; `Chat with your rider >` (`c-24`); call rider via system dialer (`File 22 §22.4`); `Help`.
- **States:** Active batched delivery (`batch_position == 2`).
- **Undal Verdict — ESSENTIAL BATCHING UX (`c-22`, `File 11 §11.4`, `File 12 §12.4`):** Implement the exact honest pill **`Rider is completing a nearby drop-off along your route >`** (`রাইডার পথে কাছের একটি অর্ডার পৌঁছে দিচ্ছেন`) whenever `batch_id IS NOT NULL` and rider is on leg 1! Note privacy law (`File 09`): never reveal the *other* customer's exact house pin on Customer #2's map — show rider live dot + your own pin + honest status pill.

### #37–#41 · `unnamed (1).webp`, `unnamed (2).webp`, `unnamed (3).webp`, `unnamed (4).webp`, `unnamed.webp`
- **Screen & Flow:** 5 Play Store / App Store Marketing Showcase Cards summarizing value propositions:
  - **#37 `unnamed (1).webp`:** *"Select from top grocery stores"* (`pandamart`, `Village Grocer`, `Hero Market`, `Guardian`, `Watsons`) → **`DROP (D-01)`**.
  - **#38 `unnamed (2).webp`:** *"Get what you need delivered fast."* (`Delivery time: ASAP (15min) · Change`) → **NOTE (`File 01 §1.4`):** Scheduled future pre-order slots are **OUT** in v1 (on-demand `ASAP` Standard vs Priority only).
  - **#39 `unnamed (3).webp`:** *"Choose pick-up for extra savings."* (`Pick-up and Save — Self-collect for guaranteed discounts and no delivery fee`, `Show map →`) → **`KEEP (D-01, D-24)`** — core Undal value prop!
  - **#40 `unnamed (4).webp`:** *"Track and chat with your rider."* (Map with kitchen pin + rider icon + home pin, `Estimated Delivery time 10:05 - 10:15`, `Delivery is on its way!`, `Contact your rider`, `#o13z-e3ty`) → **`KEEP (c-22, c-24)`** — notice clock-window format (`10:05 - 10:15`) alongside relative minutes (`15–25 min`): showing **both** (`15–25 min · arrives ~1:15 PM`) prevents stale mental math!
  - **#41 `unnamed.webp`:** *"Discover Thousands of restaurants."* (`Home`, `Meal for one` single-portion filter concept, `Order again` with `[Ad]` anti-pattern) → **`KEEP "Meal for one / Budget Bites" concept (`budget` taxonomy slug in Appendix D)`**; **DROP pink brand & ads**.
