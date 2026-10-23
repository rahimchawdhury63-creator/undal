# ADR-0005 · Empirical Schema & Workflow Enrichments from Full 172-Image Audit

- **Status:** Accepted (`Plan Response 2` — `2026-10-23`)
- **Authority:** Aligned 100% with `D-01..D-24` (`01-vision-scope-decisions.md`), `File 05`, `File 10`, `File 22`, `File 23`, and `Appendix B`.

## Context

Visual inspection of all **107 operator reference files** (`63 PARTNER_APP + 44 RIDER_APP`) alongside the **65 customer files** uncovered **five high-value street-level operational details** in real Bangladesh food delivery that prevent daily counter friction, doorstep COD delays, and unfair kitchen penalties without adding a single paid external dependency or violating any decision `D-01..D-24`:

1. **COD Doorstep Change Denomination (`RIDER_APP #R20`, `154059.png`):** Customers in Bangladesh frequently pay for `৳350–৳750` orders with a `৳500` or `৳1,000` note. Without advance notice, riders stand in stairwells hunting change.
2. **Kitchen High-Demand Prep Buffer Without Closing (`PARTNER_APP #55`, `155538.png`):** Busy kitchens need a 1-tap way to add `+10 / +15 / +20 min` to quoted prep times without shutting their storefront completely (`vendor_pauses`).
3. **Disambiguated Option Groups & Combo Category Metadata (`PARTNER_APP #32, #34`, `130618.png`, `130645.png`):** Without an `internal_label`, kitchens end up with 7 identical rows all titled `"Choose one of the following"`; combo categories also benefit from `category_type` (`regular | combo`) and optional `description_en/bn`.
4. **Anonymous 2-Tap Rider Pickup Feedback (`RIDER_APP #R01, #R16`, `153844.png`):** Allowing riders to flag `vendor_clicked_ready_early`, `poor_packaging`, `wrong_pin`, or `long_wait` right at pickup catches kitchens gaming the `Ready` button (`PARTNER_APP #39, #49–#53`) automatically.
5. **Monotonic `order_events` Sequence Law (`PARTNER_APP #42`, `190424.png`):** Rendering timeline stages strictly by `BIGINT GENERATED ALWAYS AS IDENTITY` (`order_events.id`) + server `clock_timestamp()` eliminates impossible inverted timelines (`Picked up 11:04` before `Arrived 11:14`).

## Decision

Fold these exact columns cleanly into the canonical **45 table groups** of `05-data-model-final.md` (zero extra bloat):

1. `orders.change_for_poisha bigint NULL CHECK (change_for_poisha IS NULL OR change_for_poisha >= cod_collect_poisha)` — optional customer-selected note denomination (`50000` or `100000` poisha) surfaced on Rider `r-14..r-18`.
2. `vendors.busy_mode_extra_minutes smallint NOT NULL DEFAULT 0 CHECK (busy_mode_extra_minutes IN (0, 10, 15, 20))` + `vendors.busy_mode_until timestamptz NULL` — automatically added to displayed customer ETA & `prep_minutes_committed` while `now() < busy_mode_until`.
3. `option_groups.internal_label text NOT NULL` + `menu_categories.category_type text NOT NULL DEFAULT 'regular' CHECK (category_type IN ('regular', 'combo'))` + `menu_categories.description_en text`, `menu_categories.description_bn text`.
4. `orders.pickup_feedback_rating smallint NULL CHECK (pickup_feedback_rating IN (-1, 1))` + `orders.pickup_feedback_tags text[] NOT NULL DEFAULT '{}'` — written by `POST /v1/orders/{id}/picked-up` (optional, non-blocking, strictly hidden per-order from vendor UI and shown only in aggregated form once `count >= 5` to protect rider anonymity!).
5. `order_events.id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` + trigger preventing `UPDATE/DELETE` + status transition matrix in `transition_order()` forbidding `DELIVERED -> CANCELLED`.

## Consequences

- **Zero free-tier cost increase:** Pure columns inside existing Postgres rows (`< 24 bytes/order`).
- **Zero breaking changes to `M-1..M-8` or `F-1..F-6`:** All golden money and fare formulas remain 100% identical to `Files 10–11` and `Appendix F`.
