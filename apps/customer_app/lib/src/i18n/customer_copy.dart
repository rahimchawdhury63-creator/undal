/// Complete 100%-parity English + বাংলা copy dictionary for `apps/customer_app` (`Build Response 12`).
///
/// Works alongside `UndalLocalizations.of(context)` (`package:undal_core`) so every single widget
/// across `c-01..c-12` renders idiomatic English and বাংলা with zero unlocalized strings (`File 26`).
library;

import 'package:flutter/widgets.dart';
import 'package:undal_core/undal_core.dart';

/// Bilingual helper returning idiomatic `English` or `বাংলা` text for the active [BuildContext].
String cText(BuildContext context, String en, String bn) {
  final Locale locale = Localizations.localeOf(context);
  return locale.languageCode == 'bn' ? bn : en;
}

/// Formats distance clearly for Delivery (`1.4 km`) vs Self-Pickup (`520 m away`, fixing `AP-8`).
String formatPickupReadyAndDistance({
  required String localeCode,
  required int prepMinutes,
  required int distanceMeters,
}) {
  final String distText = distanceMeters < 1000
      ? '$distanceMeters m'
      : '${(distanceMeters / 1000).toStringAsFixed(1)} km';
  if (localeCode == 'bn') {
    return 'প্রস্তুত ~${toBengaliDigits('$prepMinutes')} মি. · ${toBengaliDigits(distText)} দূরে';
  }
  return 'Ready ~$prepMinutes min · $distText away';
}

/// Canonical three-slide value proposition carousel copy for `c-02` (`File 16 §16.1`).
final class OnboardingSlideCopy {
  const OnboardingSlideCopy({
    required this.stepBadge,
    required this.titleEn,
    required this.titleBn,
    required this.bodyEn,
    required this.bodyBn,
  });

  final String stepBadge;
  final String titleEn;
  final String titleBn;
  final String bodyEn;
  final String bodyBn;
}

/// Three skippable onboarding slides highlighting UNDAL's constitutional guarantees.
const List<OnboardingSlideCopy> kOnboardingSlides = <OnboardingSlideCopy>[
  OnboardingSlideCopy(
    stepBadge: '01 / 03',
    titleEn: 'Restaurants, Home Kitchens & Cloud Kitchens',
    titleBn: 'রেস্টুরেন্ট, হোম কিচেন ও ক্লাউড কিচেন এক জায়গায়',
    bodyEn:
        'Order hot Kacchi, Shatkora beef, or homemade Shutki Bhorta across Sylhet — zero non-food clutter.',
    bodyBn:
        'সিলেট জুড়ে গরম কাচ্চি, সাতকরা বিফ কিংবা ঘরোয়া শুটকি ভর্তা অর্ডার করুন — শুধুমাত্র খাঁটি খাবার।',
  ),
  OnboardingSlideCopy(
    stepBadge: '02 / 03',
    titleEn: 'Zero Paid Ads. Pure Merit Ranking (rank_v1)',
    titleBn: 'কোনো পেইড বিজ্ঞাপন নেই — মানের ভিত্তিতে র‍্যাঙ্কিং',
    bodyEn:
        'Kitchens never buy top slots on Undal. Ratings, prep speed, and hygiene decide what you see first.',
    bodyBn:
        'উন্দালে টাকা দিয়ে র‍্যাঙ্ক কেনা যায় না। স্বাদ, দ্রুত প্রস্তুতি ও পরিচ্ছন্নতাই র‍্যাঙ্ক নির্ধারণ করে।',
  ),
  OnboardingSlideCopy(
    stepBadge: '03 / 03',
    titleEn: '100% Cash on Delivery & Honest Bills',
    titleBn: '১০০% ক্যাশ অন ডেলিভারি ও স্বচ্ছ হিসাব',
    bodyEn:
        'Pay cash at your door or pickup counter. Menu prices already include VAT — zero stealth container fees.',
    bodyBn:
        'দরজায় বা কাউন্টারে নগদ পরিশোধ করুন। মেনুর দামেই ভ্যাট অন্তর্ভুক্ত — কোনো গোপন প্যাকেজিং চার্জ নেই।',
  ),
];
