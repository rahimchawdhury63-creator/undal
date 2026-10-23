/// Canonical UNDAL Bilingual Localisation Delegate (`English` + `বাংলা`, `D-20`, `Appendix H`).
///
/// Mirrors `@undal/shared-ts` (`packages/shared_ts/src/i18n.ts`) and `lib/l10n/app_{en,bn}.arb`
/// 1-to-1 and exposes all 39 `Appendix G` error translations cleanly to every Flutter surface.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../money/undal_money.dart';

/// Supported locales across all UNDAL Flutter apps (`en`, `bn`).
abstract final class UndalSupportedLocales {
  static const List<Locale> all = <Locale>[
    Locale('en'),
    Locale('bn'),
  ];
}

/// Canonical runtime string catalogue and `Appendix G` error resolver.
final class UndalLocalizations {
  const UndalLocalizations(this.locale);

  final Locale locale;

  /// Looks up [UndalLocalizations] from the nearest [Localizations] ancestor.
  static UndalLocalizations of(BuildContext context) {
    return Localizations.of<UndalLocalizations>(context, UndalLocalizations) ??
        const UndalLocalizations(Locale('en'));
  }

  static const LocalizationsDelegate<UndalLocalizations> delegate =
      _UndalLocalizationsDelegate();

  static const Map<String, String> messagesEn = <String, String>{
    'app.name': 'Undal',
    'app.tagline': 'Real food. Real-time. No games.',
    'app.subtitle_food_only':
        'Food delivery & counter pickup across Bangladesh — Cash on Delivery',
    'app.admin_title': 'Undal Super Admin',
    'app.theme_light': 'Light cream',
    'app.theme_dark': 'Dark night',
    'app.switch_language': 'বাংলা',
    'app.zone_active': 'Active zone: {zone}',
    'app.cod_badge': '100% Cash on Delivery · Zero hidden VAT markup',
    'app.status_ready': 'Workspace shell verified and connected to shared tokens',
    'common.continue': 'Continue',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.retry': 'Retry',
    'common.search': 'Search',
    'common.save': 'Save',
    'common.delivery': 'Delivery',
    'common.pickup': 'Pick-up',
    'nav.home': 'Home',
    'nav.search': 'Search',
    'nav.orders': 'Orders',
    'nav.cart': 'Cart',
    'nav.account': 'Account',
    'home.explore_nearby': 'Explore kitchens near you',
    'home.flash_box': 'Flash Box',
    'home.order_again': 'Order again',
    'home.home_kitchens': 'Home Kitchens',
    'cart.title': 'Your cart',
    'cart.add_more': 'Add more items',
    'cart.cutlery_off': 'No cutlery. Thanks for reducing waste!',
    'checkout.cod': 'Cash on Delivery',
    'checkout.pay_counter': 'Pay at counter (cash)',
    'checkout.place_order': 'Place order',
    'checkout.tip_rider': 'Tip your rider (in cash)',
    'order.placed': 'Order placed',
    'order.accepted': 'Kitchen accepted your order',
    'order.preparing': 'Preparing your food',
    'order.rider_assigned': 'Rider assigned',
    'order.picked': 'Picked up — on the way',
    'order.delivered': 'Delivered. Enjoy!',
    'order.cancelled_unreachable': 'Cancelled — kitchen unreachable',
    'vendor.new_order': 'NEW ORDER',
    'vendor.accept': 'Accept',
    'vendor.reject': 'Reject',
    'vendor.prep_time': 'Preparation time',
    'vendor.mark_ready': 'Mark ready',
    'rider.new_offer': 'New delivery offer',
    'rider.accept': 'Accept order',
    'rider.arrived_vendor': 'Arrived at kitchen',
    'rider.scan_qr': 'Scan pickup QR',
    'rider.delivered_btn': 'Delivered — cash collected',
    'rider.cash_gate_title': 'Cash submission due',
    'rider.cash_gate_body':
        'Send the collected cash to the Undal bKash number, then submit the TrxID.',
    'rider.why_this_fare': 'Why this fare?',
    'alarm.test': 'Send test alarm',
    'alarm.armed': 'Alerts ARMED',
    'alarm.at_risk': 'Alerts AT RISK — tap to fix',
    'auth.login': 'Log in',
    'auth.signup': 'Sign up',
    'auth.google': 'Continue with Google',
  };

  static const Map<String, String> messagesBn = <String, String>{
    'app.name': 'উন্দাল',
    'app.tagline': 'আসল খাবার। সত্যিকারের দ্রুত।',
    'app.subtitle_food_only':
        'সারা বাংলাদেশে ফুড ডেলিভারি ও কাউন্টার পিকআপ — ক্যাশ অন ডেলিভারি',
    'app.admin_title': 'উন্দাল সুপার অ্যাডমিন',
    'app.theme_light': 'লাইট ক্রিম',
    'app.theme_dark': 'ডার্ক নাইট',
    'app.switch_language': 'English',
    'app.zone_active': 'সক্রিয় জোন: {zone}',
    'app.cod_badge': '১০০% ক্যাশ অন ডেলিভারি · অতিরিক্ত গোপন ভ্যাট নেই',
    'app.status_ready': 'শেয়ার্ড টোকেন ও লোকালিলাইজেশন সক্রিয় আছে',
    'common.continue': 'চালিয়ে যান',
    'common.cancel': 'বাতিল',
    'common.confirm': 'নিশ্চিত করুন',
    'common.retry': 'আবার চেষ্টা',
    'common.search': 'খুঁজুন',
    'common.save': 'সংরক্ষণ',
    'common.delivery': 'ডেলিভারি',
    'common.pickup': 'পিকআপ',
    'nav.home': 'হোম',
    'nav.search': 'খুঁজুন',
    'nav.orders': 'অর্ডার',
    'nav.cart': 'কার্ট',
    'nav.account': 'অ্যাকাউন্ট',
    'home.explore_nearby': 'কাছের রান্নাঘর দেখুন',
    'home.flash_box': 'ফ্ল্যাশ বক্স',
    'home.order_again': 'আবার অর্ডার করুন',
    'home.home_kitchens': 'হোম কিচেন',
    'cart.title': 'আপনার কার্ট',
    'cart.add_more': 'আরও যোগ করুন',
    'cart.cutlery_off': 'চামচ দেবেন না। বর্জ্য কমানোর জন্য ধন্যবাদ!',
    'checkout.cod': 'ক্যাশ অন ডেলিভারি',
    'checkout.pay_counter': 'কাউন্টারে নগদ দিন',
    'checkout.place_order': 'অর্ডার করুন',
    'checkout.tip_rider': 'রাইডারকে টিপ দিন (নগদে)',
    'order.placed': 'অর্ডার হয়েছে',
    'order.accepted': 'রেস্টুরেন্ট অর্ডার নিয়েছে',
    'order.preparing': 'আপনার খাবার তৈরি হচ্ছে',
    'order.rider_assigned': 'রাইডার নিয়োগ হয়েছে',
    'order.picked': 'রওনা হয়েছে',
    'order.delivered': 'ডেলিভারি হয়েছে। উপভোগ করুন!',
    'order.cancelled_unreachable': 'বাতিল — রেস্টুরেন্টকে পাওয়া যায়নি',
    'vendor.new_order': 'নতুন অর্ডার',
    'vendor.accept': 'গ্রহণ করুন',
    'vendor.reject': 'বাতিল করুন',
    'vendor.prep_time': 'প্রস্তুতির সময়',
    'vendor.mark_ready': 'তৈরি হয়ে গেছে',
    'rider.new_offer': 'নতুন ডেলিভারি অফার',
    'rider.accept': 'অর্ডার নিন',
    'rider.arrived_vendor': 'রেস্টুরেন্টে পৌঁছেছি',
    'rider.scan_qr': 'পিকআপ QR স্ক্যান',
    'rider.delivered_btn': 'ডেলিভারি সম্পন্ন — টাকা নেওয়া হয়েছে',
    'rider.cash_gate_title': 'নগদ টাকা জমা বাকি',
    'rider.cash_gate_body':
        'সংগৃহীত টাকা Undal বিকাশ নম্বরে পাঠিয়ে TrxID জমা দিন।',
    'rider.why_this_fare': 'এই ভাড়া কীভাবে নির্ধারিত হলো?',
    'alarm.test': 'টেস্ট অ্যালার্ম পাঠান',
    'alarm.armed': 'অ্যালার্ট চালু আছে',
    'alarm.at_risk': 'অ্যালার্ট ঝুঁকিতে — ঠিক করতে ট্যাপ করুন',
    'auth.login': 'লগইন',
    'auth.signup': 'সাইন আপ',
    'auth.google': 'Google দিয়ে চালিয়ে যান',
  };

  /// Resolves [key] in the active locale with optional `{token}` interpolation.
  String t(String key, [Map<String, Object>? params]) {
    final bool isBn = locale.languageCode == 'bn';
    final Map<String, String> table = isBn ? messagesBn : messagesEn;
    final String template = table[key] ?? messagesEn[key] ?? key;
    if (params == null || params.isEmpty) return template;
    return template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (Match m) {
      final String name = m.group(1)!;
      final Object? raw = params[name];
      if (raw == null) return m.group(0)!;
      if (isBn && raw is num) return toBengaliDigits(raw.toString());
      return raw.toString();
    });
  }
}

final class _UndalLocalizationsDelegate
    extends LocalizationsDelegate<UndalLocalizations> {
  const _UndalLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) =>
      locale.languageCode == 'en' || locale.languageCode == 'bn';

  @override
  Future<UndalLocalizations> load(Locale locale) =>
      SynchronousFuture<UndalLocalizations>(UndalLocalizations(locale));

  @override
  bool shouldReload(_UndalLocalizationsDelegate old) => false;
}
