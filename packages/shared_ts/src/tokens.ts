/**
 * @file packages/shared_ts/src/tokens.ts
 * @description Canonical UNDAL Brand & Design System tokens implementing Master Guide File 25
 * (`25-brand-design-system.md`) and Decision `D-15` (`240px -> 3840px` universal responsiveness).
 *
 * Constitutional invariants:
 * - Single source of truth shared with `tokens.css` and `packages/undal_core/.../undal_tokens.dart`.
 * - Zero competitor magenta/pink hexes; rooted in Bangladeshi Deep Green, Flame & Warm Cream.
 * - Every foreground/surface text pairing meets or exceeds WCAG 2.1 AA (`>= 4.5:1`).
 */

/** Hex colour literal format enforced across all Undal palettes. */
export type HexColor = `#${string}`;

/** Complete semantic & brand colour slot map shared by Light and Dark themes. */
export interface UndalColorScheme {
  readonly green: HexColor;
  readonly greenDeep: HexColor;
  readonly onGreen: HexColor;
  readonly flame: HexColor;
  readonly onFlame: HexColor;
  readonly sun: HexColor;
  readonly onSun: HexColor;
  readonly ink: HexColor;
  readonly slate: HexColor;
  readonly cream: HexColor;
  readonly surfaceSubtle: HexColor;
  readonly card: HexColor;
  readonly border: HexColor;
  readonly success: HexColor;
  readonly successSoft: HexColor;
  readonly warning: HexColor;
  readonly warningSoft: HexColor;
  readonly danger: HexColor;
  readonly dangerSoft: HexColor;
  readonly info: HexColor;
  readonly infoSoft: HexColor;
}

/** Canonical Light Mode palette (`File 25 §25.2`). */
export const UNDAL_LIGHT_COLORS: UndalColorScheme = {
  green: '#007A4D',
  greenDeep: '#04402A',
  onGreen: '#FFFFFF',
  flame: '#FF6B2C',
  onFlame: '#14201B',
  sun: '#FFC53D',
  onSun: '#14201B',
  ink: '#14201B',
  slate: '#5A6B63',
  cream: '#FFF9F2',
  surfaceSubtle: '#F5EDE3',
  card: '#FFFFFF',
  border: '#E2DACE',
  success: '#12805C',
  successSoft: '#E6F5EF',
  warning: '#B7791F',
  warningSoft: '#FEF3C7',
  danger: '#C92A2A',
  dangerSoft: '#FFE8E8',
  info: '#1971C2',
  infoSoft: '#E7F5FF',
} as const;

/** Canonical Dark Mode palette (`File 25 §25.2`: lifted `#2FBF8F`, `#0E1512` canvas, `#14201B` card). */
export const UNDAL_DARK_COLORS: UndalColorScheme = {
  green: '#2FBF8F',
  greenDeep: '#04402A',
  onGreen: '#0E1512',
  flame: '#FF6B2C',
  onFlame: '#14201B',
  sun: '#FFC53D',
  onSun: '#14201B',
  ink: '#F4F7F5',
  slate: '#A3B5AC',
  cream: '#0E1512',
  surfaceSubtle: '#1A2923',
  card: '#14201B',
  border: '#24352E',
  success: '#2FBF8F',
  successSoft: '#123328',
  warning: '#F6AD55',
  warningSoft: '#362712',
  danger: '#FF6B6B',
  dangerSoft: '#3B1818',
  info: '#4DABF7',
  infoSoft: '#132A3E',
} as const;

/** Typography families, fluid type scale (px), and locale line-heights (`File 25 §25.3`). */
export const UNDAL_TYPOGRAPHY = {
  fontDisplay: "'Baloo Da 2', 'Hind Siliguri', system-ui, sans-serif",
  fontBody: "'Hind Siliguri', system-ui, -apple-system, sans-serif",
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  scalePx: {
    xs: 12,
    sm: 14,
    base: 16,
    md: 18,
    lg: 22,
    xl: 28,
    xxl: 36,
  },
  lineHeightEn: 1.5,
  /** `+4%` taller line-height for Bengali matras/conjuncts (`File 25 §25.3`). */
  lineHeightBn: 1.56,
} as const;

/** 4-point spatial scale in pixels (`File 25 §25.6`). */
export const UNDAL_SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  section: 64,
} as const;

/** Corner radius tokens (`File 25 §25.6`: `12` card, `16` sheet, `9999` full pill). */
export const UNDAL_RADII = {
  xs: 4,
  sm: 8,
  card: 12,
  sheet: 16,
  modal: 24,
  pill: 9999,
} as const;

/** Responsive viewport breakpoints from `240px` ultra-compact phones to `3840px` 4K (`D-15`). */
export const UNDAL_BREAKPOINTS = {
  compact240: 240,
  mobile320: 320,
  mobile360: 360,
  phablet480: 480,
  tablet768: 768,
  laptop1024: 1024,
  desktop1280: 1280,
  wide1440: 1440,
  fhd1920: 1920,
  uhd3840: 3840,
} as const;

/** Micro-interaction durations & easing curves (`File 25 §25.4`). */
export const UNDAL_MOTION = {
  fastMs: 150,
  normalMs: 200,
  gentleMs: 250,
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/**
 * Parses a `#RRGGBB` hex colour string into `[r, g, b]` integer channels (`0..255`).
 */
export function parseHexRgb(hex: HexColor): readonly [number, number, number] {
  const clean = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) {
    throw new Error(`Invalid 6-digit hex colour: ${hex}`);
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ] as const;
}

/**
 * Computes WCAG 2.1 relative luminance (`0.0` black .. `1.0` white) for a `#RRGGBB` colour.
 */
export function relativeLuminance(hex: HexColor): number {
  const [r, g, b] = parseHexRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * Computes exact WCAG 2.1 contrast ratio (`1.0 .. 21.0`) between two `#RRGGBB` colours.
 */
export function contrastRatio(foreground: HexColor, background: HexColor): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
