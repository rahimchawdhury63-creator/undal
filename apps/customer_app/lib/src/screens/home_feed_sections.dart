/// Modular banners, Flash Box strip, `AP-1` recovery cards & sheets for `CustomerHomeFeedView`.
///
/// Extracted cleanly from `home_feed_screen.dart` so every authored file stays comfortably `< 420` lines.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../data/sylhet_seed_catalog.dart';
import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';

/// Typographic deep-green hero campaign card (`ADR-0006 v2` compliant).
class HomeHeroBannerCard extends StatelessWidget {
  const HomeHeroBannerCard({super.key, required this.controller});
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final HomeBannerModel banner = kSeededHomeBanners.first;
    final String lang = Localizations.localeOf(context).languageCode;
    return Container(
      padding: const EdgeInsets.all(UndalSpacingTokens.lg),
      decoration: BoxDecoration(
        color: Color(UndalLightColors.greenDeep.argb),
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            lang == 'bn' ? banner.titleBn : banner.titleEn,
            style: theme.textTheme.titleLarge?.copyWith(
              color: Color(UndalLightColors.onGreen.argb),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.xs),
          Text(
            lang == 'bn' ? banner.subtitleBn : banner.subtitleEn,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Color(UndalLightColors.onGreen.argb)
                  .withValues(alpha: 0.88),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          FilledButton.tonal(
            style: FilledButton.styleFrom(
              backgroundColor: semantic.sun,
              foregroundColor: semantic.onSun,
            ),
            onPressed: () => controller.updateFilters(
              controller.filters.copyWith(shortcut: banner.targetShortcut),
            ),
            child: Text(lang == 'bn' ? banner.ctaBn : banner.ctaEn),
          ),
        ],
      ),
    );
  }
}

/// Live countdown banner for vendor-funded `Undal Flash Box` (`Decision D-11`).
class HomeFlashBoxStrip extends StatelessWidget {
  const HomeFlashBoxStrip({super.key, required this.secondsLeft});
  final int secondsLeft;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final String lang = Localizations.localeOf(context).languageCode;
    final int mins = secondsLeft ~/ 60;
    final int secs = secondsLeft % 60;
    final String clock =
        '${mins.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';

    return Container(
      key: const ValueKey<String>('flash-box-strip'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      decoration: BoxDecoration(
        color: semantic.flame.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
        border: Border.all(color: semantic.flame),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: UndalSpacingTokens.sm,
        runSpacing: UndalSpacingTokens.xs,
        children: <Widget>[
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.bolt_rounded, color: semantic.flame),
              const SizedBox(width: UndalSpacingTokens.xs),
              Flexible(
                child: Text(
                  lang == 'bn'
                      ? kDefaultFlashBoxWindow.titleBn
                      : kDefaultFlashBoxWindow.titleEn,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: UndalSpacingTokens.sm,
              vertical: UndalSpacingTokens.xxs,
            ),
            decoration: BoxDecoration(
              color: semantic.flame,
              borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
            ),
            child: Text(
              lang == 'bn' ? toBengaliDigits(clock) : clock,
              style: TextStyle(
                fontFamily: UndalTypographyTokens.fontMono,
                fontWeight: FontWeight.w700,
                color: semantic.onFlame,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Recovery card displayed whenever `< 3` open kitchens match an active filter (`AP-1` fix).
class SparseFilterRecoveryCard extends StatelessWidget {
  const SparseFilterRecoveryCard({super.key, required this.onResetFilters});
  final VoidCallback onResetFilters;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    return Container(
      key: const ValueKey<String>('sparse-recovery-ap1'),
      padding: const EdgeInsets.all(UndalSpacingTokens.lg),
      decoration: BoxDecoration(
        color: semantic.infoSoft,
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            cText(
              context,
              'Few open kitchens match this exact filter right now',
              'এই মুহূর্তে এই ফিল্টারে অল্প কয়েকটি খোলা রান্নাঘর রয়েছে',
            ),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.xs),
          Text(
            cText(
              context,
              'Reset filters to explore all freshly cooked meals in Sylhet Sadar or set a reminder on evening kitchens.',
              'সিলেট সদরের সব খোলা রান্নাঘর দেখতে ফিল্টার রিসেট করুন অথবা সন্ধ্যার রান্নাঘরে রিমাইন্ডার দিন।',
            ),
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          FilledButton.icon(
            key: const ValueKey<String>('sparse-clear-filters-cta'),
            onPressed: onResetFilters,
            icon: const Icon(Icons.refresh),
            label: Text(
              cText(context, 'Show all kitchens', 'সব রান্নাঘর দেখুন'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Out-of-zone / paused-expansion-zone card (`Sylhet Sadar` vs `Kulaura`).
class OutsideServiceAreaCard extends StatelessWidget {
  const OutsideServiceAreaCard({super.key, required this.controller});
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final ZoneResolutionVerdict verdict = controller.activeAddress.verdict;
    return Container(
      key: const ValueKey<String>('home-outside-zone-card'),
      padding: const EdgeInsets.all(UndalSpacingTokens.lg),
      decoration: BoxDecoration(
        color: semantic.warningSoft,
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            verdict.isInsidePausedExpansionZone
                ? cText(
                    context,
                    '${verdict.prelaunchZoneNameEn} launches very soon!',
                    '${verdict.prelaunchZoneNameBn} জোনে শীঘ্রই সার্ভিস চালু হচ্ছে!',
                  )
                : cText(
                    context,
                    'Outside active delivery zone',
                    'সক্রিয় ডেলিভারি জোনের বাইরে',
                  ),
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: UndalSpacingTokens.xs),
          Text(
            cText(
              context,
              'Switch pin to ${verdict.nearestZoneNameEn} (${verdict.nearestDistanceKm} km) to browse live kitchens.',
              'লাইভ রান্নাঘর দেখতে ${verdict.nearestZoneNameBn} জোনে পিন পরিবর্তন করুন।',
            ),
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton.icon(
            onPressed: () => controller.openAddressPinScreen(
              initialPoint: kSylhetSadarZone.center,
            ),
            icon: const Icon(Icons.edit_location_alt_outlined),
            label: Text(
              cText(context, 'Switch to Sylhet Sadar', 'সিলেট সদরে যান'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens the Sort & Filter modal bottom sheet (`File 16 §16.2`).
void showFeedFilterSheet(BuildContext context, CustomerController controller) {
  showModalBottomSheet<void>(
    context: context,
    builder: (BuildContext sheetCtx) {
      final List<(FeedSortOption, String, String)> sorts =
          <(FeedSortOption, String, String)>[
        (FeedSortOption.recommended, 'Recommended (rank_v1)', 'প্রস্তাবিত (rank_v1)'),
        (FeedSortOption.fastest, 'Fastest arrival', 'সবচেয়ে দ্রুত'),
        (FeedSortOption.nearest, 'Nearest distance', 'সবচেয়ে কাছে'),
        (FeedSortOption.topRated, 'Highest rated', 'সেরা রেটিং'),
        (FeedSortOption.priceLowToHigh, 'Budget friendly', 'কম বাজেট'),
      ];
      return Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.lg),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                cText(sheetCtx, 'Sort kitchens by', 'রান্নাঘর সাজান'),
                style: Theme.of(sheetCtx).textTheme.titleLarge,
              ),
              const SizedBox(height: UndalSpacingTokens.sm),
              ...sorts.map(((FeedSortOption, String, String) s) {
                final bool isCurrent = controller.filters.sort == s.$1;
                return ListTile(
                  leading: Icon(
                    isCurrent
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                    color: Theme.of(sheetCtx).colorScheme.primary,
                  ),
                  title: Text(cText(sheetCtx, s.$2, s.$3)),
                  onTap: () {
                    controller.updateFilters(
                      controller.filters.copyWith(sort: s.$1),
                    );
                    Navigator.of(sheetCtx).pop();
                  },
                );
              }),
            ],
          ),
        ),
      );
    },
  );
}

/// Opens the public `rank_v1` ranking transparency explainer (`File 13`).
void showRankingExplainerSheet(BuildContext context) {
  showModalBottomSheet<void>(
    context: context,
    builder: (BuildContext sheetCtx) {
      return Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              cText(
                sheetCtx,
                'How Undal rank_v1 works (Constitutional Pledge D-12)',
                'উন্দাল rank_v1 কীভাবে কাজ করে (পেইড র‍্যাঙ্ক নিষিদ্ধ)',
              ),
              style: Theme.of(sheetCtx).textTheme.titleLarge,
            ),
            const SizedBox(height: UndalSpacingTokens.sm),
            Text(
              cText(
                sheetCtx,
                '30% verified customer ratings · 20% prep accuracy · 20% acceptance rate · 15% on-time handover · 15% complaint-free orders + live ETA & max-2 cuisine diversity.',
                '৩০% যাচাইকৃত রিভিউ · ২০% সময়মতো রান্না · ২০% অর্ডার গ্রহণ হার · ১৫% সময়মতো হস্তান্তর · ১৫% অভিযোগমুক্ত অর্ডার। কোনো রান্নাঘর টাকা দিয়ে উপরে উঠতে পারে না।',
              ),
            ),
            const SizedBox(height: UndalSpacingTokens.md),
            FilledButton(
              onPressed: () => Navigator.of(sheetCtx).pop(),
              child: Text(UndalLocalizations.of(sheetCtx).t('common.confirm')),
            ),
          ],
        ),
      );
    },
  );
}
