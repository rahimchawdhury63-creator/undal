/// Root entrypoint & adaptive shell for `apps/customer_app` (`Build Responses 12–13` — `c-01..c-21`).
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
import 'src/screens/customer_account_screens.dart';
import 'src/screens/customer_account_hub_tab.dart';
import 'src/screens/customer_cart_screen.dart';
import 'src/screens/customer_checkout_screens.dart';
import 'src/screens/customer_order_screens.dart';
import 'src/screens/customer_rating_screen.dart';
import 'src/screens/customer_social_screens.dart';
import 'src/screens/customer_support_screens.dart';
import 'src/screens/customer_tracking_screen.dart';
import 'src/screens/customer_customizer_screens.dart';
import 'src/screens/customer_vendor_screens.dart';
import 'src/screens/home_feed_screen.dart';
import 'src/screens/onboarding_screens.dart';
import 'src/screens/pickup_map_screen.dart';
import 'src/screens/search_screen.dart';
import 'src/state/customer_controller.dart';

export 'src/config/app_config.dart';
export 'src/data/sylhet_seed_catalog.dart';
export 'src/i18n/customer_copy.dart';
export 'src/models/customer_cart_models.dart';
export 'src/models/customer_models.dart';
export 'src/models/storefront_menu_models.dart';
export 'src/models/storefront_vendor_models.dart';
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
      case CustomerScreenId.c13VendorStorefront:
        return CustomerVendorStorefrontScreen(controller: ctrl);
      case CustomerScreenId.c14ItemCustomizer:
        return CustomerItemCustomizerScreen(controller: ctrl);
      case CustomerScreenId.c15BundleBuilder:
        return CustomerBundleBuilderScreen(controller: ctrl);
      case CustomerScreenId.c16VendorInfo:
        return CustomerVendorInfoScreen(controller: ctrl);
      case CustomerScreenId.c17VendorReviews:
        return CustomerVendorReviewsScreen(controller: ctrl);
      case CustomerScreenId.c19VoucherPicker:
        return CustomerVoucherPickerScreen(controller: ctrl);
      case CustomerScreenId.c20Checkout:
        return CustomerCheckoutScreen(controller: ctrl);
      case CustomerScreenId.c21OrderConfirmation:
        return CustomerOrderConfirmationScreen(controller: ctrl);
      case CustomerScreenId.c22LiveTracking:
        return CustomerLiveTrackingScreen(controller: ctrl);
      case CustomerScreenId.c23PickupReady:
        return CustomerPickupReadyScreen(controller: ctrl);
      case CustomerScreenId.c24RiderChat:
      case CustomerScreenId.c25KitchenChat:
        return CustomerOrderChatScreen(controller: ctrl);
      case CustomerScreenId.c26Orders:
        return CustomerOrdersScreen(controller: ctrl);
      case CustomerScreenId.c27OrderReceipt:
        return CustomerOrderReceiptScreen(controller: ctrl);
      case CustomerScreenId.c28Rating:
        return CustomerRatingScreen(controller: ctrl);
      case CustomerScreenId.c29Favourites:
        return CustomerFavouritesScreen(controller: ctrl);
      case CustomerScreenId.c30Addresses:
        return CustomerAddressesScreen(controller: ctrl);
      case CustomerScreenId.c31AddressEditor:
        return CustomerAddressEditorScreen(controller: ctrl);
      case CustomerScreenId.c32VoucherWallet:
        return CustomerVoucherWalletScreen(controller: ctrl);
      case CustomerScreenId.c33Rewards:
        return CustomerGrowthPolicyScreen(controller: ctrl, invite: false);
      case CustomerScreenId.c34InviteFriends:
        return CustomerGrowthPolicyScreen(controller: ctrl, invite: true);
      case CustomerScreenId.c35Notifications:
        return CustomerNotificationsScreen(controller: ctrl);
      case CustomerScreenId.c36HelpCenter:
        return CustomerHelpCenterScreen(controller: ctrl);
      case CustomerScreenId.c37SupportChat:
        return CustomerSupportChatScreen(controller: ctrl);
      case CustomerScreenId.c38ProfileEdit:
        return CustomerProfileEditScreen(controller: ctrl);
      case CustomerScreenId.c39Language:
        return CustomerLanguageScreen(controller: ctrl);
      case CustomerScreenId.c40DeleteAccount:
        return CustomerDeleteAccountScreen(controller: ctrl);
      case CustomerScreenId.c18Cart:
        break;
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
        2 => CustomerOrdersScreen(controller: ctrl, embedded: true),
        3 => CustomerCartScreen(controller: ctrl),
        _ => CustomerAccountHubTab(controller: ctrl),
      },
    );
  }
}
