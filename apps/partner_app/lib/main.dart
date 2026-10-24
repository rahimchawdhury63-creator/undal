/// Production Partner Applicant entry point (`p-01..p-07`, separate private vault `p-35`).
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:undal_core/undal_core.dart';

import 'src/models/partner_models.dart';
import 'src/screens/partner_application_screen.dart';
import 'src/screens/partner_auth_screen.dart';
import 'src/services/partner_api_client.dart';

/// Starts the real GoTrue-backed applicant sign-in and KYC application experience.
void main() {
  runApp(const UndalPartnerApp());
}

/// Root Partner app with public `UNDAL_*` configuration, EN/বাংলা, light/dark tokens and memory-only auth.
class UndalPartnerApp extends StatefulWidget {
  /// Creates the Partner app; optional injected API/session are reserved for deterministic tests.
  const UndalPartnerApp({super.key, this.apiClient, this.initialSession});

  /// Injectable real-transport-compatible API client for tests or controlled host integration.
  final PartnerApiClient? apiClient;

  /// Optional short-lived session injected only for tests; never persisted by the app.
  final PartnerSession? initialSession;

  @override
  State<UndalPartnerApp> createState() => _UndalPartnerAppState();
}

class _UndalPartnerAppState extends State<UndalPartnerApp> {
  late final PartnerApiClient _api = widget.apiClient ?? PartnerApiClient();
  PartnerSession? _session;
  Locale _locale = const Locale('en');
  ThemeMode _themeMode = ThemeMode.light;

  @override
  void initState() {
    super.initState();
    _session = widget.initialSession;
  }

  @override
  Widget build(BuildContext context) {
    final bool isBangla = _locale.languageCode == 'bn';
    return MaterialApp(
      key: const ValueKey<String>('partner-material-app'),
      debugShowCheckedModeBanner: false,
      locale: _locale,
      supportedLocales: UndalSupportedLocales.all,
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        UndalLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      themeMode: _themeMode,
      theme: buildUndalTheme(brightness: Brightness.light, locale: _locale),
      darkTheme: buildUndalTheme(brightness: Brightness.dark, locale: _locale),
      home: _session == null
          ? PartnerAuthScreen(
              api: _api,
              isBangla: isBangla,
              onAuthenticated: (PartnerSession session) => setState(() => _session = session),
              onToggleLanguage: _toggleLanguage,
            )
          : PartnerApplicationScreen(
              key: ValueKey<String>('partner-application-${_session!.userId}'),
              api: _api,
              session: _session!,
              isBangla: isBangla,
              onToggleLanguage: _toggleLanguage,
              onToggleTheme: _toggleTheme,
              onSignOut: () => setState(() => _session = null),
            ),
    );
  }

  void _toggleLanguage() {
    setState(() => _locale = _locale.languageCode == 'en' ? const Locale('bn') : const Locale('en'));
  }

  void _toggleTheme() {
    setState(() => _themeMode = _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light);
  }
}
