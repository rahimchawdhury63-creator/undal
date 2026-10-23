/// Entrypoint foundation shell for `apps/rider_app` (`Build Response 1`).
/// Full age/vehicle KYC, native Kotlin alarm engine, QR pickup & Cash Gate screens `r-01..r-29`
/// land in `Build Responses 20–22`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  runApp(const UndalRiderApp());
}

/// Root Rider App widget wired to `undal_core` Light/Dark tokens and `EN / বাংলা` i18n.
class UndalRiderApp extends StatefulWidget {
  const UndalRiderApp({super.key});

  @override
  State<UndalRiderApp> createState() => _UndalRiderAppState();
}

class _UndalRiderAppState extends State<UndalRiderApp> {
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
            title: '${l10n.t('app.name')} · Rider',
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
                icon: Icons.delivery_dining_outlined,
                selectedIcon: Icons.delivery_dining,
                label: l10n.t('rider.new_offer'),
              ),
              UndalNavItem(
                icon: Icons.account_balance_wallet_outlined,
                selectedIcon: Icons.account_balance_wallet,
                label: l10n.t('rider.cash_gate_title'),
              ),
            ],
            body: Center(
              child: Text(
                '${l10n.t('rider.why_this_fare')} · ${formatBdt(13584, localeCode: _locale.languageCode)}',
              ),
            ),
          );
        },
      ),
    );
  }
}
