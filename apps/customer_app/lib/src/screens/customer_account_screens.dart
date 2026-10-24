/// Voucher wallet, notifications, profile, language, rewards gate, and account-request screens (`c-32..c-40`).
///
/// Every balance-like value is an authenticated W1 response. Rewards and referral codes stay gated until
/// the founder approves earning, redemption, fraud, and privacy-retention policies in ADR-0007.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../models/customer_voucher_offer.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// Displays eligible first-party voucher offers and their server-provided expiry (`c-32`).
class CustomerVoucherWalletScreen extends StatefulWidget {
  /// Creates the authenticated voucher wallet.
  const CustomerVoucherWalletScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerVoucherWalletScreen> createState() => _CustomerVoucherWalletScreenState();
}

class _CustomerVoucherWalletScreenState extends State<CustomerVoucherWalletScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.controller.isAuthenticated) widget.controller.commerce.refreshVoucherWallet();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController controller = widget.controller;
    final String lang = Localizations.localeOf(context).languageCode;
    final List<CustomerVoucherOffer> offers = controller.commerce.voucherWallet;
    return Scaffold(
      key: const ValueKey<String>('screen-c-32'),
      appBar: AppBar(title: Text(cText(context, 'Voucher wallet', 'ভাউচার ওয়ালেট')), leading: BackButton(onPressed: () => controller.returnFromCustomerExperience(tabIndex: 4)), actions: <Widget>[
        IconButton(tooltip: cText(context, 'Refresh vouchers', 'ভাউচার রিফ্রেশ'), onPressed: controller.commerce.voucherWalletLoading ? null : controller.commerce.refreshVoucherWallet, icon: const Icon(Icons.refresh)),
      ]),
      body: !controller.isAuthenticated
          ? Center(child: Text(cText(context, 'Sign in to view eligible offers.', 'যোগ্য অফার দেখতে লগইন করুন।')))
          : controller.commerce.voucherWalletLoading && offers.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : controller.commerce.voucherWalletErrorCode != null && offers.isEmpty
                  ? Center(child: FilledButton.icon(onPressed: controller.commerce.refreshVoucherWallet, icon: const Icon(Icons.refresh), label: Text(cText(context, 'Try again', 'আবার চেষ্টা করুন'))))
                  : offers.isEmpty
                      ? Center(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.xl), child: Text(cText(context, 'There are no currently eligible vouchers. Offers are checked again at checkout.', 'এখন কোনো যোগ্য ভাউচার নেই। চেকআউটে অফার আবার যাচাই হবে।'), textAlign: TextAlign.center)))
                      : RefreshIndicator(onRefresh: controller.commerce.refreshVoucherWallet, child: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
                          for (final CustomerVoucherOffer offer in offers)
                            Card(child: Padding(
                              padding: const EdgeInsets.all(UndalSpacingTokens.md),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                                Text(offer.title(lang), style: Theme.of(context).textTheme.titleLarge),
                                Text(offer.code, style: Theme.of(context).textTheme.labelLarge),
                                Text(_voucherBenefit(context, offer, lang)),
                                Text(cText(context, 'Minimum food subtotal: ${formatBdt(offer.minimumOrderPoisha, localeCode: lang)}', 'খাবারের ন্যূনতম মূল্য: ${formatBdt(offer.minimumOrderPoisha, localeCode: lang)}')),
                                Text(cText(context, 'Expires ${_expiry(offer.endsAt, lang)}. W1 validates every voucher against your current cart.', 'মেয়াদ ${_expiry(offer.endsAt, lang)}। W1 আপনার বর্তমান কার্টে ভাউচার যাচাই করে।')),
                                Align(alignment: Alignment.centerRight, child: OutlinedButton.icon(
                                  key: ValueKey<String>('wallet-use-${offer.id}'),
                                  onPressed: () {
                                    controller.commerce.setVoucherInput(offer.code);
                                    controller.returnFromCustomerExperience(tabIndex: 3);
                                  },
                                  icon: const Icon(Icons.shopping_bag_outlined),
                                  label: Text(cText(context, 'Use at checkout', 'চেকআউটে ব্যবহার করুন')),
                                )),
                              ]),
                            )),
                        ])),
    );
  }
}

/// Shows first-party bilingual notifications from W1 and marks them read server-side (`c-35`).
class CustomerNotificationsScreen extends StatefulWidget {
  /// Creates the authenticated notification inbox.
  const CustomerNotificationsScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerNotificationsScreen> createState() => _CustomerNotificationsScreenState();
}

class _CustomerNotificationsScreenState extends State<CustomerNotificationsScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.experience.loadNotifications();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final String lang = Localizations.localeOf(context).languageCode;
    final int unread = state.notifications.where((CustomerInboxNotification item) => item.readAt == null).length;
    return Scaffold(
      key: const ValueKey<String>('screen-c-35'),
      appBar: AppBar(title: Text(cText(context, 'Notifications', 'নোটিফিকেশন')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4)), actions: <Widget>[
        IconButton(tooltip: cText(context, 'Refresh', 'রিফ্রেশ'), onPressed: state.notificationsLoading ? null : state.loadNotifications, icon: const Icon(Icons.refresh)),
      ]),
      body: state.notificationsLoading && state.notifications.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.notificationsError != null && state.notifications.isEmpty
              ? Center(child: FilledButton.icon(onPressed: state.loadNotifications, icon: const Icon(Icons.refresh), label: Text(cText(context, 'Try again', 'আবার চেষ্টা করুন'))))
              : state.notifications.isEmpty
                  ? Center(child: Text(cText(context, 'No notifications yet.', 'এখনো কোনো নোটিফিকেশন নেই।')))
                  : Column(children: <Widget>[
                      if (unread > 0) Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () async {
                        final bool saved = await state.markNotificationsRead(const <String>[]);
                        if (!saved && context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Read status could not be saved.', 'পড়ার অবস্থা সংরক্ষণ হয়নি।'))));
                      }, child: Text(cText(context, 'Mark all as read', 'সব পড়া হয়েছে')))),
                      Expanded(child: RefreshIndicator(onRefresh: state.loadNotifications, child: ListView.builder(
                        itemCount: state.notifications.length,
                        itemBuilder: (BuildContext context, int index) {
                          final CustomerInboxNotification item = state.notifications[index];
                          return ListTile(
                            key: ValueKey<String>('notification-${item.id}'),
                            leading: Icon(item.readAt == null ? Icons.mark_email_unread_outlined : Icons.drafts_outlined),
                            title: Text(item.title(lang), style: TextStyle(fontWeight: item.readAt == null ? FontWeight.w700 : FontWeight.normal)),
                            subtitle: Text('${item.body(lang)}\n${_notificationTime(item.createdAt, lang)}'),
                            isThreeLine: true,
                            onTap: item.readAt == null ? () async {
                              final bool saved = await state.markNotificationsRead(<String>[item.id]);
                              if (!saved && context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Read status could not be saved.', 'পড়ার অবস্থা সংরক্ষণ হয়নি।'))));
                            } : null,
                          );
                        },
                      ))),
                    ]),
    );
  }
}

/// Customer profile name editor backed by the current W1 profile (`c-38`).
class CustomerProfileEditScreen extends StatefulWidget {
  /// Creates the profile edit form.
  const CustomerProfileEditScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerProfileEditScreen> createState() => _CustomerProfileEditScreenState();
}

class _CustomerProfileEditScreenState extends State<CustomerProfileEditScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.controller.session?.fullName ?? '');
  bool _initialNameApplied = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    widget.controller.experience.loadProfile();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final CustomerProfileSnapshot? profile = state.profile;
    if (profile != null && !_initialNameApplied) {
      _initialNameApplied = true;
      _name.text = profile.fullName;
    }
    return Scaffold(
      key: const ValueKey<String>('screen-c-38'),
      appBar: AppBar(title: Text(cText(context, 'Edit profile', 'প্রোফাইল সম্পাদনা')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
      body: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
        if (state.profileLoading && profile == null) const LinearProgressIndicator(),
        if (state.profileError != null && profile == null) Text(cText(context, 'Profile could not be loaded. Reconnect and try again.', 'প্রোফাইল লোড হয়নি। সংযোগ চালু করে আবার চেষ্টা করুন।')),
        TextField(controller: _name, maxLength: 120, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: cText(context, 'Full name', 'পূর্ণ নাম')), onChanged: (_) => setState(() {})),
        if (profile?.phone?.isNotEmpty == true) ListTile(leading: const Icon(Icons.phone_outlined), title: Text(cText(context, 'Phone number', 'ফোন নম্বর')), subtitle: Text(profile!.phone!)),
        if (profile?.email?.isNotEmpty == true) ListTile(leading: const Icon(Icons.email_outlined), title: Text(cText(context, 'Email', 'ইমেইল')), subtitle: Text(profile!.email!)),
        Text(cText(context, 'Phone and email are managed by your sign-in method.', 'ফোন ও ইমেইল আপনার লগইন পদ্ধতির মাধ্যমে পরিচালিত হয়。')),
        if (state.profileError != null && profile != null) Text(cText(context, 'Profile update failed. Your current server profile is unchanged.', 'প্রোফাইল আপডেট হয়নি। সার্ভারের বর্তমান তথ্য অপরিবর্তিত।'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        FilledButton.icon(
          key: const ValueKey<String>('profile-save'),
          onPressed: _saving || _name.text.trim().isEmpty || state.profileLoading || profile == null ? null : () async {
            setState(() => _saving = true);
            final bool saved = await state.updateProfile(fullName: _name.text.trim());
            if (mounted && saved) widget.controller.returnFromCustomerExperience(tabIndex: 4);
            if (mounted) setState(() => _saving = false);
          },
          icon: _saving ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          label: Text(cText(context, 'Save profile', 'প্রোফাইল সেভ করুন')),
        ),
      ]),
    );
  }
}

/// Persists English/বাংলা selection in the W1 profile and applies it to the app (`c-39`).
class CustomerLanguageScreen extends StatefulWidget {
  /// Creates the language preference screen.
  const CustomerLanguageScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerLanguageScreen> createState() => _CustomerLanguageScreenState();
}

class _CustomerLanguageScreenState extends State<CustomerLanguageScreen> {
  late String _selected = widget.controller.experience.profile?.language ?? widget.controller.locale.languageCode;
  bool _saving = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        key: const ValueKey<String>('screen-c-39'),
        appBar: AppBar(title: Text(cText(context, 'Language', 'ভাষা')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
        body: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
          RadioListTile<String>(value: 'en', groupValue: _selected, title: const Text('English'), onChanged: (String? value) => setState(() => _selected = value ?? 'en')),
          RadioListTile<String>(value: 'bn', groupValue: _selected, title: const Text('বাংলা'), onChanged: (String? value) => setState(() => _selected = value ?? 'bn')),
          FilledButton(
            key: const ValueKey<String>('language-save'),
            onPressed: _saving ? null : () async {
              setState(() => _saving = true);
              bool saved = true;
              if (widget.controller.isAuthenticated) {
                saved = await widget.controller.experience.updateProfile(language: _selected);
              }
              if (mounted && saved) {
                widget.controller.setLocale(Locale(_selected));
                widget.controller.returnFromCustomerExperience(tabIndex: 4);
              }
              if (mounted) setState(() => _saving = false);
            },
            child: Text(_saving ? cText(context, 'Saving…', 'সেভ হচ্ছে…') : cText(context, 'Save language', 'ভাষা সেভ করুন')),
          ),
        ]),
      );
}

/// Founder-visible non-cash rewards/referral policy gate (`c-33..c-34`).
class CustomerGrowthPolicyScreen extends StatelessWidget {
  /// Creates the rewards or referral capability notice.
  const CustomerGrowthPolicyScreen({super.key, required this.controller, required this.invite});

  /// Root customer controller.
  final CustomerController controller;

  /// True for the friend-invitation screen; false for rewards.
  final bool invite;

  @override
  Widget build(BuildContext context) {
    final String title = invite ? cText(context, 'Invite friends', 'বন্ধুদের আমন্ত্রণ') : cText(context, 'Undal Rewards', 'উন্দাল রিওয়ার্ডস');
    final String body = invite
        ? cText(context, 'Friend invitations are paused until the founder approves referral eligibility, fraud checks, and when a voucher is issued. No invite code or reward status is fabricated.', 'রেফারেল যোগ্যতা, জালিয়াতি প্রতিরোধ ও ভাউচার প্রদানের নিয়ম অনুমোদন না হওয়া পর্যন্ত আমন্ত্রণ বন্ধ। কোনো কোড বা পুরস্কারের অবস্থা বানিয়ে দেখানো হয় না।')
        : cText(context, 'Rewards points are not enabled until the founder approves the earn rate, redemption value, expiry, and voucher limits. No points balance is fabricated or treated as cash.', 'আয়ের হার, বিনিময় মূল্য, মেয়াদ ও ভাউচার সীমা অনুমোদিত না হওয়া পর্যন্ত রিওয়ার্ড পয়েন্ট চালু নয়। কোনো ব্যালেন্স বানিয়ে দেখানো বা নগদ হিসেবে গণনা করা হয় না।');
    return Scaffold(
      key: ValueKey<String>(invite ? 'screen-c-34' : 'screen-c-33'),
      appBar: AppBar(title: Text(title), leading: BackButton(onPressed: () => controller.returnFromCustomerExperience(tabIndex: 4))),
      body: Center(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.xl), child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Icon(invite ? Icons.person_add_alt_1 : Icons.stars_outlined, size: 48, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: UndalSpacingTokens.md),
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: UndalSpacingTokens.sm),
        Text(body, textAlign: TextAlign.center),
        const SizedBox(height: UndalSpacingTokens.md),
        OutlinedButton.icon(onPressed: () => controller.openCustomerExperienceScreen(CustomerScreenId.c36HelpCenter, parentTab: 4), icon: const Icon(Icons.help_outline), label: Text(cText(context, 'Visit Help Center', 'সহায়তা কেন্দ্রে যান'))),
      ]))),
    );
  }
}

/// Starts a real support ticket requesting account deletion; it does not falsely claim immediate erasure (`c-40`).
class CustomerDeleteAccountScreen extends StatefulWidget {
  /// Creates the explicit account-closure request flow.
  const CustomerDeleteAccountScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerDeleteAccountScreen> createState() => _CustomerDeleteAccountScreenState();
}

class _CustomerDeleteAccountScreenState extends State<CustomerDeleteAccountScreen> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        key: const ValueKey<String>('screen-c-40'),
        appBar: AppBar(title: Text(cText(context, 'Delete account', 'অ্যাকাউন্ট মুছুন')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 4))),
        body: Center(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.xl), child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          const Icon(Icons.privacy_tip_outlined, size: 48),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(cText(context, 'Request account deletion', 'অ্যাকাউন্ট মুছে ফেলার অনুরোধ'), style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(cText(context, 'Account deletion needs a verified support review because orders and financial records may still be open. Sending a request opens a private support ticket; it does not immediately close the account or erase records.', 'অর্ডার বা আর্থিক রেকর্ড খোলা থাকতে পারে বলে অ্যাকাউন্ট মুছে ফেলার আগে সহায়তা যাচাই প্রয়োজন। অনুরোধ পাঠালে ব্যক্তিগত সহায়তা টিকিট খোলে; এতে সঙ্গে সঙ্গে অ্যাকাউন্ট বন্ধ বা রেকর্ড মুছে যায় না।'), textAlign: TextAlign.center),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton.icon(
            key: const ValueKey<String>('account-delete-request'),
            onPressed: _busy ? null : () => _requestDeletion(context),
            icon: _busy ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.support_agent),
            label: Text(cText(context, 'Start deletion request', 'মুছে ফেলার অনুরোধ শুরু করুন')),
          ),
        ]))),
      );

  Future<void> _requestDeletion(BuildContext context) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(cText(dialogContext, 'Send a private request?', 'ব্যক্তিগত অনুরোধ পাঠাবেন?')),
        content: Text(cText(dialogContext, 'Support will review the request in a secure ticket. Your account remains active until the request is resolved.', 'নিরাপদ টিকিটে সহায়তা অনুরোধ যাচাই করবে। অনুরোধ নিষ্পত্তি না হওয়া পর্যন্ত অ্যাকাউন্ট চালু থাকবে।')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(cText(dialogContext, 'Cancel', 'বাতিল'))),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(cText(dialogContext, 'Send request', 'অনুরোধ পাঠান'))),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      setState(() => _busy = true);
      final bool created = await widget.controller.experience.createSupportThread(
        category: 'account_deletion',
        subject: cText(context, 'Account deletion request', 'অ্যাকাউন্ট মুছে ফেলার অনুরোধ'),
        body: cText(context, 'I request deletion of my Undal customer account. Please explain any records that must be retained and confirm when the account is closed.', 'আমি আমার উন্দাল গ্রাহক অ্যাকাউন্ট মুছে ফেলার অনুরোধ করছি। সংরক্ষণযোগ্য রেকর্ড থাকলে জানান এবং অ্যাকাউন্ট বন্ধ হলে নিশ্চিত করুন।'),
      );
      if (mounted && !created) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'The request could not be sent. Check your connection and try again.', 'অনুরোধ পাঠানো যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'))));
      }
    }
  }
}

String _notificationTime(DateTime? value, String languageCode) {
  if (value == null) return '';
  final DateTime dhaka = value.toUtc().add(const Duration(hours: 6));
  final String formatted = '${dhaka.year}-${dhaka.month.toString().padLeft(2, '0')}-${dhaka.day.toString().padLeft(2, '0')} ${dhaka.hour.toString().padLeft(2, '0')}:${dhaka.minute.toString().padLeft(2, '0')}';
  return languageCode == 'bn' ? toBengaliDigits(formatted) : formatted;
}

String _voucherBenefit(BuildContext context, CustomerVoucherOffer offer, String locale) => switch (offer.kind) {
      'percent' => cText(context, '${(offer.value / 100).toStringAsFixed(offer.value % 100 == 0 ? 0 : 2)}% off', '${(offer.value / 100).toStringAsFixed(offer.value % 100 == 0 ? 0 : 2)}% ছাড়'),
      'flat' => cText(context, '${formatBdt(offer.value, localeCode: locale)} off', '${formatBdt(offer.value, localeCode: locale)} ছাড়'),
      'free_delivery' => cText(context, 'Free delivery', 'ফ্রি ডেলিভারি'),
      _ => cText(context, 'Voucher offer', 'ভাউচার অফার'),
    };

String _expiry(String raw, String languageCode) {
  final DateTime? instant = DateTime.tryParse(raw);
  if (instant == null) return raw;
  final DateTime date = instant.toUtc().add(const Duration(hours: 6));
  final String dateText = '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  return languageCode == 'bn' ? toBengaliDigits(dateText) : dateText;
}
