/// Server-backed Account tab linking customer order and profile destinations.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';

/// Account tab navigation for authenticated customer experience routes.
class CustomerAccountHubTab extends StatelessWidget {
  /// Creates the account destination list.
  const CustomerAccountHubTab({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final CustomerSession? session = controller.session;
    final List<(IconData, String, String, CustomerScreenId)> destinations = <(IconData, String, String, CustomerScreenId)>[
      (Icons.favorite_border, 'Favourite kitchens', 'প্রিয় রান্নাঘর', CustomerScreenId.c29Favourites),
      (Icons.location_on_outlined, 'Saved addresses', 'সংরক্ষিত ঠিকানা', CustomerScreenId.c30Addresses),
      (Icons.local_offer_outlined, 'Voucher wallet', 'ভাউচার ওয়ালেট', CustomerScreenId.c32VoucherWallet),
      (Icons.stars_outlined, 'Undal Rewards', 'উন্দাল রিওয়ার্ডস', CustomerScreenId.c33Rewards),
      (Icons.person_add_alt_1, 'Invite friends', 'বন্ধুদের আমন্ত্রণ', CustomerScreenId.c34InviteFriends),
      (Icons.notifications_none, 'Notifications', 'নোটিফিকেশন', CustomerScreenId.c35Notifications),
      (Icons.help_outline, 'Help center', 'সহায়তা কেন্দ্র', CustomerScreenId.c36HelpCenter),
      (Icons.manage_accounts_outlined, 'Profile', 'প্রোফাইল', CustomerScreenId.c38ProfileEdit),
      (Icons.language, 'Language', 'ভাষা', CustomerScreenId.c39Language),
      (Icons.delete_outline, 'Delete account', 'অ্যাকাউন্ট মুছুন', CustomerScreenId.c40DeleteAccount),
    ];

    return ListView(
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      children: <Widget>[
        Card(
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            child: session == null
                ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
                    Text(cText(context, 'Browsing as Guest', 'গেস্ট মোডে দেখছেন'), style: theme.textTheme.titleLarge),
                    const SizedBox(height: UndalSpacingTokens.xs),
                    Text(cText(context, 'Sign in to access your orders, saved kitchens, addresses, and account settings.', 'অর্ডার, পছন্দের রান্নাঘর, ঠিকানা ও অ্যাকাউন্ট সেটিংস দেখতে লগইন করুন।')),
                    const SizedBox(height: UndalSpacingTokens.sm),
                    FilledButton(
                      key: const ValueKey<String>('account-open-auth-btn'),
                      onPressed: controller.openAuthHub,
                      child: Text(UndalLocalizations.of(context).t('auth.login')),
                    ),
                  ])
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                    Text(controller.experience.profile?.fullName ?? session.fullName, style: theme.textTheme.titleLarge),
                    Text(session.phone.isNotEmpty ? session.phone : session.email ?? ''),
                    const SizedBox(height: UndalSpacingTokens.sm),
                    OutlinedButton(
                      key: const ValueKey<String>('account-logout-btn'),
                      onPressed: controller.signOut,
                      child: Text(cText(context, 'Log out', 'লগ আউট')),
                    ),
                  ]),
          ),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        if (session != null)
          for (final (IconData, String, String, CustomerScreenId) item in destinations)
            Card(
              elevation: 0,
              child: ListTile(
                leading: Icon(item.$1, color: theme.colorScheme.primary),
                title: Text(cText(context, item.$2, item.$3)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => controller.openCustomerExperienceScreen(item.$4, parentTab: 4),
              ),
            ),
        if (session == null)
          ListTile(
            leading: const Icon(Icons.help_outline),
            title: Text(cText(context, 'Help center', 'সহায়তা কেন্দ্র')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => controller.openCustomerExperienceScreen(CustomerScreenId.c36HelpCenter, parentTab: 4),
          ),
        ListTile(
          key: const ValueKey<String>('account-replay-onboarding-btn'),
          leading: const Icon(Icons.tour_outlined),
          title: Text(cText(context, 'Replay the welcome guide', 'স্বাগতম নির্দেশিকা আবার দেখুন')),
          trailing: const Icon(Icons.chevron_right),
          onTap: controller.startOnboardingFlow,
        ),
      ],
    );
  }
}
