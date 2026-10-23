/// Customer Home Discovery Feed (`c-08` Delivery & `c-09` Self-Pickup Twin, `File 16 §16.2`).
///
/// Orchestrates Delivery ⇄ Pick-up switching, search entry (`c-11`), shortcut & taxonomy rails,
/// filter row, `Flash Box` strip, `Order again` (`0%` Ads `AP-3`), responsive `1->2->3` column
/// `rank_v1` grid, `c-10` Pickup Map entry, and `AP-1` `< 3` Sparse-Filter Recovery!
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../data/sylhet_seed_catalog.dart';
import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';
import '../widgets/vendor_feed_card.dart';
import 'home_feed_sections.dart';

/// Main scrollable discovery view for `c-08` (Delivery) and `c-09` (Self-Pickup).
class CustomerHomeFeedView extends StatelessWidget {
  const CustomerHomeFeedView({
    super.key,
    required this.controller,
    required this.onSelectVendor,
  });

  final CustomerController controller;
  final ValueChanged<VendorFeedCard> onSelectVendor;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalLocalizations l10n = UndalLocalizations.of(context);
    final String lang = Localizations.localeOf(context).languageCode;
    final bool isPickup =
        controller.fulfilmentMode == UndalFulfilmentMode.pickup;
    final List<VendorFeedCard> ranked = controller.rankedFeed;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final int columns = width >= UndalBreakpointTokens.laptop1024
            ? 3
            : (width >= UndalBreakpointTokens.tablet768 ? 2 : 1);

        return CustomScrollView(
          key: ValueKey<String>(isPickup ? 'screen-c-09' : 'screen-c-08'),
          cacheExtent: 1600,
          slivers: <Widget>[
            SliverPadding(
              padding: const EdgeInsets.all(UndalSpacingTokens.md),
              sliver: SliverList(
                delegate: SliverChildListDelegate(<Widget>[
                  _buildHeader(context, theme, scheme, l10n),
                  const SizedBox(height: UndalSpacingTokens.md),
                  _buildShortcutRail(context),
                  const SizedBox(height: UndalSpacingTokens.md),
                  _buildCuisineRail(context, scheme, lang),
                  const SizedBox(height: UndalSpacingTokens.sm),
                  _buildFilterRow(context),
                  const SizedBox(height: UndalSpacingTokens.md),
                  if (!controller.activeAddress.verdict.inServiceArea)
                    OutsideServiceAreaCard(controller: controller)
                  else ...<Widget>[
                    HomeHeroBannerCard(controller: controller),
                    const SizedBox(height: UndalSpacingTokens.md),
                    HomeFlashBoxStrip(
                      secondsLeft: controller.flashSecondsLeft,
                    ),
                    if (isPickup) ...<Widget>[
                      const SizedBox(height: UndalSpacingTokens.md),
                      _buildPickupMapPreviewCard(context, theme, scheme),
                    ],
                    if (controller.filters.activeCount == 0 &&
                        controller.orderAgainVendors.isNotEmpty) ...<Widget>[
                      const SizedBox(height: UndalSpacingTokens.lg),
                      Text(
                        l10n.t('home.order_again'),
                        style: theme.textTheme.titleLarge,
                      ),
                      const SizedBox(height: UndalSpacingTokens.sm),
                      _buildOrderAgainShelf(lang),
                    ],
                    const SizedBox(height: UndalSpacingTokens.lg),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: UndalSpacingTokens.sm,
                      children: <Widget>[
                        Text(
                          isPickup
                              ? cText(
                                  context,
                                  'Pick up hot at kitchen counter',
                                  'কাউন্টার থেকে গরম খাবার নিন',
                                )
                              : l10n.t('home.explore_nearby'),
                          style: theme.textTheme.titleLarge,
                        ),
                        TextButton.icon(
                          key: const ValueKey<String>('how-ranking-works-btn'),
                          onPressed: () => showRankingExplainerSheet(context),
                          icon: const Icon(Icons.verified_outlined, size: 16),
                          label: Text(
                            cText(
                              context,
                              'rank_v1 · 0 Ads',
                              'rank_v1 · বিজ্ঞাপনমুক্ত',
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: UndalSpacingTokens.sm),
                    _buildResponsiveVendorGrid(ranked, columns),
                    if (ranked.length < 3 &&
                        controller.filters.activeCount > 0) ...<Widget>[
                      const SizedBox(height: UndalSpacingTokens.lg),
                      SparseFilterRecoveryCard(
                        onResetFilters: controller.resetAllFilters,
                      ),
                    ],
                  ],
                ]),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildHeader(
    BuildContext context,
    ThemeData theme,
    ColorScheme scheme,
    UndalLocalizations l10n,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: UndalSpacingTokens.sm,
          runSpacing: UndalSpacingTokens.xs,
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Wrap(
              key: const ValueKey<String>('home-mode-toggle'),
              spacing: UndalSpacingTokens.xs,
              runSpacing: UndalSpacingTokens.xs,
              children: <Widget>[
                ChoiceChip(
                  key: const ValueKey<String>('mode-delivery-chip'),
                  avatar: const Icon(Icons.delivery_dining, size: 16),
                  label: Text(l10n.t('common.delivery')),
                  selected:
                      controller.fulfilmentMode == UndalFulfilmentMode.delivery,
                  onSelected: (_) =>
                      controller.setFulfilmentMode(UndalFulfilmentMode.delivery),
                ),
                ChoiceChip(
                  key: const ValueKey<String>('mode-pickup-chip'),
                  avatar: const Icon(Icons.storefront_outlined, size: 16),
                  label: Text(l10n.t('common.pickup')),
                  selected:
                      controller.fulfilmentMode == UndalFulfilmentMode.pickup,
                  onSelected: (_) =>
                      controller.setFulfilmentMode(UndalFulfilmentMode.pickup),
                ),
              ],
            ),
            Text(
              l10n.t('app.cod_badge'),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        OutlinedButton.icon(
          key: const ValueKey<String>('home-search-pill'),
          style: OutlinedButton.styleFrom(
            alignment: Alignment.centerLeft,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: () => controller.selectTab(1),
          icon: const Icon(Icons.search),
          label: Text(
            cText(
              context,
              'Search Kacchi, Shatkora, Shutki, Pitha...',
              'কাচ্চি, সাতকরা, শুটকি, পিঠা বা রান্নাঘর খুঁজুন...',
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  Widget _buildShortcutRail(BuildContext context) {
    final List<(HomeShortcutKind, String, String)> items =
        <(HomeShortcutKind, String, String)>[
      (HomeShortcutKind.all, 'All', 'সব'),
      (HomeShortcutKind.flashBox, 'Flash Box', 'ফ্ল্যাশ বক্স'),
      (HomeShortcutKind.homeKitchens, 'Home Kitchens', 'হোম কিচেন'),
      (HomeShortcutKind.freeDelivery, 'Free Delivery', 'ফ্রি ডেলিভারি'),
      (HomeShortcutKind.topRated, 'Top Rated', 'সেরা রেটিং'),
      (HomeShortcutKind.newKitchens, 'New on Undal', 'নতুন রান্নাঘর'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: items.map(((HomeShortcutKind, String, String) entry) {
          final bool selected = controller.filters.shortcut == entry.$1;
          return Padding(
            padding: const EdgeInsets.only(right: UndalSpacingTokens.xs),
            child: FilterChip(
              key: ValueKey<String>('shortcut-${entry.$1.name}'),
              selected: selected,
              label: Text(cText(context, entry.$2, entry.$3)),
              onSelected: (_) => controller.updateFilters(
                controller.filters.copyWith(
                  shortcut: selected ? HomeShortcutKind.all : entry.$1,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildCuisineRail(
    BuildContext context,
    ColorScheme scheme,
    String lang,
  ) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: kUndalCuisines.map((CuisineChipModel cuisine) {
          final bool selected =
              controller.filters.selectedCuisineKey == cuisine.key;
          return Padding(
            padding: const EdgeInsets.only(right: UndalSpacingTokens.sm),
            child: ChoiceChip(
              key: ValueKey<String>('cuisine-chip-${cuisine.key}'),
              avatar: CircleAvatar(
                backgroundColor: scheme.primary.withValues(alpha: 0.14),
                child: Text(
                  cuisine.monogram,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: scheme.primary,
                  ),
                ),
              ),
              label: Text(cuisine.label(lang)),
              selected: selected,
              onSelected: (_) => controller.updateFilters(
                controller.filters.copyWith(
                  selectedCuisineKey: selected ? null : cuisine.key,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildFilterRow(BuildContext context) {
    return Wrap(
      spacing: UndalSpacingTokens.xs,
      runSpacing: UndalSpacingTokens.xs,
      children: <Widget>[
        ActionChip(
          key: const ValueKey<String>('open-filter-sheet-btn'),
          avatar: const Icon(Icons.tune, size: 16),
          label: Text(
            controller.filters.activeCount > 0
                ? '${cText(context, 'Sort & Filters', 'সর্ট ও ফিল্টার')} (${controller.filters.activeCount})'
                : cText(context, 'Sort & Filters', 'সর্ট ও ফিল্টার'),
          ),
          onPressed: () => showFeedFilterSheet(context, controller),
        ),
        FilterChip(
          label: Text(cText(context, 'Veg options', 'নিরামিষ')),
          selected: controller.filters.vegOnly,
          onSelected: (bool v) => controller.updateFilters(
            controller.filters.copyWith(vegOnly: v),
          ),
        ),
        FilterChip(
          label: Text(cText(context, 'Open now', 'এখন খোলা')),
          selected: controller.filters.openNowOnly,
          onSelected: (bool v) => controller.updateFilters(
            controller.filters.copyWith(openNowOnly: v),
          ),
        ),
        if (controller.filters.activeCount > 0)
          TextButton(
            key: const ValueKey<String>('clear-filters-btn'),
            onPressed: controller.resetAllFilters,
            child: Text(cText(context, 'Reset filters', 'ফিল্টার মুছুন')),
          ),
      ],
    );
  }

  Widget _buildPickupMapPreviewCard(
    BuildContext context,
    ThemeData theme,
    ColorScheme scheme,
  ) {
    return Container(
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
        border: Border.all(color: scheme.outline),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: UndalSpacingTokens.sm,
        runSpacing: UndalSpacingTokens.sm,
        children: <Widget>[
          Text(
            cText(
              context,
              'View pickup counters on interactive OpenStreetMap',
              'ইন্টারঅ্যাক্টিভ ম্যাপে পিকআপ কাউন্টারগুলো দেখুন',
            ),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          FilledButton.icon(
            key: const ValueKey<String>('open-pickup-map-c10-btn'),
            onPressed: controller.openPickupFullMap,
            icon: const Icon(Icons.map_outlined),
            label: Text(
              cText(context, 'Open Pickup View', 'পিকআপ ম্যাপ'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderAgainShelf(String lang) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: controller.orderAgainVendors.map((VendorFeedCard v) {
          return Padding(
            padding: const EdgeInsets.only(right: UndalSpacingTokens.sm),
            child: ActionChip(
              avatar: const Icon(Icons.history, size: 16),
              label: Text('${v.brandName(lang)} · ★${v.ratingAvg}'),
              onPressed: () => onSelectVendor(v),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildResponsiveVendorGrid(List<VendorFeedCard> vendors, int columns) {
    if (columns <= 1) {
      return Column(
        children: vendors
            .map(
              (VendorFeedCard v) => Padding(
                padding: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
                child: VendorFeedCardTile(
                  vendor: v,
                  fulfilmentMode: controller.fulfilmentMode,
                  isFavourite: controller.favouriteVendorIds.contains(v.id),
                  notifyArmed: controller.notifyWhenOpenIds.contains(v.id),
                  onTapCard: () => onSelectVendor(v),
                  onToggleFavourite: () =>
                      controller.toggleFavouriteVendor(v.id),
                  onToggleNotifyOpen: () =>
                      controller.toggleNotifyWhenOpen(v.id),
                ),
              ),
            )
            .toList(),
      );
    }

    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < vendors.length; i += columns) {
      final List<VendorFeedCard> slice = vendors.skip(i).take(columns).toList();
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: List<Widget>.generate(columns, (int col) {
              if (col >= slice.length) {
                return const Expanded(child: SizedBox.shrink());
              }
              final VendorFeedCard v = slice[col];
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                    right: col < columns - 1 ? UndalSpacingTokens.md : 0,
                  ),
                  child: VendorFeedCardTile(
                    vendor: v,
                    fulfilmentMode: controller.fulfilmentMode,
                    isFavourite: controller.favouriteVendorIds.contains(v.id),
                    notifyArmed: controller.notifyWhenOpenIds.contains(v.id),
                    onTapCard: () => onSelectVendor(v),
                    onToggleFavourite: () =>
                        controller.toggleFavouriteVendor(v.id),
                    onToggleNotifyOpen: () =>
                        controller.toggleNotifyWhenOpen(v.id),
                  ),
                ),
              );
            }),
          ),
        ),
      );
    }
    return Column(children: rows);
  }
}
