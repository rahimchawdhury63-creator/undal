/// Configured single-vendor basket screen (`c-18`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_cart_models.dart';
import '../models/storefront_menu_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// Full configured single-vendor cart shown in the Cart navigation destination (`c-18`).
class CustomerCartScreen extends StatelessWidget {
  /// Creates the c-18 cart body.
  const CustomerCartScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final List<BasketLineItem> lines = commerce.basket;
    final String lang = Localizations.localeOf(context).languageCode;
    final ThemeData theme = Theme.of(context);
    if (lines.isEmpty) {
      return Center(
        key: const ValueKey<String>('screen-c-18'),
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.shopping_bag_outlined, size: 48, color: theme.colorScheme.primary),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(cText(context, 'Your basket is empty', 'আপনার কার্ট খালি'), style: theme.textTheme.titleLarge),
              const SizedBox(height: UndalSpacingTokens.sm),
              FilledButton(onPressed: () => controller.selectTab(0), child: Text(cText(context, 'Explore kitchens', 'রান্নাঘর দেখুন'))),
            ],
          ),
        ),
      );
    }
    final OrderMoneySnapshot localQuote = commerce.displayQuote;
    final Map<String, Object?>? serverQuote = commerce.serverQuote;
    final int subtotal = _quotePoisha(serverQuote, 'items_poisha') ?? commerce.itemsSubtotalPoisha;
    final int cod = _quotePoisha(serverQuote, 'cod_collect_poisha') ?? localQuote.codCollectPoisha;
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-18'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(cText(context, 'Your basket', 'আপনার কার্ট'), style: theme.textTheme.headlineSmall),
          Text(lines.first.dish.vendorName(lang), style: theme.textTheme.titleMedium),
          if (!commerce.canPlaceLiveOrder)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xs),
              child: Text(cText(context, 'Only a current W1 menu and an authenticated account can place an order. Saved dishes remain browse-only.', 'অর্ডারের জন্য বর্তমান W1 মেনু ও লগইন করা অ্যাকাউন্ট লাগবে। সংরক্ষিত খাবার শুধু দেখার জন্য।'), style: theme.textTheme.bodySmall),
            ),
          if (commerce.serverCartConflict)
            Card(
              color: theme.colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(cText(context, 'Another kitchen already has a server cart.', 'সার্ভারে অন্য রান্নাঘরের কার্ট আছে।'), style: theme.textTheme.titleMedium),
                    Text(cText(context, 'Confirm to replace that cart. Its items will be removed.', 'সার্ভার কার্ট বদলালে আগের খাবারগুলো মুছে যাবে।')),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        key: const ValueKey<String>('cart-confirm-server-replacement'),
                        onPressed: () async {
                          final bool ok = await commerce.confirmServerCartReplacement();
                          if (!context.mounted) return;
                          if (!ok) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_commerceMessage(context, commerce.commerceErrorCode))));
                        },
                        child: Text(cText(context, 'Replace server cart', 'সার্ভার কার্ট বদলান')),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          for (final BasketLineItem line in lines)
            Card(
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(line.dish.name(lang), style: theme.textTheme.titleMedium),
                    if (_basketSelectionSummary(line, lang).isNotEmpty) Text(_basketSelectionSummary(line, lang)),
                    Text(formatBdt(line.lineTotalPoisha, localeCode: lang)),
                    if (line.specialInstructions.isNotEmpty) Text(cText(context, 'Note: ${line.specialInstructions}', 'নোট: ${line.specialInstructions}')),
                    Row(
                      children: <Widget>[
                        IconButton(
                          tooltip: cText(context, 'Decrease quantity', 'পরিমাণ কমান'),
                          onPressed: commerce.orderResolutionPending ? null : () => commerce.decrementLine(line.lineKey),
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        Text('${line.quantity}'),
                        IconButton(
                          tooltip: cText(context, 'Increase quantity', 'পরিমাণ বাড়ান'),
                          onPressed: line.quantity < 50 && !commerce.orderResolutionPending
                              ? () => commerce.incrementLine(line.lineKey)
                              : null,
                          icon: const Icon(Icons.add_circle_outline),
                        ),
                        const Spacer(),
                        IconButton(
                          tooltip: cText(context, 'Remove item', 'খাবার সরান'),
                          onPressed: commerce.orderResolutionPending ? null : () => commerce.removeLine(line.lineKey),
                          icon: const Icon(Icons.delete_outline),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(cText(context, 'Fulfilment', 'অর্ডার নেওয়ার ধরন'), style: theme.textTheme.titleMedium),
          Wrap(
            spacing: UndalSpacingTokens.xs,
            children: <Widget>[
              ChoiceChip(
                key: const ValueKey<String>('cart-delivery-mode'),
                label: Text(cText(context, 'Delivery', 'ডেলিভারি')),
                selected: controller.fulfilmentMode == UndalFulfilmentMode.delivery,
                onSelected: commerce.orderResolutionPending
                    ? null
                    : (_) => commerce.setFulfilment(UndalFulfilmentMode.delivery),
              ),
              ChoiceChip(
                key: const ValueKey<String>('cart-pickup-mode'),
                label: Text(cText(context, 'Pickup', 'পিকআপ')),
                selected: controller.fulfilmentMode == UndalFulfilmentMode.pickup,
                onSelected: commerce.orderResolutionPending
                    ? null
                    : (_) {
                  if (!commerce.setFulfilment(UndalFulfilmentMode.pickup)) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'This kitchen has not enabled pickup.', 'এই রান্নাঘর পিকআপ চালু করেনি।'))));
                  }
                },
              ),
            ],
          ),
          TextButton.icon(
            key: const ValueKey<String>('cart-open-voucher-picker'),
            onPressed: commerce.orderResolutionPending ? null : commerce.openVoucherPicker,
            icon: const Icon(Icons.local_offer_outlined),
            label: Text(commerce.appliedVoucherCode == null
                ? cText(context, 'Enter a voucher', 'ভাউচার কোড দিন')
                : cText(context, 'Voucher ${commerce.appliedVoucherCode} applied', 'ভাউচার ${commerce.appliedVoucherCode} যুক্ত হয়েছে')),
          ),
          const Divider(height: UndalSpacingTokens.xl),
          _MoneyRow(label: cText(context, 'Items subtotal', 'খাবারের উপমোট'), amount: subtotal, lang: lang),
          if (serverQuote != null) ...<Widget>[
            _MoneyRow(label: cText(context, 'Discounts', 'ছাড়'), amount: _quotePoisha(serverQuote, 'discount_total_poisha') ?? 0, lang: lang),
            _MoneyRow(label: cText(context, 'Delivery', 'ডেলিভারি'), amount: _quotePoisha(serverQuote, 'delivery_fee_poisha') ?? 0, lang: lang),
            _MoneyRow(label: cText(context, 'Platform fee', 'প্ল্যাটফর্ম ফি'), amount: _quotePoisha(serverQuote, 'platform_fee_poisha') ?? 0, lang: lang),
          ] else
            Text(cText(context, 'Estimate only · W1 confirms the exact COD amount in checkout.', 'শুধু আনুমানিক · চেকআউটে W1 সঠিক COD মূল্য নিশ্চিত করবে।'), style: theme.textTheme.bodySmall),
          _MoneyRow(label: cText(context, 'Cash to collect', 'নগদ দিতে হবে'), amount: cod, lang: lang, bold: true),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton.icon(
            key: const ValueKey<String>('cart-open-checkout'),
            onPressed: commerce.canStartCheckout ? commerce.openCheckout : null,
            icon: const Icon(Icons.payments_outlined),
            label: Text(cText(context, 'Continue to checkout', 'চেকআউটে যান')),
          ),
        ],
      ),
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({required this.label, required this.amount, required this.lang, this.bold = false});

  final String label;
  final int amount;
  final String lang;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final TextStyle? base = bold ? Theme.of(context).textTheme.titleMedium : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(label, style: base)),
          Text(formatBdt(amount, localeCode: lang), style: base?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

String _basketSelectionSummary(BasketLineItem line, String lang) {
  final List<String> labels = <String>[];
  if (line.variantId != null) {
    for (final StorefrontVariantGroup group in line.item.variantGroups) {
      final StorefrontChoice? variant = group.variants.where((StorefrontChoice row) => row.id == line.variantId).firstOrNull;
      if (variant != null) labels.add(variant.label(lang));
    }
  }
  for (final Map<String, Object?> selected in line.selections) {
    if (selected['kind'] == 'option') {
      for (final StorefrontChoiceGroup group in line.item.optionGroups) {
        if (group.id != selected['group_id']) continue;
        final StorefrontChoice? choice = group.choices.where((StorefrontChoice row) => row.id == selected['option_id']).firstOrNull;
        if (choice != null) labels.add(choice.label(lang));
      }
    } else if (selected['kind'] == 'bundle') {
      for (final BundleSlot slot in line.item.bundleSlots) {
        if (slot.id != selected['slot_id']) continue;
        final BundleSlotChoice? choice = slot.choices.where((BundleSlotChoice row) => row.itemId == selected['item_id']).firstOrNull;
        if (choice != null) labels.add(choice.label(lang));
      }
    }
  }
  return labels.join(' · ');
}

int? _quotePoisha(Map<String, Object?>? quote, String key) {
  final Object? raw = quote?[key];
  if (raw is int && raw >= 0) return raw;
  if (raw is String) {
    final int? parsed = int.tryParse(raw);
    if (parsed != null && parsed >= 0) return parsed;
  }
  return null;
}

