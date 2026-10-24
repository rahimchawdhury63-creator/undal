/// Customer order history, immutable COD receipts, and post-delivery rating (`c-26..c-28`).
///
/// Every row and receipt is sourced from authenticated W1 order endpoints; the UI never manufactures
/// a completed order, price, rating count, or cancellation reason.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// Orders tab with live jobs pinned above server history (`c-26`).
class CustomerOrdersScreen extends StatefulWidget {
  /// Creates the authenticated customer order list.
  const CustomerOrdersScreen({super.key, required this.controller, this.embedded = false});

  /// Root customer controller.
  final CustomerController controller;

  /// Whether to render inside the existing Orders tab shell without another app bar.
  final bool embedded;

  @override
  State<CustomerOrdersScreen> createState() => _CustomerOrdersScreenState();
}

class _CustomerOrdersScreenState extends State<CustomerOrdersScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      if (mounted) widget.controller.experience.loadOrders();
    });
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final String lang = Localizations.localeOf(context).languageCode;
    final List<CustomerOrderCard> active = state.orders.where((CustomerOrderCard row) => !row.isTerminal).toList();
    final List<CustomerOrderCard> history = state.orders.where((CustomerOrderCard row) => row.isTerminal).toList();
    if (!widget.controller.isAuthenticated) {
      return _OrderMessage(
        key: const ValueKey<String>('screen-c-26'),
        title: cText(context, 'Your orders', 'আপনার অর্ডার'),
        detail: cText(context, 'Sign in to view orders linked to your account.', 'আপনার অ্যাকাউন্টের অর্ডার দেখতে লগইন করুন।'),
        action: cText(context, 'Sign in', 'লগইন'),
        onPressed: widget.controller.openAuthHub,
      );
    }
    return Scaffold(
      key: const ValueKey<String>('screen-c-26'),
      appBar: widget.embedded ? null : AppBar(
        title: Text(cText(context, 'Your orders', 'আপনার অর্ডার')),
        actions: <Widget>[
          IconButton(
            key: const ValueKey<String>('orders-refresh'),
            tooltip: cText(context, 'Refresh orders', 'অর্ডার রিফ্রেশ'),
            onPressed: state.ordersLoading ? null : state.loadOrders,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: state.loadOrders,
        child: state.ordersLoading && state.orders.isEmpty
            ? ListView(children: const <Widget>[SizedBox(height: 240), Center(child: CircularProgressIndicator())])
            : state.ordersError != null && state.orders.isEmpty
                ? ListView(children: <Widget>[
                    const SizedBox(height: 100),
                    _OrderMessage(
                      title: cText(context, 'Orders could not load', 'অর্ডার লোড করা যায়নি'),
                      detail: _apiErrorCopy(context, state.ordersError!),
                      action: cText(context, 'Try again', 'আবার চেষ্টা করুন'),
                      onPressed: state.loadOrders,
                    ),
                  ])
                : state.orders.isEmpty
                    ? ListView(children: <Widget>[
                        const SizedBox(height: 90),
                        _OrderMessage(
                          title: cText(context, 'No orders yet', 'এখনো কোনো অর্ডার নেই'),
                          detail: cText(context, 'Your confirmed food orders will appear here.', 'আপনার নিশ্চিত খাবারের অর্ডার এখানে দেখা যাবে।'),
                          action: cText(context, 'Explore kitchens', 'রান্নাঘর দেখুন'),
                          onPressed: () => widget.controller.selectTab(0),
                        ),
                      ])
                    : ListView(
                        padding: const EdgeInsets.all(UndalSpacingTokens.md),
                        children: <Widget>[
                          if (active.isNotEmpty) ...<Widget>[
                            Text(cText(context, 'Live now', 'চলমান'), style: Theme.of(context).textTheme.titleLarge),
                            const SizedBox(height: UndalSpacingTokens.xs),
                            for (final CustomerOrderCard order in active) _OrderTile(
                              order: order,
                              languageCode: lang,
                              active: true,
                              onOpen: () => state.openOrder(order),
                            ),
                            const SizedBox(height: UndalSpacingTokens.md),
                          ],
                          if (history.isNotEmpty) ...<Widget>[
                            Text(cText(context, 'History', 'আগের অর্ডার'), style: Theme.of(context).textTheme.titleLarge),
                            const SizedBox(height: UndalSpacingTokens.xs),
                            for (final CustomerOrderCard order in history) _OrderTile(
                              order: order,
                              languageCode: lang,
                              active: false,
                              onOpen: () => state.openOrder(order),
                            ),
                          ],
                          if (state.ordersError != null)
                            Text(_apiErrorCopy(context, state.ordersError!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ],
                      ),
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.languageCode, required this.active, required this.onOpen});
  final CustomerOrderCard order;
  final String languageCode;
  final bool active;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final String lang = languageCode;
    final ThemeData theme = Theme.of(context);
    return Card(
      elevation: 0,
      child: InkWell(
        key: ValueKey<String>('order-open-${order.id}'),
        borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(children: <Widget>[
                Expanded(child: Text(order.vendorName(lang).isEmpty ? cText(context, 'Kitchen', 'রান্নাঘর') : order.vendorName(lang), style: theme.textTheme.titleMedium)),
                Chip(label: Text(_statusLabel(context, order.status))),
              ]),
              Text('${order.publicCode} · ${order.fulfilment == 'pickup' ? cText(context, 'Counter pickup', 'কাউন্টার পিকআপ') : cText(context, 'Delivery', 'ডেলিভারি')}'),
              if (order.addressText.isNotEmpty) Text(order.addressText, maxLines: 2, overflow: TextOverflow.ellipsis),
              if (order.batchId != null && !order.isTerminal)
                Text(cText(context, 'Your delivery shares a nearby route; other customers’ locations stay private.', 'আপনার ডেলিভারি কাছের রুটের সঙ্গে ভাগ করা; অন্য গ্রাহকের অবস্থান গোপন।')),
              const SizedBox(height: UndalSpacingTokens.xs),
              Row(children: <Widget>[
                Expanded(child: Text('${cText(context, 'Cash on delivery', 'ক্যাশ অন ডেলিভারি')}: ${formatBdt(order.codCollectPoisha, localeCode: lang)}')),
                Text(active ? cText(context, 'Track', 'ট্র্যাক') : cText(context, 'Receipt', 'রসিদ'), style: TextStyle(color: theme.colorScheme.primary, fontWeight: FontWeight.w700)),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}

/// Immutable itemized receipt, complete event timeline, reorder, and order-linked help (`c-27`).
class CustomerOrderReceiptScreen extends StatelessWidget {
  /// Creates an order receipt screen.
  const CustomerOrderReceiptScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = controller.experience;
    final CustomerOrderDetail? detail = state.orderDetail;
    final String lang = Localizations.localeOf(context).languageCode;
    if (detail == null) {
      return Scaffold(
        key: const ValueKey<String>('screen-c-27'),
        appBar: AppBar(leading: BackButton(onPressed: () => controller.returnFromCustomerExperience(tabIndex: 2))),
        body: state.orderLoading
            ? const Center(child: CircularProgressIndicator())
            : _OrderMessage(
                title: cText(context, 'Receipt unavailable', 'রসিদ পাওয়া যায়নি'),
                detail: _apiErrorCopy(context, state.orderError ?? 'ORDER_UNAVAILABLE'),
                action: cText(context, 'Back to orders', 'অর্ডারে ফিরুন'),
                onPressed: () => controller.returnFromCustomerExperience(tabIndex: 2),
              ),
      );
    }
    final CustomerOrderCard order = detail.summary;
    final Map<String, Object?> vendor = customerJsonMap(detail.order['vendor_snapshot']);
    final Map<String, Object?> address = customerJsonMap(detail.order['address_snapshot']);
    final String kitchen = customerJsonString(vendor[lang == 'bn' ? 'brand_name_bn' : 'brand_name'], fallback: order.vendorName(lang));
    final String destination = customerJsonString(address['address_text'], fallback: customerJsonString(address['label']));
    return Scaffold(
      key: const ValueKey<String>('screen-c-27'),
      appBar: AppBar(
        leading: BackButton(onPressed: () => controller.returnFromCustomerExperience(tabIndex: 2)),
        title: Text(cText(context, 'Order receipt', 'অর্ডারের রসিদ')),
        actions: <Widget>[
          IconButton(
            key: const ValueKey<String>('receipt-help'),
            tooltip: cText(context, 'Get order help', 'অর্ডার সহায়তা'),
            onPressed: () => _openOrderHelp(context, order.id),
            icon: const Icon(Icons.help_outline),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(UndalSpacingTokens.md),
        children: <Widget>[
          Card(elevation: 0, child: Padding(
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
              Text(order.publicCode, key: const ValueKey<String>('receipt-order-code'), style: Theme.of(context).textTheme.headlineSmall),
              Text('${_statusLabel(context, order.status)} · ${_formatTime(order.placedAt, lang)}'),
              Text('$kitchen → ${destination.isEmpty ? (order.fulfilment == 'pickup' ? cText(context, 'Counter pickup', 'কাউন্টার পিকআপ') : cText(context, 'Delivery address', 'ডেলিভারির ঠিকানা')) : destination}'),
              const SizedBox(height: UndalSpacingTokens.xs),
              OutlinedButton.icon(
                key: const ValueKey<String>('receipt-copy-order-code'),
                onPressed: () => Clipboard.setData(ClipboardData(text: order.publicCode)),
                icon: const Icon(Icons.copy),
                label: Text(cText(context, 'Copy order code', 'অর্ডার কোড কপি করুন')),
              ),
            ]),
          )),
          Text(cText(context, 'Items', 'খাবার'), style: Theme.of(context).textTheme.titleLarge),
          for (final Map<String, Object?> item in detail.items)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(customerJsonString(item[lang == 'bn' ? 'name_bn_snapshot' : 'name_en_snapshot'], fallback: customerJsonString(item['name_en_snapshot']))),
              subtitle: Text('${customerExactInt(item['qty']) ?? 0} × ${formatBdt(customerExactInt(item['unit_poisha']) ?? 0, localeCode: lang)}'),
              trailing: Text(formatBdt(customerExactInt(item['line_poisha']) ?? 0, localeCode: lang)),
            ),
          const Divider(),
          _ReceiptMoneyRow(label: cText(context, 'Food subtotal', 'খাবারের উপমোট'), amount: customerExactInt(detail.order['items_poisha']) ?? 0, languageCode: lang),
          if ((customerExactInt(detail.order['discount_total_poisha']) ?? 0) > 0)
            _ReceiptMoneyRow(label: cText(context, 'Discount', 'ছাড়'), amount: -(customerExactInt(detail.order['discount_total_poisha']) ?? 0), languageCode: lang),
          _ReceiptMoneyRow(label: cText(context, 'VAT included in food price', 'খাবারের দামে ভ্যাট অন্তর্ভুক্ত'), amount: customerExactInt(detail.order['tax_extracted_poisha']) ?? 0, languageCode: lang, informational: true),
          if (order.fulfilment == 'delivery') ...<Widget>[
            _ReceiptMoneyRow(label: cText(context, 'Delivery fee', 'ডেলিভারি ফি'), amount: customerExactInt(detail.order['delivery_fee_poisha']) ?? 0, languageCode: lang),
            _ReceiptMoneyRow(label: cText(context, 'Platform service fee', 'প্ল্যাটফর্ম সার্ভিস ফি'), amount: customerExactInt(detail.order['platform_fee_poisha']) ?? 0, languageCode: lang),
            _ReceiptMoneyRow(label: cText(context, 'Cash tip for rider', 'রাইডারের জন্য নগদ টিপ'), amount: customerExactInt(detail.order['tip_poisha']) ?? 0, languageCode: lang),
          ],
          const Divider(),
          _ReceiptMoneyRow(label: cText(context, 'Cash to pay', 'নগদ দিতে হবে'), amount: order.codCollectPoisha, languageCode: lang, emphasized: true),
          Text(cText(context, 'Payment method: Cash on Delivery. Pickup uses QR handover at the counter; no cash is exchanged there.', 'পেমেন্ট: ক্যাশ অন ডেলিভারি। পিকআপে কাউন্টারে QR হ্যান্ডওভার হয়; সেখানে নগদ লেনদেন নেই।')),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(cText(context, 'Order timeline', 'অর্ডারের সময়রেখা'), style: Theme.of(context).textTheme.titleLarge),
          for (final Map<String, Object?> event in detail.events)
            ListTile(
              leading: const Icon(Icons.check_circle_outline),
              title: Text(_statusLabel(context, customerJsonString(event['to_status'], fallback: 'PLACED'))),
              subtitle: Text(_formatTime(DateTime.tryParse(customerJsonString(event['created_at'])), lang)),
            ),
          if (!order.isTerminal)
            FilledButton.icon(
              key: const ValueKey<String>('receipt-track-order'),
              onPressed: () => state.openOrder(order),
              icon: const Icon(Icons.map_outlined),
              label: Text(cText(context, 'Open live tracking', 'লাইভ ট্র্যাকিং খুলুন')),
            ),
          if (order.fulfilment == 'pickup' && order.status == 'READY_FOR_PICKUP')
            FilledButton.tonalIcon(
              key: const ValueKey<String>('receipt-show-pickup-qr'),
              onPressed: () => controller.openCustomerExperienceScreen(CustomerScreenId.c23PickupReady, parentTab: 2),
              icon: const Icon(Icons.qr_code_2),
              label: Text(cText(context, 'Show pickup QR', 'পিকআপ QR দেখান')),
            ),
          if (order.status == 'DELIVERED')
            OutlinedButton.icon(
              key: const ValueKey<String>('receipt-rate-order'),
              onPressed: () => controller.openCustomerExperienceScreen(CustomerScreenId.c28Rating, parentTab: 2),
              icon: const Icon(Icons.star_outline),
              label: Text(cText(context, 'Rate this order', 'অর্ডারটি রেট করুন')),
            ),
          if (order.vendorSlug.isNotEmpty)
            OutlinedButton.icon(
              key: const ValueKey<String>('receipt-reorder-live-menu'),
              onPressed: () => controller.commerce.openVendorBySlug(order.vendorSlug),
              icon: const Icon(Icons.restaurant_menu),
              label: Text(cText(context, 'Check kitchen menu to reorder', 'আবার অর্ডারের জন্য রান্নাঘরের মেনু দেখুন')),
            ),
        ],
      ),
    );
  }

  Future<void> _openOrderHelp(BuildContext context, String orderId) async {
    String issue = '';
    final TextEditingController details = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext dialogContext, StateSetter setState) => AlertDialog(
          title: Text(cText(dialogContext, 'What went wrong?', 'কী সমস্যা হয়েছে?')),
          content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            DropdownButtonFormField<String>(
              value: issue.isEmpty ? null : issue,
              decoration: InputDecoration(labelText: cText(dialogContext, 'Issue type', 'সমস্যার ধরন')),
              items: <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'missing_item', child: Text(cText(dialogContext, 'Missing item', 'খাবার নেই'))),
                DropdownMenuItem(value: 'quality_issue', child: Text(cText(dialogContext, 'Food quality', 'খাবারের মান'))),
                DropdownMenuItem(value: 'late_delivery', child: Text(cText(dialogContext, 'Late delivery', 'ডেলিভারি দেরি'))),
                DropdownMenuItem(value: 'other', child: Text(cText(dialogContext, 'Other', 'অন্যান্য'))),
              ],
              onChanged: (String? value) => setState(() => issue = value ?? ''),
            ),
            TextField(controller: details, maxLines: 3, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: cText(dialogContext, 'Describe the issue', 'সমস্যাটি লিখুন'))),
          ]),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(cText(dialogContext, 'Cancel', 'বাতিল'))),
            FilledButton(
              onPressed: issue.isEmpty || details.text.trim().length < 3 ? null : () async {
                final bool sent = await controller.experience.createSupportThread(
                  category: issue,
                  subject: _issueSubject(dialogContext, issue),
                  body: details.text.trim(),
                  orderId: orderId,
                );
                if (dialogContext.mounted) Navigator.of(dialogContext).pop(sent);
                if (context.mounted && sent) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cText(context, 'Support ticket opened.', 'সহায়তা টিকিট খোলা হয়েছে।'))));
                }
              },
              child: Text(cText(dialogContext, 'Send to support', 'সহায়তায় পাঠান')),
            ),
          ],
        ),
      ),
    );
    details.dispose();
  }
}

class _ReceiptMoneyRow extends StatelessWidget {
  const _ReceiptMoneyRow({required this.label, required this.amount, required this.languageCode, this.emphasized = false, this.informational = false});
  final String label;
  final int amount;
  final String languageCode;
  final bool emphasized;
  final bool informational;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.xxs),
        child: Row(children: <Widget>[
          Expanded(child: Text(label, style: emphasized ? Theme.of(context).textTheme.titleMedium : null)),
          Text('${amount < 0 ? '−' : ''}${formatBdt(amount.abs(), localeCode: languageCode)}${informational ? ' · ${cText(context, 'included', 'অন্তর্ভুক্ত')}' : ''}', style: emphasized ? Theme.of(context).textTheme.titleMedium : null),
        ]),
      );
}

class _OrderMessage extends StatelessWidget {
  const _OrderMessage({super.key, required this.title, required this.detail, required this.action, required this.onPressed});
  final String title;
  final String detail;
  final String action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.xl), child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
    Icon(Icons.receipt_long_outlined, size: 48, color: Theme.of(context).colorScheme.primary),
    const SizedBox(height: UndalSpacingTokens.md),
    Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
    const SizedBox(height: UndalSpacingTokens.xs),
    Text(detail, textAlign: TextAlign.center),
    const SizedBox(height: UndalSpacingTokens.md),
    FilledButton(onPressed: onPressed, child: Text(action)),
  ])));
}

String _statusLabel(BuildContext context, String status) => switch (status.toUpperCase()) {
      'PLACED' => cText(context, 'Placed', 'অর্ডার হয়েছে'),
      'VENDOR_ACCEPTED' => cText(context, 'Accepted', 'গ্রহণ করা হয়েছে'),
      'PREPARING' => cText(context, 'Preparing', 'প্রস্তুত হচ্ছে'),
      'READY_FOR_PICKUP' => cText(context, 'Ready for pickup', 'পিকআপের জন্য প্রস্তুত'),
      'RIDER_ASSIGNED' => cText(context, 'Rider assigned', 'রাইডার নিয়োগ হয়েছে'),
      'RIDER_AT_VENDOR' => cText(context, 'At kitchen', 'রান্নাঘরে পৌঁছেছেন'),
      'PICKED_UP' => cText(context, 'On the way', 'পথে আছে'),
      'RIDER_AT_CUSTOMER' => cText(context, 'Rider at your location', 'রাইডার আপনার অবস্থানে'),
      'DELIVERED' => cText(context, 'Delivered', 'ডেলিভারি হয়েছে'),
      'CANCELLED_CUSTOMER' => cText(context, 'Cancelled by customer', 'গ্রাহক বাতিল করেছেন'),
      'CANCELLED_VENDOR' => cText(context, 'Cancelled by kitchen', 'রান্নাঘর বাতিল করেছে'),
      'CANCELLED_TIMEOUT' => cText(context, 'Cancelled: kitchen did not respond', 'রান্নাঘর সাড়া না দেওয়ায় বাতিল'),
      'CANCELLED_ADMIN' => cText(context, 'Cancelled by support', 'সহায়তা দল বাতিল করেছে'),
      'FAILED_DELIVERY' => cText(context, 'Delivery issue', 'ডেলিভারিতে সমস্যা'),
      _ => cText(context, 'Order update', 'অর্ডার আপডেট'),
    };

String _formatTime(DateTime? value, String languageCode) {
  if (value == null) return languageCode == 'bn' ? 'সময় পাওয়া যায়নি' : 'Time unavailable';
  final DateTime dhaka = value.toUtc().add(const Duration(hours: 6));
  final String hour = dhaka.hour.toString().padLeft(2, '0');
  final String minute = dhaka.minute.toString().padLeft(2, '0');
  final String formatted = '${dhaka.year}-${dhaka.month.toString().padLeft(2, '0')}-${dhaka.day.toString().padLeft(2, '0')} $hour:$minute';
  return languageCode == 'bn' ? toBengaliDigits(formatted) : formatted;
}

String _apiErrorCopy(BuildContext context, String code) => code == 'SESSION_REQUIRED'
    ? cText(context, 'Sign in to view this information.', 'এই তথ্য দেখতে লগইন করুন।')
    : cText(context, 'The server could not load this information. Check your connection and retry.', 'সার্ভার থেকে তথ্য পাওয়া যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।');

String _issueSubject(BuildContext context, String issue) => switch (issue) {
      'missing_item' => cText(context, 'Missing item', 'খাবার নেই'),
      'quality_issue' => cText(context, 'Food quality', 'খাবারের মান'),
      'late_delivery' => cText(context, 'Late delivery', 'ডেলিভারি দেরি'),
      _ => cText(context, 'Order issue', 'অর্ডারের সমস্যা'),
    };
