/// Root entrypoint & adaptive shell for `apps/customer_app` (`Build Response 12` — `c-01..c-12`).
///
/// Connects:
/// - `package:undal_core` Light & Dark Material 3 tokens + `EN / বাংলা` live switcher.
/// - 5-destination `UndalResponsiveScaffold` (`Home · Search · Orders · Cart(badge) · Account`)
///   scaling cleanly from `240px` compact handsets to `1920px+` Android tablets (`Decision D-15`).
/// - Sequential unstacked Onboarding & OSM Pinning (`c-01..c-05`), Auth Hub & 3-Step Sign-Up (`c-06..c-07`),
///   Delivery & Self-Pickup feeds (`c-08..c-09`), Full-Screen Pickup Map (`c-10`), and Search (`c-11..c-12`).
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:undal_core/undal_core.dart';

import 'src/i18n/customer_copy.dart';
import 'src/models/customer_models.dart';
import 'src/screens/auth_screens.dart';
import 'src/screens/companion_tabs.dart';
import 'src/screens/home_feed_screen.dart';
import 'src/screens/onboarding_screens.dart';
import 'src/screens/pickup_map_screen.dart';
import 'src/screens/search_screen.dart';
import 'src/state/customer_controller.dart';

export 'src/config/app_config.dart';
export 'src/data/sylhet_seed_catalog.dart';
export 'src/i18n/customer_copy.dart';
export 'src/models/customer_models.dart';
export 'src/services/customer_api_client.dart';
export 'src/state/customer_controller.dart';

void main() {
  runApp(const UndalCustomerApp());
}

/// Root Customer App widget supporting both production startup and test-injected [CustomerController].
class UndalCustomerApp extends StatefulWidget {
  const UndalCustomerApp({
    super.key,
    this.controller,
  });

  final CustomerController? controller;

  @override
  State<UndalCustomerApp> createState() => _UndalCustomerAppState();
}

class _UndalCustomerAppState extends State<UndalCustomerApp> {
  late CustomerController _ownedController;
  CustomerController get _ctrl => widget.controller ?? _ownedController;

  @override
  void initState() {
    super.initState();
    _ownedController = CustomerController();
  }

  @override
  void dispose() {
    if (widget.controller == null) {
      _ownedController.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _ctrl,
      builder: (BuildContext context, _) {
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          locale: _ctrl.locale,
          supportedLocales: UndalSupportedLocales.all,
          localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
            UndalLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          themeMode: _ctrl.themeMode,
          theme: buildUndalTheme(
            brightness: Brightness.light,
            locale: _ctrl.locale,
          ),
          darkTheme: buildUndalTheme(
            brightness: Brightness.dark,
            locale: _ctrl.locale,
          ),
          home: Builder(
            builder: (BuildContext innerContext) =>
                _buildActiveRoot(innerContext, _ctrl),
          ),
        );
      },
    );
  }

  Widget _buildActiveRoot(BuildContext context, CustomerController ctrl) {
    switch (ctrl.activeOverlay) {
      case CustomerScreenId.c01Splash:
      case CustomerScreenId.c02Carousel:
      case CustomerScreenId.c03LocationPrime:
      case CustomerScreenId.c04AddressPin:
      case CustomerScreenId.c05NotificationPrime:
        return CustomerOnboardingFlow(controller: ctrl);
      case CustomerScreenId.c06AuthHub:
      case CustomerScreenId.c07SignUp:
        return CustomerAuthScreen(controller: ctrl);
      case CustomerScreenId.c10PickupMap:
        return CustomerPickupMapScreen(
          controller: ctrl,
          onSelectVendor: (VendorFeedCard v) => showVendorQuickMenuSheet(
            context,
            controller: ctrl,
            vendor: v,
          ),
        );
      case CustomerScreenId.c08HomeDelivery:
      case CustomerScreenId.c09HomePickup:
      case CustomerScreenId.c11SearchHome:
      case CustomerScreenId.c12SearchResults:
        break;
    }

    final UndalLocalizations l10n = UndalLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final SavedCustomerAddress addr = ctrl.activeAddress;

    return UndalResponsiveScaffold(
      title: l10n.t('app.name'),
      titleWidget: InkWell(
        key: const ValueKey<String>('header-address-switcher'),
        borderRadius: BorderRadius.circular(UndalRadiusTokens.sm),
        onTap: ctrl.openAddressPinScreen,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xxs),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.location_on_outlined,
                size: 18,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: UndalSpacingTokens.xxs),
              Flexible(
                child: Text(
                  '${l10n.t('app.name')} · ${addr.label} (${addr.plusCode})',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(Icons.keyboard_arrow_down, size: 18),
            ],
          ),
        ),
      ),
      topBanner: ctrl.isOffline
          ? Container(
              key: const ValueKey<String>('global-offline-banner'),
              color: semantic.warningSoft,
              padding: const EdgeInsets.symmetric(
                horizontal: UndalSpacingTokens.md,
                vertical: UndalSpacingTokens.xs,
              ),
              child: Text(
                cText(
                  context,
                  'Offline — showing cached Sylhet feed. Reconnect to place COD orders.',
                  'অফলাইন মোড — সংরক্ষিত মেনু দেখানো হচ্ছে। অর্ডার করতে ইন্টারনেট চালু করুন।',
                ),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: semantic.warning,
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          : null,
      selectedIndex: ctrl.selectedTabIndex,
      onDestinationSelected: ctrl.selectTab,
      actions: <Widget>[
        TextButton(
          key: const ValueKey<String>('appbar-locale-switch'),
          onPressed: ctrl.toggleLocale,
          child: Text(l10n.t('app.switch_language')),
        ),
        IconButton(
          key: const ValueKey<String>('appbar-theme-switch'),
          tooltip: l10n.t('app.theme_dark'),
          onPressed: ctrl.toggleThemeMode,
          icon: Icon(
            ctrl.themeMode == ThemeMode.light
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
          icon: Icons.shopping_bag_outlined,
          selectedIcon: Icons.shopping_bag,
          label: l10n.t('nav.cart'),
          badgeCount: ctrl.totalBasketItems,
        ),
        UndalNavItem(
          icon: Icons.person_outline,
          selectedIcon: Icons.person,
          label: l10n.t('nav.account'),
        ),
      ],
      body: switch (ctrl.selectedTabIndex) {
        0 => CustomerHomeFeedView(
            controller: ctrl,
            onSelectVendor: (VendorFeedCard v) => showVendorQuickMenuSheet(
              context,
              controller: ctrl,
              vendor: v,
            ),
          ),
        1 => CustomerSearchView(
            controller: ctrl,
            onSelectVendor: (VendorFeedCard v) => showVendorQuickMenuSheet(
              context,
              controller: ctrl,
              vendor: v,
            ),
          ),
        2 => CustomerOrdersPreviewTab(controller: ctrl),
        3 => CustomerQuickCartTab(controller: ctrl),
        _ => CustomerAccountHubTab(controller: ctrl),
      },
    );
  }
}
