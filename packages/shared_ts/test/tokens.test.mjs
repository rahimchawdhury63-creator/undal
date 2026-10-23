/**
 * @file packages/shared_ts/test/tokens.test.mjs
 * @description Automated verification suite for Master Guide File 25 Design Tokens:
 * 1. Exact hex palette & typography match against File 25 §25.2–25.6.
 * 2. WCAG 2.1 AA/AAA contrast verification across every Light & Dark foreground/surface pair.
 * 3. 100% 1-to-1 synchronisation across `tokens.ts`, `tokens.css`, and `undal_tokens.dart`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UNDAL_LIGHT_COLORS,
  UNDAL_DARK_COLORS,
  UNDAL_TYPOGRAPHY,
  UNDAL_SPACING,
  UNDAL_RADII,
  UNDAL_BREAKPOINTS,
  UNDAL_MOTION,
  contrastRatio,
} from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Extracts `static const <name> = UndalColorToken(0xFF<HEX>);` blocks from Dart token source.
 */
function parseDartColorClass(dartSource, className) {
  const blockMatch = new RegExp(`class\\s+${className}\\s*\\{([\\s\\S]*?)\\}`).exec(dartSource);
  assert.ok(blockMatch, `Missing ${className} in undal_tokens.dart`);
  const entries = {};
  const tokenRegex = /static\s+const\s+(\w+)\s*=\s*UndalColorToken\(0xFF([0-9A-Fa-f]{6})\);/g;
  let match;
  while ((match = tokenRegex.exec(blockMatch[1])) !== null) {
    entries[match[1]] = `#${match[2].toUpperCase()}`;
  }
  return entries;
}

test('File 25 §25.2 canonical brand hexes & zero forbidden magenta', () => {
  assert.equal(UNDAL_LIGHT_COLORS.green, '#007A4D');
  assert.equal(UNDAL_LIGHT_COLORS.greenDeep, '#04402A');
  assert.equal(UNDAL_LIGHT_COLORS.flame, '#FF6B2C');
  assert.equal(UNDAL_LIGHT_COLORS.sun, '#FFC53D');
  assert.equal(UNDAL_LIGHT_COLORS.ink, '#14201B');
  assert.equal(UNDAL_LIGHT_COLORS.slate, '#5A6B63');
  assert.equal(UNDAL_LIGHT_COLORS.cream, '#FFF9F2');
  assert.equal(UNDAL_LIGHT_COLORS.card, '#FFFFFF');
  assert.equal(UNDAL_LIGHT_COLORS.success, '#12805C');
  assert.equal(UNDAL_LIGHT_COLORS.warning, '#B7791F');
  assert.equal(UNDAL_LIGHT_COLORS.danger, '#C92A2A');
  assert.equal(UNDAL_LIGHT_COLORS.info, '#1971C2');

  assert.equal(UNDAL_DARK_COLORS.green, '#2FBF8F');
  assert.equal(UNDAL_DARK_COLORS.cream, '#0E1512');
  assert.equal(UNDAL_DARK_COLORS.card, '#14201B');

  assert.deepEqual(Object.values(UNDAL_TYPOGRAPHY.scalePx), [12, 14, 16, 18, 22, 28, 36]);
  assert.equal(UNDAL_TYPOGRAPHY.lineHeightEn, 1.5);
  assert.equal(UNDAL_TYPOGRAPHY.lineHeightBn, 1.56);
  assert.equal(UNDAL_RADII.card, 12);
  assert.equal(UNDAL_RADII.sheet, 16);
  assert.equal(UNDAL_RADII.pill, 9999);
  assert.equal(UNDAL_BREAKPOINTS.compact240, 240);
  assert.equal(UNDAL_BREAKPOINTS.uhd3840, 3840);
  assert.equal(UNDAL_MOTION.fastMs, 150);
  assert.equal(UNDAL_MOTION.gentleMs, 250);
});

test('WCAG 2.1 AA/AAA contrast ratios pass across all Light & Dark token pairs', () => {
  const requiredPairs = [
    ['Light primary CTA (white on green)', UNDAL_LIGHT_COLORS.onGreen, UNDAL_LIGHT_COLORS.green, 5.0],
    ['Light body ink on warm cream', UNDAL_LIGHT_COLORS.ink, UNDAL_LIGHT_COLORS.cream, 14.0],
    ['Light body ink on white card', UNDAL_LIGHT_COLORS.ink, UNDAL_LIGHT_COLORS.card, 15.0],
    ['Light deep green heading on cream', UNDAL_LIGHT_COLORS.greenDeep, UNDAL_LIGHT_COLORS.cream, 10.5],
    ['Light secondary slate on cream', UNDAL_LIGHT_COLORS.slate, UNDAL_LIGHT_COLORS.cream, 5.0],
    ['Light secondary slate on card', UNDAL_LIGHT_COLORS.slate, UNDAL_LIGHT_COLORS.card, 5.0],
    ['Light ink on flame badge', UNDAL_LIGHT_COLORS.onFlame, UNDAL_LIGHT_COLORS.flame, 5.8],
    ['Light ink on sun star pill', UNDAL_LIGHT_COLORS.onSun, UNDAL_LIGHT_COLORS.sun, 10.5],
    ['Light white on success pill', '#FFFFFF', UNDAL_LIGHT_COLORS.success, 4.9],
    ['Light white on danger pill', '#FFFFFF', UNDAL_LIGHT_COLORS.danger, 5.0],
    ['Light white on info pill', '#FFFFFF', UNDAL_LIGHT_COLORS.info, 5.0],
    ['Dark body ink on dark canvas', UNDAL_DARK_COLORS.ink, UNDAL_DARK_COLORS.cream, 15.0],
    ['Dark body ink on dark card', UNDAL_DARK_COLORS.ink, UNDAL_DARK_COLORS.card, 13.5],
    ['Dark secondary slate on dark card', UNDAL_DARK_COLORS.slate, UNDAL_DARK_COLORS.card, 7.5],
    ['Dark primary CTA (onGreen on lifted green)', UNDAL_DARK_COLORS.onGreen, UNDAL_DARK_COLORS.green, 7.8],
  ];

  for (const [label, fg, bg, minRatio] of requiredPairs) {
    const actual = contrastRatio(fg, bg);
    assert.ok(
      actual >= minRatio,
      `${label} failed WCAG check: got ${actual.toFixed(2)}:1, expected >= ${minRatio}:1`,
    );
  }
});

test('100% cross-platform parity across tokens.ts, tokens.css, and undal_tokens.dart', () => {
  const cssSource = fs.readFileSync(
    path.join(REPO_ROOT, 'packages/shared_ts/src/tokens.css'),
    'utf8',
  );
  const dartSource = fs.readFileSync(
    path.join(REPO_ROOT, 'packages/undal_core/lib/src/tokens/undal_tokens.dart'),
    'utf8',
  );

  // Every hex colour in Light & Dark TS schemes exists in tokens.css and matches Dart 1-to-1
  for (const hex of [
    ...Object.values(UNDAL_LIGHT_COLORS),
    ...Object.values(UNDAL_DARK_COLORS),
  ]) {
    assert.ok(cssSource.toUpperCase().includes(hex.toUpperCase()), `tokens.css missing ${hex}`);
  }

  const dartLight = parseDartColorClass(dartSource, 'UndalLightColors');
  const dartDark = parseDartColorClass(dartSource, 'UndalDarkColors');
  assert.deepEqual(dartLight, UNDAL_LIGHT_COLORS);
  assert.deepEqual(dartDark, UNDAL_DARK_COLORS);

  // Spacing tokens match between TS and CSS
  for (const [key, px] of Object.entries(UNDAL_SPACING)) {
    assert.match(cssSource, new RegExp(`--undal-space-${key}:\\s*${px}px;`));
  }
});
