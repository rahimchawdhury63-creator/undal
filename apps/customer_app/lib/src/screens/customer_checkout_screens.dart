/// Voucher, COD checkout and server-confirmed receipt screens (`c-19..c-21`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_cart_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// User-entered voucher code picker; W1 remains authoritative for redemption rules (`c-19`).
class CustomerVoucherPickerScreen extends StatelessWidget {
  /// Creates the c-19 voucher picker.
  const CustomerVoucherPickerScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    return Scaffold(
      key: const ValueKey<String>('screen-c-19'),
      appBar: AppBar(
        title: Text(cText(context, 'Voucher code', 'ভাউচার কোড')),
        leading: IconButton(onPressed: commerce.backToCart, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(cText(context, 'Enter a voucher code to ask W1 to verify it. Discounts and limits are confirmed by the server.', 'W1-এ যাচাই করার জন্য ভাউচার কোড দিন। ছাড় ও সীমা সার্ভার নিশ্চিত করবে।')),
              const SizedBox(height: UndalSpacingTokens.md),
              TextFormField(
                key: const ValueKey<String>('voucher-code-input'),
                initialValue: commerce.voucherInput,
                textCapitalization: TextCapitalization.characters,
                maxLength: 32,
                decoration: InputDecoration(labelText: cText(context, 'Voucher code', 'ভাউচার কোড'), border: const OutlineInputBorder()),
                onChanged: commerce.setVoucherInput,
              ),
              if (commerce.appliedVoucherCode != null)
                Chip(label: Text(cText(context, 'Applied: ${commerce.appliedVoucherCode}', 'যুক্ত হয়েছে: ${commerce.appliedVoucherCode}'))),
              if (commerce.voucherErrorCode != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xs),
                  child: Text(_voucherMessage(context, commerce.voucherErrorCode), style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              FilledButton.icon(
                key: const ValueKey<String>('voucher-apply'),
                onPressed: commerce.voucherInput.trim().length >= 3 && !commerce.orderResolutionPending
                    ? () async {
                        final bool applied = await commerce.applyVoucher();
                        if (applied && context.mounted) commerce.backToCart();
                      }
                    : null,
                icon: const Icon(Icons.verified_outlined),
                label: Text(cText(context, 'Verify voucher', 'ভাউচার যাচাই করুন')),
              ),
              if (commerce.appliedVoucherCode != null)
                TextButton.icon(
                  key: const ValueKey<String>('voucher-remove'),
                  onPressed: commerce.orderResolutionPending
                      ? null
                      : () async {
                    final bool removed = await commerce.removeVoucher();
                    if (removed && context.mounted) commerce.backToCart();
                  },
                  icon: const Icon(Icons.remove_circle_outline),
                  label: Text(cText(context, 'Remove voucher', 'ভাউচার সরান')),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Cash-on-Delivery delivery or pay-at-counter pickup checkout with a current W1 quote (`c-20`).
class CustomerCheckoutScreen extends StatelessWidget {
  /// Creates the c-20 checkout screen.
  const CustomerCheckoutScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    final Map<String, Object?>? quote = commerce.serverQuote;
    final int? cod = _quotePoisha(quote, 'cod_collect_poisha');
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey<String>('screen-c-20'),
      appBar: AppBar(
        title: Text(cText(context, 'Cash-on-Delivery checkout', 'ক্যাশ অন ডেলিভারি চেকআউট')),
        leading: IconButton(onPressed: commerce.backToCart, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (commerce.orderResolutionPending && !commerce.checkoutBusy)
                _CheckoutNotice(
                  text: cText(context, 'W1 has not confirmed whether the previous request placed an order. Retry below with the same idempotency key; do not edit this basket.', 'আগের অনুরোধে অর্ডার হয়েছে কি না W1 নিশ্চিত করেনি। একই অনুরোধে আবার চেষ্টা করুন; কার্ট বদলাবেন না।'),
                ),
              if (commerce.serverCartConflict)
                _CheckoutNotice(
                  text: cText(context, 'A different kitchen cart needs your confirmation.', 'অন্য রান্নাঘরের সার্ভার কার্ট নিশ্চিত করতে হবে।'),
                  action: cText(context, 'Review cart', 'কার্ট দেখুন'),
                  onPressed: commerce.backToCart,
                ),
              Text(cText(context, 'Fulfilment', 'অর্ডার নেওয়ার ধরন'), style: theme.textTheme.titleMedium),
              Wrap(
                spacing: UndalSpacingTokens.xs,
                children: <Widget>[
                  ChoiceChip(
                    key: const ValueKey<String>('checkout-delivery-mode'),
                    label: Text(cText(context, 'Delivery', 'ডেলিভারি')),
                    selected: controller.fulfilmentMode == UndalFulfilmentMode.delivery,
                    onSelected: commerce.orderResolutionPending
                        ? null
                        : (_) => commerce.setFulfilment(UndalFulfilmentMode.delivery),
                  ),
                  ChoiceChip(
                    key: const ValueKey<String>('checkout-pickup-mode'),
                    label: Text(cText(context, 'Pickup', 'পিকআপ')),
                    selected: controller.fulfilmentMode == UndalFulfilmentMode.pickup,
                    onSelected: commerce.orderResolutionPending || !commerce.pickupAvailable
                        ? null
                        : (_) => commerce.setFulfilment(UndalFulfilmentMode.pickup),
                  ),
                ],
              ),
              Card(
                elevation: 0,
                child: ListTile(
                  leading: Icon(controller.fulfilmentMode == UndalFulfilmentMode.pickup ? Icons.qr_code_2 : Icons.location_on_outlined),
                  title: Text(controller.fulfilmentMode == UndalFulfilmentMode.pickup
                      ? cText(context, 'Pay cash at the kitchen counter', 'রান্নাঘরের কাউন্টারে নগদে পরিশোধ করুন')
                      : cText(context, 'Deliver to ${controller.activeAddress.label}', '${controller.activeAddress.label}-এ পৌঁছে দিন')),
                  subtitle: Text(controller.fulfilmentMode == UndalFulfilmentMode.pickup
                      ? cText(context, 'Counter pickup is available only when enabled by this kitchen. No online payment.', 'রান্নাঘর চালু করলে কাউন্টার পিকআপ পাওয়া যাবে। অনলাইন পেমেন্ট নেই।')
                      : '${controller.activeAddress.addressText}\n${controller.activeAddress.landmarkNote}'),
                ),
              ),
              const SizedBox(height: UndalSpacingTokens.sm),
              Text(cText(context, 'Cash tip', 'নগদ টিপ'), style: theme.textTheme.titleMedium),
              Wrap(
                spacing: UndalSpacingTokens.xs,
                children: <Widget>[
                  for (final int amount in <int>[0, 2000, 5000])
                    ChoiceChip(
                      key: ValueKey<String>('checkout-tip-$amount'),
                      label: Text(amount == 0 ? cText(context, 'No tip', 'টিপ নয়') : formatBdt(amount, localeCode: lang)),
                      selected: commerce.tipPoisha == amount,
                      onSelected: controller.fulfilmentMode == UndalFulfilmentMode.pickup || commerce.orderResolutionPending
                          ? null
                          : (_) => commerce.setTipPoisha(amount),
                    ),
                ],
              ),
              SwitchListTile(
                key: const ValueKey<String>('checkout-cutlery-toggle'),
                contentPadding: EdgeInsets.zero,
                title: Text(cText(context, 'Include disposable cutlery', 'ডিসপোজেবল কাটলারি দিন')),
                value: commerce.cutleryRequested,
                onChanged: commerce.orderResolutionPending ? null : commerce.setCutleryRequested,
              ),
              SwitchListTile(
                key: const ValueKey<String>('checkout-priority-toggle'),
                contentPadding: EdgeInsets.zero,
                title: Text(cText(context, 'Priority delivery', 'অগ্রাধিকার ডেলিভারি')),
                subtitle: Text(cText(context, 'Additional ${formatBdt(1000, localeCode: lang)} · delivery only', 'অতিরিক্ত ${formatBdt(1000, localeCode: lang)} · শুধু ডেলিভারি')),
                value: commerce.priority,
                onChanged: controller.fulfilmentMode == UndalFulfilmentMode.delivery && !commerce.orderResolutionPending
                    ? commerce.setPriority
                    : null,
              ),
              TextFormField(
                key: const ValueKey<String>('checkout-customer-note'),
                initialValue: commerce.customerNote,
                maxLength: 300,
                enabled: !commerce.orderResolutionPending,
                decoration: InputDecoration(labelText: cText(context, 'Delivery or pickup note (optional)', 'ডেলিভারি বা পিকআপ নোট (ঐচ্ছিক)'), border: const OutlineInputBorder()),
                onChanged: commerce.setCustomerNote,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              if (quote == null)
                _CheckoutNotice(
                  text: cText(context, 'Request a fresh W1 quote before placing your order.', 'অর্ডার দেওয়ার আগে W1 থেকে নতুন কোট নিন।'),
                  action: cText(context, 'Refresh quote', 'কোট আপডেট করুন'),
                  onPressed: commerce.refreshServerQuote,
                )
              else ...<Widget>[
                Text(cText(context, 'W1-confirmed price breakdown', 'W1-নিশ্চিত মূল্য বিবরণ'), style: theme.textTheme.titleLarge),
                _MoneyRow(label: cText(context, 'Items', 'খাবার'), amount: _quotePoisha(quote, 'items_poisha') ?? 0, lang: lang),
                _MoneyRow(label: cText(context, 'Discounts', 'ছাড়'), amount: _quotePoisha(quote, 'discount_total_poisha') ?? 0, lang: lang),
                _MoneyRow(label: cText(context, 'Delivery', 'ডেলিভারি'), amount: _quotePoisha(quote, 'delivery_fee_poisha') ?? 0, lang: lang),
                _MoneyRow(label: cText(context, 'Platform fee', 'প্ল্যাটফর্ম ফি'), amount: _quotePoisha(quote, 'platform_fee_poisha') ?? 0, lang: lang),
                _MoneyRow(label: cText(context, 'Tip', 'টিপ'), amount: _quotePoisha(quote, 'tip_poisha') ?? 0, lang: lang),
                _MoneyRow(label: cText(context, 'Cash to collect', 'নগদ দিতে হবে'), amount: cod ?? 0, lang: lang, bold: true),
              ],
              if (commerce.appliedVoucherCode != null)
                Text(cText(context, 'Voucher ${commerce.appliedVoucherCode} is included in this quote.', 'ভাউচার ${commerce.appliedVoucherCode} এই কোটে অন্তর্ভুক্ত।')),
              if (commerce.commerceErrorCode != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.sm),
                  child: Text(_commerceMessage(context, commerce.commerceErrorCode), style: TextStyle(color: theme.colorScheme.error)),
                ),
              const SizedBox(height: UndalSpacingTokens.md),
              FilledButton.icon(
                key: const ValueKey<String>('checkout-place-cod-order'),
                onPressed: commerce.checkoutBusy || cod == null || !commerce.canPlaceLiveOrder
                    ? null
                    : () => commerce.placeCodOrder(),
                icon: commerce.checkoutBusy
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.payments_outlined),
                label: Text(commerce.orderResolutionPending
                    ? cText(context, 'Retry same order request', 'একই অর্ডার আবার যাচাই করুন')
                    : cText(context, 'Place Cash-on-Delivery order', 'ক্যাশ অন ডেলিভারি অর্ডার দিন')),
              ),
              Text(cText(context, 'No online payment is accepted. Delivery orders are paid in cash on arrival; pickup is paid at the kitchen counter.', 'অনলাইন পেমেন্ট নেই। ডেলিভারির সময় নগদ পরিশোধ করুন; পিকআপে রান্নাঘরের কাউন্টারে পরিশোধ করুন।'), style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

/// Order confirmation shown only after W1 returns a valid order ID, code and COD amount (`c-21`).
class CustomerOrderConfirmationScreen extends StatelessWidget {
  /// Creates the c-21 receipt screen.
  const CustomerOrderConfirmationScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final CustomerOrderReceipt? receipt = controller.commerce.receipt;
    final String lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      key: const ValueKey<String>('screen-c-21'),
      appBar: AppBar(title: Text(cText(context, 'Order confirmation', 'অর্ডার নিশ্চিতকরণ'))),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(UndalSpacingTokens.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(receipt == null ? Icons.error_outline : Icons.check_circle_outline, size: 64, color: receipt == null ? Theme.of(context).colorScheme.error : Theme.of(context).colorScheme.primary),
                const SizedBox(height: UndalSpacingTokens.md),
                Text(receipt == null ? cText(context, 'Order confirmation unavailable', 'অর্ডার নিশ্চিতকরণ পাওয়া যায়নি') : cText(context, 'Your order is confirmed', 'আপনার অর্ডার নিশ্চিত হয়েছে'), style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
                if (receipt != null) ...<Widget>[
                  const SizedBox(height: UndalSpacingTokens.md),
                  Text(receipt.publicCode, key: const ValueKey<String>('order-public-code'), style: Theme.of(context).textTheme.headlineMedium),
                  Text(cText(context, 'Status: ${receipt.status}', 'অবস্থা: ${receipt.status}')),
                  const SizedBox(height: UndalSpacingTokens.sm),
                  _MoneyRow(label: cText(context, 'Cash to collect', 'নগদ দিতে হবে'), amount: receipt.codCollectPoisha, lang: lang, bold: true),
                  Text(cText(context, 'Keep this order code for support. The amount above came from the server.', 'সহায়তার জন্য অর্ডার কোডটি রাখুন। উপরের মূল্য সার্ভার থেকে এসেছে।'), textAlign: TextAlign.center),
                ],
                const SizedBox(height: UndalSpacingTokens.lg),
                FilledButton(onPressed: () => controller.selectTab(0), child: Text(cText(context, 'Back to kitchens', 'রান্নাঘরে ফিরুন'))),
              ],
            ),
          ),
        ),
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

class _CheckoutNotice extends StatelessWidget {
  const _CheckoutNotice({required this.text, this.action, this.onPressed});

  final String text;
  final String? action;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Card(
        color: Theme.of(context).colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(text),
              if (action != null && onPressed != null)
                TextButton(onPressed: onPressed, child: Text(action!)),
            ],
          ),
        ),
      );
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

String _voucherMessage(BuildContext context, String? code) => switch (code) {
      'VOUCHER_INVALID' => cText(context, 'This code is invalid or expired.', 'কোডটি সঠিক নয় বা মেয়াদ শেষ।'),
      'VOUCHER_LIMIT_REACHED' => cText(context, 'This voucher reached its use limit.', 'ভাউচারটির ব্যবহারের সীমা শেষ।'),
      'VOUCHER_MIN_ORDER' => cText(context, 'The basket does not meet this voucher minimum.', 'কার্টে ভাউচারের ন্যূনতম মূল্য নেই।'),
      'VOUCHER_BUDGET_EXHAUSTED' => cText(context, 'This voucher budget is no longer available.', 'ভাউচারের বাজেট শেষ।'),
      'CART_VENDOR_CONFLICT' => cText(context, 'Another kitchen cart needs confirmation.', 'অন্য রান্নাঘরের কার্ট নিশ্চিত করতে হবে।'),
      _ => cText(context, 'W1 could not apply this code. Please try again.', 'W1 কোডটি যোগ করতে পারেনি। আবার চেষ্টা করুন।'),
    };

String _commerceMessage(BuildContext context, String? code) => switch (code) {
      'ORDER_RESULT_UNKNOWN' => cText(context, 'Order result is unknown. Retry the same request before changing anything.', 'অর্ডারের ফল অজানা। কিছু বদলানোর আগে একই অনুরোধ আবার পাঠান।'),
      'CART_STALE' => cText(context, 'The total changed. Refresh the quote and review it again.', 'মোট মূল্য বদলেছে। কোট আপডেট করে আবার দেখুন।'),
      'CART_VENDOR_CONFLICT' => cText(context, 'Confirm replacing the other kitchen cart on the Cart screen.', 'কার্ট স্ক্রিনে অন্য রান্নাঘরের কার্ট বদল নিশ্চিত করুন।'),
      'MENU_REFRESH_REQUIRED' => cText(context, 'Refresh the kitchen menu before ordering.', 'অর্ডারের আগে রান্নাঘরের মেনু আপডেট করুন।'),
      'PICKUP_DISABLED' => cText(context, 'This kitchen does not accept pickup.', 'এই রান্নাঘর পিকআপ নেয় না।'),
      'VENDOR_CLOSED' => cText(context, 'This kitchen is not taking orders right now.', 'এই রান্নাঘর এখন অর্ডার নিচ্ছে না।'),
      'BELOW_MIN_ORDER' => cText(context, 'Your basket is below the kitchen minimum.', 'আপনার কার্ট রান্নাঘরের ন্যূনতম অর্ডারের কম।'),
      'OUT_OF_ZONE' => cText(context, 'This delivery address is outside the kitchen zone.', 'এই ঠিকানা রান্নাঘরের ডেলিভারি এলাকার বাইরে।'),
      'COD_LIMIT_EXCEEDED' => cText(context, 'The COD total exceeds the account limit.', 'COD মোট অ্যাকাউন্ট সীমার বেশি।'),
      'NETWORK_UNAVAILABLE' => cText(context, 'Connection lost. No order was placed; retry when online.', 'সংযোগ নেই। অর্ডার হয়নি; অনলাইনে আবার চেষ্টা করুন।'),
      _ => cText(context, 'W1 could not confirm this order. Review the basket and retry.', 'W1 অর্ডার নিশ্চিত করতে পারেনি। কার্ট দেখে আবার চেষ্টা করুন।'),
    };
