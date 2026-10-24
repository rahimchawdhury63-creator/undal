/// Customer voucher-wallet and code-entry screen (`c-19`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../models/customer_voucher_offer.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';
import 'customer_checkout_components.dart';

/// Shows current W1 voucher offers and validates entered codes against the live cart.
class CustomerVoucherPickerScreen extends StatefulWidget {
  /// Creates the c-19 voucher picker.
  const CustomerVoucherPickerScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  State<CustomerVoucherPickerScreen> createState() => _CustomerVoucherPickerScreenState();
}

class _CustomerVoucherPickerScreenState extends State<CustomerVoucherPickerScreen> {
  late final TextEditingController _voucherController;

  @override
  void initState() {
    super.initState();
    _voucherController = TextEditingController(text: widget.controller.commerce.voucherInput);
  }

  @override
  void didUpdateWidget(covariant CustomerVoucherPickerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String stateCode = widget.controller.commerce.voucherInput;
    if (_voucherController.text != stateCode) {
      _voucherController.value = TextEditingValue(
        text: stateCode,
        selection: TextSelection.collapsed(offset: stateCode.length),
      );
    }
  }

  @override
  void dispose() {
    _voucherController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController controller = widget.controller;
    final CustomerCommerceState commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey<String>('screen-c-19'),
      appBar: AppBar(
        title: Text(cText(context, 'Voucher code', 'ভাউচার কোড')),
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
              const CustomerCheckoutProgress(activeStep: 2),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(
                cText(
                  context,
                  'Choose an eligible offer or enter a code. W1 verifies discounts, limits, and the live budget.',
                  'যোগ্য অফার বাছুন বা কোড দিন। ছাড়, সীমা ও বর্তমান বাজেট W1 যাচাই করবে।',
                ),
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      cText(context, 'Offers for you', 'আপনার অফার'),
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  if (controller.isAuthenticated)
                    IconButton(
                      key: const ValueKey<String>('voucher-wallet-refresh'),
                      tooltip: cText(context, 'Refresh offers', 'অফার আপডেট করুন'),
                      onPressed: commerce.voucherWalletLoading ? null : commerce.refreshVoucherWallet,
                      icon: const Icon(Icons.refresh),
                    ),
                ],
              ),
              if (!controller.isAuthenticated)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(cText(context, 'Sign in to view your eligible voucher wallet.', 'যোগ্য ভাউচার দেখতে লগইন করুন।')),
                        TextButton.icon(
                          key: const ValueKey<String>('voucher-wallet-sign-in'),
                          onPressed: () => controller.openAuthHub(intent: const VoucherPickerIntent()),
                          icon: const Icon(Icons.login),
                          label: Text(cText(context, 'Sign in', 'লগইন করুন')),
                        ),
                      ],
                    ),
                  ),
                ),
              if (commerce.voucherWalletLoading) const LinearProgressIndicator(),
              if (commerce.voucherWalletErrorCode != null)
                _WalletNotice(
                  text: _walletErrorMessage(context, commerce.voucherWalletErrorCode),
                  action: controller.isAuthenticated ? cText(context, 'Try again', 'আবার চেষ্টা করুন') : null,
                  onPressed: controller.isAuthenticated ? commerce.refreshVoucherWallet : null,
                ),
              if (commerce.voucherWalletLoaded && commerce.voucherWallet.isEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(UndalSpacingTokens.md),
                    child: Text(cText(context, 'No currently eligible offers. You can still enter a code below.', 'এখন কোনো যোগ্য অফার নেই। নিচে কোড দিতে পারেন।')),
                  ),
                ),
              for (final CustomerVoucherOffer offer in commerce.voucherWallet)
                Card(
                  key: ValueKey<String>('voucher-offer-${offer.code}'),
                  elevation: 0,
                  child: Padding(
                    padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            const Icon(Icons.local_offer_outlined),
                            const SizedBox(width: UndalSpacingTokens.xs),
                            Expanded(child: Text(offer.title(lang), style: theme.textTheme.titleMedium)),
                            Chip(label: Text(offer.code)),
                          ],
                        ),
                        Text(_offerDescription(context, offer, lang)),
                        const SizedBox(height: UndalSpacingTokens.xs),
                        Align(
                          alignment: Alignment.centerRight,
                          child: OutlinedButton.icon(
                            key: ValueKey<String>('voucher-offer-apply-${offer.code}'),
                            onPressed: commerce.orderResolutionPending
                                ? null
                                : () => _applyOffer(context, commerce, offer.code),
                            icon: const Icon(Icons.check_circle_outline),
                            label: Text(cText(context, 'Apply to this cart', 'এই কার্টে যোগ করুন')),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              const Divider(height: UndalSpacingTokens.xl),
              Text(
                cText(context, 'Enter a voucher code', 'ভাউচার কোড দিন'),
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: UndalSpacingTokens.xs),
              TextFormField(
                key: const ValueKey<String>('voucher-code-input'),
                controller: _voucherController,
                textCapitalization: TextCapitalization.characters,
                maxLength: 32,
                enabled: !commerce.orderResolutionPending,
                decoration: InputDecoration(
                  labelText: cText(context, 'Voucher code', 'ভাউচার কোড'),
                  border: const OutlineInputBorder(),
                ),
                onChanged: commerce.setVoucherInput,
              ),
              if (commerce.appliedVoucherCode != null)
                Chip(
                  label: Text(cText(
                    context,
                    'Applied: ${commerce.appliedVoucherCode}',
                    'যুক্ত হয়েছে: ${commerce.appliedVoucherCode}',
                  )),
                ),
              if (commerce.voucherErrorCode != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xs),
                  child: Text(
                    _voucherMessage(context, commerce.voucherErrorCode),
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
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

Future<void> _applyOffer(BuildContext context, CustomerCommerceState commerce, String code) async {
  commerce.setVoucherInput(code);
  final bool applied = await commerce.applyVoucher();
  if (applied && context.mounted) commerce.backToCart();
}

String _offerDescription(BuildContext context, CustomerVoucherOffer offer, String lang) {
  final String benefit = switch (offer.kind) {
    'percent' => '${_percentLabel(offer.value)} ${cText(context, 'off', 'ছাড়')}',
    'flat' => cText(context, '${formatBdt(offer.value, localeCode: lang)} off', '${formatBdt(offer.value, localeCode: lang)} ছাড়'),
    'free_delivery' => cText(context, 'Free delivery', 'ফ্রি ডেলিভারি'),
    _ => cText(context, 'Offer', 'অফার'),
  };
  final String minimum = formatBdt(offer.minimumOrderPoisha, localeCode: lang);
  return cText(context, '$benefit · Minimum order $minimum', '$benefit · ন্যূনতম অর্ডার $minimum');
}

String _percentLabel(int basisPoints) {
  final int whole = basisPoints ~/ 100;
  final int fraction = basisPoints % 100;
  if (fraction == 0) return '$whole%';
  final String decimal = fraction.toString().padLeft(2, '0').replaceFirst(RegExp(r'0$'), '');
  return '$whole.$decimal%';
}

String _voucherMessage(BuildContext context, String? code) => switch (code) {
      'VOUCHER_INVALID' => cText(context, 'This code is invalid or expired.', 'কোডটি সঠিক নয় বা মেয়াদ শেষ।'),
      'VOUCHER_FIRST_ORDER_ONLY' => cText(context, 'This offer is available only on your first order.', 'এই অফারটি শুধু প্রথম অর্ডারে প্রযোজ্য।'),
      'VOUCHER_LIMIT_REACHED' => cText(context, 'This voucher reached its use limit.', 'ভাউচারটির ব্যবহারের সীমা শেষ।'),
      'VOUCHER_MIN_ORDER' => cText(context, 'The basket does not meet this voucher minimum.', 'কার্টে ভাউচারের ন্যূনতম মূল্য নেই।'),
      'VOUCHER_BUDGET_EXHAUSTED' => cText(context, 'This voucher budget is no longer available.', 'ভাউচারের বাজেট শেষ।'),
      'CART_VENDOR_CONFLICT' => cText(context, 'Another kitchen cart needs confirmation.', 'অন্য রান্নাঘরের কার্ট নিশ্চিত করতে হবে।'),
      'NETWORK_UNAVAILABLE' => cText(context, 'Connection lost. Reconnect and try again.', 'সংযোগ নেই। আবার চেষ্টা করুন।'),
      _ => cText(context, 'W1 could not apply this code. Please try again.', 'W1 কোডটি যোগ করতে পারেনি। আবার চেষ্টা করুন।'),
    };

String _walletErrorMessage(BuildContext context, String? code) => switch (code) {
      'NETWORK_UNAVAILABLE' => cText(context, 'Could not load offers. Check your connection.', 'অফার লোড হয়নি। ইন্টারনেট সংযোগ দেখুন।'),
      'VOUCHER_WALLET_INVALID' => cText(context, 'The wallet response could not be verified.', 'ভাউচার তালিকা যাচাই করা যায়নি।'),
      'VOUCHER_WALLET_UNAVAILABLE' => cText(context, 'Voucher offers are unavailable right now.', 'ভাউচার অফার এখন পাওয়া যাচ্ছে না।'),
      _ => cText(context, 'Sign in again to load eligible offers.', 'যোগ্য অফার দেখতে আবার লগইন করুন।'),
    };

class _WalletNotice extends StatelessWidget {
  const _WalletNotice({required this.text, this.action, this.onPressed});

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
