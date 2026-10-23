# 25 · Brand & Design System — Logo, Colour, Type, Sound

## 25.1 Logo (created for this guide — `brand/` folder, production SVGs)

**Concept — “The Undal Bowl-Pin”:** a generous serving bowl whose rim curve forms a bold **U** (Undal), topped by a rising
**steam-flame** (hot, fresh, home-cooked) whose negative space is a **location pin drop** (delivery precision). One mark tells
the whole story: *hot food, from a real kitchen, to your exact door.* Wordmark: lowercase rounded “undal” (friendly, ownable,
pronounced *un-daal*) with the bowl dotting the composition as app icon. App-icon variant: mark alone on Deep Green squircle.
Files: `brand/undal-logo-primary.svg` (mark+wordmark), `brand/undal-icon.svg` (app icon), `brand/undal-mono.svg`
(single-colour for print/receipts). Clear-space = height of flame; min size 24 px; never recolour flame outside palette;
never place on photographic clutter without cream plate.

## 25.2 Palette (deliberately NOT foodpanda-pink — ownable, appetising, Bangladeshi-rooted)

| Token | Hex | Use |
|---|---|---|
| `undal.green` (primary) | `#007A4D` | Brand, primary CTAs, open/live states — deep flag-green, trust + freshness |
| `undal.greenDeep` | `#04402A` | Headers, icon background, text-on-cream accents |
| `undal.flame` (accent) | `#FF6B2C` | Flame mark, offers/Flash Box, urgency, rider route |
| `undal.sun` | `#FFC53D` | Ratings stars, badges, highlights (never body text) |
| `undal.ink` | `#14201B` | Primary text |
| `undal.slate` | `#5A6B63` | Secondary text |
| `undal.cream` | `#FFF9F2` | App/web background warmth (not sterile white) |
| `undal.card` | `#FFFFFF` | Cards on cream |
| semantic | success `#12805C` · warning `#B7791F` · danger `#C92A2A` · info `#1971C2` | Always paired with icon+text (file `02` law 4) |

Contrast-verified pairs (green/white 5.0:1 ✓, ink/cream 14:1 ✓, flame used on ink/greenDeep or large text only).
Dark mode: `ink`-based surfaces, green→`#2FBF8F` lifted, cream→`#0E1512` (tokens defined in `undal_core` + CSS vars; both modes ship v1).

## 25.3 Typography (free Google Fonts, superb Bengali)

Display/wordmark-adjacent: **Baloo Da 2** (Latin+Bengali, warm, food-friendly) — headlines, prices hero, numbers.
UI/body: **Hind Siliguri** (Latin+Bengali workhorse) — everything else. Mono (codes/TrxID): system mono.
Scale (fluid): 12/14/16/18/22/28/36 with 1.5 line-height body; Bangla +4% line-height. Numerals: tabular for money/timers;
locale bn renders Bengali digits for display (inputs accept both).

## 25.4 Motion, illustration, photography

Motion: 150–250 ms ease-out micro (add-to-cart bounce, status check draws), skeleton shimmers in cream tones,
respect `prefers-reduced-motion`. Illustration: flat two-tone (green+flame) spot art (empty states — rider, bowl, map pin) —
builder commissions as inline SVG set (no stock-photo people). Food photography guidelines for vendors (in-app guide:
daylight, 45° angle, plain background) + auto quality hints (brightness/blur check at upload).

## 25.5 Sound identity (`sounds/` folder)

- **`undal_order_alert_loop.wav`** (included, generated): loud, normalised (−1 dBFS), seamless two-tone urgency loop
  (880→1320 Hz siren-sweep pattern with percussive ticks), designed to cut through kitchen noise — vendor + rider order alarm.
- Specs for builder-produced siblings (same synth recipe, documented in `sounds/README.md`): pickup-ready chime (short triad),
  cash-gate tick-tick (1 kHz ticks ×4 pattern), success blip, chat pop. All ≤12 s loops/chimes, shipped in `res/raw`,
  played per file `07` pipeline. Volume law: alarm stream forced max; all other sounds use notification stream politely.
- Voice: TTS prompts (rider) in Bangla first (“নতুন অর্ডার এসেছে”) + English setting.

## 25.6 Component/token delivery

Builder materialises tokens ONCE in `packages/undal_core` (Dart) and `packages/shared_ts` (CSS vars/TS) — colours, type,
spacing (4-pt), radii (12 card / 16 sheet / full pill), shadows, breakpoints (D-15). No app hardcodes a hex. Storybook-style
gallery page (web) + widgetbook (Flutter dev-only) prove every component in both themes/locales/densities.
