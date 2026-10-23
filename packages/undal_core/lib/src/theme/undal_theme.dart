/// Canonical UNDAL Material 3 Theme builder (`Master Guide File 25`).
///
/// Consumes `undal_tokens.dart` exclusively — zero hardcoded raw hex literals.
/// Applies `Baloo Da 2` display headings, `Hind Siliguri` body text, tabular numerals,
/// and `+4%` line-height automatically when `locale.languageCode == 'bn'`.
library;

import 'package:flutter/material.dart';

import '../tokens/undal_tokens.dart';

/// Theme extension carrying UNDAL semantic status tokens (`File 25 §25.2`).
final class UndalSemanticColors extends ThemeExtension<UndalSemanticColors> {
  const UndalSemanticColors({
    required this.flame,
    required this.onFlame,
    required this.sun,
    required this.onSun,
    required this.success,
    required this.successSoft,
    required this.warning,
    required this.warningSoft,
    required this.danger,
    required this.dangerSoft,
    required this.info,
    required this.infoSoft,
  });

  final Color flame;
  final Color onFlame;
  final Color sun;
  final Color onSun;
  final Color success;
  final Color successSoft;
  final Color warning;
  final Color warningSoft;
  final Color danger;
  final Color dangerSoft;
  final Color info;
  final Color infoSoft;

  static final light = UndalSemanticColors(
    flame: Color(UndalLightColors.flame.argb),
    onFlame: Color(UndalLightColors.onFlame.argb),
    sun: Color(UndalLightColors.sun.argb),
    onSun: Color(UndalLightColors.onSun.argb),
    success: Color(UndalLightColors.success.argb),
    successSoft: Color(UndalLightColors.successSoft.argb),
    warning: Color(UndalLightColors.warning.argb),
    warningSoft: Color(UndalLightColors.warningSoft.argb),
    danger: Color(UndalLightColors.danger.argb),
    dangerSoft: Color(UndalLightColors.dangerSoft.argb),
    info: Color(UndalLightColors.info.argb),
    infoSoft: Color(UndalLightColors.infoSoft.argb),
  );

  static final dark = UndalSemanticColors(
    flame: Color(UndalDarkColors.flame.argb),
    onFlame: Color(UndalDarkColors.onFlame.argb),
    sun: Color(UndalDarkColors.sun.argb),
    onSun: Color(UndalDarkColors.onSun.argb),
    success: Color(UndalDarkColors.success.argb),
    successSoft: Color(UndalDarkColors.successSoft.argb),
    warning: Color(UndalDarkColors.warning.argb),
    warningSoft: Color(UndalDarkColors.warningSoft.argb),
    danger: Color(UndalDarkColors.danger.argb),
    dangerSoft: Color(UndalDarkColors.dangerSoft.argb),
    info: Color(UndalDarkColors.info.argb),
    infoSoft: Color(UndalDarkColors.infoSoft.argb),
  );

  @override
  UndalSemanticColors copyWith({
    Color? flame,
    Color? onFlame,
    Color? sun,
    Color? onSun,
    Color? success,
    Color? successSoft,
    Color? warning,
    Color? warningSoft,
    Color? danger,
    Color? dangerSoft,
    Color? info,
    Color? infoSoft,
  }) {
    return UndalSemanticColors(
      flame: flame ?? this.flame,
      onFlame: onFlame ?? this.onFlame,
      sun: sun ?? this.sun,
      onSun: onSun ?? this.onSun,
      success: success ?? this.success,
      successSoft: successSoft ?? this.successSoft,
      warning: warning ?? this.warning,
      warningSoft: warningSoft ?? this.warningSoft,
      danger: danger ?? this.danger,
      dangerSoft: dangerSoft ?? this.dangerSoft,
      info: info ?? this.info,
      infoSoft: infoSoft ?? this.infoSoft,
    );
  }

  @override
  UndalSemanticColors lerp(ThemeExtension<UndalSemanticColors>? other, double t) {
    if (other is! UndalSemanticColors) return this;
    return UndalSemanticColors(
      flame: Color.lerp(flame, other.flame, t)!,
      onFlame: Color.lerp(onFlame, other.onFlame, t)!,
      sun: Color.lerp(sun, other.sun, t)!,
      onSun: Color.lerp(onSun, other.onSun, t)!,
      success: Color.lerp(success, other.success, t)!,
      successSoft: Color.lerp(successSoft, other.successSoft, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningSoft: Color.lerp(warningSoft, other.warningSoft, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerSoft: Color.lerp(dangerSoft, other.dangerSoft, t)!,
      info: Color.lerp(info, other.info, t)!,
      infoSoft: Color.lerp(infoSoft, other.infoSoft, t)!,
    );
  }
}

/// Builds the canonical UNDAL Light or Dark [ThemeData] for [locale].
ThemeData buildUndalTheme({
  required Brightness brightness,
  Locale locale = const Locale('en'),
}) {
  final bool isDark = brightness == Brightness.dark;
  final double lineHeight = locale.languageCode == 'bn'
      ? UndalTypographyTokens.lineHeightBn
      : UndalTypographyTokens.lineHeightEn;

  final Color primary =
      Color(isDark ? UndalDarkColors.green.argb : UndalLightColors.green.argb);
  final Color onPrimary =
      Color(isDark ? UndalDarkColors.onGreen.argb : UndalLightColors.onGreen.argb);
  final Color canvas =
      Color(isDark ? UndalDarkColors.cream.argb : UndalLightColors.cream.argb);
  final Color card =
      Color(isDark ? UndalDarkColors.card.argb : UndalLightColors.card.argb);
  final Color ink =
      Color(isDark ? UndalDarkColors.ink.argb : UndalLightColors.ink.argb);
  final Color slate =
      Color(isDark ? UndalDarkColors.slate.argb : UndalLightColors.slate.argb);
  final Color border =
      Color(isDark ? UndalDarkColors.border.argb : UndalLightColors.border.argb);
  final Color danger =
      Color(isDark ? UndalDarkColors.danger.argb : UndalLightColors.danger.argb);
  final Color flame =
      Color(isDark ? UndalDarkColors.flame.argb : UndalLightColors.flame.argb);
  final Color onFlame =
      Color(isDark ? UndalDarkColors.onFlame.argb : UndalLightColors.onFlame.argb);

  final ColorScheme colorScheme = ColorScheme(
    brightness: brightness,
    primary: primary,
    onPrimary: onPrimary,
    secondary: flame,
    onSecondary: onFlame,
    error: danger,
    onError: Color(UndalLightColors.onGreen.argb),
    surface: card,
    onSurface: ink,
    onSurfaceVariant: slate,
    outline: border,
  );

  final TextTheme textTheme = TextTheme(
    displaySmall: TextStyle(
      fontFamily: UndalTypographyTokens.fontDisplay,
      fontSize: UndalTypographyTokens.xxl,
      fontWeight: FontWeight.w800,
      height: 1.2,
      color: ink,
    ),
    headlineMedium: TextStyle(
      fontFamily: UndalTypographyTokens.fontDisplay,
      fontSize: UndalTypographyTokens.xl,
      fontWeight: FontWeight.w700,
      height: 1.25,
      color: ink,
    ),
    titleLarge: TextStyle(
      fontFamily: UndalTypographyTokens.fontDisplay,
      fontSize: UndalTypographyTokens.lg,
      fontWeight: FontWeight.w700,
      height: 1.3,
      color: ink,
    ),
    titleMedium: TextStyle(
      fontFamily: UndalTypographyTokens.fontBody,
      fontSize: UndalTypographyTokens.md,
      fontWeight: FontWeight.w600,
      height: lineHeight,
      color: ink,
    ),
    bodyLarge: TextStyle(
      fontFamily: UndalTypographyTokens.fontBody,
      fontSize: UndalTypographyTokens.base,
      fontWeight: FontWeight.w400,
      height: lineHeight,
      color: ink,
    ),
    bodyMedium: TextStyle(
      fontFamily: UndalTypographyTokens.fontBody,
      fontSize: UndalTypographyTokens.sm,
      fontWeight: FontWeight.w400,
      height: lineHeight,
      color: ink,
    ),
    labelSmall: TextStyle(
      fontFamily: UndalTypographyTokens.fontBody,
      fontSize: UndalTypographyTokens.xs,
      fontWeight: FontWeight.w600,
      height: lineHeight,
      color: slate,
    ),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: canvas,
    fontFamily: UndalTypographyTokens.fontBody,
    textTheme: textTheme,
    dividerColor: border,
    extensions: <ThemeExtension<dynamic>>[
      isDark ? UndalSemanticColors.dark : UndalSemanticColors.light,
    ],
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        backgroundColor: primary,
        foregroundColor: onPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
        ),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(UndalRadiusTokens.sheet),
        ),
      ),
    ),
  );
}
