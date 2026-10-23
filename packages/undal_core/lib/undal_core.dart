/// Canonical public library barrel for `package:undal_core` (`Build Response 1`).
///
/// Exports:
/// - `undal_tokens.dart`: Light & Dark brand palettes, typography, spacing, radii, breakpoints.
/// - `undal_theme.dart`: Material 3 Light & Dark `ThemeData` + `UndalSemanticColors`.
/// - `undal_money.dart`: Exact `BigInt` poisha waterfall (`File 10`), `formatBdt`, `parseBdtInputToPoisha`.
/// - `undal_fare.dart`: Exact `BigInt` dynamic rider fare & surge engine (`File 11`).
/// - `undal_localizations.dart`: Parity-gated `en` + `bn` localisation delegate (`Appendix H`).
/// - `undal_responsive_scaffold.dart`: `240px -> 3840px` adaptive scaffold (`Decision D-15`).
library undal_core;

export 'src/cloudinary_url.dart';
export 'src/fare/undal_fare.dart';
export 'src/i18n/undal_localizations.dart';
export 'src/money/undal_money.dart';
export 'src/theme/undal_theme.dart';
export 'src/tokens/undal_tokens.dart';
export 'src/widgets/undal_responsive_scaffold.dart';
