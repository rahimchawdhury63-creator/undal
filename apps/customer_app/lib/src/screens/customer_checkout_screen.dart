/// Current W1 quote, cash-only fulfilment choices, and idempotent COD placement (`c-20`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';
import 'customer_checkout_address_screen.dart';
import 'customer_checkout_components.dart';

/// Cash-on-Delivery checkout for delivery or QR-only counter pickup.
class CustomerCheckoutScreen extends StatelessWidget {
  /// Creates the c-20 checkout screen.
  const CustomerCheckoutScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final CustomerCommerceState commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    final Map<String, Object?>? quote = commerce.serverQuote;
    final int? cod = customerQuotePoisha(quote, 'cod_collect_poisha');
    final int? priorityFee = customerQuotePoisha(quote, 'priority_delivery_fee_poisha');
    final int subtotal = customerQuotePoisha(quote, 'items_poisha') ?? commerce.itemsSubtotalPoisha;
    final String pickupLabel = commerce.pickupPointLabel ?? cText(context, 'kitchen counter', 'রান্নাঘরের কাউন্টার');
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey<String>('screen-c-20'),
      appBar: AppBar(
        title: Text(cText(context, 'Cash-on-Delivery checkout', 'ক্যাশ অন ডেলিভারি চেকআউট')),
        leading: IconButton(
          tooltip: cText(context, 'Back to cart', 'কার্টে ফিরুন'),
          onPressed: commerce.backToCart,
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const CustomerCheckoutProgress(activeStep: 3),
              const SizedBox(height: UndalSpacingTokens.md),
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
                        : (_) => _changeFulfilment(commerce, UndalFulfilmentMode.delivery),
                  ),
                  ChoiceChip(
                    key: const ValueKey<String>('checkout-pickup-mode'),
                    label: Text(cText(context, 'Pickup · QR handover', 'পিকআপ · QR হ্যান্ডওভার')),
                    selected: controller.fulfilmentMode == UndalFulfilmentMode.pickup,
                    onSelected: commerce.orderResolutionPending || !commerce.pickupAvailable
                        ? null
                        : (_) => _changeFulfilment(commerce, UndalFulfilmentMode.pickup),
                  ),
                ],
              ),
              Card(
                elevation: 0,
                child: ListTile(
                  leading: Icon(
                    controller.fulfilmentMode == UndalFulfilmentMode.pickup
                        ? Icons.qr_code_2
                        : Icons.location_on_outlined,
                  ),
                  title: Text(controller.fulfilmentMode == UndalFulfilmentMode.pickup
                      ? cText(context, 'Counter pickup · $pickupLabel', 'কাউন্টার পিকআপ · $pickupLabel')
                      : cText(
                          context,
                          'Deliver to ${controller.activeAddress.label}',
                          '${controller.activeAddress.label}-এ পৌঁছে দিন',
                        )),
                  subtitle: Text(controller.fulfilmentMode == UndalFulfilmentMode.pickup
                      ? cText(
                          context,
                          'Show the QR handover code at the counter. No cash is exchanged there; COD is collected by the rider.',
                          'কাউন্টারে QR হ্যান্ডওভার কোড দেখান। সেখানে নগদ লেনদেন হবে না; রাইডার COD সংগ্রহ করবেন।',
                        )
                      : '${controller.activeAddress.addressText}\n${controller.activeAddress.landmarkNote}'),
                ),
              ),
              if (controller.fulfilmentMode == UndalFulfilmentMode.delivery && !commerce.hasSpecificDeliveryAddress)
                _CheckoutNotice(
                  text: cText(
                    context,
                    'Add a specific house, road, or area before delivery. “Sylhet Sadar, Sylhet” is only a service-area label.',
                    'ডেলিভারির আগে নির্দিষ্ট বাসা, রোড বা এলাকার ঠিকানা দিন। “সিলেট সদর, সিলেট” শুধু সার্ভিস এলাকার নাম।',
                  ),
                  action: cText(context, 'Add delivery address', 'ডেলিভারি ঠিকানা যোগ করুন'),
                  onPressed: commerce.orderResolutionPending ? null : () => _editAddress(context),
                ),
              if (controller.fulfilmentMode == UndalFulfilmentMode.delivery)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const ValueKey<String>('checkout-edit-address'),
                    onPressed: commerce.orderResolutionPending ? null : () => _editAddress(context),
                    icon: const Icon(Icons.pin_drop_outlined),
                    label: Text(cText(context, 'Adjust address pin', 'ঠিকানার পিন ঠিক করুন')),
                  ),
                ),
              const SizedBox(height: UndalSpacingTokens.sm),
              Text(cText(context, 'Delivery speed', 'ডেলিভারির গতি'), style: theme.textTheme.titleMedium),
              SwitchListTile(
                key: const ValueKey<String>('checkout-priority-toggle'),
                contentPadding: EdgeInsets.zero,
                title: Text(cText(context, 'Priority delivery', 'অগ্রাধিকার ডেলিভারি')),
                subtitle: Text(controller.fulfilmentMode == UndalFulfilmentMode.pickup
                    ? cText(context, 'Not available for counter pickup.', 'কাউন্টার পিকআপে প্রযোজ্য নয়।')
                    : priorityFee == null
                        ? cText(context, 'W1 will confirm the additional fee in the quote.', 'অতিরিক্ত ফি W1 কোটে নিশ্চিত করবে।')
                        : cText(
                            context,
                            'Additional ${formatBdt(priorityFee, localeCode: lang)} · delivery only',
                            'অতিরিক্ত ${formatBdt(priorityFee, localeCode: lang)} · শুধু ডেলিভারি',
                          )),
                value: commerce.priority,
                onChanged: controller.fulfilmentMode == UndalFulfilmentMode.delivery && !commerce.orderResolutionPending
                    ? (bool enabled) => _changePriority(commerce, enabled)
                    : null,
              ),
              if (controller.fulfilmentMode == UndalFulfilmentMode.delivery)
                Padding(
                  padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm),
                  child: Text(commerce.standardDeliveryEtaLabel == null
                      ? cText(context, 'ETA is confirmed by the kitchen and dispatch; it is not guaranteed.', 'ETA রান্নাঘর ও ডিসপ্যাচ নিশ্চিত করবে; এটি নিশ্চয়তা নয়।')
                      : cText(
                          context,
                          'Standard estimate ${commerce.standardDeliveryEtaLabel}. Final ETA is confirmed after dispatch.',
                          'সাধারণ আনুমানিক ${commerce.standardDeliveryEtaLabel}। ডিসপ্যাচের পর চূড়ান্ত ETA জানানো হবে।',
                        ),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              Text(cText(context, 'Cash tip · paid in cash to the rider', 'নগদ টিপ · রাইডারকে নগদে দিন'), style: theme.textTheme.titleMedium),
              Wrap(
                spacing: UndalSpacingTokens.xs,
                children: <Widget>[
                  _tipChip(context, commerce, lang, subtotal, 0, 'None', 'টিপ নয়'),
                  for (final int basisPoints in <int>[1000, 2000, 3000])
                    _percentTipChip(
                      context,
                      commerce,
                      lang,
                      subtotal,
                      basisPoints,
                      controller.fulfilmentMode == UndalFulfilmentMode.pickup,
                    ),
                  ChoiceChip(
                    key: const ValueKey<String>('checkout-tip-custom'),
                    label: Text(cText(context, 'Custom', 'নিজের মতো')),
                    selected: !_isStandardTip(commerce.tipPoisha, subtotal),
                    onSelected: controller.fulfilmentMode == UndalFulfilmentMode.pickup || commerce.orderResolutionPending
                        ? null
                        : (_) => _setCustomTip(context, commerce),
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
              TextFormField(
                key: const ValueKey<String>('checkout-customer-note'),
                initialValue: commerce.customerNote,
                maxLength: 300,
                enabled: !commerce.orderResolutionPending,
                decoration: InputDecoration(
                  labelText: cText(context, 'Delivery or pickup note (optional)', 'ডেলিভারি বা পিকআপ নোট (ঐচ্ছিক)'),
                  border: const OutlineInputBorder(),
                ),
                onChanged: commerce.setCustomerNote,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              if (commerce.quoteLoading) const LinearProgressIndicator(),
              if (quote == null)
                _CheckoutNotice(
                  text: cText(context, 'Request a fresh W1 quote before placing your order.', 'অর্ডার দেওয়ার আগে W1 থেকে নতুন কোট নিন।'),
                  action: commerce.orderResolutionPending
                      ? null
                      : cText(context, 'Refresh quote', 'কোট আপডেট করুন'),
                  onPressed: commerce.quoteLoading || commerce.orderResolutionPending
                      ? null
                      : commerce.refreshServerQuote,
                )
              else ...<Widget>[
                Text(cText(context, 'W1-confirmed price breakdown', 'W1-নিশ্চিত মূল্য বিবরণ'), style: theme.textTheme.titleLarge),
                for (final Map<String, Object?> line in _quoteLineItems(quote))
                  ListTile(
                    key: ValueKey<String>('checkout-quote-line-${line['menu_item_id']}'),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(_lineName(line, lang)),
                    subtitle: Text(cText(context, 'Quantity ${line['qty'] ?? 0}', 'পরিমাণ ${line['qty'] ?? 0}')),
                    trailing: Text(formatBdt(customerQuotePoisha(line, 'line_poisha') ?? 0, localeCode: lang)),
                  ),
                CustomerMoneyRow(label: cText(context, 'Items', 'খাবার'), amountPoisha: customerQuotePoisha(quote, 'items_poisha') ?? 0, localeCode: lang),
                CustomerMoneyRow(label: cText(context, 'Discounts', 'ছাড়'), amountPoisha: customerQuotePoisha(quote, 'discount_total_poisha') ?? 0, localeCode: lang),
                CustomerMoneyRow(
                  label: cText(context, 'Delivery', 'ডেলিভারি'),
                  amountPoisha: customerQuoteBaseDeliveryPoisha(quote, includePriority: commerce.priority),
                  localeCode: lang,
                ),
                if (commerce.priority)
                  CustomerMoneyRow(label: cText(context, 'Priority delivery fee', 'অগ্রাধিকার ডেলিভারি ফি'), amountPoisha: priorityFee ?? 0, localeCode: lang),
                CustomerMoneyRow(label: cText(context, 'Platform fee', 'প্ল্যাটফর্ম ফি'), amountPoisha: customerQuotePoisha(quote, 'platform_fee_poisha') ?? 0, localeCode: lang),
                CustomerMoneyRow(label: cText(context, 'Tip', 'টিপ'), amountPoisha: customerQuotePoisha(quote, 'tip_poisha') ?? 0, localeCode: lang),
                CustomerMoneyRow(label: cText(context, 'Cash to collect', 'নগদ দিতে হবে'), amountPoisha: cod ?? 0, localeCode: lang, emphasized: true),
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
                onPressed: commerce.checkoutBusy || commerce.quoteLoading || cod == null || !commerce.canPlaceLiveOrder
                    ? null
                    : () => commerce.placeCodOrder(),
                icon: commerce.checkoutBusy
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.payments_outlined),
                label: Text(commerce.orderResolutionPending
                    ? cText(context, 'Retry same order request', 'একই অর্ডার আবার যাচাই করুন')
                    : cText(context, 'Place Cash-on-Delivery order', 'ক্যাশ অন ডেলিভারি অর্ডার দিন')),
              ),
              Text(
                cText(
                  context,
                  'No online payment is accepted. The rider collects COD; counter pickup uses QR handover only and has no cash exchange.',
                  'অনলাইন পেমেন্ট নেই। রাইডার COD সংগ্রহ করবেন; কাউন্টার পিকআপে শুধু QR হ্যান্ডওভার, নগদ লেনদেন নয়।',
                ),
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _editAddress(BuildContext context) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (BuildContext routeContext) => CustomerCheckoutAddressEditorScreen(controller: controller),
      ),
    );
  }
}

Future<void> _changeFulfilment(CustomerCommerceState commerce, UndalFulfilmentMode mode) async {
  if (commerce.setFulfilment(mode)) await commerce.refreshServerQuote();
}

Future<void> _changePriority(CustomerCommerceState commerce, bool enabled) async {
  commerce.setPriority(enabled);
  await commerce.refreshServerQuote();
}

Widget _tipChip(BuildContext context, CustomerCommerceState commerce, String lang, int subtotal, int basisPoints, String en, String bn) {
  final int amount = _tipForBasisPoints(subtotal, basisPoints);
  return ChoiceChip(
    key: ValueKey<String>('checkout-tip-$basisPoints'),
    label: Text(basisPoints == 0
        ? cText(context, en, bn)
        : cText(context, '$en · ${formatBdt(amount, localeCode: lang)}', '$bn · ${formatBdt(amount, localeCode: lang)}')),
    selected: commerce.tipPoisha == amount,
    onSelected: commerce.tipPoisha == amount || commerce.orderResolutionPending
        ? null
        : (_) => _changeTip(commerce, amount),
  );
}

Widget _percentTipChip(
  BuildContext context,
  CustomerCommerceState commerce,
  String lang,
  int subtotal,
  int basisPoints,
  bool pickup,
) {
  final int amount = _tipForBasisPoints(subtotal, basisPoints);
  final String percent = '${basisPoints ~/ 100}%';
  return ChoiceChip(
    key: ValueKey<String>('checkout-tip-$basisPoints'),
    label: Text('$percent · ${formatBdt(amount, localeCode: lang)}'),
    selected: commerce.tipPoisha == amount,
    onSelected: pickup || commerce.orderResolutionPending || commerce.tipPoisha == amount
        ? null
        : (_) => _changeTip(commerce, amount),
  );
}

Future<void> _changeTip(CustomerCommerceState commerce, int amount) async {
  commerce.setTipPoisha(amount);
  await commerce.refreshServerQuote();
}

int _tipForBasisPoints(int subtotal, int basisPoints) {
  final int poisha = roundHalfUpDiv(BigInt.from(subtotal) * BigInt.from(basisPoints), BigInt.from(10000)).toInt();
  return poisha > 100000 ? 100000 : poisha;
}

bool _isStandardTip(int amount, int subtotal) => <int>{
      0,
      _tipForBasisPoints(subtotal, 1000),
      _tipForBasisPoints(subtotal, 2000),
      _tipForBasisPoints(subtotal, 3000),
    }.contains(amount);

Future<void> _setCustomTip(BuildContext context, CustomerCommerceState commerce) async {
  final TextEditingController amountController = TextEditingController();
  String? error;
  final int? amount = await showDialog<int>(
    context: context,
    builder: (BuildContext dialogContext) => StatefulBuilder(
      builder: (BuildContext context, StateSetter setDialogState) => AlertDialog(
        title: Text(cText(context, 'Custom cash tip', 'নিজের মতো নগদ টিপ')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(cText(context, 'Enter BDT, up to ৳1,000. Decimals are limited to two places.', 'টাকার অঙ্ক লিখুন, সর্বোচ্চ ৳১,০০০। দশমিকের পরে দুই ঘর পর্যন্ত।')),
            TextField(
              key: const ValueKey<String>('checkout-tip-custom-input'),
              controller: amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: cText(context, 'Amount in BDT', 'টাকার অঙ্ক'),
                errorText: error,
              ),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(cText(context, 'Cancel', 'বাতিল')),
          ),
          FilledButton(
            onPressed: () {
              final int? parsed = _parseBdtPoisha(amountController.text);
              if (parsed == null) {
                setDialogState(() => error = cText(context, 'Enter a valid amount from ৳0 to ৳1,000.', '৳০ থেকে ৳১,০০০-এর মধ্যে সঠিক অঙ্ক লিখুন।'));
              } else {
                Navigator.of(dialogContext).pop(parsed);
              }
            },
            child: Text(cText(context, 'Apply tip', 'টিপ যোগ করুন')),
          ),
        ],
      ),
    ),
  );
  amountController.dispose();
  if (amount != null) await _changeTip(commerce, amount);
}

int? _parseBdtPoisha(String raw) {
  final String value = raw.trim();
  if (!RegExp(r'^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,2})?$').hasMatch(value)) return null;
  final List<String> parts = value.split('.');
  final int whole = int.parse(parts.first);
  final int fractional = parts.length == 1 ? 0 : int.parse(parts.last.padRight(2, '0'));
  final int poisha = whole * 100 + fractional;
  return poisha <= 100000 ? poisha : null;
}

List<Map<String, Object?>> _quoteLineItems(Map<String, Object?>? quote) {
  final Object? raw = quote?['line_items'];
  if (raw is! List<Object?>) return <Map<String, Object?>>[];
  return raw.whereType<Map<String, Object?>>().toList(growable: false);
}

String _lineName(Map<String, Object?> line, String lang) {
  final Object? raw = lang == 'bn' ? line['name_bn'] : line['name_en'];
  if (raw is String && raw.isNotEmpty) return raw;
  return line['name_en'] is String ? line['name_en'] as String : '';
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
      'VOUCHER_FIRST_ORDER_ONLY' => cText(context, 'This voucher is only valid for a first order.', 'এই ভাউচার শুধু প্রথম অর্ডারে প্রযোজ্য।'),
      'VOUCHER_BUDGET_EXHAUSTED' => cText(context, 'This voucher budget is no longer available.', 'ভাউচারের বাজেট শেষ।'),
      'VOUCHER_INVALID' => cText(context, 'This voucher is invalid or expired.', 'ভাউচারটি সঠিক নয় বা মেয়াদ শেষ।'),
      'VOUCHER_LIMIT_REACHED' => cText(context, 'This voucher reached its use limit.', 'ভাউচারটির ব্যবহারের সীমা শেষ।'),
      'VOUCHER_MIN_ORDER' => cText(context, 'The basket does not meet this voucher minimum.', 'কার্টে ভাউচারের ন্যূনতম মূল্য নেই।'),
      'LIVE_CHECKOUT_UNAVAILABLE' => cText(context, 'Reconnect and sign in to refresh this live checkout.', 'লাইভ চেকআউট আপডেট করতে ইন্টারনেট চালু করে লগইন করুন।'),
      'ADDRESS_REQUIRED' => cText(context, 'Add a specific house, road, or area before placing a delivery order.', 'ডেলিভারি অর্ডার দেওয়ার আগে নির্দিষ্ট বাসা, রোড বা এলাকার ঠিকানা দিন।'),
      'CART_EMPTY' => cText(context, 'Add at least one menu item before checkout.', 'চেকআউটের আগে অন্তত একটি খাবার যোগ করুন।'),
      'NETWORK_UNAVAILABLE' => cText(context, 'Connection lost. No order was placed; retry when online.', 'সংযোগ নেই। অর্ডার হয়নি; অনলাইনে আবার চেষ্টা করুন।'),
      _ => cText(context, 'W1 could not confirm this order. Review the basket and retry.', 'W1 অর্ডার নিশ্চিত করতে পারেনি। কার্ট দেখে আবার চেষ্টা করুন।'),
    };
