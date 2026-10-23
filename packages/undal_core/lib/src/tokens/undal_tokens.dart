/// Canonical UNDAL Brand & Design System tokens for Flutter (`Master Guide File 25`).
///
/// Verified in CI (`packages/shared_ts/test/tokens.test.mjs`) for 100% 1-to-1 parity
/// with `packages/shared_ts/src/tokens.ts` and `tokens.css`.
/// No Flutter screen may hardcode a raw ARGB hex literal outside this file.
library;

/// Pure-Dart immutable ARGB colour value (`0xFFRRGGBB`) usable with or without `dart:ui`.
final class UndalColorToken {
  /// Creates an opaque 32-bit `0xFFRRGGBB` colour token.
  const UndalColorToken(this.argb);

  /// Packed 32-bit ARGB integer (`0xFFRRGGBB`).
  final int argb;

  /// Canonical uppercase `#RRGGBB` representation matching `packages/shared_ts`.
  String get hex =>
      '#${(argb & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';
}

/// Complete light-mode palette (`File 25 §25.2`).
abstract final class UndalLightColors {
  static const green = UndalColorToken(0xFF007A4D);
  static const greenDeep = UndalColorToken(0xFF04402A);
  static const onGreen = UndalColorToken(0xFFFFFFFF);
  static const flame = UndalColorToken(0xFFFF6B2C);
  static const onFlame = UndalColorToken(0xFF14201B);
  static const sun = UndalColorToken(0xFFFFC53D);
  static const onSun = UndalColorToken(0xFF14201B);
  static const ink = UndalColorToken(0xFF14201B);
  static const slate = UndalColorToken(0xFF5A6B63);
  static const cream = UndalColorToken(0xFFFFF9F2);
  static const surfaceSubtle = UndalColorToken(0xFFF5EDE3);
  static const card = UndalColorToken(0xFFFFFFFF);
  static const border = UndalColorToken(0xFFE2DACE);
  static const success = UndalColorToken(0xFF12805C);
  static const successSoft = UndalColorToken(0xFFE6F5EF);
  static const warning = UndalColorToken(0xFFB7791F);
  static const warningSoft = UndalColorToken(0xFFFEF3C7);
  static const danger = UndalColorToken(0xFFC92A2A);
  static const dangerSoft = UndalColorToken(0xFFFFE8E8);
  static const info = UndalColorToken(0xFF1971C2);
  static const infoSoft = UndalColorToken(0xFFE7F5FF);
}

/// Complete dark-mode palette (`File 25 §25.2`: lifted `#2FBF8F`, `#0E1512` canvas, `#14201B` card).
abstract final class UndalDarkColors {
  static const green = UndalColorToken(0xFF2FBF8F);
  static const greenDeep = UndalColorToken(0xFF04402A);
  static const onGreen = UndalColorToken(0xFF0E1512);
  static const flame = UndalColorToken(0xFFFF6B2C);
  static const onFlame = UndalColorToken(0xFF14201B);
  static const sun = UndalColorToken(0xFFFFC53D);
  static const onSun = UndalColorToken(0xFF14201B);
  static const ink = UndalColorToken(0xFFF4F7F5);
  static const slate = UndalColorToken(0xFFA3B5AC);
  static const cream = UndalColorToken(0xFF0E1512);
  static const surfaceSubtle = UndalColorToken(0xFF1A2923);
  static const card = UndalColorToken(0xFF14201B);
  static const border = UndalColorToken(0xFF24352E);
  static const success = UndalColorToken(0xFF2FBF8F);
  static const successSoft = UndalColorToken(0xFF123328);
  static const warning = UndalColorToken(0xFFF6AD55);
  static const warningSoft = UndalColorToken(0xFF362712);
  static const danger = UndalColorToken(0xFFFF6B6B);
  static const dangerSoft = UndalColorToken(0xFF3B1818);
  static const info = UndalColorToken(0xFF4DABF7);
  static const infoSoft = UndalColorToken(0xFF132A3E);
}

/// Typography families, scale (logical px), and locale line-heights (`File 25 §25.3`).
abstract final class UndalTypographyTokens {
  static const String fontDisplay = 'Baloo Da 2';
  static const String fontBody = 'Hind Siliguri';
  static const String fontMono = 'monospace';

  static const double xs = 12;
  static const double sm = 14;
  static const double base = 16;
  static const double md = 18;
  static const double lg = 22;
  static const double xl = 28;
  static const double xxl = 36;

  static const double lineHeightEn = 1.50;
  static const double lineHeightBn = 1.56;
}

/// 4-point spacing grid (`File 25 §25.6`).
abstract final class UndalSpacingTokens {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
  static const double section = 64;
}

/// Corner radii (`File 25 §25.6`: `12` card, `16` sheet, `9999` full pill).
abstract final class UndalRadiusTokens {
  static const double xs = 4;
  static const double sm = 8;
  static const double card = 12;
  static const double sheet = 16;
  static const double modal = 24;
  static const double pill = 9999;
}

/// Universal responsive breakpoints (`Decision D-15`: `240px -> 3840px`).
abstract final class UndalBreakpointTokens {
  static const double compact240 = 240;
  static const double mobile320 = 320;
  static const double mobile360 = 360;
  static const double phablet480 = 480;
  static const double tablet768 = 768;
  static const double laptop1024 = 1024;
  static const double desktop1280 = 1280;
  static const double wide1440 = 1440;
  static const double fhd1920 = 1920;
  static const double uhd3840 = 3840;
}

/// Micro-interaction durations (`File 25 §25.4`).
abstract final class UndalMotionTokens {
  static const int fastMs = 150;
  static const int normalMs = 200;
  static const int gentleMs = 250;
}
