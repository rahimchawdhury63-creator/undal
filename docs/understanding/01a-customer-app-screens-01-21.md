# 01a · Customer App Per-Image Deep Analysis — Part 1 (Files #01–#21)

> **Owner:** Builder AI (`Plan Response 1`) · **Governing Guide Files:** `01`, `02`, `14`, `16`, `25`, `Appendix A`  
> **Scope:** Pixel-by-pixel visual inspection of `reference-images/CUSTOMER_APP/` files **#01 through #21** (all 21 opened directly via vision).  
> **Companion index:** [`01-customer-surface-analysis.md`](./01-customer-surface-analysis.md) · **Part 2 (#22–#41):** [`01b-customer-app-screens-22-41.md`](./01b-customer-app-screens-22-41.md)

---

## Methodology & Privacy Hygiene

Every screenshot below was visually opened and inspected on **2026-10-23**. Note on device geometry: files `Screenshot_20261017-*` and `Screenshot_20261021-*` were captured on a **4G Android tablet (`~1200×1920` portrait)** in **Sylhet / Kulaura**, proving directly that Undal's Android apps must render cleanly on both phones (`360–412 dp`) and tablets (`600–900 dp`) without stretched cards or wasted whitespace (`D-15`). Personal emails/phone numbers visible in reference captures are redacted (`r***`, `d***@gmail.com`) per `File 09 §9.3`.

---

## Per-Image Findings (#01–#21)

### #01 · `Screenshot_20261017-124707.png`
- **Screen & Flow:** First-Run Location Permission Priming **overlaid with** Notification Priming Modal (`Onboarding → Permissions`).
- **Key Elements:** Dimmed background showing 3D map-pin illustration, heading *"Allow location access on the next screen for:"*, two icon rows (scooter icon + storefront icon), full-width bottom `Continue` CTA — **blocked mid-flow** by centered modal dialog (`×` close, pink `%` paper-plane graphic, *"Stay in the loop!"*, body *"Enable push notifications to get special deals and updates on your orders."*, `Maybe Later` outline button + `Enable` solid button).
- **Data Fields:** Local device permission state (`ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`).
- **Actions:** `Enable` → OS notification prompt; `Maybe Later` / `×` → dismiss modal to reveal underlying location screen.
- **States:** First-launch cold start (`12:47 PM`, 4G VoLTE).
- **Undal Verdict — IMPROVE (`AP-4b` Double-Modal Collision):** Pre-priming before OS dialogs is great (`AP-4`), **stacking two permission prompts simultaneously on frame 1 is hostile UX**. Undal (`c-03` → `c-04` → `c-05`) sequences them strictly one-at-a-time: Location Prime → OSM Pin confirm → contextual Notification Prime framed around **live order & rider arrival updates** (never "special deals"), in EN + বাংলা.

### #02 · `Screenshot_20261017-124713.png`
- **Screen & Flow:** First-Run Location Permission Priming — clean unobstructed state (`Onboarding → Location Prime`).
- **Key Elements:** White canvas, centered 3D pin + folded map illustration, bold headline *"Allow location access on the next screen for:"*, row 1 (`Finding the best restaurants and shops near you`), row 2 (`Faster and more accurate delivery`), sticky bottom full-width CTA `Continue`.
- **Data Fields:** None fetched yet (pre-permission).
- **Actions:** `Continue` triggers Android OS `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` runtime dialog.
- **States:** Unobstructed prime state; **missing explicit `Enter address manually` secondary escape** if user prefers typing an area without GPS.
- **Undal Verdict — IMPROVE (`c-03`, `D-01`):** Replace "and shops" with **restaurants, home kitchens & cloud kitchens** (`D-01`); use Undal Bowl-Pin SVG art (`File 25`); add clear secondary ghost button **`Set location manually on map`** below `Continue` so GPS-denied tablets/desktops never feel trapped.

### #03 · `Screenshot_20261017-124801.png`
- **Screen & Flow:** Full-Screen Interactive Map Address Pinning (`Onboarding / Address Create → Pin`).
- **Key Elements:** Full-viewport map centered on **Sylhet Temukhi / Kumargaon / Surma River / Sylhet Bypass Rd (`R280`)** with bilingual EN+BN labels (`তেমুখী সেতু, সিলেট`, `কুমারগাঁও কেন্দ্রীয় জামে মসজিদ`, `SylhetBites`), fixed center drop pin, top-left `×` close button, bottom-left satellite thumbnail toggle, bottom-right GPS crosshair FAB, bottom sheet showing pin icon + resolved city `Sylhet` + edit pencil icon, blue info banner *"Your rider will deliver to the pinned location. You can edit your written address on the next page."*, full-width `Confirm location` CTA.
- **Data Fields:** `lat`, `lng`, reverse-geocoded area label (`Sylhet`).
- **Actions:** Drag/pan map under fixed center pin; tap GPS recenter FAB; tap pencil to search address text; tap `Confirm location`.
- **States:** Map loaded; notice reverse geocode resolved only coarse string `"Sylhet"` with zero indication of whether the pin falls inside an active delivery polygon!
- **Undal Verdict — IMPROVE (`c-04`, `File 14`):** Render via `flutter_map` + cached W1 OSM tiles (drop paid satellite toggle; replace with **Undal Delivery Zone Polygon overlay toggle**!); reverse-geocode via W2 Nominatim cache + Open Location Code fallback; display **live zone verdict badge right in the bottom sheet** (`✓ Inside Sylhet Sadar · Standard delivery ৳30` vs `✕ Outside service zone — nearest active zone 1.2 km`) BEFORE user taps confirm.

### #04 · `Screenshot_20261017-124810.png`
- **Screen & Flow:** Logged-Out Customer Home Feed — Top Viewport (`Discovery → Home`).
- **Key Elements:** Header with pin `Selected location / Sylhet` + pill search bar *"Search for restaurants and groceries"*; hero promo banner *"Here's 50% on your first order! Start ordering >"* with carousel dots; **9-icon shortcut row** (`Offers`, `pandamart`, `Grocery`, `Pick-up [Up to -25%]`, `Convenience`, `Health & Beauty`, `Wet Market`, `New restaurants`, `Super restaurants`); **9-item cuisine rail** (`Biryani`, `Fast Food`, `Bangladeshi`, `Pizza`, `Burgers`, `Cakes`, `Cafe`, `Khichuri`, `Pasta`); **4 vertical promo cards** (`Free delivery / Flat 50% off 1st order / code YUMPANDA`, `Flat 15% off entire menu`, `bKash Tk. 100 off biriyani / code BK100`, `6 years of pandamart`); horizontal rail **Popular Restaurants** (`Yokoso ★4.9 (500+) [Ad]`, `Panchini Restaurant [Super] ★3.7 (100+)`, `Sultan's Dine -Sylhet · Price Match`); rail **Flat 15% off entire menu**; 5-tab bottom bar (`Food`, `Grocery`, `Search`, `Carts`, `Account`).
- **Data Fields:** Zone feed modules, banners, shortcuts, cuisine taxonomy, vendor summary cards (`name`, `hero_url`, `rating_avg`, `rating_bucket`, `eta_min`, `price_tier`, `primary_cuisine`, `delivery_fee`, `offer_pills`).
- **Actions:** Tap address → change location; tap search pill; tap shortcut/cuisine/campaign card/vendor card; bottom nav switch.
- **States:** Guest cold feed (`Carts` unbadged).
- **Undal Verdict — KEEP WORKABILITY / DROP NON-FOOD & ADS (`D-01`, `D-08`, `D-12`, `c-08`):** Drop all 5 non-food shortcuts (`pandamart`, `Grocery`, `Convenience`, `Health & Beauty`, `Wet Market`), drop bKash online promo (`COD only`), drop `[Ad]` cards (`Yokoso [Ad]`). Replace with Undal's food-pure shortcuts (`Offers`, `Pick-up`, `Flash Box`, `Home Kitchens`, `Cloud Kitchens`, `New Kitchens`, `Top Rated`) and 5-tab bar `Home · Search · Orders · Cart · Account`.

### #05 · `Screenshot_20261017-124827.png`
- **Screen & Flow:** Grocery Vertical Landing Tab (`Bottom Nav → Grocery`).
- **Key Elements:** Search bar *"Search for shops and products"*, pandamart 70% banner, category tiles (`Grocery`, `Convenience`, `Health & Beauty`, `Fresh Market`), `Popular shops` (`pandamart (Sylhet)`, `Unimart - Sylhet`, `Bengal Meat - Sylhet Shubidbazar`), SKU shelf (`brightfarms Egg`, `Aarong Sour Yoghurt`, `Freedom Pads`, `Marks Milk`, `Dano Milk`), shop deal cards.
- **Data Fields:** Retail packaged SKUs, MRP strikethroughs, spend thresholds (`Free with Tk1,800 spend`).
- **Actions:** Retail shop/SKU browsing.
- **States:** Active `Grocery` bottom tab.
- **Undal Verdict — DROP COMPLETELY (`D-01` Law):** Undal v1 is **100% Food Only** (`RESTAURANT`, `HOME_KITCHEN`, `CLOUD_KITCHEN`). Zero grocery/shop tables, tabs, or routes are built. Note one reusable UI pattern salvaged for food: horizontal compact item cards (`photo + price + strikethrough + Save badge`) work great for dish search & cross-sell rails.

### #06 · `Screenshot_20261017-124838.png`
- **Screen & Flow:** Search Pre-Query Landing Screen (`Bottom Nav → Search`).
- **Key Elements:** Top search input pill *"Search for restaurants and groceries"*, `Popular cuisines` horizontal icon strip (8 cuisines), `Featured on foodpanda — Sponsored` horizontal mini-cards (`Star Dine`, `Yokoso`, `Crisp - Chef's Table Sylhet`, `Salt Bae`, `Woondaal King Kebab`, `Ambrosia Food Factory`, `Rainbow Chinese Restaurant`, `Hotel Dallas`), `Popular searches in restaurants` pill chips (`pizza`, `burger`, `kfc`, `ice cream`, `dominos`, `pizza hut`, `panshi`, `burger king`), `Popular searches in shops` pill chips (`chips`, `biscuits`, `ice cream`).
- **Data Fields:** Cuisine list, trending zone search terms, recommended kitchens.
- **Actions:** Type query; tap cuisine chip; tap trending keyword chip; tap vendor mini-card.
- **States:** Empty query initial state (no recent searches yet for guest session).
- **Undal Verdict — IMPROVE (`c-11`, `D-01`, `D-12`):** Remove `"Sponsored"` rail → replace with organic **`Top Rated in {Zone}`** (`rank_v1` stage 4+5); remove `"in shops"` section; compute **`Trending in {Zone}`** chips nightly from real `search_queries` table (`File 13`); prepend on-device **`Recent searches`** chips with single-tap clear; support Bangla + Banglish synonyms (`বিরিয়ানি = biriyani = briyani = kacchi`).

### #07 · `Screenshot_20261017-124848.png`
- **Screen & Flow:** Search Results View — Dish/Category Query `"ice cream"` (`Search → Results`).
- **Key Elements:** Top bar (`←`, `"ice cream"`, `×` clear), tabs `Restaurants` (active) | `Shops`, horizontal filter strip (`Tune`, `Delivery` filled pill, `Pick-Up`, `Sort ▾`, `Free delivery`, `★ Ratings 4.0+`, `Price ▾`, `Offers ▾`, `Cuisines ▾`), count heading **`69 results for ice cream`**, full-width vendor cards (`Cremo Coffee ★4.6 (3k+) [Ad]` with top-left hero pill **`Ice Choco Shake • Tk261`**; `Mr. Blender ★3.5 (33) [Ad]` with top-left hero pill **`Special Faluda • Tk198`**), followed by horizontal dish-card module **`Recommended ice cream for you`** (`Oreo Blast with Ice Cream Tk180 ~~Tk200~~ 👍 76%` at `Waffle King ★4.9`, `Strawberry Milkshake Tk100` at `Revive Juice Corner`, `Crispy Chicken Ice-Cream Tk50`, `Kitkat Blast Tk198 👍 93%`, `Vanilla Milkshake Tk110`).
- **Data Fields:** Result count, matched dish overlay (`dish_name`, `price_poisha`), dish cards (`eta_range`, `vendor_name`, `vendor_rating`, `item_name`, `price`, `compare_at`, `satisfaction_pct`).
- **Actions:** Switch scope tab (`All / Kitchens / Dishes` in Undal); toggle filters; tap vendor card; tap dish card → open vendor menu scrolled & opened directly at that item's sheet!
- **States:** Populated results state. Notice relevance bug: `"Crispy Chicken Ice-Cream Tk50"` (actually fried chicken lollipop misnamed with "Ice-Cream" stick!) polluted results.
- **Undal Verdict — KEEP & IMPROVE (`c-12`):** **Adopt the matched-dish hero pill (`Ice Choco Shake • ৳261`) + horizontal dish-card rail** — that dual-granularity search pattern is superb! Drop `[Ad]` bias (`D-12`) and `Shops` tab (`D-01`); rank by `pg_trgm` text similarity × `rank_v1` quality score.

### #08 · `Screenshot_20261017-124904.png`
- **Screen & Flow:** Account Tab — Unauthenticated State (`Bottom Nav → Account`).
- **Key Elements:** Header `Account` + top-right settings gear icon; promo headline *"Here's 50% on your first order!"* + full-width `Sign up or Log in` CTA; section `Perks for you` (`Become a pro`, `Sign up and invite friends!`); section `General` (`Help center`, `Become a partner`, `foodpanda for business`, `Terms & policies`); brand footer + `Version 26.41.0`.
- **Data Fields:** App build version, runtime first-order campaign banner text (from `platform_settings` / active campaign, never hardcoded false promise!).
- **Actions:** `Sign up or Log in` → `c-06` Auth Hub; gear → language (`English / বাংলা`) & theme settings accessible even when logged out; partner/rider recruitment links.
- **States:** Logged-out guest state.
- **Undal Verdict — IMPROVE (`c-06`, `D-13`):** Keep clean logged-out utility (language switcher EN/BN prominently visible directly as a row rather than hidden behind gear icon!); drop `Become a pro` (`D-13`) and `for business`; add **`Ride with Undal`** alongside **`Become a Kitchen Partner`** (`File 16 §16.7`); show real version + Undal Bowl-Pin mark only.

### #09 · `Screenshot_20261017-124911.png`
- **Screen & Flow:** Auth / Login Credential Screen — **OS `FLAG_SECURE` Black Capture** (`Account → Sign up or Log in`).
- **Key Elements:** Entire viewport below the Android status bar (`12:49 PM`, 7s after `#08`) is solid `#000000` black because the app set Android `WindowManager.LayoutParams.FLAG_SECURE` on its authentication activity.
- **Data Fields:** Auth credentials / OAuth entry (`c-06`).
- **Actions:** Email+password, Phone+password, Google OAuth, config-gated plugin OAuth buttons (`D-09`).
- **States:** `FLAG_SECURE` active.
- **Undal Verdict — ARCHITECTURAL LESSON (`File 09 §9.3`):** `FLAG_SECURE` must be **scoped strictly to credential-entry / TOTP / private KYC document screens**, NEVER applied globally, because customers, partners, and riders legitimately screenshot **order receipts, bKash TrxID confirmations, and weekly invoices** for disputes and accounting!

### #10 · `Screenshot_20261017-124928.png`
- **Screen & Flow:** Restaurant Storefront Top View (`Panchini Restaurant`, Sylhet — `Discovery → Vendor Page`).
- **Key Elements:** Full-bleed hero food photo with floating circular buttons (`←` left; `ⓘ` Info, `Share`, `Group Order` right); centered store header (`Panchini Restaurant`, `Super` badge, `★ 3.7 (100+ ratings)` link); segmented control `Delivery` (selected) | `Pick-Up 10% off`; fulfilment card (`Delivery 25–35 min` + `Change`, `Free delivery for first order · Min. order Tk 50`); horizontal deal cards (`15% off Auto-applied`, `50% off (YUMPANDA) Min. order Tk 199`); `Search menu` pill; category strip (`Popular`, `Rice`, `Khichuri`, `Bhaji`, `Curry`, `Naan & Paratha`); **`🔥 Popular — Most ordered right now`** 2-column square cards (`Chicken Biryani Tk 136 ~~Tk 160~~`, `Beef Biryani Tk 204 ~~Tk 240~~ 👍 66%`) with `+` FAB and pink watermark *"Image by foodpanda. For reference only."*
- **Data Fields:** Vendor metadata, mode availability (`D-24`), active auto-discounts & claimable vouchers, categories, popular items (top 30-day order count).
- **Actions:** Mode switch, tap ratings → `#13`, tap `ⓘ` → business hours/hygiene info (`c-16`), search menu, tap `+` quick-add or tap card → `#11`.
- **States:** Open store, empty cart.
- **Undal Verdict — IMPROVE (`c-13`, `AP-6` Ban Fake Stock Food Photos):** Replace unused `Group Order` icon with **`♡ Favourite`** right in the hero bar! **Ban generic misleading stock food photos (`AP-6`)**: items either display authentic vendor-uploaded photos (via W1 ImgBB proxy) or a clean Undal typographic monogram tile — never fake stock dishes. Add Home Kitchen trust card (`cooks fresh · hygiene verified`) when `vendor.type == HOME_KITCHEN`.

### #11 · `Screenshot_20261017-124942.png`
- **Screen & Flow:** Item Detail & Add-On Bottom Sheet (`Vendor Page → Tap Chicken Biryani`).
- **Key Elements:** Modal sheet ~78% viewport height with full-width item photo, bold title `Chicken Biryani`, `Tk 136 ~~Tk 160~~`, portion-prefixed description `1:1 - The perfect balance of spices with juicy chicken & aromatic rice`, section **`Frequently bought together — Other customers also ordered these`** with `Optional` pill badge and 4 checkbox rows (`Moong Dal +Tk 17 ~~Tk 20~~`, `Chicken Bhuna Khichuri +Tk 60`, `Beef Bhuna Khichuri +Tk 76`, `Beef Biryani +Tk 204`) + `⌄ View 6 more`, collapsible `+ Add special instructions`, sticky footer `[-] 1 [+]` stepper + full-width `Add to cart` button.
- **Data Fields:** `menu_items`, `variant_groups`/`variants`, `option_groups`/`options`, co-purchased items, `note`, `qty`.
- **Actions:** Select size/options, expand cross-sell items, enter kitchen note, adjust qty, submit `Add to cart`.
- **States:** Valid selection ready (`Add to cart` enabled). Notice button says `"Add to cart"` **without live price total**!
- **Undal Verdict — IMPROVE (`c-14`):** Display **live computed total right inside the CTA button** (`Add to cart · ৳136` → updates live to `৳153` the instant `Moong Dal +৳17` is checked, per `File 16 §16.4`!), render structured `serves` badge (`Serves 1`), spicy chillies `🌶`, veg/halal chips, and enforce required `min_select..max_select` groups cleanly with auto-scroll to first incomplete group.

### #12 · `Screenshot_20261017-124950.png`
- **Screen & Flow:** Vendor Storefront Mid-Page Scroll — Inline Reviews Rail + Standard Category Rows (`Vendor Page → Scroll`).
- **Key Elements:** Sticky top search bar `Search Panchini Restaurant` + category tabs (`Popular`, `Rice`, `Khichuri`...), bottom of `Popular` 2-up grid (`Chicken Akhni Tk 68 ~~Tk 80~~ 👍 75%`, `Beef Bhuna Khichuri Tk 76 ~~Tk 90~~ 👍 83%`), inline social-proof carousel **`Fellow foodies say`** + `See all` link showing 3 horizontal review snippet cards (Bengali 5★ complaint text by `Morium` — *funny rating mismatch where angry user tapped 5★ by mistake!*, English 5★ by `HANiF`, 4★ by `Fahmidul`), followed by standard list category **`Rice`** (`Polao Rice Tk 51`, `Chicken Polao Tk 68`, `Beef Polao Tk 85 👍 44%` — left text + right square photo + overlapping `+` FAB).
- **Data Fields:** Category list items, inline recent reviews (`stars`, `body`, `reviewer_name`, `created_at`).
- **Actions:** Scroll spy updates active tab; `See all` opens `#13`; `+` adds simple item immediately or opens sheet if required variants exist.
- **States:** Sticky header collapsed cleanly on scroll.
- **Undal Verdict — KEEP & IMPROVE (`c-13`):** Dual layout (**2-column visual cards for `Popular`, compact horizontal rows for full categories, inline review preview rail between them**) is fast, scannable, and high-converting. Keep exact structure; add dish-tag pills + vendor reply badge on inline review cards.

### #13 · `Screenshot_20261017-125000.png`
- **Screen & Flow:** Dedicated Vendor Ratings & Reviews Screen (`Vendor Page → Tap ★ 3.7 / See all`).
- **Key Elements:** Top bar (`×`, `Ratings & Reviews / Panchini Restaurant`, `ⓘ`), summary card (`3.7` large numeral, star row, `All ratings (100+)`, 5→1 horizontal distribution bars), `Reviews` filter chips (`Top reviews` active dark pill, `Newest`, `Highest rating`, `Lowest rating`), stacked review cards (`Morium 1 month ago` in Bengali, `HANiF`, `Fuzael` in Bengali requesting lemon/salad, `Md.Nazmul`, `Umar` ×2) each with `👍 Helpful` counter button.
- **Data Fields:** `rating_avg`, `rating_count`, histogram `1..5`, paged reviews (`stars`, `body`, `helpful_count`, `created_at`).
- **Actions:** Sort chip switch, vote `Helpful`, `ⓘ` explains rating methodology (`Bayesian 90-day verified orders` in Undal).
- **States:** Loaded list; notice zero verified-order dish context and zero vendor replies visible on angry reviews (`Morium`).
- **Undal Verdict — IMPROVE (`c-17`, `File 22 §22.6`):** Keep clean histogram + sort chips; add **`Verified Order` badge**, **ordered item pills (`Ordered: Chicken Biryani`)**, aspect chips (`Taste · Portion · Packaging · Temperature`), review photos, **inline Vendor Reply thread**, and `Report` flag → Admin moderation queue.

### #14 · `Screenshot_20261017-125023.png`
- **Screen & Flow:** Customer Cart Screen — Step 2 of 3 (`Menu → Cart → Checkout`).
- **Key Elements:** Header `× Cart / Panchini Restaurant`, **3-step progress bar (`1 Menu` — `2 Cart` active — `3 Checkout`)**, segmented mode switch `Delivery` | `Pick-Up 10% off`, `Delivery: 15 - 25 min` + `Change`, line item (`Chicken Biryani`, `[🗑 1 +]` stepper, `Tk 136 ~~Tk 160~~`), `+ Add more items`, bill breakdown (`Subtotal Tk 136`, `Standard delivery Free — You've got free delivery for your first order`, `Platform Fee ⓘ Tk 5`), outlined button `Apply a voucher`, **Cutlery toggle default OFF** (`No cutlery provided. Thanks for reducing waste!`), sticky bottom bar (`Total (incl. fees and tax) Tk 141 ~~Tk 184~~`, `See summary`, full-width CTA `Review payment and address`).
- **Data Fields:** `carts`, `cart_items`, `fulfilment`, `cutlery_requested`, server-validated money waterfall (`File 10`).
- **Actions:** Toggle Delivery/Pickup (reprices instantly!), increment/decrement/delete line, reopen item to edit options, apply voucher (`c-19`), toggle cutlery, proceed to Checkout (`c-20`).
- **States:** Valid cart above `Min. order Tk 50`.
- **Undal Verdict — KEEP WORKABILITY (`c-18`, `File 10`, `File 16 §16.5`):** Nearly ideal information hierarchy! Adopt the **3-step spine (`1 Menu · 2 Cart · 3 Checkout`)**, default-OFF cutlery toggle (printed on Partner ticket!), explicit `Platform Fee ⓘ` tooltip, and exact server `validate_cart` totals.

### #15 · `Screenshot_20261017-125032.png`
- **Screen & Flow:** Restaurant Storefront **with Active Cart Sticky Footer Bar** (`Vendor Page — Post Add-to-Cart`).
- **Key Elements:** Same `Panchini Restaurant` storefront as `#10`, now showing: dark circular quantity badge **`1`** replacing `+` on `Chicken Biryani`, bottom reward banner **`✓ You've got 15% off your order!`** above a full green progress bar, and full-width bottom sticky cart CTA **`[1] View your cart · Panchini Restaurant · Tk 136 ~~Tk 160~~`**.
- **Data Fields:** Active cart item count, threshold progress toward next promo tier (e.g. `"Add ৳63 more for free delivery!"`), live cart food subtotal + strikethrough savings.
- **Actions:** Tap `1` badge to increment/adjust directly on card; tap bottom bar → opens `#14` Cart.
- **States:** Active in-store cart state. *(Audit note: Guide File `02` §2.1.3 text accidentally cited `125032.png` where `#06` `124838.png` was meant — corrected here!)*
- **Undal Verdict — KEEP (`c-13`):** The **dynamic promo-threshold progress bar** (`"Add ৳X more to unlock Flash Box / Free Delivery"` → turns green `"✓ Unlocked!"`) plus persistent bottom cart bar drives higher AOV without annoying popups!

### #16 · `Screenshot_20261017-125102.png`
- **Screen & Flow:** Checkout Screen **Interrupted by Subscription Upsell Popup** (`Cart → Checkout + Modal`).
- **Key Elements:** Underlying Step-3 `Checkout` screen dimmed and blocked by a bright purple modal: megaphone illustration, `×` close button, **`Free trial: 30 days of PRO`**, copy claiming savings, **`Claim free trial`** button.
- **Data Fields:** Marketing upsell trigger firing right as user attempts to pay.
- **Actions:** Must hunt for top-right `×` to avoid accidental subscription enrollment before placing order!
- **States:** Blocking modal anti-pattern. *(Audit note: Guide File `02` §2.1.1 cited `125102` for address pin `#03` `124801` — corrected here!)*
- **Undal Verdict — FORBIDDEN (`AP-2`, `D-13`):** Explicitly banned! Checkout (`c-20`) is a sacred zero-distraction corridor: **never show modals, upsells, or banners once the user taps `Review payment and address`**.

### #17 · `Screenshot_20261017-125110.png`
- **Screen & Flow:** Checkout Screen — Step 3 of 3 Unobstructed (`Checkout`).
- **Key Elements:** Step spine (`3 Checkout` active); `Delivery address` card (mini-map thumbnail, `Sylhet`, `Change`, `Delivery instructions` input, disabled `Contactless delivery: switch to online payment for this option`); `Delivery options` radio card (`Priority 10 - 20 mins ⚡ +Tk 20` vs selected `Standard 15 - 25 mins`); `Tip your rider` card (`"Your rider receives 100% of the tip"`, chips `Not now` active | `Tk 20` | `Tk 30 [Most common]` | `Tk 50` | `Tk 100`, `Save for your next order` checkbox); `Payment method` (`Cash · Tk 141`); `Order summary` (`1x Chicken Biryani Tk 144` **[BUG!]**, `Subtotal Tk 136`, `Standard delivery Free`, `Platform Fee Tk 5`); sticky footer `Total (incl. fees and tax) Tk 141 ~~Tk 184~~` + CTA `Confirm address` (prompts pin confirmation before final submit).
- **Data Fields:** Address + instructions, `is_priority`, `tip_poisha`, payment mode (`COD`), order summary lines.
- **Actions:** Edit address/pin, choose Standard vs Priority, choose cash tip chip, submit order (`Idempotency-Key`).
- **States:** **LIVE PRODUCTION MATH BUG CAUGHT ON REFERENCE:** `Order summary` prints **`1x Chicken Biryani Tk 144`** right above **`Subtotal Tk 136`** (`144 ≠ 136` — two different discount calculation paths on the same screen!). Also remove dead disabled `Contactless delivery` toggle (meaningless on COD — replace with note chip `"Leave at door (pay cash first)"` only if applicable, or clean rider instructions).
- **Undal Verdict — IMPROVE (`c-20`, `AP-7` Math Discrepancy Ban):** In Undal, **every number on Menu, Cart, Checkout, Partner Ticket, Rider Offer, and Invoice comes from one canonical server `price_order()` snapshot (`File 10`)** — `line_net` sum ALWAYS equals `food_payable` to the single poisha! Label rider tips clearly: **`Tip your rider in cash (100% goes to rider)`**.

### #18 · `Screenshot_20261017-125123.png`
- **Screen & Flow:** Flash Deals Dedicated Campaign Sheet (`Home Floating Countdown Banner → Tap`).
- **Key Elements:** Bottom sheet with drag handle, pink header strip with alarm-clock icon, **`Save 25% · Flash Deals: limited time offers · Max. discount Tk 110, Min. order Tk 170`**, live digital countdown tiles **`[44] : [23]`**, and vertical list of participating Sylhet stores (`Rajbari Restaurant ★4.5 (4k+)`, `Panchini Restaurant ★3.7 (100+)`, `Mughal Masallam ★4.8 (500+)`, `Dhakaiya - Sylhet ★3.5 (2k+)`).
- **Data Fields:** `campaigns` (`flash_box`, `percent`, `cap_poisha`, `min_order_poisha`, `ends_at` server timestamp), opted-in `campaign_vendors` ranked by `rank_v1`.
- **Actions:** Tap any participating kitchen → opens storefront with Flash Box auto-applied badge; swipe down to dismiss.
- **States:** Active window ticking down synchronously from server `ends_at`.
- **Undal Verdict — KEEP AS `UNDAL FLASH BOX` (`D-11`, `File 20 Domain 7`):** Rebrand with Undal Flame (`#FF6B2C`) + Sun (`#FFC53D`) accents; enforce **real server `ends_at` timestamps** (never fake reset-on-reload timers!) and transparent vendor/platform funding split.

### #19 · `Screenshot_20261017-125133.png`
- **Screen & Flow:** Logged-In Home Feed — Personalised Modules + Persistent Flash Strip + Cart Badge (`Home`).
- **Key Elements:** Search header, **`Order again`** horizontal card showing `Domino's Pizza - Chef's Table Sylhet ★4.4` **WITH `[Ad]` BADGE ON IT (!)**, retail promo strip `Kick-off with top deals / pandamart (Sylhet)` (lemon, Dettol soap ×2, Sunshine Atta 2kg), **`Flat 15% off entire menu`** rail (`The Magician [Ad]`, `Alpine Restaurant`, `Burger's Corner`), floating bottom strip **`Save 25% Flash Deals [44]:[13]`** with `×`, bottom nav with **`Carts [1]`** badge.
- **Data Fields:** Past customer orders (`Order again`), active deal rails, active cart item count badge.
- **Actions:** Tap card, dismiss floating Flash strip (`×`), tap `Carts [1]` badge.
- **States:** Logged-in user with 1 active cart item.
- **Undal Verdict — IMPROVE (`AP-3` Ad Injection in Personal History):** Injecting paid `[Ad]` placements inside **`Order again`** betrays user trust! In Undal, **`Order again`** queries strictly `SELECT DISTINCT vendor FROM orders WHERE customer_id = auth.uid() AND status = 'DELIVERED'` ordered by recency/frequency — **100% genuine past kitchens + 1-tap reorder**. Drop Dettol/Atta grocery strip (`D-01`).

### #20 · `Screenshot_20261017-125141.png`
- **Screen & Flow:** Logged-In Home Feed — Mid/Lower Modules (`Home → Scroll`).
- **Key Elements:** Dish-level recommendation rail (`Chicken Bhuna Khichuri Tk72 👍 74%` at `Palki`, `Plain Bhuna Khichuri Tk36 👍 79%` at `Haji Noyab Ali`, `Beef Biryani Tk252` at `Hotel Farmis Garden`, `Plain Rice Tk24 👍 73%`, `BBQ Pizza Tk233` at `Pizza's Point`), **`Top brands`** square logo strip (`Sultan's Dine`, `Chillox`, `Kacchi Bhai`, `Panshi`, `Takeout`, `Palki`, `Alpine`, `Rajbari` missing logo placeholder), **`Try something new`** horizontal cards with `New` pill (`Nobanno Restaurant ★3.4 (26)`, `Pizza Lovers`, `Mack & Bite Fast Food`), large campaign banner (`30% OFF USE CODE DEALNAO`), floating `Save 25% [44]:[06]`.
- **Data Fields:** Dish recommendations, brand logos, new-vendor exploration slots (`File 13 Stage 8`), campaign banners.
- **Actions:** Tap dish → opens store at dish; tap brand logo → opens store; tap banner → filtered promo list.
- **States:** Notice `Rajbari Restaurant` square card shows a washed-out grey panda placeholder because no square logo was uploaded.
- **Undal Verdict — IMPROVE (`c-08`, `File 13 Stage 8 & 10`):** Keep **dish-level rail ("Under ৳100 / Because you loved Khichuri")**, **Square Kitchen Logos rail ("Loved in Sylhet")**, and **`New on Undal` exploration module** (giving new restaurants & home kitchens fair Stage-8 visibility!). Require square logo upload during Partner KYC (`File 21`) with bold Undal initial monogram fallback so no broken grey box ever renders.

### #21 · `Screenshot_20261017-125201.png`
- **Screen & Flow:** Logged-In Account Screen (`Bottom Nav → Account`).
- **Key Elements:** User greeting **`Rahim` + `View profile`**, top purple banner `Save with pandapro! Free for 30 days`, **3-card quick-action row (`Orders` | `Favourites` | `Addresses`)**, `Wallet` section (`Refund Account · Tk 0`), `Perks for you` (`Try pandapro`, `panda rewards`, `Vouchers`, `Invite friends`), `General` (`Help center`, `Become a partner`, `foodpanda for business`, `Terms & policies`), full-width outlined `Log out` button, `Version 26.41.0`.
- **Data Fields:** `profiles` (`full_name`), voucher count, rewards points balance (`Undal Rewards`), app version.
- **Actions:** Open Profile (`c-38`), Orders (`c-26`), Favourites (`c-29`), Addresses (`c-30`), Vouchers (`c-32`), Rewards (`c-33`), Invite (`c-34`), Help (`c-36`), Legal, `Log out`.
- **States:** Authenticated customer (`Carts [1]` badge active).
- **Undal Verdict — KEEP STRUCTURE / CLEAN UP (`c-29..c-40`, `D-13`):** The **3-tile hero action grid (`Orders · Favourites · Addresses`)** is super thumb-friendly and clear — keep it verbatim! Drop `pandapro` banner/row and `Wallet / Refund Account Tk 0` (`D-13` — COD adjustments use goodwill vouchers or support-handled credits, never a stored-money wallet); add visible **`Language: English / বাংলা`** toggle and **`Notifications inbox`** row.
