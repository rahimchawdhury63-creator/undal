/// Live delivery tracking and QR-only customer counter pickup (`c-22..c-23`).
///
/// Shows only this customer's kitchen, rider, and destination pins. RTDB room access is leased through
/// W2 and automatically degrades to participant-checked five-second W1 polling without third-party ads.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// OSM live order tracker with an honest ETA and batched-route privacy (`c-22`).
class CustomerLiveTrackingScreen extends StatefulWidget {
  /// Creates the active-order tracking screen.
  const CustomerLiveTrackingScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerLiveTrackingScreen> createState() => _CustomerLiveTrackingScreenState();
}

class _CustomerLiveTrackingScreenState extends State<CustomerLiveTrackingScreen> {
  @override
  void initState() {
    super.initState();
    if (!widget.controller.experience.trackingActive) {
      widget.controller.experience.startTracking();
    }
  }

  @override
  void dispose() {
    unawaited(widget.controller.experience.stopTracking());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerExperienceState state = widget.controller.experience;
    final CustomerOrderDetail? detail = state.orderDetail;
    final String lang = Localizations.localeOf(context).languageCode;
    if (detail == null) {
      return Scaffold(
        key: const ValueKey<String>('screen-c-22'),
        appBar: AppBar(leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 2))),
        body: state.orderLoading
            ? const Center(child: CircularProgressIndicator())
            : _TrackingMessage(
                title: cText(context, 'Live order unavailable', 'লাইভ অর্ডার পাওয়া যায়নি'),
                body: cText(context, 'Reconnect and open the order again to load its server status.', 'সংযোগ চালু করে অর্ডারটি আবার খুলুন।'),
                action: cText(context, 'Back to orders', 'অর্ডারে ফিরুন'),
                onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 2),
              ),
      );
    }

    final CustomerOrderCard order = detail.summary;
    final GeoPoint center = detail.riderPoint ?? detail.vendorPoint ?? detail.customerPoint ?? widget.controller.activeAddress.point;
    final String vendorName = _vendorName(detail, lang);
    final Map<String, Object?> vendorSnapshot = customerJsonMap(detail.order['vendor_snapshot']);
    final bool isHomeKitchen = customerJsonString(vendorSnapshot['type']) == 'HOME_KITCHEN';
    final List<UndalMapMarker> markers = <UndalMapMarker>[
      if (detail.vendorPoint != null)
        UndalMapMarker(id: 'kitchen-${order.id}', point: detail.vendorPoint!, label: cText(context, 'Kitchen', 'রান্নাঘর'), isHomeKitchen: isHomeKitchen),
      if (detail.riderPoint != null)
        UndalMapMarker(id: 'rider-${order.id}', point: detail.riderPoint!, label: cText(context, 'Rider', 'রাইডার'), selected: true),
      if (detail.customerPoint != null)
        UndalMapMarker(id: 'destination-${order.id}', point: detail.customerPoint!, label: cText(context, 'You', 'আপনি')),
    ];

    return Scaffold(
      key: const ValueKey<String>('screen-c-22'),
      appBar: AppBar(
        leading: IconButton(
          tooltip: cText(context, 'Back to orders', 'অর্ডারে ফিরুন'),
          onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 2),
          icon: const Icon(Icons.close),
        ),
        title: Text(cText(context, 'Your order', 'আপনার অর্ডার')),
        actions: <Widget>[
          IconButton(
            key: const ValueKey<String>('tracking-open-help'),
            tooltip: cText(context, 'Get order help', 'অর্ডার সহায়তা'),
            onPressed: () => _openHelp(context, order.id),
            icon: const Icon(Icons.help_outline),
          ),
        ],
      ),
      body: Column(children: <Widget>[
        SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.34,
          child: Stack(fit: StackFit.expand, children: <Widget>[
            UndalOsmMap(
              center: center,
              zoom: detail.riderPoint == null ? 13.5 : 14.5,
              markers: markers,
              route: state.routePoints,
              tileProxyBaseUrl: widget.controller.api.config.effectiveTileProxyUrl,
            ),
            Positioned(
              left: UndalSpacingTokens.md,
              top: UndalSpacingTokens.md,
              child: _MapStatusPill(
                icon: state.trackingPolling ? Icons.sync : Icons.wifi_tethering,
                text: state.trackingPolling
                    ? cText(context, 'Secure status polling', 'নিরাপদ স্ট্যাটাস পোলিং')
                    : cText(context, 'Live rider updates', 'রাইডারের লাইভ আপডেট'),
              ),
            ),
            if (order.batchId != null && order.status == 'PICKED_UP')
              Positioned(
                left: UndalSpacingTokens.md,
                right: 70,
                bottom: UndalSpacingTokens.md,
                child: _MapStatusPill(
                  icon: Icons.route,
                  text: cText(context, 'Rider is completing a nearby drop-off along your route', 'রাইডার পথে কাছের একটি অর্ডার পৌঁছে দিচ্ছেন'),
                ),
              ),
          ]),
        ),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
            Text(_arrivalCopy(context, detail.order), style: Theme.of(context).textTheme.headlineSmall),
            Text('${order.publicCode} · $vendorName'),
            const SizedBox(height: UndalSpacingTokens.sm),
            _OrderProgress(status: order.status, pickup: order.fulfilment == 'pickup'),
            const SizedBox(height: UndalSpacingTokens.sm),
            Text(_statusCopy(context, order.status), style: Theme.of(context).textTheme.titleMedium),
            if (state.trackingPolling)
              Text(cText(context, 'Live location is unavailable; order status refreshes over the secure API.', 'লাইভ অবস্থান পাওয়া যাচ্ছে না; নিরাপদ API দিয়ে অর্ডার স্ট্যাটাস আপডেট হবে।')),
            if (state.trackingError != null)
              Text(cText(context, 'Tracking connection is retrying. The order remains on the server.', 'ট্র্যাকিং সংযোগ আবার চেষ্টা করছে। অর্ডারের তথ্য সার্ভারে আছে।'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
            TextButton.icon(
              key: const ValueKey<String>('tracking-why-eta'),
              onPressed: () => _showEtaExplanation(context, detail),
              icon: const Icon(Icons.info_outline),
              label: Text(cText(context, 'Why this ETA?', 'এই পৌঁছানোর সময় কেন?')),
            ),
            if (order.batchId != null && order.status == 'PICKED_UP')
              Card(elevation: 0, child: Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.sm),
                child: Text(cText(context, 'Your rider is making a nearby delivery stop. Other customers’ exact addresses and route pins are never shown.', 'আপনার রাইডার কাছের আরেকটি ডেলিভারি দিচ্ছেন। অন্য গ্রাহকের সঠিক ঠিকানা বা পিন দেখানো হয় না।')),
              )),
            ExpansionTile(
              key: const ValueKey<String>('tracking-order-summary'),
              title: Text(cText(context, 'Order details', 'অর্ডারের বিবরণ')),
              subtitle: Text('${cText(context, 'Keep ready', 'প্রস্তুত রাখুন')} ${formatBdt(order.codCollectPoisha, localeCode: lang)} ${cText(context, 'in cash', 'নগদে')}'),
              children: <Widget>[
                for (final Map<String, Object?> item in detail.items)
                  ListTile(
                    dense: true,
                    title: Text(customerJsonString(item[lang == 'bn' ? 'name_bn_snapshot' : 'name_en_snapshot'], fallback: customerJsonString(item['name_en_snapshot']))),
                    trailing: Text('${customerExactInt(item['qty']) ?? 0} × ${formatBdt(customerExactInt(item['unit_poisha']) ?? 0, localeCode: lang)}'),
                  ),
                Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => widget.controller.openCustomerExperienceScreen(CustomerScreenId.c27OrderReceipt, parentTab: 2), child: Text(cText(context, 'View full receipt', 'সম্পূর্ণ রসিদ দেখুন')))),
              ],
            ),
            Wrap(spacing: UndalSpacingTokens.sm, runSpacing: UndalSpacingTokens.xs, children: <Widget>[
              OutlinedButton.icon(
                key: const ValueKey<String>('tracking-chat-kitchen'),
                onPressed: () => state.openChat(order.id, withRider: false),
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(cText(context, 'Chat kitchen', 'রান্নাঘরে বার্তা')),
              ),
              if (order.riderId != null)
                OutlinedButton.icon(
                  key: const ValueKey<String>('tracking-chat-rider'),
                  onPressed: () => state.openChat(order.id, withRider: true),
                  icon: const Icon(Icons.delivery_dining),
                  label: Text(cText(context, 'Chat rider', 'রাইডারকে বার্তা')),
                ),
              if (order.fulfilment == 'pickup' && order.status == 'READY_FOR_PICKUP')
                FilledButton.tonalIcon(
                  key: const ValueKey<String>('tracking-pickup-qr'),
                  onPressed: () => widget.controller.openCustomerExperienceScreen(CustomerScreenId.c23PickupReady, parentTab: 2),
                  icon: const Icon(Icons.qr_code_2),
                  label: Text(cText(context, 'Show pickup code', 'পিকআপ কোড দেখান')),
                ),
            ]),
          ]),
        ),
      ]),
    );
  }

  Future<void> _openHelp(BuildContext context, String orderId) async {
    String issue = '';
    final TextEditingController note = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext dialogContext, StateSetter setState) => AlertDialog(
          title: Text(cText(dialogContext, 'Get help with this order', 'এই অর্ডারে সহায়তা নিন')),
          content: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            DropdownButtonFormField<String>(
              value: issue.isEmpty ? null : issue,
              decoration: InputDecoration(labelText: cText(dialogContext, 'Issue', 'সমস্যা')),
              items: <DropdownMenuItem<String>>[
                DropdownMenuItem(value: 'late_delivery', child: Text(cText(dialogContext, 'Late delivery', 'ডেলিভারি দেরি'))),
                DropdownMenuItem(value: 'missing_item', child: Text(cText(dialogContext, 'Missing item', 'খাবার নেই'))),
                DropdownMenuItem(value: 'wrong_item', child: Text(cText(dialogContext, 'Wrong item', 'ভুল খাবার'))),
                DropdownMenuItem(value: 'cancel_request', child: Text(cText(dialogContext, 'Cancellation request', 'বাতিলের অনুরোধ'))),
              ],
              onChanged: (String? value) => setState(() => issue = value ?? ''),
            ),
            TextField(
              controller: note,
              maxLines: 3,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: cText(dialogContext, 'Describe the issue', 'সমস্যাটি লিখুন')),
            ),
          ]),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(cText(dialogContext, 'Cancel', 'বাতিল'))),
            FilledButton(
              onPressed: issue.isEmpty || note.text.trim().length < 3 ? null : () async {
                final bool sent = await widget.controller.experience.createSupportThread(
                  category: issue,
                  subject: _issueSubject(dialogContext, issue),
                  body: note.text.trim(),
                  orderId: orderId,
                );
                if (dialogContext.mounted) Navigator.of(dialogContext).pop(sent);
              },
              child: Text(cText(dialogContext, 'Send to support', 'সহায়তায় পাঠান')),
            ),
          ],
        ),
      ),
    );
    note.dispose();
  }

  void _showEtaExplanation(BuildContext context, CustomerOrderDetail detail) {
    final int? prep = customerExactInt(detail.order['prep_minutes_committed']);
    showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext sheetContext) => SafeArea(child: Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Text(cText(sheetContext, 'How arrival estimates work', 'পৌঁছানোর সময় কীভাবে হিসাব হয়'), style: Theme.of(sheetContext).textTheme.titleLarge),
          const SizedBox(height: UndalSpacingTokens.sm),
          if (prep != null) Text(cText(sheetContext, 'The kitchen committed to about $prep minutes of preparation.', 'রান্নাঘর প্রস্তুতির জন্য প্রায় $prep মিনিট সময় দিয়েছে।')),
          Text(cText(sheetContext, 'Estimates combine the kitchen update and available road-route data. If live GPS or routing is unavailable, Undal does not invent a countdown.', 'সময়ে রান্নাঘরের আপডেট ও পাওয়া রুটের তথ্য ব্যবহার হয়। লাইভ GPS বা রুট না থাকলে উন্দাল অনুমান করে কাউন্টডাউন দেখায় না।')),
        ]),
      )),
    );
  }
}

/// QR handover screen for a ready counter-pickup order (`c-23`).
class CustomerPickupReadyScreen extends StatelessWidget {
  /// Creates the pickup QR screen.
  const CustomerPickupReadyScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  Widget build(BuildContext context) {
    final CustomerOrderDetail? detail = controller.experience.orderDetail;
    final bool valid = detail != null &&
        detail.summary.fulfilment == 'pickup' &&
        detail.summary.status == 'READY_FOR_PICKUP' &&
        detail.pickupQrToken != null;
    final String lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      key: const ValueKey<String>('screen-c-23'),
      appBar: AppBar(
        title: Text(cText(context, 'Pickup ready', 'পিকআপ প্রস্তুত')),
        leading: BackButton(onPressed: () => controller.returnFromCustomerExperience(tabIndex: 2)),
        actions: <Widget>[
          IconButton(
            tooltip: cText(context, 'Refresh order', 'অর্ডার রিফ্রেশ'),
            onPressed: detail == null ? null : () => controller.experience.loadOrder(detail.summary.publicCode),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: valid
          ? ListView(padding: const EdgeInsets.all(UndalSpacingTokens.lg), children: <Widget>[
              Text(detail!.summary.vendorName(lang), style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
              Text(detail.summary.publicCode, textAlign: TextAlign.center),
              const SizedBox(height: UndalSpacingTokens.md),
              Center(child: Semantics(
                label: cText(context, 'Secure pickup QR code. Show it to the kitchen counter.', 'নিরাপদ পিকআপ QR কোড। রান্নাঘরের কাউন্টারে দেখান।'),
                child: Container(
                  padding: const EdgeInsets.all(UndalSpacingTokens.md),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(UndalRadiusTokens.card)),
                  child: QrImageView(
                    data: detail.pickupQrToken!,
                    version: QrVersions.auto,
                    size: 236,
                    errorCorrectionLevel: QrErrorCorrectLevel.M,
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.black,
                  ),
                ),
              )),
              const SizedBox(height: UndalSpacingTokens.md),
              Text(cText(context, 'Show this QR at the pickup counter', 'পিকআপ কাউন্টারে এই QR দেখান'), style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
              if (detail.pickupCode4 != null)
                SelectableText(detail.pickupCode4!, key: const ValueKey<String>('pickup-four-digit-fallback'), textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineLarge),
              Text(cText(context, 'The rider collects the full COD amount from you. There is no cash exchange with the kitchen at pickup.', 'রাইডার আপনার কাছ থেকে পুরো COD নেবেন। পিকআপে রান্নাঘরের সঙ্গে নগদ লেনদেন হবে না।'), textAlign: TextAlign.center),
            ])
          : _TrackingMessage(
              title: cText(context, 'Pickup code unavailable', 'পিকআপ কোড পাওয়া যায়নি'),
              body: cText(context, 'W1 only reveals a QR after the kitchen marks this pickup order ready. Refresh the order or contact support.', 'রান্নাঘর পিকআপ প্রস্তুত করলে W1 QR দেখায়। অর্ডার রিফ্রেশ করুন বা সহায়তায় যোগাযোগ করুন।'),
              action: cText(context, 'View receipt', 'রসিদ দেখুন'),
              onPressed: () => controller.openCustomerExperienceScreen(CustomerScreenId.c27OrderReceipt, parentTab: 2),
            ),
    );
  }
}

class _OrderProgress extends StatelessWidget {
  const _OrderProgress({required this.status, required this.pickup});
  final String status;
  final bool pickup;

  @override
  Widget build(BuildContext context) {
    final int current = _progressStep(status, pickup);
    final int count = pickup ? 4 : 5;
    return Semantics(
      label: cText(context, 'Order progress, step ${current + 1} of $count', 'অর্ডারের অগ্রগতি, $count ধাপের ${current + 1} নম্বর ধাপ'),
      child: Row(children: List<Widget>.generate(count, (int i) => Expanded(
        child: Container(
          key: ValueKey<String>('tracking-progress-$i'),
          height: 7,
          margin: EdgeInsets.only(right: i == count - 1 ? 0 : UndalSpacingTokens.xs),
          decoration: BoxDecoration(
            color: i <= current ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
          ),
        ),
      ))),
    );
  }
}

class _MapStatusPill extends StatelessWidget {
  const _MapStatusPill({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: UndalSpacingTokens.sm, vertical: UndalSpacingTokens.xs),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.94), borderRadius: BorderRadius.circular(UndalRadiusTokens.pill), boxShadow: const <BoxShadow>[BoxShadow(color: Color(0x22000000), blurRadius: 6)]),
        child: Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
          Icon(icon, size: 18),
          const SizedBox(width: UndalSpacingTokens.xs),
          Flexible(child: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis)),
        ]),
      );
}

class _TrackingMessage extends StatelessWidget {
  const _TrackingMessage({required this.title, required this.body, required this.action, required this.onPressed});
  final String title;
  final String body;
  final String action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Center(child: Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.xl),
        child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
          const Icon(Icons.location_searching, size: 48),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: UndalSpacingTokens.xs),
          Text(body, textAlign: TextAlign.center),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton(onPressed: onPressed, child: Text(action)),
        ]),
      ));
}

int _progressStep(String status, bool pickup) {
  if (status == 'DELIVERED') return pickup ? 3 : 4;
  if (status == 'PICKED_UP' || status == 'RIDER_AT_CUSTOMER') return pickup ? 2 : 3;
  if (status == 'RIDER_ASSIGNED' || status == 'RIDER_AT_VENDOR') return 2;
  if (status == 'READY_FOR_PICKUP') return pickup ? 2 : 1;
  if (status == 'PREPARING') return 1;
  return 0;
}

String _statusCopy(BuildContext context, String status) => switch (status) {
      'PLACED' => cText(context, 'Waiting for kitchen confirmation.', 'রান্নাঘরের নিশ্চিতকরণের অপেক্ষায়।'),
      'VENDOR_ACCEPTED' => cText(context, 'The kitchen accepted your order.', 'রান্নাঘর আপনার অর্ডার গ্রহণ করেছে।'),
      'PREPARING' => cText(context, 'The kitchen is preparing your food.', 'রান্নাঘরে খাবার প্রস্তুত হচ্ছে।'),
      'READY_FOR_PICKUP' => cText(context, 'Your pickup is ready. Show the QR at the counter.', 'আপনার পিকআপ প্রস্তুত। কাউন্টারে QR দেখান।'),
      'RIDER_ASSIGNED' => cText(context, 'A rider is assigned and heading to the kitchen.', 'রাইডার নিয়োগ হয়েছে এবং রান্নাঘরে যাচ্ছেন।'),
      'RIDER_AT_VENDOR' => cText(context, 'Your rider is at the kitchen.', 'আপনার রাইডার রান্নাঘরে পৌঁছেছেন।'),
      'PICKED_UP' => cText(context, 'Your order is on its way.', 'আপনার অর্ডার পথে আছে।'),
      'RIDER_AT_CUSTOMER' => cText(context, 'Your rider has reached your location.', 'রাইডার আপনার অবস্থানে পৌঁছেছেন।'),
      _ => cText(context, 'The kitchen is preparing your order.', 'রান্নাঘরে আপনার অর্ডার প্রস্তুত হচ্ছে।'),
    };

String _arrivalCopy(BuildContext context, Map<String, Object?> order) {
  final int? eta = customerExactInt(order['eta_epoch_sec']);
  if (eta == null) return cText(context, 'Preparing your order', 'আপনার অর্ডার প্রস্তুত হচ্ছে');
  final DateTime instantUtc = DateTime.fromMillisecondsSinceEpoch(eta * 1000, isUtc: true);
  final DateTime timeDhaka = instantUtc.add(const Duration(hours: 6));
  final String hour = (timeDhaka.hour % 12 == 0 ? 12 : timeDhaka.hour % 12).toString();
  final String minute = timeDhaka.minute.toString().padLeft(2, '0');
  final String period = timeDhaka.hour < 12 ? 'AM' : 'PM';
  final int remaining = instantUtc.difference(DateTime.now().toUtc()).inMinutes;
  final String languageCode = Localizations.localeOf(context).languageCode;
  final String remainingText = languageCode == 'bn' ? toBengaliDigits('$remaining') : '$remaining';
  final String timeText = languageCode == 'bn' ? toBengaliDigits('$hour:$minute') : '$hour:$minute $period';
  final String relative = remaining <= 0
      ? cText(context, 'arriving now', 'এখনই পৌঁছাবে')
      : cText(context, 'about $remaining min', 'প্রায় $remainingText মিনিট');
  return cText(context, 'Arrives $relative · around $hour:$minute $period', 'পৌঁছাবে $relative · আনুমানিক $timeText');
}

String _vendorName(CustomerOrderDetail detail, String languageCode) {
  final Map<String, Object?> vendor = customerJsonMap(detail.order['vendor_snapshot']);
  return customerJsonString(vendor[languageCode == 'bn' ? 'brand_name_bn' : 'brand_name'], fallback: detail.summary.vendorName(languageCode));
}

String _issueSubject(BuildContext context, String issue) => switch (issue) {
      'late_delivery' => cText(context, 'Late delivery', 'ডেলিভারি দেরি'),
      'missing_item' => cText(context, 'Missing item', 'খাবার নেই'),
      'wrong_item' => cText(context, 'Wrong item', 'ভুল খাবার'),
      'cancel_request' => cText(context, 'Cancellation request', 'বাতিলের অনুরোধ'),
      _ => cText(context, 'Order issue', 'অর্ডারের সমস্যা'),
    };
