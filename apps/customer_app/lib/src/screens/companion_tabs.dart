/// Functional `Orders`, `Cart`, `Account` & single-vendor Quick Menu Sheet (`Build Responses 12–13`).
///
/// Ensures every navigation destination and kitchen card action executes real state-backed logic,
/// with explicit kitchen-replacement confirmation and a full W1 storefront route.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_cart_models.dart';
import '../models/customer_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// Opens a clean interactive preview sheet of a kitchen's authentic menu & quick `+ Add` actions.
void showVendorQuickMenuSheet(
  BuildContext context, {
  required CustomerController controller,
  required VendorFeedCard vendor,
}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (BuildContext ctx) {
      final ThemeData theme = Theme.of(ctx);
      final String lang = Localizations.localeOf(ctx).languageCode;
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.lg),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  vendor.brandName(lang),
                  style: theme.textTheme.headlineMedium,
                ),
                const SizedBox(height: UndalSpacingTokens.xxs),
                Text(
                  '${vendor.publicArea(lang)} · ★ ${vendor.ratingAvg.toStringAsFixed(1)} (${vendor.ratingCount})',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: UndalSpacingTokens.md),
                FilledButton.tonalIcon(
                  key: const ValueKey<String>('quick-menu-open-full-storefront'),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    controller.commerce.openVendor(vendor);
                  },
                  icon: const Icon(Icons.restaurant_menu),
                  label: Text(cText(ctx, 'Open full live menu', 'সম্পূর্ণ লাইভ মেনু দেখুন')),
                ),
                const SizedBox(height: UndalSpacingTokens.sm),
                ...vendor.dishes.map((CatalogDishItem d) {
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(d.name(lang)),
                    subtitle: Text(
                      '${d.description(lang)}\n${formatBdt(d.pricePoisha, localeCode: lang)}',
                    ),
                    trailing: FilledButton(
                      key: ValueKey<String>('quick-menu-add-${d.id}'),
                      onPressed: controller.isOffline
                          ? null
                          : () async {
                              final CartAddResult result = await addDishWithConflictConfirmation(ctx, controller, d);
                              if (ctx.mounted && (result == CartAddResult.added || result == CartAddResult.requiresLiveRefresh)) {
                                Navigator.of(ctx).pop();
                              }
                            },
                      child: Text(cText(ctx, 'Add', 'যোগ করুন')),
                    ),
                  );
                }),
              ],
            ),
          ),
        ),
      );
    },
  );
}

/// Adds a catalog dish with a confirmation dialog before replacing another kitchen's basket.
Future<CartAddResult> addDishWithConflictConfirmation(
  BuildContext context,
  CustomerController controller,
  CatalogDishItem dish,
) async {
  CartAddResult result = controller.tryAddDishToBasket(dish);
  if (result == CartAddResult.vendorConflict) {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(cText(dialogContext, 'Replace current kitchen?', 'বর্তমান রান্নাঘর বদলাবেন?')),
        content: Text(cText(dialogContext, 'Your basket has items from another kitchen. Replacing it removes those items.', 'আপনার কার্টে অন্য রান্নাঘরের খাবার আছে। বদলালে সেগুলো মুছে যাবে।')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(cText(dialogContext, 'Keep basket', 'কার্ট রাখুন'))),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(cText(dialogContext, 'Replace kitchen', 'রান্নাঘর বদলান'))),
        ],
      ),
    );
    if (!context.mounted || confirmed != true) return CartAddResult.vendorConflict;
    result = controller.tryAddDishToBasket(dish, confirmVendorReplacement: true);
  }
  if (!context.mounted) return result;
  if (result == CartAddResult.added) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Added to your basket.', 'আপনার কার্টে যোগ হয়েছে।'))));
  } else if (result == CartAddResult.offline) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Reconnect before adding an item.', 'খাবার যোগ করার আগে সংযোগ চালু করুন।'))));
  } else if (result == CartAddResult.requiresLiveRefresh) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Open the live kitchen menu before adding.', 'খাবার যোগ করতে লাইভ রান্নাঘরের মেনু দেখুন।'))));
  }
  return result;
}

/// Live `Cart` tab (`5th` primary nav slot) computing canonical `priceOrder()` integer poisha.
class CustomerQuickCartTab extends StatelessWidget {
  const CustomerQuickCartTab({super.key, required this.controller});
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String lang = Localizations.localeOf(context).languageCode;
    final UndalLocalizations l10n = UndalLocalizations.of(context);

    if (controller.basket.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.shopping_bag_outlined,
                size: 48,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(l10n.t('cart.title'), style: theme.textTheme.titleLarge),
              const SizedBox(height: UndalSpacingTokens.xs),
              Text(
                cText(
                  context,
                  'Your basket is empty — explore fresh kitchens in Sylhet Sadar.',
                  'আপনার কার্ট খালি — সিলেট সদরের রান্নাঘরগুলো দেখুন।',
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              FilledButton(
                onPressed: () => controller.selectTab(0),
                child: Text(l10n.t('home.explore_nearby')),
              ),
            ],
          ),
        ),
      );
    }

    final int itemsPoisha = controller.basket.fold<int>(
      0,
      (int s, BasketLineItem l) => s + l.lineTotalPoisha,
    );
    final OrderMoneySnapshot snap = priceOrder(
      OrderPricingInput(
        fulfilment: controller.fulfilmentMode,
        itemsPoisha: itemsPoisha,
        discountVendorPoisha: 0,
        discountPlatformPoisha: 0,
        deliveryFeePoisha:
            controller.fulfilmentMode == UndalFulfilmentMode.pickup ? 0 : 4000,
        platformFeePoisha: 500,
      ),
    );

    return ListView(
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      children: <Widget>[
        Text(l10n.t('cart.title'), style: theme.textTheme.headlineMedium),
        const SizedBox(height: UndalSpacingTokens.md),
        ...controller.basket.map((BasketLineItem line) {
          return Card(
            elevation: 0,
            child: ListTile(
              title: Text(line.dish.name(lang)),
              subtitle: Text(
                formatBdt(line.lineTotalPoisha, localeCode: lang),
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  IconButton(
                    tooltip: '-',
                    onPressed: () =>
                        controller.decrementBasketItem(line.dish.id),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                  Text('${line.quantity}'),
                  IconButton(
                    tooltip: '+',
                    onPressed: () => controller.addDishToBasket(line.dish),
                    icon: const Icon(Icons.add_circle_outline),
                  ),
                ],
              ),
            ),
          );
        }),
        const Divider(height: UndalSpacingTokens.xl),
        _MoneyLine(
          label: cText(context, 'Food subtotal (VAT-inclusive)', 'খাবারের মূল্য (ভ্যাটসহ)'),
          value: formatBdt(snap.foodPayablePoisha, localeCode: lang),
        ),
        _MoneyLine(
          label: l10n.t('common.delivery'),
          value: formatBdt(snap.deliveryFeePoisha, localeCode: lang),
        ),
        _MoneyLine(
          label: cText(context, 'Platform service fee', 'প্ল্যাটফর্ম ফি'),
          value: formatBdt(snap.platformFeePoisha, localeCode: lang),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        _MoneyLine(
          label: l10n.t('checkout.cod'),
          value: formatBdt(snap.codCollectPoisha, localeCode: lang),
          bold: true,
        ),
      ],
    );
  }
}

class _MoneyLine extends StatelessWidget {
  const _MoneyLine({
    required this.label,
    required this.value,
    this.bold = false,
  });

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final TextStyle? base = bold
        ? Theme.of(context).textTheme.titleMedium
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Expanded(child: Text(label, style: base)),
          Text(value, style: base?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
