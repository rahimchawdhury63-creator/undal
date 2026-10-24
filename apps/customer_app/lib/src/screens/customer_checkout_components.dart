/// Shared checkout progress and integer-poisha presentation for customer cart flows.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';

/// Three-step cart, voucher, and checkout progress indicator.
class CustomerCheckoutProgress extends StatelessWidget {
  /// Creates the checkout journey indicator with a one-based active step.
  const CustomerCheckoutProgress({super.key, required this.activeStep});

  /// Active step number: 1 for cart, 2 for voucher, or 3 for checkout.
  final int activeStep;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final List<String> labels = <String>[
      cText(context, 'Cart', 'কার্ট'),
      cText(context, 'Voucher', 'ভাউচার'),
      cText(context, 'Checkout', 'চেকআউট'),
    ];
    return Semantics(
      label: cText(context, 'Checkout step $activeStep of 3', 'চেকআউট ধাপ ৩টির মধ্যে $activeStep'),
      child: Row(
        children: <Widget>[
          for (int index = 0; index < labels.length; index++)
            Expanded(
              child: Column(
                children: <Widget>[
                  CircleAvatar(
                    radius: 13,
                    backgroundColor: index + 1 <= activeStep
                        ? theme.colorScheme.primary
                        : theme.colorScheme.surfaceContainerHighest,
                    foregroundColor: index + 1 <= activeStep
                        ? theme.colorScheme.onPrimary
                        : theme.colorScheme.onSurfaceVariant,
                    child: index + 1 < activeStep
                        ? const Icon(Icons.check, size: 15)
                        : Text('${index + 1}', style: theme.textTheme.labelSmall),
                  ),
                  const SizedBox(height: UndalSpacingTokens.xxs),
                  Text(
                    labels[index],
                    textAlign: TextAlign.center,
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: index + 1 == activeStep ? FontWeight.w700 : FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Displays an exact integer-poisha amount using the active locale's BDT format.
class CustomerMoneyRow extends StatelessWidget {
  /// Creates one labeled bill row.
  const CustomerMoneyRow({
    super.key,
    required this.label,
    required this.amountPoisha,
    required this.localeCode,
    this.emphasized = false,
  });

  /// Localized row label.
  final String label;

  /// Exact non-negative amount in poisha; 100 poisha equals ৳1.
  final int amountPoisha;

  /// BCP-47 locale code used by the BDT formatter.
  final String localeCode;

  /// Whether this row is the emphasized final total.
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final TextStyle? base = emphasized
        ? Theme.of(context).textTheme.titleMedium
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(label, style: base)),
          Text(
            formatBdt(amountPoisha, localeCode: localeCode),
            style: base?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// Safely reads an integer-poisha quote field without converting through floating point.
int? customerQuotePoisha(Map<String, Object?>? quote, String key) {
  final Object? raw = quote?[key];
  if (raw is int && raw >= 0) return raw;
  if (raw is String) {
    final int? parsed = int.tryParse(raw);
    if (parsed != null && parsed >= 0) return parsed;
  }
  return null;
}

/// Returns standard delivery cost after removing the separately displayed priority surcharge.
int customerQuoteBaseDeliveryPoisha(
  Map<String, Object?>? quote, {
  required bool includePriority,
}) {
  final int total = customerQuotePoisha(quote, 'delivery_fee_poisha') ?? 0;
  final int surcharge = includePriority
      ? customerQuotePoisha(quote, 'priority_delivery_fee_poisha') ?? 0
      : 0;
  return total >= surcharge ? total - surcharge : total;
}
