/// Configured single-vendor basket screen (`c-18`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_cart_models.dart';
import 'customer_checkout_components.dart';
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
    final int subtotal = customerQuotePoisha(serverQuote, 'items_poisha') ?? commerce.itemsSubtotalPoisha;
    final int cod = customerQuotePoisha(serverQuote, 'cod_collect_poisha') ?? localQuote.codCollectPoisha;
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-18'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const CustomerCheckoutProgress(activeStep: 1),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(cText(context, 'Your basket', 'আপনার কার্ট'), style: theme.textTheme.headlineSmall),
          Text(lines.first.dish.vendorName(lang), style: theme.textTheme.titleMedium),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const ValueKey<String>('cart-add-more'),
              onPressed: commerce.orderResolutionPending || commerce.storefront == null
                  ? null
                  : commerce.backToStorefront,
              icon: const Icon(Icons.add),
              label: Text(cText(context, 'Add more from this kitchen', 'এই রান্নাঘর থেকে আরও খাবার নিন')),
            ),
          ),
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
                          if (!ok) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_cartCommerceMessage(context, commerce.commerceErrorCode))));
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
                    Text(_cartLinePriceLabel(context, line, serverQuote, lang)),
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
                        TextButton.icon(
                          key: ValueKey<String>('cart-edit-line-${line.lineKey}'),
                          onPressed: commerce.orderResolutionPending ? null : () => commerce.editBasketLine(line.lineKey),
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: Text(cText(context, 'Edit', 'সম্পাদনা')),
                        ),
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
                label: Text(cText(context, 'Pickup · QR handover', 'পিকআপ · QR হ্যান্ডওভার')),
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
          if (controller.fulfilmentMode == UndalFulfilmentMode.pickup)
            Padding(
              padding: const EdgeInsets.only(top: UndalSpacingTokens.xs),
              child: Text(cText(
                context,
                'Counter handover is QR-only. No cash is exchanged at the counter; the rider collects COD.',
                'কাউন্টারে শুধু QR হ্যান্ডওভার হবে। সেখানে নগদ লেনদেন নয়; রাইডার COD সংগ্রহ করবেন।',
              )),
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
          CustomerMoneyRow(label: cText(context, 'Items subtotal', 'খাবারের উপমোট'), amountPoisha: subtotal, localeCode: lang),
          if (serverQuote != null) ...<Widget>[
            CustomerMoneyRow(label: cText(context, 'Discounts', 'ছাড়'), amountPoisha: customerQuotePoisha(serverQuote, 'discount_total_poisha') ?? 0, localeCode: lang),
            CustomerMoneyRow(
              label: cText(context, 'Delivery', 'ডেলিভারি'),
              amountPoisha: customerQuoteBaseDeliveryPoisha(serverQuote, includePriority: commerce.priority),
              localeCode: lang,
            ),
            if (commerce.priority)
              CustomerMoneyRow(
                label: cText(context, 'Priority delivery fee', 'অগ্রাধিকার ডেলিভারি ফি'),
                amountPoisha: customerQuotePoisha(serverQuote, 'priority_delivery_fee_poisha') ?? 0,
                localeCode: lang,
              ),
            CustomerMoneyRow(label: cText(context, 'Platform fee', 'প্ল্যাটফর্ম ফি'), amountPoisha: customerQuotePoisha(serverQuote, 'platform_fee_poisha') ?? 0, localeCode: lang),
            CustomerMoneyRow(label: cText(context, 'Tip', 'টিপ'), amountPoisha: customerQuotePoisha(serverQuote, 'tip_poisha') ?? 0, localeCode: lang),
          ] else ...<Widget>[
            Text(cText(context, 'Estimate only · W1 confirms current item prices and COD in checkout.', 'শুধু আনুমানিক · চেকআউটে W1 খাবারের বর্তমান মূল্য ও COD নিশ্চিত করবে।'), style: theme.textTheme.bodySmall),
            TextButton.icon(
              key: const ValueKey<String>('cart-refresh-price'),
              onPressed: commerce.canPlaceLiveOrder && !commerce.quoteLoading ? commerce.refreshServerQuote : null,
              icon: commerce.quoteLoading
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh),
              label: Text(cText(context, 'Refresh server price', 'সার্ভারের মূল্য আপডেট করুন')),
            ),
          ],
          CustomerMoneyRow(
            label: serverQuote == null
                ? cText(context, 'Estimated cash to collect', 'আনুমানিক নগদ দিতে হবে')
                : cText(context, 'Cash to collect', 'নগদ দিতে হবে'),
            amountPoisha: cod,
            localeCode: lang,
            emphasized: true,
          ),
          if (commerce.commerceErrorCode != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xs),
              child: Text(_cartCommerceMessage(context, commerce.commerceErrorCode), style: TextStyle(color: theme.colorScheme.error)),
            ),
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

String _cartCommerceMessage(BuildContext context, String? code) => switch (code) {
      'CART_VENDOR_CONFLICT' => cText(context, 'Confirm replacing the other kitchen cart.', 'অন্য রান্নাঘরের কার্ট বদল নিশ্চিত করুন।'),
      'NETWORK_UNAVAILABLE' => cText(context, 'Reconnect and try again.', 'ইন্টারনেট চালু করে আবার চেষ্টা করুন।'),
      'VOUCHER_FIRST_ORDER_ONLY' => cText(context, 'This voucher is only valid for a first order.', 'এই ভাউচার শুধু প্রথম অর্ডারে প্রযোজ্য।'),
      'VOUCHER_BUDGET_EXHAUSTED' => cText(context, 'This voucher budget is no longer available.', 'ভাউচারের বাজেট শেষ।'),
      'VOUCHER_LIMIT_REACHED' => cText(context, 'This voucher reached its use limit.', 'ভাউচারটির ব্যবহারের সীমা শেষ।'),
      'VOUCHER_MIN_ORDER' => cText(context, 'The basket does not meet this voucher minimum.', 'কার্টে ভাউচারের ন্যূনতম মূল্য নেই।'),
      'OUT_OF_ZONE' => cText(context, 'This address is outside the kitchen delivery area.', 'এই ঠিকানা রান্নাঘরের ডেলিভারি এলাকার বাইরে।'),
      'BELOW_MIN_ORDER' => cText(context, 'The basket is below the kitchen minimum.', 'কার্ট রান্নাঘরের ন্যূনতম অর্ডারের কম।'),
      _ => cText(context, 'W1 could not refresh this cart. Review it and try again.', 'W1 কার্ট আপডেট করতে পারেনি। আবার চেষ্টা করুন।'),
    };

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

String _cartLinePriceLabel(
  BuildContext context,
  BasketLineItem line,
  Map<String, Object?>? quote,
  String lang,
) {
  if (quote == null) return formatBdt(line.lineTotalPoisha, localeCode: lang);
  final Map<String, Object?>? row = _quotedCartLine(quote, line);
  final int? amount = customerQuotePoisha(row, 'line_poisha');
  return amount == null
      ? cText(context, 'W1 line price unavailable; refresh the quote.', 'W1 খাবারের মূল্য পাওয়া যায়নি; কোট আপডেট করুন।')
      : formatBdt(amount, localeCode: lang);
}

Map<String, Object?>? _quotedCartLine(Map<String, Object?> quote, BasketLineItem line) {
  final Object? raw = quote['line_items'];
  if (raw is! List<Object?>) return null;
  for (final Map<String, Object?> row in raw.whereType<Map<String, Object?>>()) {
    if (row['menu_item_id'] != line.dish.id ||
        row['variant_id'] != line.variantId ||
        _quoteInteger(row['qty']) != line.quantity ||
        _selectionSignature(row['selections']) != _selectionSignature(line.selections)) {
      continue;
    }
    return row;
  }
  return null;
}

String _selectionSignature(Object? raw) {
  final Iterable<Map<String, Object?>> rows = raw is List<Object?>
      ? raw.whereType<Map<String, Object?>>()
      : const <Map<String, Object?>>[];
  final List<String> signatures = rows.map((Map<String, Object?> row) {
    final List<String> entries = row.entries.map((MapEntry<String, Object?> entry) => '${entry.key}=${entry.value}').toList()..sort();
    return entries.join('&');
  }).toList()..sort();
  return signatures.join('|');
}

int? _quoteInteger(Object? raw) {
  if (raw is int && raw >= 0) return raw;
  if (raw is String) return int.tryParse(raw);
  return null;
}

