/// Server-confirmed Cash-on-Delivery order receipt (`c-21`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_cart_models.dart';
import '../state/customer_controller.dart';
import 'customer_checkout_components.dart';

/// Confirms an order only after W1 returns its valid order ID, public code, and COD amount.
class CustomerOrderConfirmationScreen extends StatelessWidget {
  /// Creates the c-21 receipt screen.
  const CustomerOrderConfirmationScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final CustomerOrderReceipt? receipt = controller.commerce.receipt;
    final String lang = Localizations.localeOf(context).languageCode;
    final bool confirmed = receipt != null;
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
                Icon(
                  confirmed ? Icons.check_circle_outline : Icons.error_outline,
                  size: 64,
                  color: confirmed ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.error,
                ),
                const SizedBox(height: UndalSpacingTokens.md),
                Text(
                  confirmed
                      ? cText(context, 'Your order is confirmed', 'আপনার অর্ডার নিশ্চিত হয়েছে')
                      : cText(context, 'Order confirmation unavailable', 'অর্ডার নিশ্চিতকরণ পাওয়া যায়নি'),
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                if (receipt != null) ...<Widget>[
                  const SizedBox(height: UndalSpacingTokens.md),
                  Text(
                    receipt.publicCode,
                    key: const ValueKey<String>('order-public-code'),
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  Text(cText(context, 'Status: ${receipt.status}', 'অবস্থা: ${receipt.status}')),
                  const SizedBox(height: UndalSpacingTokens.sm),
                  CustomerMoneyRow(
                    label: cText(context, 'Cash to collect', 'নগদ দিতে হবে'),
                    amountPoisha: receipt.codCollectPoisha,
                    localeCode: lang,
                    emphasized: true,
                  ),
                  Text(
                    cText(
                      context,
                      'The amount came from W1. The rider collects COD; counter pickup uses QR handover only, with no cash exchange at the counter.',
                      'অঙ্কটি W1 থেকে এসেছে। রাইডার COD সংগ্রহ করবেন; কাউন্টার পিকআপে শুধু QR হ্যান্ডওভার, কাউন্টারে নগদ লেনদেন নয়।',
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
                const SizedBox(height: UndalSpacingTokens.lg),
                FilledButton(
                  key: const ValueKey<String>('order-confirmation-back-home'),
                  onPressed: () => controller.selectTab(0),
                  child: Text(cText(context, 'Back to kitchens', 'রান্নাঘরে ফিরুন')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
