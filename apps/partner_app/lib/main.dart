/// Entrypoint foundation shell for `apps/partner_app` (`Build Response 1`).
/// Full 3-track KYC, native Kotlin alarm engine & screens `p-01..p-37` ship in `Build Responses 16–19`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  runApp(const UndalPartnerApp());
}

/// Root Partner App widget wired to `undal_core` Light/Dark tokens and `EN / বাংলা` i18n.
class UndalPartnerApp extends StatefulWidget {
  const UndalPartnerApp({super.key});

  @override
  State<UndalPartnerApp> createState() => _UndalPartnerAppState();
}

class _UndalPartnerAppState extends State<UndalPartnerApp> {
  Locale _locale = const Locale('en');
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
      theme: buildUndalTheme(brightness: Brightness.light, locale: _locale),
      darkTheme: buildUndalTheme(brightness: Brightness.dark, locale: _locale),
      home: Builder(
        builder: (BuildContext innerContext) {
          final l10n = UndalLocalizations.of(innerContext);
          return UndalResponsiveScaffold(
            title: '${l10n.t('app.name')} · Partner',
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
            ],
            destinations: <UndalNavItem>[
              UndalNavItem(
                icon: Icons.soup_kitchen_outlined,
                selectedIcon: Icons.soup_kitchen,
                label: l10n.t('nav.orders'),
              ),
              UndalNavItem(
                icon: Icons.restaurant_menu_outlined,
                selectedIcon: Icons.restaurant_menu,
                label: l10n.t('alarm.armed'),
              ),
            ],
            body: Center(
              child: Text(
                '${l10n.t('vendor.new_order')} · ${formatBdt(183940, localeCode: _locale.languageCode)}',
              ),
            ),
          );
        },
      ),
    );
  }
}
