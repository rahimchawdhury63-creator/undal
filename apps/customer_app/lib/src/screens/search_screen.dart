/// Instant Bilingual + Banglish Search Home (`c-11`) & Results (`c-12`, `File 16 §16.3`).
///
/// Implements:
/// - `c-11` Pre-query landing: clearable on-device Recent Searches, organic Zone Trending chips
///   (strictly zero `[Sponsored]` keywords per `D-12`), and Cuisine quick-jump grid.
/// - `c-12` Live results: `All / Kitchens / Dishes` scopes, matched dishes with quick `+ Add`
///   to basket (`1-tap` inline counter per `W04`), matched `rank_v1` kitchen cards, and `AP-1`
///   typo-tolerant `"Did you mean ...?"` + popular nearby recovery!
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../data/sylhet_seed_catalog.dart';
import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../services/customer_api_client.dart';
import '../state/customer_controller.dart';
import '../widgets/vendor_feed_card.dart';
import 'companion_tabs.dart';

/// Unified Search view rendering `c-11` when query is empty and `c-12` when query is active.
class CustomerSearchView extends StatefulWidget {
  const CustomerSearchView({
    super.key,
    required this.controller,
    required this.onSelectVendor,
  });

  final CustomerController controller;
  final ValueChanged<VendorFeedCard> onSelectVendor;

  @override
  State<CustomerSearchView> createState() => _CustomerSearchViewState();
}

class _CustomerSearchViewState extends State<CustomerSearchView> {
  late final TextEditingController _inputCtrl =
      TextEditingController(text: widget.controller.searchQuery);

  @override
  void didUpdateWidget(covariant CustomerSearchView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_inputCtrl.text != widget.controller.searchQuery) {
      _inputCtrl.value = TextEditingValue(
        text: widget.controller.searchQuery,
        selection: TextSelection.collapsed(
          offset: widget.controller.searchQuery.length,
        ),
      );
    }
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController ctrl = widget.controller;
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final String lang = Localizations.localeOf(context).languageCode;
    final bool hasQuery = ctrl.searchQuery.trim().isNotEmpty;

    return SingleChildScrollView(
      key: ValueKey<String>(hasQuery ? 'screen-c-12' : 'screen-c-11'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextField(
            key: const ValueKey<String>('search-query-input'),
            controller: _inputCtrl,
            textInputAction: TextInputAction.search,
            onChanged: (String v) => ctrl.setSearchQuery(v),
            onSubmitted: (String v) =>
                ctrl.setSearchQuery(v, recordRecent: true),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              suffixIcon: hasQuery
                  ? IconButton(
                      key: const ValueKey<String>('search-clear-btn'),
                      tooltip: UndalLocalizations.of(context).t('common.cancel'),
                      onPressed: () {
                        _inputCtrl.clear();
                        ctrl.setSearchQuery('');
                      },
                      icon: const Icon(Icons.clear),
                    )
                  : null,
              hintText: cText(
                context,
                'Search in English, বাংলা or Banglish (biriyani, shutki)...',
                'ইংরেজি, বাংলা বা বাংলিশে খুঁজুন (বিরিয়ানি, shutki)...',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          if (!hasQuery)
            ..._buildPreQueryLanding(context, ctrl, theme, scheme, lang)
          else
            ..._buildSearchResults(
              context: context,
              ctrl: ctrl,
              theme: theme,
              scheme: scheme,
              semantic: semantic,
              lang: lang,
            ),
        ],
      ),
    );
  }

  List<Widget> _buildPreQueryLanding(
    BuildContext context,
    CustomerController ctrl,
    ThemeData theme,
    ColorScheme scheme,
    String lang,
  ) {
    return <Widget>[
      if (ctrl.recentSearches.isNotEmpty) ...<Widget>[
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text(
              cText(context, 'Recent searches', 'সাম্প্রতিক খোঁজ'),
              style: theme.textTheme.titleMedium,
            ),
            TextButton(
              key: const ValueKey<String>('clear-recent-searches-btn'),
              onPressed: ctrl.clearRecentSearches,
              child: Text(cText(context, 'Clear all', 'সব মুছুন')),
            ),
          ],
        ),
        Wrap(
          spacing: UndalSpacingTokens.xs,
          runSpacing: UndalSpacingTokens.xs,
          children: ctrl.recentSearches.map((String term) {
            return ActionChip(
              avatar: const Icon(Icons.history, size: 16),
              label: Text(term),
              onPressed: () => ctrl.setSearchQuery(term, recordRecent: true),
            );
          }).toList(),
        ),
        const SizedBox(height: UndalSpacingTokens.lg),
      ],
      Text(
        cText(
          context,
          'Trending in Sylhet Sadar (organic)',
          'সিলেট সদরে এখন জনপ্রিয়',
        ),
        style: theme.textTheme.titleMedium,
      ),
      const SizedBox(height: UndalSpacingTokens.sm),
      Wrap(
        spacing: UndalSpacingTokens.xs,
        runSpacing: UndalSpacingTokens.xs,
        children: kSylhetTrendingSearches.map(((String, String) item) {
          final String text = lang == 'bn' ? item.$2 : item.$1;
          return ActionChip(
            avatar: Icon(Icons.trending_up, size: 16, color: scheme.primary),
            label: Text(text),
            onPressed: () => ctrl.setSearchQuery(text, recordRecent: true),
          );
        }).toList(),
      ),
      const SizedBox(height: UndalSpacingTokens.lg),
      Text(
        cText(context, 'Popular cuisines', 'জনপ্রিয় ক্যাটাগরি'),
        style: theme.textTheme.titleMedium,
      ),
      const SizedBox(height: UndalSpacingTokens.sm),
      Wrap(
        spacing: UndalSpacingTokens.sm,
        runSpacing: UndalSpacingTokens.sm,
        children: kUndalCuisines.map((CuisineChipModel c) {
          return OutlinedButton.icon(
            onPressed: () =>
                ctrl.setSearchQuery(c.label(lang), recordRecent: true),
            icon: Text(
              c.monogram,
              style: TextStyle(
                fontWeight: FontWeight.w800,
                color: scheme.primary,
              ),
            ),
            label: Text(c.label(lang)),
          );
        }).toList(),
      ),
    ];
  }

  List<Widget> _buildSearchResults({
    required BuildContext context,
    required CustomerController ctrl,
    required ThemeData theme,
    required ColorScheme scheme,
    required UndalSemanticColors semantic,
    required String lang,
  }) {
    final SearchQueryResult result = ctrl.searchResults;
    final bool emptyAll = result.vendors.isEmpty && result.dishes.isEmpty;

    return <Widget>[
      Wrap(
        key: const ValueKey<String>('c12-scope-tabs'),
        spacing: UndalSpacingTokens.xs,
        runSpacing: UndalSpacingTokens.xs,
        children: <Widget>[
          ChoiceChip(
            label: Text(cText(context, 'All', 'সব')),
            selected: ctrl.searchScope == SearchScopeTab.all,
            onSelected: (_) => ctrl.setSearchScope(SearchScopeTab.all),
          ),
          ChoiceChip(
            label: Text(
              '${cText(context, 'Kitchens', 'রান্নাঘর')} (${result.vendors.length})',
            ),
            selected: ctrl.searchScope == SearchScopeTab.kitchens,
            onSelected: (_) => ctrl.setSearchScope(SearchScopeTab.kitchens),
          ),
          ChoiceChip(
            label: Text(
              '${cText(context, 'Dishes', 'খাবার')} (${result.dishes.length})',
            ),
            selected: ctrl.searchScope == SearchScopeTab.dishes,
            onSelected: (_) => ctrl.setSearchScope(SearchScopeTab.dishes),
          ),
        ],
      ),
      const SizedBox(height: UndalSpacingTokens.md),
      if (emptyAll)
        _buildZeroResultRecovery(
          context: context,
          ctrl: ctrl,
          result: result,
          theme: theme,
          semantic: semantic,
          lang: lang,
        )
      else ...<Widget>[
        if (ctrl.searchScope != SearchScopeTab.kitchens &&
            result.dishes.isNotEmpty) ...<Widget>[
          Text(
            cText(context, 'Matched dishes', 'মিল পাওয়া খাবার'),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          ...result.dishes.map(
            (CatalogDishItem dish) => Padding(
              padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm),
              child: _DishResultRow(
                dish: dish,
                isOffline: ctrl.isOffline,
                onAdd: () => addDishWithConflictConfirmation(context, ctrl, dish),
              ),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
        ],
        if (ctrl.searchScope != SearchScopeTab.dishes &&
            result.vendors.isNotEmpty) ...<Widget>[
          Text(
            cText(context, 'Matched kitchens', 'মিল পাওয়া রান্নাঘর'),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          ...result.vendors.map(
            (VendorFeedCard v) => Padding(
              padding: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
              child: VendorFeedCardTile(
                vendor: v,
                fulfilmentMode: ctrl.fulfilmentMode,
                isFavourite: ctrl.favouriteVendorIds.contains(v.id),
                notifyArmed: ctrl.notifyWhenOpenIds.contains(v.id),
                onTapCard: () => widget.onSelectVendor(v),
                onToggleFavourite: () => ctrl.toggleFavouriteVendor(v.id),
                onToggleNotifyOpen: () => ctrl.toggleNotifyWhenOpen(v.id),
              ),
            ),
          ),
        ],
      ],
    ];
  }

  Widget _buildZeroResultRecovery({
    required BuildContext context,
    required CustomerController ctrl,
    required SearchQueryResult result,
    required ThemeData theme,
    required UndalSemanticColors semantic,
    required String lang,
  }) {
    final String? suggestion =
        lang == 'bn' ? result.didYouMeanBn : result.didYouMeanEn;
    return Container(
      key: const ValueKey<String>('c12-zero-result-recovery'),
      padding: const EdgeInsets.all(UndalSpacingTokens.lg),
      decoration: BoxDecoration(
        color: semantic.warningSoft,
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            cText(
              context,
              'No exact dish or kitchen matched "${result.query}"',
              '"${result.query}" এর সাথে সরাসরি কোনো খাবার বা রান্নাঘর মেলেনি',
            ),
            style: theme.textTheme.titleMedium,
          ),
          if (suggestion != null) ...<Widget>[
            const SizedBox(height: UndalSpacingTokens.sm),
            FilledButton.tonal(
              key: const ValueKey<String>('c12-did-you-mean-btn'),
              onPressed: () =>
                  ctrl.setSearchQuery(suggestion, recordRecent: true),
              child: Text(
                cText(
                  context,
                  'Did you mean "$suggestion"?',
                  'আপনি কি "$suggestion" খুঁজছেন?',
                ),
              ),
            ),
          ],
          const SizedBox(height: UndalSpacingTokens.sm),
          Wrap(
            spacing: UndalSpacingTokens.xs,
            runSpacing: UndalSpacingTokens.xs,
            children: kSylhetTrendingSearches.take(3).map(
              ((String, String) alt) {
                final String t = lang == 'bn' ? alt.$2 : alt.$1;
                return ActionChip(
                  label: Text(t),
                  onPressed: () => ctrl.setSearchQuery(t, recordRecent: true),
                );
              },
            ).toList(),
          ),
        ],
      ),
    );
  }
}

class _DishResultRow extends StatelessWidget {
  const _DishResultRow({
    required this.dish,
    required this.isOffline,
    required this.onAdd,
  });

  final CatalogDishItem dish;
  final bool isOffline;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final String lang = Localizations.localeOf(context).languageCode;

    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
        side: BorderSide(color: scheme.outline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.md),
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: UndalSpacingTokens.sm,
          runSpacing: UndalSpacingTokens.sm,
          children: <Widget>[
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    dish.name(lang),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    '${dish.vendorName(lang)} · ${formatBdt(dish.pricePoisha, localeCode: lang)}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            FilledButton.icon(
              key: ValueKey<String>('add-dish-${dish.id}'),
              onPressed: isOffline ? null : onAdd,
              icon: const Icon(Icons.add, size: 18),
              label: Text(cText(context, 'Add', 'যোগ করুন')),
            ),
          ],
        ),
      ),
    );
  }
}
