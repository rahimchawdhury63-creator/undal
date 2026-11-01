<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 03 — Brand and Design System

> Every value in this document is a **token**. Tokens are generated once, from
> `design/tokens/undal.tokens.json`, into four targets: Compose `Theme.kt`, CSS custom properties,
> a Tailwind preset, and Android XML resources. **No hex value, spacing number, radius or duration
> may be typed literally in any component file.** CI job `token-purity` fails the build on a literal.

---

## 1. The token pipeline

```
design/tokens/undal.tokens.json          ← single source of truth, W3C Design Tokens format
            │
            │  pnpm --filter @undal/tokens build   (runs in GitHub Actions only)
            ▼
   ┌────────┴─────────┬──────────────────┬───────────────────┐
   ▼                  ▼                  ▼                   ▼
packages/tokens/   packages/tokens/   android/core-design/  android/core-design/
  dist/tokens.css    dist/tailwind.js   .../UndalColors.kt    res/values/colors.xml
  (CSS vars)         (preset)           UndalType.kt          res/values/dimens.xml
                                        UndalShape.kt         res/values-night/colors.xml
                                        UndalMotion.kt
```

The generator is `packages/tokens/build.mjs`, 180 lines, no dependencies beyond `style-dictionary`.
It runs in the `tokens` job of `.github/workflows/ci.yml` and the job **fails if the generated output
differs from what is committed** — so a token change that was not regenerated cannot merge.

---

## 2. Colour

### 2.1 Brand constants

Derived in [`02 §2.3`](02-reference-analysis.md) from the supplied logos.

| Token | Hex | Use |
| --- | --- | --- |
| `color.brand.forest` | `#0F4435` | **The Undal constant.** Logos, headers, partner and rider identity, invoice letterhead. |
| `color.brand.forest.deep` | `#0A2F24` | Pressed states, dark-theme surfaces, map base tint |
| `color.brand.forest.soft` | `#1C6B53` | Hover, secondary fills |
| `color.brand.ink` | `#0C1F1C` | Customer mark ink; the darkest text colour |
| `color.brand.crimson` | `#A6192E` | The crimson logo variant; error-adjacent brand moments only |

### 2.2 Functional colours

The brief asks for "the main theme color will be Uber eats and Foodpanda". Both are adopted, but
**as functions, not as decoration**, so they never fight the forest-green identity:

| Token | Hex | Meaning — used for nothing else |
| --- | --- | --- |
| `color.action.primary` | `#D70F64` | **Every primary call to action.** Add to cart, Place order, Accept, Confirm, Save. |
| `color.action.primary.press` | `#B10B52` | Pressed |
| `color.action.primary.soft` | `#FDE7F0` | Tinted background behind a primary-coloured element |
| `color.live` | `#06C167` | **Live, moving, in-progress, succeeded.** Rider marker, online pill, delivered tick, open-now dot. |
| `color.live.press` | `#04A055` | Pressed |
| `color.live.soft` | `#E2F8EC` | Tinted background |

> **The two-colour rule.** On any single screen, magenta appears **at most once as a filled
> element** (the single most important action) and green appears only where something is genuinely
> live. A screen with three magenta buttons is a design bug and is caught in review.

### 2.3 Semantic colours

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `color.bg.canvas` | `#FAFAF8` | `#0B100E` | The page behind everything |
| `color.bg.surface` | `#FFFFFF` | `#141A17` | Cards, sheets, dialogs |
| `color.bg.surface.raised` | `#FFFFFF` | `#1B2320` | Elements above a card |
| `color.bg.panel` | `#F4F4F2` | `#101614` | Section grouping panels (ref B) |
| `color.bg.scrim` | `rgba(12,31,28,0.56)` | `rgba(0,0,0,0.68)` | Behind modals |
| `color.bg.inverse` | `#0C1F1C` | `#FAFAF8` | The floating cart capsule |
| `color.text.primary` | `#0C1F1C` | `#F2F5F3` | Body and headings |
| `color.text.secondary` | `#4A5A55` | `#A8B5B0` | Supporting copy |
| `color.text.tertiary` | `#7A8884` | `#75837E` | Metadata, timestamps |
| `color.text.disabled` | `#B4BDBA` | `#4A5450` | Disabled |
| `color.text.on.action` | `#FFFFFF` | `#FFFFFF` | Text on magenta |
| `color.text.on.brand` | `#FFFFFF` | `#FFFFFF` | Text on forest |
| `color.border.hairline` | `#E8EAE8` | `#242D29` | 1 px dividers |
| `color.border.strong` | `#D3D8D6` | `#33403B` | Input outlines |
| `color.border.focus` | `#D70F64` | `#FF4D8F` | Focus ring, 2 px + 2 px offset |

### 2.4 Status colours

| Token | Hex | Soft background | Used on |
| --- | --- | --- | --- |
| `color.status.success` | `#06C167` | `#E2F8EC` | Delivered, verified, paid, approved |
| `color.status.warning` | `#F2A300` | `#FFF5E0` | Late, pending review, low stock, busy mode |
| `color.status.danger` | `#E01B2E` | `#FDE8EA` | Cancelled, rejected, failed, overdue cash |
| `color.status.info` | `#1E6FD9` | `#E7F0FD` | Informational, system notices |
| `color.status.neutral` | `#7A8884` | `#F1F3F2` | Draft, archived, closed |

### 2.5 Order-state colours

Each state in [`01 §6`](01-mission-and-non-negotiables.md) gets a colour used consistently on every
surface — the badge in the partner app, the chip in the admin tower, the timeline node in the
customer app, and the marker ring on the command map all agree.

| State | Token | Hex |
| --- | --- | --- |
| `PLACED` | `color.order.placed` | `#D70F64` |
| `ACCEPTED` | `color.order.accepted` | `#7A3FD9` |
| `RIDER_SEARCH` | `color.order.search` | `#F2A300` |
| `RIDER_ASSIGNED` | `color.order.assigned` | `#1E6FD9` |
| `PICKED_UP` | `color.order.picked` | `#0DA6B8` |
| `ARRIVED` | `color.order.arrived` | `#17A672` |
| `DELIVERED` | `color.order.delivered` | `#06C167` |
| `SETTLED` | `color.order.settled` | `#0F4435` |
| `CANCELLED_*` | `color.order.cancelled` | `#E01B2E` |
| `DISPUTED` | `color.order.disputed` | `#A6192E` |

### 2.6 Vehicle colours

| Vehicle | Token | Hex | Marker |
| --- | --- | --- | --- |
| Motorbike | `color.vehicle.motorbike` | `#D70F64` | Scooter SVG, magenta body |
| Bicycle | `color.vehicle.bicycle` | `#06C167` | Bicycle SVG, green frame |

### 2.7 Data-visualisation ramp

Seven hues, colour-blind safe (checked against deuteranopia, protanopia and tritanopia simulations in
the `a11y` CI job), used for every chart in the admin panel.

`#0F4435` `#17A672` `#06C167` `#F2A300` `#D70F64` `#7A3FD9` `#1E6FD9`

Sequential ramp for the demand heatmap, 9 stops:
`#E2F8EC` `#B8EDD1` `#89E0B4` `#5CD197` `#2FBE7C` `#17A672` `#0F8A5E` `#0B6B49` `#0F4435`

### 2.8 Contrast

Every foreground/background pair in the token set is verified at build time. `packages/tokens/
contrast.test.mjs` asserts:

- Body text ≥ **4.5:1**
- Large text (≥ 24 px or ≥ 18.66 px bold) ≥ **3:1**
- Non-text UI (borders, icons, focus rings) ≥ **3:1**
- Both themes, all 283 screens

A token change that breaks a pair fails CI. There is no override.

### 2.9 Dark theme

Dark is **not** an inversion. It is a separate, hand-tuned set. Rules:

1. Surfaces get **lighter** as they get closer to the user (`#0B100E` canvas → `#141A17` card →
   `#1B2320` raised), the opposite of light theme where elevation is expressed by shadow.
2. Shadows are replaced by a 1 px `rgba(255,255,255,0.06)` top-edge highlight.
3. Magenta lifts to `#FF4D8F` at ≤ 14 px text sizes to hold contrast.
4. Food photography is **never** dimmed. The image is the product.
5. Maps switch to a dark OSM raster style with the forest tint at 0.18 opacity.

---

## 3. Typography

### 3.1 Families

| Role | Family | Why | Licence |
| --- | --- | --- | --- |
| Latin display and UI | **Poppins** | Matches the logo wordmark's geometry exactly | OFL |
| Bangla | **Hind Siliguri** | The best-matching free Bangla face: geometric, open counters, pairs with Poppins at the same optical size | OFL |
| Numerals in money and metrics | **Poppins** with `font-feature-settings: "tnum"` | Tabular figures so columns align and rolling digits do not jitter | OFL |
| Monospace (admin, logs, IDs) | **JetBrains Mono** | Unambiguous `0`/`O`, `1`/`l` — matters for transaction IDs | OFL |

Fonts are **self-hosted**, subset per language, preloaded with `font-display: swap`, and bundled as
`.ttf` in the Android apps. No Google Fonts CDN request is made — it is a third-party dependency, a
privacy leak, and a point of failure.

**Optical matching:** Hind Siliguri's x-height is 7% smaller than Poppins at the same point size, so
the Bangla locale applies a `1.07×` size multiplier and a `-0.02em` line-height correction. The
multiplier lives in `type.bn.opticalScale` and is applied automatically by `UndalText`.

### 3.2 The type ramp

Fluid between the `xs` and `2xl` breakpoints via `clamp()` on web; stepped at three breakpoints on
Android.

| Token | Size (min → max) | Line height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| `type.display.xl` | 34 → 56 px | 1.08 | 700 | −2.0% | Marketing hero, splash |
| `type.display.lg` | 28 → 40 px | 1.12 | 700 | −1.6% | Page hero, empty-state headline |
| `type.display.md` | 24 → 32 px | 1.16 | 700 | −1.2% | Section hero (ref B's centred section headers) |
| `type.heading.lg` | 20 → 24 px | 1.25 | 650 | −0.8% | Screen title |
| `type.heading.md` | 18 → 20 px | 1.30 | 600 | −0.5% | Card title, vendor name |
| `type.heading.sm` | 16 → 17 px | 1.35 | 600 | −0.3% | Dish name, list header |
| `type.body.lg` | 16 px | 1.50 | 400 | 0 | Primary body |
| `type.body.md` | 14 px | 1.50 | 400 | 0 | Default UI text |
| `type.body.sm` | 13 px | 1.45 | 400 | 0 | Supporting |
| `type.label.lg` | 15 px | 1.20 | 600 | 0 | Button text |
| `type.label.md` | 13 px | 1.20 | 600 | +0.5% | Chip, tab, badge |
| `type.label.sm` | 11 px | 1.20 | 600 | +1.5% | Overline, tiny badge |
| `type.caption` | 12 px | 1.40 | 400 | 0 | Timestamp, metadata, helper |
| `type.money.xl` | 28 → 36 px | 1.10 | 700 | −1.0% | Cart total, payout headline |
| `type.money.lg` | 20 px | 1.20 | 700 | −0.5% | Order total |
| `type.money.md` | 16 px | 1.20 | 600 | 0 | Line item |
| `type.mono.md` | 13 px | 1.45 | 400 | 0 | IDs, TrxID, logs |

### 3.3 Typographic rules

1. **Never more than three sizes on one screen**, excluding money and captions.
2. **Money always uses a money token**, never a body token. This guarantees tabular figures.
3. **The ৳ sign** is set at 0.72 em, raised 0.08 em, with 0.06 em of space after it. A dedicated
   `UndalMoney` component owns this so it is impossible to get wrong.
4. **Bangla never uses weights below 400.** Hind Siliguri's Light is unreadable at UI sizes.
5. **Line length** is capped at 72 characters for body copy via `max-inline-size: 64ch`.
6. **Text never truncates without an affordance.** Two-line clamp plus a `…` is fine; a hard cut is
   not. Vendor names get a marquee on the storefront header if they overflow at `xs`.

---

## 4. Spacing

A **4 px base grid**. Every margin, padding and gap is a multiple.

| Token | px | Typical use |
| --- | --- | --- |
| `space.0` | 0 | — |
| `space.1` | 4 | Icon-to-label inside a chip |
| `space.2` | 8 | Tight stack, badge padding |
| `space.3` | 12 | Chip padding, list row inner gap |
| `space.4` | 16 | **Default.** Card padding, screen gutter at `xs` |
| `space.5` | 20 | Card padding at `md`+ |
| `space.6` | 24 | Section gap, screen gutter at `md`+ |
| `space.8` | 32 | Major section gap |
| `space.10` | 40 | Hero padding |
| `space.12` | 48 | Page section rhythm |
| `space.16` | 64 | Marketing section rhythm |
| `space.20` | 80 | Full-bleed section |
| `space.24` | 96 | Hero vertical |

**Screen gutter** is responsive: `16 px` below `sm`, `20 px` at `sm`, `24 px` at `md`, `32 px` at
`lg`, then centred with a `max-inline-size` of `1280 px` for app-like pages and `1140 px` for
reading pages.

**Safe areas** are always respected: `env(safe-area-inset-*)` on web, `WindowInsets` on Android. The
floating cart capsule sits `space.4` above the bottom inset, never on top of the gesture bar.

---

## 5. Radius

| Token | px | Use |
| --- | --- | --- |
| `radius.xs` | 6 | Tiny badge, tag |
| `radius.sm` | 10 | Input, small button |
| `radius.md` | 14 | Button, chip |
| `radius.lg` | 20 | **Card.** The default. |
| `radius.xl` | 28 | Section panel, bottom sheet, large card (ref B) |
| `radius.2xl` | 36 | Modal, hero card |
| `radius.full` | 9999 | Pill, capsule, avatar, stepper |

Radius **does not scale with breakpoint**. A 20 px card radius at 320 px and at 2560 px is correct;
scaling it makes large screens look like inflated phones.

---

## 6. Elevation

Shadows are two-layer: a tight contact shadow and a wide ambient shadow. Single-layer shadows look
cheap and this is the detail that separates the references from ordinary work.

| Token | Value |
| --- | --- |
| `shadow.sm` | `0 1px 2px rgba(12,31,28,0.05), 0 1px 1px rgba(12,31,28,0.04)` |
| `shadow.md` | `0 2px 6px rgba(12,31,28,0.06), 0 6px 16px rgba(12,31,28,0.06)` |
| `shadow.lg` | `0 4px 10px rgba(12,31,28,0.07), 0 14px 32px rgba(12,31,28,0.08)` |
| `shadow.xl` | `0 8px 18px rgba(12,31,28,0.08), 0 28px 60px rgba(12,31,28,0.12)` |
| `shadow.capsule` | `0 6px 14px rgba(12,31,28,0.18), 0 18px 40px rgba(12,31,28,0.22)` |
| `shadow.focus` | `0 0 0 2px #FAFAF8, 0 0 0 4px #D70F64` |

On Android, `shadow.md` maps to `Modifier.shadow(6.dp, shape, ambientColor, spotColor)` with the
ambient and spot colours set from the token rather than the platform default black, which is what
makes Compose shadows look correct rather than muddy.

Dark theme replaces every shadow with the top-edge highlight described in §2.9.

---

## 7. Iconography

- **Source**: a bespoke set, 2 px stroke, 24 × 24 grid, round caps, round joins, drawn on a 2 px
  inner margin so icons optically align with text.
- **Count**: 340 icons across five surfaces, plus **112 cuisine-category icons** (two-colour: forest
  stroke + a food-appropriate fill) and **28 map markers**.
- **Format**: SVG source → `VectorDrawable` for Android via the tokens pipeline; an SVG sprite sheet
  for web, inlined for the 18 above-the-fold icons.
- **Sizes**: `16` (inline with `body.sm`), `20` (inline with `body.md`), `24` (**default**), `32`
  (feature), `48` (empty state), `64` (hero empty state).
- **Rule**: an icon never appears without an accessible label, and an icon-only button always has a
  tooltip on web and a `contentDescription` on Android.

### 7.1 The vehicle and actor marker set

Hand-drawn SVGs for the command map ([`22`](22-admin-super-map.md)), each with a distinct silhouette
readable at 24 px:

| Marker | Silhouette | Fill | States |
| --- | --- | --- | --- |
| Motorbike rider | Three-quarter scooter with a delivery box | `color.vehicle.motorbike` | idle, en-route-to-vendor, carrying, batched (shows `2`/`3`), stale |
| Bicycle rider | Side-profile bicycle with a box | `color.vehicle.bicycle` | same five |
| Restaurant | Rounded building with a pitched awning | `color.brand.forest` | open, busy, paused, closed, unreachable |
| Home kitchen | House silhouette with a steam wisp | `color.brand.forest.soft` | same five |
| Grocery | Shop front with a basket | `color.brand.forest` | same five |
| Customer | Pin with a person glyph | `color.text.secondary` | waiting, delivered |
| Live order | A pulsing ring that wraps whichever marker owns it | order-state colour | all 10 states |
| Cluster | A filled circle with a count | forest, scaled by count | — |

Each rider marker **rotates to the bearing** of travel and carries a small heading triangle. Each
has a 2 px white outer stroke so it stays legible over any map tile.

---

## 8. The component catalogue

Every component is implemented **once** in `packages/ui` (web) and `android/core-design` (Compose),
with the same name, the same props, and the same visual result. A component that exists on only one
platform is a bug unless it is in the platform-only list at the end.

### 8.1 Primitives

| Component | Variants | Notes |
| --- | --- | --- |
| `UndalButton` | `primary`, `secondary`, `tertiary`, `ghost`, `danger`, `brand` | Sizes `sm`/`md`/`lg`/`xl`. Loading state swaps the label for a 3-dot pulse without changing width. Min height 48 dp. |
| `UndalIconButton` | `filled`, `tonal`, `ghost` | 48 dp hit area even at 32 dp visual size |
| `UndalChip` | `filter`, `choice`, `input`, `status` | Filter chips animate their fill from the leading edge |
| `UndalInput` | `underline`, `outlined`, `search` | Floating label, helper text, error text, character counter, leading/trailing slots |
| `UndalTextArea` | — | Auto-grow to 6 lines |
| `UndalSelect` | — | Opens a bottom sheet on mobile, a popover above `md` |
| `UndalSwitch` | — | 52 × 32, thumb springs |
| `UndalCheckbox` / `UndalRadio` | — | Tick draws on with a 180 ms path animation |
| `UndalStepper` | `inline`, `pill`, `morph` | **The `+` → `− n +` morph from ref B.** Rolling digits. |
| `UndalAvatar` | `xs`…`xl` | Initials fallback with a deterministic colour from the name hash |
| `UndalBadge` | `dot`, `count`, `label` | Count caps at `99+` |
| `UndalSkeleton` | `text`, `rect`, `circle`, `card` | Shimmer at 1.4 s, disabled under reduce-motion |
| `UndalDivider` | `hairline`, `section` | |
| `UndalTooltip` | — | Web only above `md`; long-press sheet on touch |

### 8.2 Layout and containers

| Component | Notes |
| --- | --- |
| `UndalCard` | `radius.lg`, `shadow.md`, press-scales to 0.985 |
| `UndalPanel` | The `#F4F4F2` section grouping panel at `radius.xl` |
| `UndalSheet` | Bottom sheet with 3 detents (peek/half/full), drag handle, scrim, and gesture-aware dismissal |
| `UndalModal` | Centred above `md`, full-screen sheet below |
| `UndalDrawer` | Left on web, right for the map inspector |
| `UndalTabs` | `underline` (ref A) and `segmented` variants; the indicator slides with a spring |
| `UndalAccordion` | Height animates with `animateContentSize` |
| `UndalCollapsingHeader` | **Continuous scroll-driven condensation** (ref B) |
| `UndalStickyTabs` | Two-way bound to scroll position |
| `UndalCarousel` | Snap, auto-advance with pause-on-touch, dot indicator, respects reduce-motion |
| `UndalEmptyState` | Illustration, headline, body, up to two actions. 44 instances — see [`33`](33-empty-state-doctrine.md). |
| `UndalErrorState` | Illustration, cause in plain language, retry, and a "copy diagnostic" affordance |

### 8.3 Domain components

| Component | Where | Notes |
| --- | --- | --- |
| `UndalCartCapsule` | Customer app + web | The floating black capsule. Item count, rolling total, spring entry. |
| `UndalVendorCard` | Customer, web, admin | Cover, logo chip, name, `⭐ · 🕒 · 🛵 · 📍`, dietary badges, state ribbon |
| `UndalDishCard` | Customer, web | Overflowing cut-out image, name, price, `+` morph stepper, heart |
| `UndalOrderTimeline` | Customer, partner, admin | Vertical below `md`, horizontal above; animated node fill |
| `UndalOrderStateBadge` | Everywhere | Colour from §2.5 |
| `UndalMoney` | Everywhere | Owns ৳ placement, tabular figures, Bengali numerals in `bn` |
| `UndalRatingStars` | Everywhere | Half-star support, `readonly` and `input` modes |
| `UndalPrepTimeDial` | Partner | The `−` / `+` dial, 5-min steps, 5–200 min, with the suggested value marked |
| `UndalOfferCard` | Rider | Countdown ring, full payout breakdown, accept/reject |
| `UndalCountdownRing` | Rider, partner | SVG stroke-dashoffset, 60 fps, colour shifts amber → red |
| `UndalQrScanner` | Rider | CameraX + ML Kit barcode, torch toggle, haptic on detect |
| `UndalSelfieCapture` | Rider | Front camera, face-bounds guide, liveness prompt |
| `UndalMapCanvas` | All | MapLibre wrapper with the Undal style, attribution, and marker layer API |
| `UndalRoutePolyline` | Customer, rider, admin | Animated draw-on, traffic-tinted segments |
| `UndalZoneEditor` | Admin | Polygon draw, vertex drag, snap, self-intersection guard |
| `UndalDataTable` | Admin | Virtualised, sortable, filterable, column-resizable, CSV export, 10 k rows at 60 fps |
| `UndalKpiTile` | Admin | Value, delta, sparkline, drill-through |
| `UndalChart` | Admin | Line, bar, area, heatmap, funnel — built on a 400-line SVG renderer, no chart library |
| `UndalAuditEntry` | Admin | Actor, action, delta diff, IP, timestamp |
| `UndalInvoicePreview` | Admin, partner, rider | Renders the same layout as the PDF |

### 8.4 Platform-only components

| Component | Platform | Why |
| --- | --- | --- |
| `UndalAlarmTakeover` | Android (partner, rider) | Full-screen-intent surface; has no web equivalent |
| `UndalForegroundServiceChip` | Android | The persistent shift/alarm notification |
| `UndalCashLockScreen` | Android (rider) | Un-dismissible; see [`25`](25-rider-cash-settlement.md) |
| `UndalSeoHead` | Web | Dynamic head management for prerender |
| `UndalCommandMap` | Web (admin) | The full-screen map; see [`22`](22-admin-super-map.md) |

---

## 9. Responsive — the 50 breakpoints

Non-negotiable 31 requires zero layout breakage from **200 px to 3840 px**. The platform does not
have 50 *named* breakpoints — it has **9 named breakpoints and 50 tested widths**. The named set
drives the code; the tested set drives CI.

### 9.1 Named breakpoints

| Name | Min width | Typical device | Layout |
| --- | --- | --- | --- |
| `xxs` | 200 px | Watch browser, split-screen sliver, 25% browser window | Single column, icons-only nav, no descriptors, money abbreviated |
| `xs` | 320 px | Small phone (iPhone SE, Nokia) | Single column, 16 px gutter |
| `sm` | 384 px | Standard phone | Single column, 16 px gutter, 2-up dish grid |
| `md` | 600 px | Large phone landscape, small tablet | 2-up vendor grid, 20 px gutter |
| `lg` | 840 px | Tablet portrait | 2-up vendors, persistent filter rail |
| `xl` | 1024 px | Tablet landscape, small laptop | 3-up vendors, sidebar nav |
| `2xl` | 1280 px | Laptop | 3-up, max-width content |
| `3xl` | 1600 px | Desktop | 4-up, admin 3-pane |
| `4xl` | 1920 px+ | Large desktop, command map | 4-up, admin 4-pane, map at full bleed |

### 9.2 The 50 tested widths

CI job `responsive-matrix` screenshots every page at each of these widths, at both `1×` and `2×`
density, in both themes, in both languages, and diffs against the golden set:

```
200  240  280  300  320  344  360  375  384  390
393  400  412  414  428  440  480  540  568  600
640  667  720  768  800  834  896  900  960 1024
1080 1112 1152 1180 1200 1280 1366 1440 1512 1536
1600 1680 1728 1792 1920 2048 2304 2560 3200 3840
```

Heights tested: `480`, `640`, `740`, `844`, `900`, `1080`, `1440`.

### 9.3 Responsive rules

1. **Container queries, not viewport queries**, for every component. A vendor card inside a 320 px
   sidebar on a 1920 px screen must lay out like a 320 px card. Web uses `@container`; Compose uses
   `BoxWithConstraints`.
2. **No fixed pixel widths** on anything that holds text. Checked by the `no-fixed-width` lint.
3. **Text never overflows.** At `xxs`, long vendor names clamp to 2 lines then marquee; money
   abbreviates (`৳1.2k`); metadata rows drop to the two highest-priority items.
4. **Touch targets stay 48 dp** at every width, even at 200 px, which means at `xxs` some rows become
   two rows rather than shrinking.
5. **Orientation is handled**, not ignored. Landscape phone is a tested configuration, and the
   partner app's order console has a dedicated landscape layout because tablets sit on counters in
   landscape.
6. **Foldables**: `WindowSizeClass` plus `FoldingFeature` so the partner app can put the order list
   on one half and the detail on the other.
7. **Zoom to 200%** must not break any web page (WCAG 1.4.4). Tested at 1280 px × 200%.

---

## 10. Imagery

| Context | Aspect | Delivered size | Format |
| --- | --- | --- | --- |
| Vendor cover | 16:9 | 800 × 450, 1600 × 900 @2× | WebP, JPEG fallback |
| Vendor logo | 1:1 | 200 × 200, 400 × 400 @2× | WebP |
| Dish card | 1:1 | 320 × 320, 640 × 640 @2× | WebP, PNG when transparent |
| Dish hero | 4:3 | 900 × 675 | WebP |
| Category icon | 1:1 | vector | SVG |
| KYC document | original | ≤ 2000 px long edge | JPEG, Cloudinary private |
| Selfie | 3:4 | 600 × 800 | JPEG |

Rules:

- **Every image has an explicit intrinsic size** so nothing shifts (CLS < 0.02).
- **`loading="lazy"` below the fold**, `fetchpriority="high"` on the single LCP image.
- **A blurhash placeholder** is stored with every vendor and dish image and rendered while loading —
  20 bytes, no extra request, and it looks far better than a grey rectangle.
- **No image is ever required.** Every image slot has a designed fallback: a generated gradient from
  the vendor's name hash with the vendor's initials, in brand colours. A vendor who uploads nothing
  still looks intentional.

---

## 11. Writing

Voice: **warm, direct, never cute about money or time.**

| Do | Do not |
| --- | --- |
| "No vendors are open near you yet." | "Oops! Nothing here 😢" |
| "Your rider is 4 minutes away." | "Hang tight, deliciousness incoming!" |
| "We could not reach the restaurant, so this order was cancelled. You have not been charged." | "Order failed." |
| "৳25 small-order fee applies to orders of ৳100 or more. ৳5 goes to your rider." | "Service fee" |
| "Scan the QR code on the restaurant's screen." | "Scan to proceed" |

Rules:
- **Sentence case** everywhere. No `ALL CAPS` except a 3-character status chip.
- **Numerals as digits**, always. "4 minutes", not "four minutes".
- **Every error says what happened, why, and what to do next.** Three clauses, maximum.
- **Never blame the user.** "That code has expired", not "You entered an invalid code".
- **Bangla is written, not machine-translated.** See [`32 §4`](32-localization-and-currency.md).

---

## 12. Brand asset tokens

| Token | Value |
| --- | --- |
| `mark.ring-weight.lg` | 2.6% of diameter (≥ 96 dp) |
| `mark.ring-weight.sm` | 4.5% of diameter (< 96 dp) |
| `mark.clearspace` | 0.18 × diameter on all sides |
| `mark.min-size.digital` | 24 dp (mark only, no wordmark) |
| `mark.min-size.wordmark` | 88 dp |
| `splash.bg.customer` | `#FAFAF8` light / `#0B100E` dark |
| `splash.bg.partner` | `#0F4435` |
| `splash.bg.rider` | `#0F4435` |
| `app.accent.customer` | `#D70F64` |
| `app.accent.partner` | `#0F4435` |
| `app.accent.rider` | `#06C167` |

Each app keeps the shared design system but leans on its own accent, so the three apps are
unmistakably siblings and never confused with each other on a crowded home screen.

### 12.1 Logo misuse — never

Do not: recolour outside the token set · stretch or skew · rotate · add a drop shadow · place on a
busy photograph without the clearspace plate · remove the bindle · substitute the wordmark typeface ·
use the customer mark on the partner or rider app · outline the mark · animate the bird's limbs.

---

## 13. Accessibility

| Requirement | Standard | Enforcement |
| --- | --- | --- |
| Contrast | WCAG 2.2 AA | `a11y` CI job on every token pair and every screenshot |
| Touch target | ≥ 48 × 48 dp | Compose semantics test + axe rule |
| Focus visible | 2 px ring, 2 px offset, always | Keyboard-traversal test on every web page |
| Screen reader | Every element labelled; live regions for order-state changes | TalkBack test script for the 20 critical flows; axe-core on web |
| Reduce motion | Every animation has a reduced variant that changes opacity only | `prefers-reduced-motion` + `Settings.Global.ANIMATOR_DURATION_SCALE` |
| Text scaling | Up to 200% without loss of content | Android `fontScale` 2.0 test; web 200% zoom test |
| Colour independence | No information conveyed by colour alone — every state has an icon and a label | Design review |
| Language | `lang` attribute per element where mixed Bangla/Latin | Lint rule |

---

## 14. Reading on

Next: [`04-motion-and-interaction.md`](04-motion-and-interaction.md) — the spring constants and the
code for every animation named here.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
