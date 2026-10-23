/// Entrypoint foundation shell for `apps/customer_app` (`Build Response 1`).
/// Full screens `c-01..c-40` land in `Build Responses 12–15`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  runApp(const UndalCustomerApp());
}

/// Root Customer App widget wired to `undal_core` Light/Dark tokens and `EN / বাংলা` i18n.
class UndalCustomerApp extends StatefulWidget {
  const UndalCustomerApp({super.key});

  @override
  State<UndalCustomerApp> createState() => _UndalCustomerAppState();
}

class _UndalCustomerAppState extends State<UndalCustomerApp> {
  Locale _locale = const Locale('en');
  ThemeMode _themeMode = ThemeMode.light;
  int _navIndex = 0;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
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
      home: Builder(
        builder: (BuildContext innerContext) {
          final l10n = UndalLocalizations.of(innerContext);
          return UndalResponsiveScaffold(
            title: l10n.t('app.name'),
            selectedIndex: _navIndex,
            onDestinationSelected: (int next) =>
                setState(() => _navIndex = next),
            actions: <Widget>[
              TextButton(
                onPressed: () => setState(() {
                  _locale = _locale.languageCode == 'en'
                      ? const Locale('bn')
                      : const Locale('en');
                }),
                child: Text(l10n.t('app.switch_language')),
              ),
              IconButton(
                tooltip: l10n.t('app.theme_dark'),
                onPressed: () => setState(() {
                  _themeMode = _themeMode == ThemeMode.light
                      ? ThemeMode.dark
                      : ThemeMode.light;
                }),
                icon: Icon(
                  _themeMode == ThemeMode.light
                      ? Icons.dark_mode_outlined
                      : Icons.light_mode_outlined,
                ),
              ),
            ],
            destinations: <UndalNavItem>[
              UndalNavItem(
                icon: Icons.explore_outlined,
                selectedIcon: Icons.explore,
                label: l10n.t('nav.home'),
              ),
              UndalNavItem(
                icon: Icons.search_outlined,
                selectedIcon: Icons.search,
                label: l10n.t('nav.search'),
              ),
              UndalNavItem(
                icon: Icons.receipt_long_outlined,
                selectedIcon: Icons.receipt_long,
                label: l10n.t('nav.orders'),
              ),
              UndalNavItem(
                icon: Icons.person_outline,
                selectedIcon: Icons.person,
                label: l10n.t('nav.account'),
              ),
            ],
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.lg),
                child: Text(
                  '${l10n.t('app.tagline')} · ${formatBdt(43780, localeCode: _locale.languageCode)}',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
