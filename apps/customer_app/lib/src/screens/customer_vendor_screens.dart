/// Storefront, public kitchen information and verified-buyer reviews (`c-13`, `c-16`, `c-17`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/storefront_menu_models.dart';
import '../models/storefront_vendor_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// Full public menu view backed by the current W1 storefront snapshot.
class CustomerVendorStorefrontScreen extends StatelessWidget {
  /// Creates the c-13 storefront screen.
  const CustomerVendorStorefrontScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final VendorStorefront? snapshot = commerce.storefront;
    if (snapshot == null) {
      return Scaffold(
        key: const ValueKey<String>('screen-c-13'),
        appBar: AppBar(leading: BackButton(onPressed: () => controller.selectTab(controller.selectedTabIndex))),
        body: Center(child: Text(cText(context, 'Kitchen details are unavailable.', 'রান্নাঘরের তথ্য পাওয়া যাচ্ছে না।'))),
      );
    }
    final String lang = Localizations.localeOf(context).languageCode;
    final StorefrontVendorSummary vendor = snapshot.vendor;
    final ThemeData theme = Theme.of(context);
    final List<Widget> sections = <Widget>[
      if (vendor.coverImgbbUrl != null)
        ClipRRect(
          borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
          child: Image.network(
            vendor.coverImgbbUrl!,
            height: 180,
            width: double.infinity,
            fit: BoxFit.cover,
            errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
                const SizedBox(height: 24),
          ),
        ),
      if (commerce.storefrontLoading)
        const LinearProgressIndicator(minHeight: 2),
      if (!snapshot.isLiveSnapshot || commerce.storefrontUnavailable)
        _NoticeCard(
          icon: Icons.cloud_off_outlined,
          text: commerce.storefrontUnavailable
              ? cText(context, 'W1 could not refresh this menu. The saved catalog is browse-only; ordering is unavailable.', 'লাইভ মেনু আপডেট হয়নি। সংরক্ষিত মেনু শুধু দেখার জন্য; অর্ডার করা যাবে না।')
              : cText(context, 'This saved catalog is a preview only. Connect to W1 for current availability and checkout.', 'সংরক্ষিত মেনুটি শুধু প্রিভিউ। বর্তমান মজুত ও চেকআউটের জন্য W1-এ সংযোগ করুন।'),
          actionLabel: commerce.storefrontUnavailable
              ? cText(context, 'Try again', 'আবার চেষ্টা করুন')
              : null,
          onAction: commerce.storefrontUnavailable ? commerce.retryStorefront : null,
        ),
      Card(
        elevation: 0,
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  if (vendor.logoImgbbUrl != null) ...<Widget>[
                    ClipOval(
                      child: Image.network(
                        vendor.logoImgbbUrl!,
                        width: 52,
                        height: 52,
                        fit: BoxFit.cover,
                        errorBuilder: (BuildContext context, Object error, StackTrace? stack) => const SizedBox.shrink(),
                      ),
                    ),
                    const SizedBox(width: UndalSpacingTokens.sm),
                  ],
                  Expanded(child: Text(vendor.brandName(lang), style: theme.textTheme.headlineSmall)),
                ],
              ),
              const SizedBox(height: UndalSpacingTokens.xxs),
              Text('${vendor.publicArea(lang)} · ★ ${vendor.ratingAverage.toStringAsFixed(1)} (${vendor.ratingCount})'),
              const SizedBox(height: UndalSpacingTokens.xs),
              Wrap(
                spacing: UndalSpacingTokens.xs,
                children: <Widget>[
                  Chip(label: Text(_statusLabel(context, vendor.operationalStatus))),
                  if (vendor.hygieneVerified)
                    Chip(avatar: const Icon(Icons.verified_outlined), label: Text(cText(context, 'Hygiene verified', 'স্বাস্থ্যবিধি যাচাইকৃত'))),
                  if (vendor.acceptsPickup)
                    Chip(avatar: const Icon(Icons.qr_code_2), label: Text(cText(context, 'QR counter pickup', 'কাউন্টারে QR পিকআপ'))),
                ],
              ),
              Text(cText(context, 'Minimum order: ${formatBdt(vendor.minOrderPoisha, localeCode: lang)} · Prep: ${vendor.prepMinutes} min', 'ন্যূনতম অর্ডার: ${formatBdt(vendor.minOrderPoisha, localeCode: lang)} · প্রস্তুতি: ${vendor.prepMinutes} মিনিট')),
              const SizedBox(height: UndalSpacingTokens.xs),
              Wrap(
                spacing: UndalSpacingTokens.sm,
                children: <Widget>[
                  OutlinedButton.icon(
                    key: const ValueKey<String>('storefront-kitchen-info'),
                    onPressed: commerce.openVendorInfo,
                    icon: const Icon(Icons.info_outline),
                    label: Text(cText(context, 'Kitchen & hours', 'রান্নাঘর ও সময়সূচি')),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey<String>('storefront-verified-reviews'),
                    onPressed: commerce.openVendorReviews,
                    icon: const Icon(Icons.star_outline),
                    label: Text(cText(context, 'Verified reviews', 'যাচাইকৃত রিভিউ')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      if (snapshot.categories.isEmpty)
        _NoticeCard(
          icon: Icons.restaurant_menu,
          text: cText(context, 'No public menu items are available right now.', 'এখন কোনো পাবলিক মেনু আইটেম নেই।'),
        ),
      for (final StorefrontCategory category in snapshot.categories) ...<Widget>[
        Text(category.label(lang), style: theme.textTheme.titleLarge),
        for (final StorefrontMenuItem item in category.items)
          Card(
            elevation: 0,
            child: Padding(
              padding: const EdgeInsets.all(UndalSpacingTokens.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (item.dish.imgbbUrl != null) ...<Widget>[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(UndalRadiusTokens.sm),
                      child: Image.network(
                        item.dish.imgbbUrl!,
                        width: 72,
                        height: 72,
                        fit: BoxFit.cover,
                        errorBuilder: (BuildContext context, Object error, StackTrace? stack) => const SizedBox.shrink(),
                      ),
                    ),
                    const SizedBox(width: UndalSpacingTokens.sm),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(item.dish.name(lang), style: theme.textTheme.titleMedium),
                        if (item.dish.description(lang).isNotEmpty) Text(item.dish.description(lang)),
                        Text(formatBdt(item.dish.pricePoisha, localeCode: lang), style: theme.textTheme.titleSmall),
                        if (!item.isOrderable)
                          Text(cText(context, 'Currently unavailable', 'এখন পাওয়া যাচ্ছে না'), style: TextStyle(color: theme.colorScheme.error)),
                      ],
                    ),
                  ),
                  const SizedBox(width: UndalSpacingTokens.xs),
                  OutlinedButton(
                    key: ValueKey<String>('storefront-customize-${item.dish.id}'),
                    onPressed: item.isOrderable &&
                            (!snapshot.isLiveSnapshot || vendor.operationalStatus == 'open')
                        ? () => commerce.openItem(item)
                        : null,
                    child: Text(cText(context, 'Customize', 'পছন্দ ঠিক করুন')),
                  ),
                ],
              ),
            ),
          ),
      ],
    ];
    return Scaffold(
      key: const ValueKey<String>('screen-c-13'),
      appBar: AppBar(
        title: Text(vendor.brandName(lang), maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: IconButton(
          tooltip: cText(context, 'Back to kitchens', 'রান্নাঘরে ফিরুন'),
          onPressed: () => controller.selectTab(controller.selectedTabIndex),
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (final Widget section in sections) ...<Widget>[
                section,
                const SizedBox(height: UndalSpacingTokens.md),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Privacy-safe kitchen profile and published weekly operating hours.
class CustomerVendorInfoScreen extends StatelessWidget {
  /// Creates the c-16 information screen.
  const CustomerVendorInfoScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final VendorStorefront? snapshot = controller.commerce.storefront;
    if (snapshot == null) return const Scaffold(body: SizedBox.shrink());
    final String lang = Localizations.localeOf(context).languageCode;
    final StorefrontVendorSummary vendor = snapshot.vendor;
    final ThemeData theme = Theme.of(context);
    final List<String> weekdays = lang == 'bn'
        ? const <String>['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি']
        : const <String>['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return Scaffold(
      key: const ValueKey<String>('screen-c-16'),
      appBar: AppBar(
        title: Text(cText(context, 'Kitchen information', 'রান্নাঘরের তথ্য')),
        leading: IconButton(onPressed: controller.commerce.backToStorefront, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(vendor.brandName(lang), style: theme.textTheme.headlineSmall),
              const SizedBox(height: UndalSpacingTokens.sm),
              ListTile(leading: const Icon(Icons.location_on_outlined), title: Text(vendor.publicArea(lang)), subtitle: Text(cText(context, 'Public service area', 'পাবলিক সার্ভিস এলাকা'))),
              ListTile(leading: const Icon(Icons.restaurant_outlined), title: Text(_vendorTypeLabel(context, vendor.vendorType)), subtitle: Text(cText(context, 'Kitchen type', 'রান্নাঘরের ধরন'))),
              ListTile(
                leading: Icon(vendor.hygieneVerified ? Icons.verified_outlined : Icons.info_outline),
                title: Text(vendor.hygieneVerified ? cText(context, 'Hygiene checks verified', 'স্বাস্থ্যবিধি যাচাই হয়েছে') : cText(context, 'No public hygiene verification badge', 'পাবলিক স্বাস্থ্যবিধি যাচাই ব্যাজ নেই')),
              ),
              ListTile(
                leading: const Icon(Icons.qr_code_2),
                title: Text(vendor.acceptsPickup ? cText(context, 'QR handover at the pickup counter', 'পিকআপ কাউন্টারে QR হস্তান্তর') : cText(context, 'Counter pickup is not offered', 'কাউন্টার পিকআপ নেই')),
                subtitle: vendor.acceptsPickup && vendor.pickupPointLabel != null ? Text(vendor.pickupPointLabel!) : null,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(cText(context, 'Weekly hours · Asia/Dhaka', 'সাপ্তাহিক সময় · Asia/Dhaka'), style: theme.textTheme.titleLarge),
              if (snapshot.openingHours.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.sm),
                  child: Text(cText(context, 'The kitchen has not published weekly hours.', 'রান্নাঘরটি সাপ্তাহিক সময় প্রকাশ করেনি।')),
                )
              else
                for (final VendorOpeningHours row in snapshot.openingHours)
                  ListTile(
                    dense: true,
                    title: Text(weekdays[row.weekday.clamp(0, 6)]),
                    subtitle: Text(_hoursLabel(context, row)),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Moderated public reviews tied by W1 to completed-order verified buyers.
class CustomerVendorReviewsScreen extends StatelessWidget {
  /// Creates the c-17 verified-reviews screen.
  const CustomerVendorReviewsScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final VendorStorefront? snapshot = commerce.storefront;
    if (snapshot == null) return const Scaffold(body: SizedBox.shrink());
    final String lang = Localizations.localeOf(context).languageCode;
    final ThemeData theme = Theme.of(context);
    final List<Widget> children = <Widget>[
      if (commerce.reviewsLoading) const LinearProgressIndicator(minHeight: 2),
      if (commerce.reviewsUnavailable)
        _NoticeCard(icon: Icons.cloud_off_outlined, text: cText(context, 'Verified reviews could not be loaded. Please reconnect and try again.', 'যাচাইকৃত রিভিউ লোড হয়নি। সংযোগ করে আবার চেষ্টা করুন।')),
      if (!commerce.reviewsLoading && !commerce.reviewsUnavailable && commerce.reviewsLoaded && commerce.reviews.isEmpty)
        _NoticeCard(icon: Icons.rate_review_outlined, text: cText(context, 'No published verified-buyer reviews yet.', 'এখনো কোনো প্রকাশিত যাচাইকৃত ক্রেতার রিভিউ নেই।')),
      for (final CustomerVendorReview review in commerce.reviews)
        Card(
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: UndalSpacingTokens.xs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Text('★' * review.rating, style: theme.textTheme.titleMedium),
                    Chip(avatar: const Icon(Icons.verified_outlined), label: Text(cText(context, 'Verified buyer', 'যাচাইকৃত ক্রেতা'))),
                    if (review.createdAt != null) Text(MaterialLocalizations.of(context).formatShortDate(review.createdAt!.toLocal())),
                  ],
                ),
                if (review.aspectTags.isNotEmpty)
                  Wrap(spacing: UndalSpacingTokens.xxs, children: review.aspectTags.map((String tag) => Chip(label: Text(_reviewTagLabel(context, tag)))).toList()),
                Text(review.comment ?? cText(context, 'Rating shared without a written comment.', 'লিখিত মন্তব্য ছাড়া রেটিং দেওয়া হয়েছে।')),
                for (final String url in review.photoUrls)
                  Padding(
                    padding: const EdgeInsets.only(top: UndalSpacingTokens.xs),
                    child: Image.network(url, height: 160, fit: BoxFit.cover, errorBuilder: (BuildContext context, Object error, StackTrace? stack) => const SizedBox.shrink()),
                  ),
                if (review.vendorReply != null)
                  Padding(
                    padding: const EdgeInsets.only(top: UndalSpacingTokens.sm),
                    child: Text(cText(context, 'Kitchen reply: ${review.vendorReply}', 'রান্নাঘরের উত্তর: ${review.vendorReply}')),
                  ),
              ],
            ),
          ),
        ),
    ];
    return Scaffold(
      key: const ValueKey<String>('screen-c-17'),
      appBar: AppBar(
        title: Text(cText(context, 'Verified reviews · ${snapshot.vendor.brandName(lang)}', 'যাচাইকৃত রিভিউ · ${snapshot.vendor.brandName(lang)}'), maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: IconButton(onPressed: commerce.backToStorefront, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.icon, required this.text, this.actionLabel, this.onAction});

  final IconData icon;
  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Card(
        elevation: 0,
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(icon),
              const SizedBox(height: UndalSpacingTokens.xs),
              Text(text),
              if (actionLabel != null && onAction != null)
                Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: onAction, child: Text(actionLabel!))),
            ],
          ),
        ),
      );
}

String _statusLabel(BuildContext context, String status) => switch (status) {
      'open' => cText(context, 'Open now', 'এখন খোলা'),
      'busy' => cText(context, 'Busy', 'ব্যস্ত'),
      'closed' || 'closed_hours' => cText(context, 'Closed', 'বন্ধ'),
      'paused' => cText(context, 'Temporarily paused', 'সাময়িক বিরতি'),
      'suspended' => cText(context, 'Unavailable', 'পাওয়া যাচ্ছে না'),
      _ => cText(context, 'Status unavailable', 'অবস্থা পাওয়া যায়নি'),
    };

String _vendorTypeLabel(BuildContext context, String type) => switch (type) {
      'HOME_KITCHEN' => cText(context, 'Home kitchen', 'হোম কিচেন'),
      'CLOUD_KITCHEN' => cText(context, 'Cloud kitchen', 'ক্লাউড কিচেন'),
      _ => cText(context, 'Restaurant', 'রেস্তোরাঁ'),
    };

String _reviewTagLabel(BuildContext context, String tag) => switch (tag) {
      'cv_taste_great' || 'hot_fresh' => cText(context, 'Authentic taste', 'দারুণ স্বাদ'),
      'cv_generous_portion' || 'generous_portion' => cText(context, 'Generous portion', 'পর্যাপ্ত পরিমাণ'),
      'cv_sealed_packaging' => cText(context, 'Clean, spill-free packaging', 'পরিচ্ছন্ন, লিকমুক্ত প্যাকেজিং'),
      'cv_missing_or_wrong_item' => cText(context, 'Missing or wrong item', 'ভুল বা কম আইটেম'),
      _ => tag,
    };

String _hoursLabel(BuildContext context, VendorOpeningHours row) {
  if (row.isClosed) return cText(context, 'Closed', 'বন্ধ');
  final List<String> shifts = <String>[
    if (row.open1 != null && row.close1 != null) '${row.open1}–${row.close1}',
    if (row.open2 != null && row.close2 != null) '${row.open2}–${row.close2}',
  ];
  return shifts.isEmpty ? cText(context, 'Hours unavailable', 'সময় পাওয়া যায়নি') : shifts.join(' · ');
}
