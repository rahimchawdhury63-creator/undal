/// Server-defined menu customization and bundle selection screens (`c-14`, `c-15`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/storefront_menu_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// Required/min-max variants and add-on selection screen for one menu item.
class CustomerItemCustomizerScreen extends StatelessWidget {
  /// Creates the c-14 item customizer.
  const CustomerItemCustomizerScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final StorefrontMenuItem? item = controller.commerce.activeItem;
    if (item == null) return const Scaffold(body: SizedBox.shrink());
    final commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    final bool hasBundleSlots = item.isBundle && item.bundleSlots.isNotEmpty;
    return Scaffold(
      key: const ValueKey<String>('screen-c-14'),
      appBar: AppBar(
        title: Text(cText(context, 'Customize item', 'খাবার পছন্দ করুন')),
        leading: IconButton(onPressed: commerce.backToStorefront, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(item.dish.name(lang), style: Theme.of(context).textTheme.headlineSmall),
              Text(formatBdt(item.dish.pricePoisha, localeCode: lang)),
              const SizedBox(height: UndalSpacingTokens.md),
              _ConfigurationSections(controller: controller, item: item),
              if (hasBundleSlots) ...<Widget>[
                const SizedBox(height: UndalSpacingTokens.sm),
                OutlinedButton.icon(
                  key: const ValueKey<String>('customizer-open-bundle-builder'),
                  onPressed: commerce.openBundleBuilder,
                  icon: const Icon(Icons.tune),
                  label: Text(cText(context, 'Build this bundle', 'এই কম্বো সাজান')),
                ),
              ],
              const SizedBox(height: UndalSpacingTokens.md),
              _QuantitySelector(controller: controller),
              const SizedBox(height: UndalSpacingTokens.sm),
              TextField(
                key: const ValueKey<String>('customizer-instructions'),
                maxLength: 200,
                decoration: InputDecoration(
                  labelText: cText(context, 'Kitchen note (optional)', 'রান্নাঘরের নোট (ঐচ্ছিক)'),
                  border: const OutlineInputBorder(),
                ),
                onChanged: commerce.setItemInstructions,
              ),
              const SizedBox(height: UndalSpacingTokens.sm),
              Text(
                cText(context, 'Estimated unit price: ${formatBdt(commerce.itemUnitPricePoisha, localeCode: lang)} · W1 rechecks every selection before checkout.', 'আনুমানিক একক মূল্য: ${formatBdt(commerce.itemUnitPricePoisha, localeCode: lang)} · চেকআউটের আগে W1 প্রতিটি পছন্দ যাচাই করবে।'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              FilledButton.icon(
                key: const ValueKey<String>('customizer-add-to-basket'),
                onPressed: hasBundleSlots
                    ? commerce.openBundleBuilder
                    : commerce.itemConfigurationValid && item.isOrderable
                        ? () => _addConfiguredItem(context, controller)
                        : null,
                icon: Icon(hasBundleSlots ? Icons.tune : Icons.add_shopping_cart),
                label: Text(hasBundleSlots
                    ? cText(context, 'Continue to bundle builder', 'কম্বো সাজানো চালিয়ে যান')
                    : cText(context, 'Add to basket', 'কার্টে যোগ করুন')),
              ),
              if (!commerce.itemConfigurationValid)
                Padding(
                  padding: const EdgeInsets.only(top: UndalSpacingTokens.xs),
                  child: Text(cText(context, 'Complete each required selection before adding.', 'কার্টে যোগ করার আগে আবশ্যক পছন্দগুলো সম্পন্ন করুন।'), textAlign: TextAlign.center),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Min/max bundle-slot builder; all included and paid deltas come from W1 menu rows.
class CustomerBundleBuilderScreen extends StatelessWidget {
  /// Creates the c-15 bundle builder.
  const CustomerBundleBuilderScreen({super.key, required this.controller});

  /// Root state owner.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final StorefrontMenuItem? item = controller.commerce.activeItem;
    if (item == null) return const Scaffold(body: SizedBox.shrink());
    final commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      key: const ValueKey<String>('screen-c-15'),
      appBar: AppBar(
        title: Text(cText(context, 'Build your bundle', 'আপনার কম্বো সাজান')),
        leading: IconButton(onPressed: commerce.backToItemCustomizer, icon: const Icon(Icons.arrow_back)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(item.dish.name(lang), style: Theme.of(context).textTheme.headlineSmall),
              Text(formatBdt(item.dish.pricePoisha, localeCode: lang)),
              const SizedBox(height: UndalSpacingTokens.md),
              _ConfigurationSections(controller: controller, item: item),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(cText(context, 'Choose each meal slot', 'প্রতিটি খাবারের ঘর পূরণ করুন'), style: Theme.of(context).textTheme.titleLarge),
              for (final BundleSlot slot in item.bundleSlots)
                _BundleSlotSection(controller: controller, slot: slot),
              const SizedBox(height: UndalSpacingTokens.sm),
              _QuantitySelector(controller: controller),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(
                cText(context, 'Estimated bundle price: ${formatBdt(commerce.itemUnitPricePoisha, localeCode: lang)} · The server validates current choices and COD total.', 'আনুমানিক কম্বো মূল্য: ${formatBdt(commerce.itemUnitPricePoisha, localeCode: lang)} · সার্ভার বর্তমান পছন্দ ও COD মোট যাচাই করবে।'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: UndalSpacingTokens.md),
              FilledButton.icon(
                key: const ValueKey<String>('bundle-add-to-basket'),
                onPressed: commerce.itemConfigurationValid && item.isOrderable
                    ? () => _addConfiguredItem(context, controller)
                    : null,
                icon: const Icon(Icons.add_shopping_cart),
                label: Text(cText(context, 'Add bundle to basket', 'কম্বো কার্টে যোগ করুন')),
              ),
              if (!commerce.itemConfigurationValid)
                Padding(
                  padding: const EdgeInsets.only(top: UndalSpacingTokens.xs),
                  child: Text(cText(context, 'Complete each required selection before adding.', 'কার্টে যোগ করার আগে আবশ্যক পছন্দগুলো সম্পন্ন করুন।'), textAlign: TextAlign.center),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConfigurationSections extends StatelessWidget {
  const _ConfigurationSections({required this.controller, required this.item});

  final CustomerController controller;
  final StorefrontMenuItem item;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    final List<Widget> children = <Widget>[
      for (final StorefrontVariantGroup group in item.variantGroups) ...<Widget>[
        Text(group.label(lang), style: Theme.of(context).textTheme.titleMedium),
        Wrap(
          spacing: UndalSpacingTokens.xs,
          children: <Widget>[
            if (group.minSelect == 0)
              ChoiceChip(
                key: ValueKey<String>('variant-none-${group.id}'),
                label: Text(cText(context, 'No selection', 'নির্বাচন নেই')),
                selected: commerce.selectedVariant(group.id) == null,
                onSelected: (_) => commerce.clearVariant(group.id),
              ),
            for (final StorefrontChoice choice in group.variants)
              ChoiceChip(
                key: ValueKey<String>('variant-${choice.id}'),
                label: Text('${choice.label(lang)} ${_deltaLabel(context, choice.priceDeltaPoisha)}'),
                selected: commerce.selectedVariant(group.id) == choice.id,
                onSelected: choice.available ? (_) => commerce.selectVariant(group.id, choice.id) : null,
              ),
          ],
        ),
      ],
      for (final StorefrontChoiceGroup group in item.optionGroups) ...<Widget>[
        Text(group.label(lang), style: Theme.of(context).textTheme.titleMedium),
        Text(_selectionRule(context, group.minSelect, group.maxSelect), style: Theme.of(context).textTheme.bodySmall),
        Wrap(
          spacing: UndalSpacingTokens.xs,
          children: <Widget>[
            for (final StorefrontChoice choice in group.choices)
              FilterChip(
                key: ValueKey<String>('option-${choice.id}'),
                label: Text('${choice.label(lang)} ${_deltaLabel(context, choice.priceDeltaPoisha)}'),
                selected: commerce.isOptionSelected(group.id, choice.id),
                onSelected: choice.available ? (_) => commerce.toggleOption(group.id, choice.id) : null,
              ),
          ],
        ),
      ],
    ];
    if (children.isEmpty) return Text(cText(context, 'No additional choices for this item.', 'এই খাবারের জন্য অতিরিক্ত পছন্দ নেই।'));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: children.map((Widget child) => Padding(padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm), child: child)).toList());
  }
}

class _BundleSlotSection extends StatelessWidget {
  const _BundleSlotSection({required this.controller, required this.slot});

  final CustomerController controller;
  final BundleSlot slot;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    final String lang = Localizations.localeOf(context).languageCode;
    return Padding(
      padding: const EdgeInsets.only(bottom: UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(slot.label(lang), style: Theme.of(context).textTheme.titleMedium),
          Text(_selectionRule(context, slot.minPick, slot.maxPick), style: Theme.of(context).textTheme.bodySmall),
          Wrap(
            spacing: UndalSpacingTokens.xs,
            children: <Widget>[
              for (final BundleSlotChoice choice in slot.choices)
                FilterChip(
                  key: ValueKey<String>('bundle-choice-${slot.id}-${choice.itemId}'),
                  label: Text('${choice.label(lang)} ${_deltaLabel(context, choice.priceDeltaPoisha)}'),
                  selected: commerce.isBundleChoiceSelected(slot.id, choice.itemId),
                  onSelected: choice.available ? (_) => commerce.toggleBundleChoice(slot.id, choice.itemId) : null,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuantitySelector extends StatelessWidget {
  const _QuantitySelector({required this.controller});

  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final commerce = controller.commerce;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        IconButton(
          key: const ValueKey<String>('customizer-quantity-minus'),
          onPressed: commerce.itemQuantity > 1 ? () => commerce.setItemQuantity(commerce.itemQuantity - 1) : null,
          icon: const Icon(Icons.remove_circle_outline),
        ),
        Text('${commerce.itemQuantity}', style: Theme.of(context).textTheme.titleLarge),
        IconButton(
          key: const ValueKey<String>('customizer-quantity-plus'),
          onPressed: commerce.itemQuantity < 50 ? () => commerce.setItemQuantity(commerce.itemQuantity + 1) : null,
          icon: const Icon(Icons.add_circle_outline),
        ),
      ],
    );
  }
}

Future<void> _addConfiguredItem(BuildContext context, CustomerController controller) async {
  CartAddResult result = controller.commerce.addConfiguredItem();
  if (result == CartAddResult.vendorConflict) {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(cText(dialogContext, 'Replace current kitchen?', 'বর্তমান রান্নাঘর বদলাবেন?')),
        content: Text(cText(dialogContext, 'Your basket has items from another kitchen. Replacing it will remove those items.', 'আপনার কার্টে অন্য রান্নাঘরের খাবার আছে। বদলালে সেগুলো কার্ট থেকে মুছে যাবে।')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(cText(dialogContext, 'Keep basket', 'কার্ট রাখুন'))),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(cText(dialogContext, 'Replace kitchen', 'রান্নাঘর বদলান'))),
        ],
      ),
    );
    if (!context.mounted || confirmed != true) return;
    result = controller.commerce.addConfiguredItem(confirmVendorReplacement: true);
  }
  if (!context.mounted) return;
  if (result == CartAddResult.added) {
    controller.selectTab(3);
    return;
  }
  final String message = switch (result) {
    CartAddResult.offline => cText(context, 'Reconnect to add this item.', 'খাবার যোগ করতে সংযোগ চালু করুন।'),
    CartAddResult.requiresLiveRefresh => cText(context, 'Refresh the live kitchen menu before adding.', 'যোগ করার আগে লাইভ রান্নাঘরের মেনু আপডেট করুন।'),
    CartAddResult.vendorConflict => cText(context, 'The kitchen was not changed.', 'রান্নাঘর পরিবর্তন করা হয়নি।'),
    CartAddResult.unavailable => cText(context, 'This configuration is unavailable. Check the required choices.', 'এই কনফিগারেশন পাওয়া যাচ্ছে না। আবশ্যক পছন্দগুলো দেখুন।'),
    CartAddResult.added => cText(context, 'Added to basket.', 'কার্টে যোগ হয়েছে।'),
  };
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

String _deltaLabel(BuildContext context, int delta) {
  final String lang = Localizations.localeOf(context).languageCode;
  if (delta == 0) return cText(context, 'included', 'অন্তর্ভুক্ত');
  final String amount = formatBdt(delta.abs(), localeCode: lang);
  return delta > 0 ? '+$amount' : '−$amount';
}

String _selectionRule(BuildContext context, int minimum, int maximum) {
  if (minimum == maximum) return cText(context, 'Choose exactly $minimum', 'ঠিক $minimumটি বাছুন');
  return cText(context, 'Choose $minimum–$maximum', '$minimum–$maximumটি বাছুন');
}
