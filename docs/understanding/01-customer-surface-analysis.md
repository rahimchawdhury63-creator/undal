# 01 · Customer Surface Analysis — Synthesis of All 65 Customer Screenshots

> **Owner:** Builder AI (`Plan Response 1`) · **Governing Guide Files:** `00`, `01`, `02`, `10`, `13`, `14`, `16`, `19`, `22`, `25`, `Appendix A`, `Appendix N`  
> **Scope:** Complete visual audit and UX synthesis of **100% of Customer App (`41 images`) + Customer Web App (`24 images`) = 65 reference images**, extending Guide File `02`.  
> **Detailed per-image inspections (all 65 rows):**
> - [`01a-customer-app-screens-01-21.md`](./01a-customer-app-screens-01-21.md) — `CUSTOMER_APP` **#01–#21**
> - [`01b-customer-app-screens-22-41.md`](./01b-customer-app-screens-22-41.md) — `CUSTOMER_APP` **#22–#41**
> - [`01c-customer-web-screens-01-24.md`](./01c-customer-web-screens-01-24.md) — `CUSTOMER_WEB_APP` **#W01–#W24**

---

## 1. Repository Image Inventory Audit (Ground Truth vs Guide Metadata)

Before inspecting a single pixel, we audited every file physically on disk inside `reference-images/`:

| Folder | Actual Images on Disk | `.txt` Marker Files | Appendix A Listed | Delta Discovered by Builder Audit | Assigned Phase |
|---|---:|---:|---:|---|---|
| `CUSTOMER_APP/` | **41** (`34 PNG, 2 JPEG, 5 WebP`) | 1 (`0 B`) | 41 | `0` — **All 41 opened & analysed in Plan 1** | **Plan Response 1 ✓** |
| `CUSTOMER_WEB_APP/` | **24** (`24 PNG`) | 1 (`0 B`) | 24 | `0` — **All 24 opened & analysed in Plan 1** | **Plan Response 1 ✓** |
| `PARTNER_APP/` | **63** (`55 PNG, 8 WebP`) | 1 (`0 B`) | 61 | **+2 extra PNGs found** (`Screenshot_20261023-155525.png`, `155538.png`) | **Plan Response 2** (all 63!) |
| `RIDER_APP/` | **44** (`30 PNG, 13 WebP, 1 AVIF`) | 1 (`0 B`) | 44 | `0` — all 44 queued (incl. `.avif` decode check) | **Plan Response 2** (all 44!) |
| Root marker | — | 1 (`0 B`) | — | — | — |
| **TOTAL** | **172 actual images** | **5 `.txt` files** | **170** | **+2 bonus `PARTNER_APP` files included automatically** | **65 Done / 107 Plan 2** |

Also corrected **two minor inline citation slips** in Guide File `02`:
1. `02 §2.1.1` cited `125102.png` for the Surma River address-pin map; physically on disk, **`124801.png` (`#03`)** is the Surma River address-pin map while **`125102.png` (`#16`)** is Checkout with the blocking PRO modal.
2. `02 §2.1.3` cited `125032.png` for Search landing; physically on disk, **`124838.png` (`#06`)** is Search landing while **`125032.png` (`#15`)** is `Panchini Restaurant` storefront with the active bottom cart bar.

---

## 2. Empirical Anti-Patterns Discovered Across the 65 Reference Screens (`AP-1` → `AP-9`)

Guide File `02 §2.5` defined `AP-1..AP-5`. Visually opening all 65 images uncovered **four additional real production bugs and dark patterns (`AP-6..AP-9`)** inside the reference platform that Undal eliminates structurally:

| ID | Anti-Pattern / Bug Observed in Reference | Exact Evidence File(s) | Undal Structural Solution |
|---|---|---|---|
| **AP-1** | **Dead-end blank screen on sparse filter** (`Sweets` shows 1 kitchen + 55% empty white screen; `All carts` wastes 75% screen) | `#32` `174315.png`, `#27` `125330.png` | Recovery module below `<3` results (`Clear filter` + `Opening later` + nearby dessert dishes); bottom `Cart` tab opens active cart in 1 tap. |
| **AP-2** | **Checkout-hijacking subscription modal** right over Step 3 payment confirmation | `#16` `125102.png` | Hard UX law: zero modals, banners, or upsells anywhere inside Cart → Checkout (`c-18..c-20`, `w-08..w-09`). |
| **AP-3** | **Paid `[Ad]` pollution overriding user intent, personal history & tracking** (`[Ad]` inside `Order again`!; crab/burger `[Ad]` overriding `Rice Dishes` filter!; bank lottery ad inside Live Tracking!) | `#19` `125133.png`, `#30` `174300.png`, `#35` `images (6).jpeg`, `#W17` `132916.png` | **Zero ads or paid ranking anywhere (`D-12`)**. Strict filter predicates; genuine order history in `Order again`; clean distraction-free live tracking. |
| **AP-4** | **Stacked double permission prompt on first frame** (Notification modal covering Location priming screen!) | `#01` `124707.png` | Strictly sequential one-at-a-time priming screens (`c-03` → `c-04` → `c-05`) with manual map escape when GPS is declined. |
| **AP-5** | **Silent failures / unexplained states** (`Cancelled` order card gives zero reason; `FLAG_SECURE` blackouts if over-applied) | `#23` `125224.png`, `#09` `124911.png` | Explicit EN/BN cancel reason pill from `order_events`; `FLAG_SECURE` restricted strictly to password/TOTP/private KYC viewers. |
| **AP-6** | **Misleading generic stock food photos** watermarked *"Image by foodpanda. For reference only."* | `#10` `124928.png`, `#12` `124950.png` | Authentic kitchen photography via W1 ImgBB proxy, or clean typographic Undal category/monogram card (`#W09` text-card layout when null) — never fake food. |
| **AP-7** | **Checkout math & state bugs** (App prints `1x Chicken Biryani Tk 144` above `Subtotal Tk 136`!; Web prints `Subtotal Tk 0 / Total Tk 0` when phone blank + adds surprise `VAT Tk 19` on top!) | `#17` `125110.png`, `#W19` `132936.png`, `#W20` `132951.png` | Single canonical server `price_order()` snapshot (`File 10`); **VAT-inclusive menu prices (`D-08`)**; totals stay intact during inline form validation. |
| **AP-8** | **Stealth checkout junk fees & deceptive pickup walk times** (`Container charges Tk 29` adding +24% surprise; `🕒 5 min · 🚶 4.9 km away` on pickup card!) | `#24` `125237.png`, `#W15` `132800.png` | Zero surprise container surcharges (`COD = food_payable + delivery + platform + tip`); pickup cards separate **`Ready in ~15 min`** from **`520 m away`**. |
| **AP-9** | **Unchecked duplicate menu items & clipped compound dish names** (`6- pic patishapta` published twice side-by-side; `5 pic – chitol pitha with Shutki bho...` clipped at 1 line; `?lat=&lng=` leaked in shared URLs) | `#W02` `121759.png`, `#W03` `121808.png`, `#W01..#W16` | Partner Menu Studio duplicate-item detector; 2-line title wrap on item cards; `menu_categories.description_en/bn` column; clean `/r/{slug}` URLs without user GPS leakage. |

---

## 3. Sylhet & Bangladesh Ground-Truth Patterns Captured from Reference Screens

1. **Tablet-First Reality:** Both app (`1200×1920`) and web (`1280×800`) captures come from an Android tablet on 4G (`Sylhet / Kulaura / SUST / Ambarkhana / Temukhi R280`). Every Flutter screen (`16–18`) and React page (`19–20`) must center/multi-column gracefully across `240px → 768px → 1024px → 1600px+` (`D-15`).
2. **Banglish Landmark Addressing (`#22`, `#W14`, `#W20`):** Real addresses rely on **Plus Codes (`WR6F+W42`) + highway/bazar names (`R280`, `Temukhi`, `Baroigram Road`) + vivid Banglish building notes (`"Shaad er pichoner road er 5 tala tower Wala building"`)**. Undal makes `Landmark & floor note for rider` prominent on both address creation and the Rider Arrival card.
3. **Authentic Bangladeshi Menu Structure (`#W01–#W13` `undal-cdo6` & `#W23` `Farhanar Rannaghor`):**
   - Low-ticket add-on staples (`Plain Rice ৳45`, `Egg fry ৳32`, `Alu Bhorta ৳38`, `Lachha Paratha ৳57`) require **frictionless 1-tap inline `+` cart addition** without modal interruption.
   - Multi-component regional platters (`Shutki Bhorta + Dal Bhuna + Plain Rice`, `Palli Gramer Shidol Oitijhho`, `Chhatrabash Special`) require both **category descriptions (`menu_categories.description_en/bn`)** and **structured bundle/variant slots (`menu_items.item_type = sized | bundle`)**.
   - Home Kitchens (`Farhanar Rannaghor ★4.7 (500+) · From 75 min`) thrive with high ratings when fresh cook-to-order prep times are set and shown honestly!

---

## 4. Complete 65-Image Master Index (`CUSTOMER_APP` + `CUSTOMER_WEB_APP`)

### 4.1 `CUSTOMER_APP` (41 / 41 Inspected — Details in [`01a`](./01a-customer-app-screens-01-21.md) & [`01b`](./01b-customer-app-screens-22-41.md))

| # | File | Screen Identified | Undal Target | Verdict |
|---:|---|---|---|---|
| 01 | `Screenshot_20261017-124707.png` | Location Prime + stacked Notification Modal | `c-03`, `c-05` | **Improve** (unstack modals `AP-4`) |
| 02 | `Screenshot_20261017-124713.png` | Location Permission Prime (unobstructed) | `c-03` | **Improve** (food-only copy + manual pin link) |
| 03 | `Screenshot_20261017-124801.png` | Map Address Pinning (Surma River / Temukhi) | `c-04` | **Improve** (OSM + live zone polygon verdict) |
| 04 | `Screenshot_20261017-124810.png` | Guest Home Feed (top shortcuts, cuisines, deals) | `c-08` | **Improve** (drop 5 non-food tabs & `[Ad]`) |
| 05 | `Screenshot_20261017-124827.png` | Grocery / pandamart Vertical Tab | — | **Drop** (`D-01` Food-Only law) |
| 06 | `Screenshot_20261017-124838.png` | Search Pre-Query Landing | `c-11` | **Improve** (real zone trends, BN/Banglish, no Sponsored) |
| 07 | `Screenshot_20261017-124848.png` | Search Results `"ice cream"` (vendor + dish rail) | `c-12` | **Keep & Improve** (hero matched-dish pill + dish rail) |
| 08 | `Screenshot_20261017-124904.png` | Account Tab (Logged-Out Guest) | `c-06` | **Improve** (visible EN/BN toggle, partner+rider CTAs) |
| 09 | `Screenshot_20261017-124911.png` | Auth Screen (`FLAG_SECURE` black capture) | `c-06` | **Security Rule** (scope `FLAG_SECURE` narrowly) |
| 10 | `Screenshot_20261017-124928.png` | Storefront Top (`Panchini Restaurant`, Popular 2-up) | `c-13` | **Improve** (`♡` in hero, ban fake stock photos `AP-6`) |
| 11 | `Screenshot_20261017-124942.png` | Item Sheet (`Chicken Biryani` + cross-sell options) | `c-14` | **Improve** (live `Add to cart · ৳total` CTA) |
| 12 | `Screenshot_20261017-124950.png` | Storefront Mid (`Fellow foodies say` + `Rice` rows) | `c-13` | **Keep & Improve** (verified dish tags + replies) |
| 13 | `Screenshot_20261017-125000.png` | Ratings & Reviews Screen (`3.7`, bars, BN/EN list) | `c-17` | **Improve** (aspect chips, photos, vendor reply, report) |
| 14 | `Screenshot_20261017-125023.png` | Cart Screen (Step 2/3, mode toggle, cutlery OFF) | `c-18` | **Keep** (exact 3-step spine + server `validate_cart`) |
| 15 | `Screenshot_20261017-125032.png` | Storefront with Active Cart Bar & `15% off` unlocked | `c-13` | **Keep** (live threshold progress bar + sticky cart CTA) |
| 16 | `Screenshot_20261017-125102.png` | Checkout Blocked by `30 days of PRO` Modal | `c-20` | **Drop Modal** (`AP-2`, `D-13` forbidden) |
| 17 | `Screenshot_20261017-125110.png` | Checkout Unobstructed (`Tk 144` vs `Tk 136` bug!) | `c-20` | **Improve** (single server money truth `AP-7`, COD cash tip) |
| 18 | `Screenshot_20261017-125123.png` | Flash Deals Sheet (`Save 25% [44]:[23]`) | `c-08` | **Keep as `Undal Flash Box`** (`D-11`) |
| 19 | `Screenshot_20261017-125133.png` | Home (`Order again [Ad]`, pandamart, `Carts [1]`) | `c-08` | **Improve** (pure non-ad `Order again`, drop grocery) |
| 20 | `Screenshot_20261017-125141.png` | Home (`Dish rail`, `Top brands`, `Try something new`) | `c-08` | **Keep & Improve** (`New on Undal` Stage-8 slots) |
| 21 | `Screenshot_20261017-125201.png` | Logged-In Account (`Rahim`, 3-tile grid, perks) | `c-29..40` | **Keep 3-tile hub**, drop wallet/pro (`D-13`) |
| 22 | `Screenshot_20261017-125206.png` | Saved Addresses (`WR6F+W42`, Banglish notes) | `c-30..31` | **Improve** (prominent landmark field + zone badge) |
| 23 | `Screenshot_20261017-125224.png` | Past Orders (`Cancelled` vs `Delivered` + reorder) | `c-26` | **Improve** (show cancel reason + pinned live order) |
| 24 | `Screenshot_20261017-125237.png` | Order Receipt (`#xisi-2613-795k`, `Container Tk 29`) | `c-27` | **Improve** (ban stealth container fees `AP-8` + timeline) |
| 25 | `Screenshot_20261017-125252.png` | Home Main Vertical Feed (`Explore nearby`) | `c-08` | **Keep** card anatomy (`rank_v1` order) |
| 26 | `Screenshot_20261017-125310.png` | Pick-up Discovery Feed + Map Preview Card | `c-09` | **Keep & Improve** (`Ready ~X min · Y m away`) |
| 27 | `Screenshot_20261017-125330.png` | `All carts` Intermediate Screen | `c-18` | **Simplify** (1-tap direct to single active cart) |
| 28 | `Screenshot_20261021-174248.png` | Home Filtered: `Fried Chicken` | `c-08` | **Keep** filter ring + `Reset` action |
| 29 | `Screenshot_20261021-174254.png` | Home Filtered: `Chicken` | `c-08` | **Keep** parent→child taxonomy expansion |
| 30 | `Screenshot_20261021-174300.png` | Home Filtered: `Rice Dishes` (broken by non-rice Ads) | `c-08` | **Fix via `D-12`** (strict organic match only) |
| 31 | `Screenshot_20261021-174306.png` | Home Filtered: `Kebab` | `c-08` | **Keep** horizontal rail scroll retention |
| 32 | `Screenshot_20261021-174315.png` | Home Filtered: `Sweets` (1 result + blank screen) | `c-08` | **Fix `AP-1`** (empty/sparse recovery module) |
| 33 | `Screenshot_20261021-174335.png` | Pick-up Full-Screen Map (`Search this area` + pills) | `c-10` | **Keep** on OSM (`flutter_map` pin↔card sync) |
| 34 | `Screenshot_20261021-174417.png` | Search `Shops` Tab (`"ice cream"`) | `c-12` | **Drop `Shops`**, reuse vendor+dish shelf for food |
| 35 | `images (6).jpeg` | Live Order Tracking — `PREPARING` + tracking ads | `c-22` | **Improve** (OSM map, prep timer, zero ads) |
| 36 | `images (7).jpeg` | Live Order Tracking — `Rider is making a stop >` | `c-22` | **Keep** batch transparency pill (`File 11/12`) |
| 37 | `unnamed (1).webp` | Promo Card: Grocery Stores | — | **Drop** (`D-01`) |
| 38 | `unnamed (2).webp` | Promo Card: `ASAP (15min)` | `c-20` | **Keep on-demand ASAP** (no future scheduling v1) |
| 39 | `unnamed (3).webp` | Promo Card: `Pick-up and Save` | `c-09` | **Keep** core pickup value prop |
| 40 | `unnamed (4).webp` | Promo Card: `Track and chat with your rider` | `c-22,24` | **Keep** (`15–25 min · ~10:15` dual ETA display) |
| 41 | `unnamed.webp` | Promo Card: `Discover Restaurants / Meal for one` | `c-08` | **Keep** `Budget Bites` / single-meal filter |

### 4.2 `CUSTOMER_WEB_APP` (24 / 24 Inspected — Details in [`01c`](./01c-customer-web-screens-01-24.md))

| # | File | Screen Identified | Undal Target | Verdict |
|---:|---|---|---|---|
| W01 | `Screenshot_20261008-121752.png` | `undal-cdo6` Web Menu: `Snacks (8)` + Empty Right Cart | `w-02` | **Keep** 2-col menu + sticky cart + SSG HTML |
| W02 | `Screenshot_20261008-121759.png` | `undal-cdo6` Menu: `Snacks` end + `Dessert` (dup item!) | `w-02,p-17` | **Improve** (duplicate menu guard `AP-9`) |
| W03 | `Screenshot_20261008-121808.png` | `undal-cdo6` Menu: `Dessert` end + `Pasta & Noodles (3)` | `w-02` | **Improve** (2-line title clamp for long BN/EN dishes) |
| W04 | `Screenshot_20261008-121815.png` | `undal-cdo6` Menu: `Bhorta & Bhaji (10)` Part 1 | `w-02` | **Keep** 1-click inline `+` for fast multi-item baskets |
| W05 | `Screenshot_20261008-121823.png` | `undal-cdo6` Menu: `Bhorta & Bhaji` Part 2 + `Curry` | `w-02` | **Keep** fixed `1:1` thumb box (`CLS = 0`) |
| W06 | `Screenshot_20261008-121829.png` | `undal-cdo6` Menu: `Curry (8)` (`Shutki`, `Dal`, `Veg`) | `w-02` | **Improve** (auto-suggest `is_veg` tag in Studio) |
| W07 | `Screenshot_20261008-121837.png` | `undal-cdo6` Menu: `Fish (3)` + `Set Meal` start | `w-02` | **Keep** clean 2-col odd-count grid alignment |
| W08 | `Screenshot_20261008-121843.png` | `undal-cdo6` Menu: `Set Meal (13)` (`Chhatrabash`, `🌿`) | `w-02` | **Keep** veg leaf `🌿` + structured combo items |
| W09 | `Screenshot_20261008-121851.png` | `undal-cdo6` Menu: `Set Meal` no-photo card + `Rice` | `w-02` | **Keep** graceful no-photo card layout |
| W10 | `Screenshot_20261008-121856.png` | `undal-cdo6` Menu: `Rice (4)` + `Sides` + `>` tab arrow | `w-02` | **Keep** `<` / `>` scroll arrows on sticky tabs |
| W11 | `Screenshot_20261008-121908.png` | `undal-cdo6` Menu: `Sides (2)` + `Paratha (5)` (`🌶`) | `w-02` | **Keep** chilli spice indicator (`0..3`) |
| W12 | `Screenshot_20261008-121916.png` | `undal-cdo6` Menu: `Special Combo (7)` + Category Desc | `w-02` | **Enrich DB** (`menu_categories.description_en/bn`) |
| W13 | `Screenshot_20261008-121921.png` | `undal-cdo6` Menu: `Special Combo (7)` bottom floor | `w-02` | **Keep** slot-by-slot bundle modal on `from Tk X` |
| W14 | `Screenshot_20261017-132753.png` | Web Home (`Delivery`, QR download card, Filters, Flash) | `w-01` | **Keep** left QR + Filters rail + clean `/r/{slug}` URLs |
| W15 | `Screenshot_20261017-132800.png` | Web `Pick-up` Home (searchable Cuisines filter, map bar) | `w-01` | **Improve** (`Ready ~15m · 520m` fix `AP-8`) |
| W16 | `Screenshot_20261017-132819.png` | Web Full-Screen Split-Pane Pick-up Map (`/pickup/map`) | `w-01` | **Keep** split sidebar + Leaflet OSM map |
| W17 | `Screenshot_20261017-132916.png` | Web `All restaurants` Grid Row 1 (3/3 `[Ad]` cards!) | `w-01` | **Fix via `D-12`** (organic `rank_v1` above fold) |
| W18 | `Screenshot_20261017-132921.png` | Web `All restaurants` Grid Row 2–3 (Sylhet icons) | `w-01` | **Keep** 1→2→3→4 col fluid grid (`D-15`) |
| W19 | `Screenshot_20261017-132936.png` | Store Page with Active Right Cart + Cross-Sell Rail | `w-02,08` | **Improve** (show fee lines before checkout `AP-7`) |
| W20 | `Screenshot_20261017-132951.png` | Web Checkout Top (`Total Tk 0` bug + top-added `VAT`!) | `w-09` | **Fix `AP-7` + `D-08`** (VAT-incl., intact COD total) |
| W21 | `Screenshot_20261017-132956.png` | Web Checkout Lower (`Personal details` phone + Tip) | `w-09` | **Keep** inline BD phone validation + cash tip |
| W22 | `Screenshot_20261017-133001.png` | Web `All carts` Right Slide-Over Drawer | `w-08` | **Improve** (full cart editor inside drawer) |
| W23 | `Screenshot_20261017-133030.png` | User Dropdown Menu + `Farhanar Rannaghor [Homechef]` | `w-01` | **Keep** dropdown + proud `Home Kitchen` trust badge |
| W24 | `Screenshot_20261017-133052.png` | Web `/account` Profile + `English / বাংলা` Switcher | `w-13` | **Keep** 1-click top-bar EN/বাংলা switcher |
