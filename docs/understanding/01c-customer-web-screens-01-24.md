# 01c · Customer Web App Per-Image Deep Analysis (Files #W01–#W24)

> **Owner:** Builder AI (`Plan Response 1`) · **Governing Guide Files:** `01`, `02`, `10`, `14`, `17`, `19`, `25`, `Appendix A`, `Appendix D`  
> **Scope:** Pixel-by-pixel visual inspection of **all 24 files** in `reference-images/CUSTOMER_WEB_APP/` (`1280×800` tablet Chrome desktop viewport).  
> **Companion index:** [`01-customer-surface-analysis.md`](./01-customer-surface-analysis.md)

---

## Special Discovery: The Founder's Real Live Store (`undal-cdo6`)

Files **#W01–#W13 (`Screenshot_20261008-121752.png` → `121921.png`)** capture the **complete 11-category Bangladeshi menu of the live store `undal-cdo6`** on `foodpanda.com.bd`! Inspecting every single frame uncovered concrete data-model & UX requirements directly from the founder's own real kitchen operations:

1. **Category-Level Rich Descriptions (`#W12` `121916.png`):** Under `Special Combo and Platter (7)`, the store displays a full multi-sentence editorial description explaining how base rice + protein curry + bhorta/dal accompaniments work together. **Schema enrichment:** we add `description_en text` and `description_bn text` to `menu_categories` in Plan Response 2's final DDL (`05-data-model-final.md`) so zero menu richness is lost!
2. **Variant Price Prefix (`from Tk X`):** Items with size/variant choices (`Chicken kabab from Tk 36`, `Sujir Borra from Tk 132`, all 7 combos `from Tk 183..280`) automatically prefix `"from "` before the lowest active price while fixed items show `Tk 113`.
3. **Portion Ratio Prefix (`1:1 - ...`, `5 pic - ...`, `1 pc - ...`):** Nearly every Bangladeshi dish starts with portion sizing (`1:1`, `1 pc`, `6 PCs`). Making `serves` (`menu_items.serves`) a crisp visual pill (`Serves 1`, `6 pcs`) prevents customers from guessing portion sizes!
4. **Duplicate Menu Item Protection (`#W02` `121759.png`):** `6- pic patishapta (Tk 144)` appears **twice side-by-side** in `Dessert (6)` because the reference partner portal gave zero warning when saving duplicate items. Undal's Partner Menu Studio (`p-17..p-20`) adds an instant duplicate-item warning + `Menu Health` check!
5. **Dietary & Spice Markers (`#W01`, `#W08`, `#W11`, `#W12`):** Red chilli `🌶` (`Chicken kabab`, `Mini Masala Popcorn`, `Chicken Special Mughlai Paratha`) and green leaf `🌿` (`Plain rice with dal bhuna`, `Deshi Ghoroa Niramish Bhoj`) appear bottom-left inside item cards — mapped directly to `menu_items.spicy_level (0..3)` and `menu_items.is_veg`.
6. **URL Privacy Flaw (`?lat=24.510891&lng=92.022123`):** Every web restaurant URL leaks the user's exact home GPS coordinates in the browser address bar when shared! Undal (`File 02 §2.2`, `File 19`) uses clean canonical URLs `/r/{slug}` storing coordinates in client state / session only.

---

## Per-Image Findings (#W01–#W24)

### #W01 · `Screenshot_20261008-121752.png`
- **Screen & Flow:** Restaurant Menu Page (`undal-cdo6`) — Category `Snacks (8)` Top (`Web → /r/{slug}`).
- **Key Elements:** Sticky top header (logo, address selector, user menu, `EN ▾`, `♡` favourites, `🛒` cart); sticky secondary bar (`Search in menu` pill + horizontal category tabs with item counts: **`Snacks (8)`**, `Dessert (6)`, `Pasta & Noodles (3)`, `Bhorta & Bhaji (10)`, `Curry (8)`, `Fish (3)`, `Set Meal (13)`, `Rice (4)`, `>` scroll chevron); main 2-column menu grid (`Crispy Fried Chicken Tk 113 ~~Tk 141~~`, `Chicken Chaap Tk 132 ~~Tk 165~~`, `French Fries Tk 113 ~~Tk 141~~`, `Chira Bhaja Tk 108 ~~Tk 135~~`, `Chicken kabab from Tk 36 ~~Tk 45~~ 🌶`, `Mini Masala Popcorn Tk 36 ~~Tk 45~~ 🌶`); right sticky cart sidebar (`Hungry? You haven't added anything to your cart!`, `Total (incl. fees and tax) Tk 0`, `See summary`, disabled `Go to checkout`).
- **Data Fields:** Full menu JSON (`categories[]` with item count + `items[]`), active store discount (`20% off` compare-at strikethroughs across all items).
- **Actions:** Search within menu, click category tab (smooth scroll + scroll-spy), click `+` or card, open cart summary.
- **States:** Desktop `≥1024px` 2-col menu + sticky right cart panel, empty cart (`Go to checkout` disabled).
- **Undal Verdict — KEEP ARCHITECTURE (`w-02`, `File 19`):** Prerender entire menu HTML at build time (`WEB-01`) with `Restaurant` + `Menu` JSON-LD so Google indexes every dish (`Chira Bhaja`, `Chicken Chaap`, etc.) directly!

### #W02 · `Screenshot_20261008-121759.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — End of `Snacks` + `Dessert (6)`.
- **Key Elements:** `Chana Bhaja Tk 75`, `Bhaja Pitha Tk 141`; `Dessert`: `Sujir Halwa Tk 170`, `Sujir Borra from Tk 132`, and **duplicate side-by-side `6- pic patishapta Tk 144` ×2**.
- **Data Fields:** Category items, compare-at prices.
- **Actions:** Scroll-spy still transitioning from `Snacks (8)` to `Dessert (6)`.
- **States:** Duplicate menu entry flaw visible (`AP-9` Partner Menu Duplicate Guard).
- **Undal Verdict — IMPROVE (`p-17`, `w-02`):** Add duplicate-title detection in Partner Menu Studio + expand Bangla/Banglish taxonomy synonyms (`patishapta`, `sujir halwa`, `chira bhaja`).

### #W03 · `Screenshot_20261008-121808.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — End of `Dessert` + `Pasta & Noodles (3)`.
- **Key Elements:** `5 pic – chitol pitha with Shutki bho... Tk 216 ~~Tk 270~~` (title truncated at 1 line with `...`!), `Nuner Shondesh Tk 75` (empty description row still preserves card alignment); `Pasta & Noodles`: `Spicy Pasta Tk 113`, `Egg Noodles Tk 99`, `Spicy Macaroni Tk 113`.
- **Data Fields:** Optional description (`nullable`), single-line vs 2-line title clamp.
- **Actions:** Click card to view full untruncated dish title in modal sheet.
- **States:** Notice 1-line title truncation cut off `"Shutki bhorta"` — **Undal improvement:** allow **2-line wrap on item titles** (`line-clamp: 2`) before ellipsis so compound Bangladeshi dish names (`5 pcs Chitoi Pitha with Shutki Bhorta`) remain fully readable without clicking!

### #W04 · `Screenshot_20261008-121815.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Bhorta & Bhaji (10)` Part 1.
- **Key Elements:** Scroll-spy underline on `Bhorta & Bhaji (10)`; 6 cards: `Spicy Alu Bhorta Tk 38`, `Tomato Bhorta Tk 75`, `Begun Bhorta Tk 57`, `Dal Bhorta Tk 57`, `Fish Bhorta Tk 85`, `Shidol Shutki Bhorta Tk 75` *(authentic Sylheti fermented fish specialty!)*.
- **Data Fields:** Traditional low-ticket items (`৳38–৳85`).
- **Actions:** Quick `+` multi-item basket building (typical customer adds 3–4 bhortas + rice in 5 clicks!).
- **States:** Fast multi-add flow.
- **Undal Verdict — OPTIMISE FOR MULTI-ITEM BASKETS (`w-02`, `c-13`):** Simple items with zero required options MUST add directly to cart on **1 click of `+`** (turning `+` into `[- 1 +]` inline without forcing a modal open/close for each ৳57 bhorta!).

### #W05 · `Screenshot_20261008-121823.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Bhorta & Bhaji` Part 2 + `Curry (8)` Top.
- **Key Elements:** `Chingri Shutki Bhorta Tk 75`, `Alu Bhaji Tk 47`, `Begun bhaja Tk 80`, `Alu begun mixed bhaja Tk 64`; `Curry`: `Chicken Bhuna Tk 179`, `Chicken Bhuna with Moong Dal Tk 188`.
- **Data Fields:** Menu items, square 1:1 right-aligned thumbnails (`~104×104 px` CSS box).
- **Actions:** Inline `+` add.
- **States:** Consistent 2-col card height regardless of 1-line vs 2-line description.
- **Undal Verdict — KEEP (`w-02`):** Explicit `width`/`height` + `aspect-ratio: 1/1` on item thumbnails guarantees `CLS = 0.00` (`File 19 §19.5`).

### #W06 · `Screenshot_20261008-121829.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Curry (8)` Remainder.
- **Key Elements:** `Curry (8)` active tab; `Egg Alu Bhuna Tk 113`, `Egg Bhuna Tk 57`, `Shutki Bhuna Tk 113` (*Chepa dried fish*), `Moong Dal Bhuna Tk 75`, `Moshur Dal Bhuna Tk 57`, `Mixed Vegetable Tk 70`.
- **Data Fields:** Menu items.
- **Actions:** Tab click / scroll spy.
- **States:** Notice `Mixed Vegetable` lacked `is_veg` leaf badge despite being vegetarian — Partner Menu Studio (`p-18`) can suggest `Vegetarian` toggle automatically when item title contains `Vegetable / Niramish / Dal`!

### #W07 · `Screenshot_20261008-121837.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Fish (3)` + `Set Meal (13)` Start.
- **Key Elements:** `Fish`: `Tengra Fish Curry Tk 160`, `Pabda Fish Curry Tk 113 (2 Pcs)`, `Jhatka fish curry Tk 88`; `Set Meal`: `Biryani with Chicken Roast Tk 188`, `Bhuna Khichuri with Egg Tk 155`.
- **Data Fields:** River-fish items (`tengra`, `pabda` — already in `Appendix D` `rui_curry` synonyms!).
- **Actions:** Item browse / add.
- **States:** Odd-count category (`3 items`) renders 2 cards in row 1 + left-aligned card in row 2 cleanly.
- **Undal Verdict — KEEP GRID BEHAVIOUR (`CSS Grid repeat(2, minmax(0, 1fr))` ≥768px, `1fr` <768px).**

### #W08 · `Screenshot_20261008-121843.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Set Meal (13)` Mid Section.
- **Key Elements:** `Set Meal (13)` active tab; `Chirar Polao with Egg Tk 113`, `"Fish Bhaja" with "dal curry" also "... Tk 235`, `'Plain rice' with "dal bhuna" and "b... Tk 235 🌿`, `"Shutki bhorta" with "dal bhuna" w... Tk 198`, `Chhatrabash Special "Dim-Bhaja" ... Tk 217`, `"begun bhorta", "dal bhorta", "tom... Tk 358`.
- **Data Fields:** Fixed combo platters with numbered components (`1. Plain rice 2. Dal...`), `is_veg` leaf badge `🌿`.
- **Actions:** Click card to read full platter component list and choose add-ons.
- **States:** Notice student/hostel persona targeting (`Chhatrabash Special` = SUST university students near Kumargaon/Akhalia!).
- **Undal Verdict — KEEP & ENHANCE:** Structured **Bundle / Platter components list** in item detail displays numbered items as clean bullet chips instead of cramped paragraph text!

### #W09 · `Screenshot_20261008-121851.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Set Meal` End + `Rice (4)` Start.
- **Key Elements:** `"Siddho Rice" with "alu begun mixe... Tk 207`, `"Pabda Fish Curry" with "egg bhun... Tk 226`, **`Bhuna Khichuri with Chana Bhuna Tk 170` WITHOUT PHOTO** (renders clean text-only card with `+` button pinned bottom-right!), followed by `Rice`: `Egg Biryani Tk 113`, `Fried Rice Tk 141`.
- **Data Fields:** `image_url = NULL` card layout variant!
- **Actions:** `+` add works identically with or without photo.
- **States:** **CRITICAL LAYOUT DETAIL:** When `image_url IS NULL` (`Bhuna Khichuri with Chana Bhuna`), the card does NOT show a broken image box — text expands cleanly and the circular `+` button docks neatly in the bottom-right corner!
- **Undal Verdict — KEEP EXACT TEXT-ONLY CARD FALLBACK (`w-02`, `c-13`):** Zero broken icons when a home kitchen adds a daily special before photographing it!

### #W10 · `Screenshot_20261008-121856.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Rice (4)` + `Sides` Top.
- **Key Elements:** `Rice (4)` active tab (`Egg Biryani Tk 113`, `Fried Rice Tk 141`, `Plain Rice Tk 57`, `Siddho Rice Tk 45`); `Sides`: `Egg Omelette Tk 47`, `Egg fry – dim bhaja Tk 32`; horizontal category bar shows right scroll button `>` because categories exceed viewport width.
- **Data Fields:** Category overflow navigation (`<` and `>` arrow buttons on desktop/tablet mouse/touch).
- **Actions:** Click `>` button to scroll hidden right-hand tabs into view.
- **States:** Scrollable tab bar with edge arrow affordance.
- **Undal Verdict — KEEP (`w-02`):** Include both touch drag-scroll AND visible `<` / `>` arrow buttons for desktop/tablet browsers!

### #W11 · `Screenshot_20261008-121908.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Sides (2)` + `Paratha (5)`.
- **Key Elements:** Left scroll arrow `<` visible in sticky bar showing `Sides (2)`, `Paratha (5)`, `Special Combo and Platter (7)`; `Paratha`: `Lachha Paratha Tk 57`, `Plain Paratha Tk 38`, `Mughlai Paratha Tk 52`, `Chicken Special Mughlai Paratha Tk 64 🌶`.
- **Data Fields:** `spicy_level = 1` (`🌶`), piece count `1 pc`.
- **Actions:** Tab navigation, `+` quick add.
- **States:** Clean scroll-spy highlight on `Sides (2)`.
- **Undal Verdict — KEEP (`w-02`).**

### #W12 · `Screenshot_20261008-121916.png` & #W13 · `Screenshot_20261008-121921.png`
- **Screen & Flow:** Restaurant Menu (`undal-cdo6`) — `Special Combo and Platter (7)` Top & Bottom (`Bundle` Items).
- **Key Elements:** Category description paragraph beneath heading; **pink subtle highlight tint on hovered/focused card (`Chattogramer Shutki Milon from Tk 189`)**; all 7 bundles (`Deshi Ghoroa Niramish Bhoj from Tk 241 🌿`, `Chattogramer Shutki Milon from Tk 189`, `Chhatrabash Special Dim and dal from Tk 183`, `Choto Macher Jhal Bhoj from Tk 280`, `Padmar Jatka Ayojon from Tk 190`, `Palli Gramer Shidol Oitijhho from Tk 222`, `Pabda-Dim Rajokiyo Ayojon from Tk 214`).
- **Data Fields:** `menu_categories.description_en/bn`, `item_type = 'bundle'`, `bundle_slots` + `bundle_slot_choices`.
- **Actions:** Clicking `+` on a `"from Tk ..."` bundle opens the **Slot-by-Slot Bundle Builder Modal** (`c-15` / `w-02`)!
- **States:** Hover highlight state (`#W12`) + end-of-page scroll floor (`#W13`).
- **Undal Verdict — KEEP & ENRICH SCHEMA (`menu_categories.description_en/bn` confirmed!).**

### #W14 · `Screenshot_20261017-132753.png`
- **Screen & Flow:** Customer Web Home — Desktop Layout (`Web → /`).
- **Key Elements:** Top header (logo, address selector bar, account dropdown, `EN ▾`, `♡`, `🛒`), sub-header mode tabs (`Delivery` active, `Pick-up`, `pandamart`, `Shops`) + right search bar `"Search for restaurants, cuisines, and dishes"`; **left sidebar column** containing **App Download QR Card** (*"Unlock more app-only deals. Download now."* + App Store / Play Store badges + `×` dismiss) above sticky **`Filters`** panel (`Sort by: Relevance / Fastest delivery / Distance / Top rated`, `Quick filters`); **right main canvas** showing `Get 25% off [44:53]` campaign carousel (`Rajbari`, `Panchini`, `Mughal Masallam`, `Salt Bae` + `>` arrow), `Your favourite cuisines` circle/rounded cards (`Biryani`, `Pizza`, `Rice Dishes`...) + `>`, `Your daily deals`.
- **Data Fields:** Ranked home modules, live countdown, filter state synced with URL query params (`?sort=fastest`).
- **Actions:** Scan QR → opens `/app` / Android App Link (`File 19 §19.4`); filter radios; horizontal rail arrows.
- **States:** Logged-in desktop home (`1280px`).
- **Undal Verdict — KEEP 2-COLUMN DESKTOP SHELL (`w-01`, `File 19`):** Keep **App-Download QR card** (encoding `https://{UNDAL_WEB_DOMAIN}/app` with Play + direct GitHub Release APK badge — no fake iOS App Store button per `D-01`!) + sticky left `Filters` rail on `≥1024px` collapsing to bottom sheet `<1024px`.

### #W15 · `Screenshot_20261017-132800.png`
- **Screen & Flow:** Customer Web Pick-up Home (`Web → /?mode=pickup`).
- **Key Elements:** `Pick-up` mode tab active, header shows `🕒 Time ASAP`, left `Filters` rail (`Sort by: Relevance / Top rated / Distance`, `Offers: [ ] Accepts vouchers`, **`Cuisines` with inline `Search for cuisines` input + checkboxes `Asian`, `Bakery`, `Bangladeshi`, `Beverage`, `Biryani`, `Burgers`**), top right banner **`Explore restaurants around you` + `Show map →`** button, `Get 25% off [44:44]` carousel with distance labels (`Rajbari · 5 min · 🚶 4.9 km away` **[BUG!]**).
- **Data Fields:** Pickup vendor list, searchable 117-cuisine filter checklist (`Appendix D`).
- **Actions:** Filter by searchable cuisine checkboxes; click `Show map →` (`#W16`).
- **States:** ** UX Flaw Caught:** `🕒 5 min · 🚶 4.9 km away` pairs prep/drive minutes next to a walking figure icon for a 4.9 km trip!
- **Undal Verdict — IMPROVE (`w-01`, `Appendix D`):** Keep the **searchable cuisine filter box inside the left sidebar** (essential when browsing 117 cuisines!); display **`Ready in ~15 min · 520 m away`** truthfully!

### #W16 · `Screenshot_20261017-132819.png`
- **Screen & Flow:** Customer Web Full-Screen Interactive Pick-up Map (`Web → /pickup/map`).
- **Key Elements:** Split desktop view: **320px left sidebar** (`FILTERS ▾` accordion + scrollable vertical store cards with red active border on selected card `Panchini Restaurant ★3.7 · 10 min · 520 m`, `Himur Vojon Bilash ★3.6 · 10 min · 930 m`) + **full-height right map** (`SUST / Kumargaon / Akhalia / Surma River`, black `Home` pin, selected `Panchini Restaurant` pin, promo bubbles `15% Off`, `10% Off`, floating `Search this area` CTA, recenter + `+`/`-` zoom controls).
- **Data Fields:** Map viewport bounds, pickup stores, user home pin.
- **Actions:** Click pin ↔ highlights & scrolls left sidebar card; pan map + `Search this area`; zoom `+`/`-`.
- **States:** Desktop split-pane map (`Leaflet` + cached OSM tiles in Undal `File 14`).
- **Undal Verdict — KEEP EXACT SPLIT-PANE UX (`w-01` Map Mode):** Zero paid Google Maps JS SDK needed — Leaflet + OSM delivers this 100% free!

### #W17 · `Screenshot_20261017-132916.png` & #W18 · `Screenshot_20261017-132921.png`
- **Screen & Flow:** Customer Web Home — `All restaurants` 3-Column Grid (`Web → /` Scrolled).
- **Key Elements:** App-download horizontal banner + **3-column responsive grid** (`Yokoso [Ad]`, `Crisp - Chef's Table Sylhet [Ad]`, `Domino's [Ad]` in `#W17`; `Kacchi Bhai – Sylhet ★4.4 (2000+)`, `Dhakaiya – Sylhet ★3.5`, `Palki Restaurant – Ambarkhana ★4.1 (5000+)`, `PachForon Restaurant ★4.2 (2000+)`, `Chillox – Sylhet ★4.5`, `Woondaal King Kebab ★4.5 (3000+)` in `#W18`).
- **Data Fields:** Paged `All kitchens` ranked grid (`1→2→3→4 cols` across `D-15` breakpoints).
- **Actions:** `♡` favourite toggle on hover/tap, infinite scroll / pagination.
- **States:** Notice entire top row of `All restaurants` in `#W17` is 100% paid `[Ad]` slots (`3/3 cards`), pushing genuine Sylhet favorites (`Kacchi Bhai`, `Palki`, `PachForon`) below the fold!
- **Undal Verdict — IMPROVE (`D-12`):** In Undal, row 1 above the fold belongs 100% to the highest-performing kitchens in the user's zone (`rank_v1`).

### #W19 · `Screenshot_20261017-132936.png`
- **Screen & Flow:** Customer Web Store Page **with Active Populated Right Cart Panel** (`Woondaal King Kebab`).
- **Key Elements:** Header shows `🕒 Time Standard (45 – 55 mins)` + cart badge `[1]`; `Mutton Biryani Tk 315 ~~Tk 350~~` card tinted pink with black count badge `1`; **right sticky cart panel**: `Your items` (`Mutton Biryani · Tk 315 ~~Tk 350~~ · [🗑 1 +]`), horizontal cross-sell carousel **`Popular with your order — Based on what other customers bought together`** (`Trending now · Chicken Biryani Tk 275 [+]`, `Plain Polao Tk 180 [+]`) with `← →` arrows, `Total (incl. fees and tax) Tk 344 ~~Tk 448~~`, `See summary`, active CTA **`Review payment and address`**.
- **Data Fields:** Server cart items, cross-sell suggestions, live repriced total.
- **Actions:** Adjust qty `[🗑 1 +]`, 1-click add cross-sell side (`Plain Polao`), proceed to `/checkout`.
- **States:** Populated cart (`Tk 315` item → `Tk 344` unexplained `+Tk 29` jump until summary clicked!).
- **Undal Verdict — IMPROVE TRANSPARENCY (`w-08`, `File 10`):** Show **`Subtotal ৳315 · Delivery Free · Platform fee ৳5 → Total ৳320`** right inside the sticky right cart panel with **zero hidden fee surprises**!

### #W20 · `Screenshot_20261017-132951.png` & #W21 · `Screenshot_20261017-132956.png`
- **Screen & Flow:** Customer Web Two-Column Checkout Page (`Web → /checkout`).
- **Key Elements:** Left column: `Delivery address` card (`Home · R280 Sylhet`, `Note to rider` textarea, `Contactless delivery` toggle), `Delivery options` (`Standard 45–55 mins` vs `Priority 40-50 mins +Tk 35`), `Personal details` card (`E-mail` verified, `First name`, `Last name`, empty `Mobile number` input + disabled `Save` button), `Tip your rider` (`Tk 20 | Tk 30 [Most common] | Tk 50 | Tk 100`). Right column: `Woondaal King Kebab · 1 x Mutton Biryani Tk 315`, `+ Add more items`, `Vouchers for your order` (`Add Tk 284 more to use NBPLC150`), breakdown (`Subtotal Tk 0` **[BUG!]**, `Standard delivery Free`, `Service fee Tk 10`, **`VAT Tk 19`**, **`Total Tk 0 ~~Tk 448~~` [BUG!]**), disabled `Place order` button.
- **Data Fields:** Checkout state, customer phone check, order money breakdown.
- **Actions:** Enter BD mobile number (`^01[3-9]\d{8}$`), choose Priority/Tip, apply voucher, click `Place order` (`COD`).
- **States:** **TWO CRITICAL BUGS / FLAWS CAUGHT ON REFERENCE:**
  1. Because `Mobile number` was blank in `Personal details`, the reference app's checkout reducer broke and displayed **`Subtotal: Tk 0` and `Total: Tk 0`** while still showing `Service fee Tk 10` and `VAT Tk 19`!
  2. Notice `VAT Tk 19` added **on top** of menu price here — contradicting `D-08`!
- **Undal Verdict — MAJOR IMPROVEMENT (`w-09`, `D-08`, `File 10`):** Keep clean 2-column desktop checkout (`left steps, right sticky summary`); **never add VAT on top** (`D-08` VAT-inclusive menu pricing); never zero-out totals when a form field awaits validation — keep exact `COD_COLLECT` visible with inline helper *"Enter your mobile number so the rider can call on arrival"*.

### #W22 · `Screenshot_20261017-133001.png`
- **Screen & Flow:** Customer Web `All carts` Right Slide-Over Drawer (`Header Cart Icon Click`).
- **Key Elements:** Right slide-over drawer `All carts` + `×`, card `Woondaal King Kebab · 45-55 mins · Free · 🗑`, thumbnail + `+`, `Saving Tk35 · ~~Tk350~~ Tk315`, `Go to checkout`.
- **Data Fields:** Active cart state.
- **Actions:** Open drawer from any page header `🛒` click; edit items directly inside drawer and click `Go to checkout`.
- **States:** Slide-over overlay.
- **Undal Verdict — IMPROVE (`w-08`):** Clicking `🛒` in Undal's web header opens the **full interactive Cart Drawer (`items + qty steppers + voucher input + cutlery toggle + itemised bill + Go to checkout`)** directly in 1 click!

### #W23 · `Screenshot_20261017-133030.png`
- **Screen & Flow:** Customer Web User Account Dropdown + **`Farhanar Rannaghor` (`Homechef`) Card Discovery**.
- **Key Elements:** Open user menu dropdown under profile button (`Orders & reordering`, `Profile`, `Vouchers`, `rewards`, `Help Center`, `Logout`, plus dropped `pandapay`/`Subscribe`); behind backdrop on bottom-right grid sits **`Farhanar Rannaghor ★4.7 (500+) · From 75 min · Bangladeshi`** carrying a **`Homechef`** corner badge!
- **Data Fields:** Auth menu items; `vendors.type == 'HOME_KITCHEN'`, realistic fresh-cooked ETA (`75 min`).
- **Actions:** Quick navigation to Orders, Profile, Vouchers, Rewards, Help, Logout.
- **States:** Dropdown open over dimmed backdrop (`ESC` / outside-click dismissible, keyboard arrow navigable).
- **Undal Verdict — KEEP DROPDOWN + ELEVATE HOME KITCHENS (`w-01`, `D-01`, `File 21 §21.2`):** `Farhanar Rannaghor (★4.7, 500+, 75 min)` proves real Sylhet demand for authentic home-cooked meals even with longer cook-to-order prep times when communicated honestly!

### #W24 · `Screenshot_20261017-133052.png`
- **Screen & Flow:** Customer Web Profile Page (`/account`) + **Bilingual `English / বাংলা` Header Switcher**.
- **Key Elements:** Open globe dropdown top-right showing **`English ✓`** and **`বাংলা`**; underlying centered single-column `/account` form (`My profile ⓘ`: `First name`, `Last name`, `Mobile number`, `Save`; `Email` with `✓ Verified` pill + `Save`; `Password` change block).
- **Data Fields:** `profiles` (`full_name`, `phone`, `email`, `language`), password update via Supabase Auth.
- **Actions:** Instant 1-click switch between `English` and `বাংলা` persisting to `localStorage` + `profiles.language` (if logged in) and updating HTML `<html lang="bn">` + numerals/copy immediately without reload!
- **States:** Dropdown open.
- **Undal Verdict — KEEP VERBATIM (`w-01`, `w-13`, `Appendix H`):** Always keep the **1-click `EN / বাংলা` switcher** directly visible in the top bar on every page across Customer Web & Admin Web!
