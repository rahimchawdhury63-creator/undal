/// OSM pin micro-adjust editor launched from c-18 or c-20 checkout surfaces.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../state/customer_commerce_state.dart';
import '../state/customer_controller.dart';

/// Edits the active delivery address without losing the cart or checkout route.
class CustomerCheckoutAddressEditorScreen extends StatefulWidget {
  /// Creates the inline checkout address editor.
  const CustomerCheckoutAddressEditorScreen({super.key, required this.controller});

  /// Root state owner whose saved address and service-zone verdict are updated on save.
  final CustomerController controller;

  @override
  State<CustomerCheckoutAddressEditorScreen> createState() => _CustomerCheckoutAddressEditorScreenState();
}

class _CustomerCheckoutAddressEditorScreenState extends State<CustomerCheckoutAddressEditorScreen> {
  late GeoPoint _pin;
  late final TextEditingController _streetController;
  late final TextEditingController _landmarkController;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final address = widget.controller.activeAddress;
    _pin = address.point;
    _streetController = TextEditingController(text: address.id == 'area-sylhet-sadar' ? '' : address.addressText);
    _landmarkController = TextEditingController(text: address.landmarkNote);
  }

  @override
  void dispose() {
    _streetController.dispose();
    _landmarkController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController controller = widget.controller;
    final bool inLocalZone = resolveZoneLocal(_pin).inServiceArea;
    final bool addressValid = _streetController.text.trim().length >= 3;
    final String apiBase = controller.api.config.apiBaseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    return Scaffold(
      key: const ValueKey<String>('checkout-address-editor'),
      appBar: AppBar(
        title: Text(cText(context, 'Adjust delivery pin', 'ডেলিভারি পিন ঠিক করুন')),
        leading: IconButton(
          tooltip: cText(context, 'Back to checkout', 'চেকআউটে ফিরুন'),
          onPressed: _saving ? null : () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          children: <Widget>[
            SizedBox(
              height: 250,
              child: UndalOsmMap(
                center: _pin,
                zoom: 15,
                showCenterPin: true,
                tileProxyBaseUrl: apiBase.isEmpty ? null : apiBase,
                onCenterChanged: (GeoPoint point) => setState(() => _pin = point),
              ),
            ),
            const SizedBox(height: UndalSpacingTokens.sm),
            Text(
              inLocalZone
                  ? cText(context, 'Delivery pin is inside an active service area.', 'ডেলিভারি পিনটি চালু সার্ভিস এলাকার মধ্যে আছে।')
                  : cText(context, 'This pin is outside an active delivery area.', 'এই পিনটি চালু ডেলিভারি এলাকার বাইরে।'),
              style: TextStyle(color: inLocalZone ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: UndalSpacingTokens.sm),
            TextField(
              key: const ValueKey<String>('checkout-address-street-input'),
              controller: _streetController,
              maxLength: 400,
              enabled: !_saving,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: cText(context, 'House / Road / Area', 'বাসা / রোড / এলাকা'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: UndalSpacingTokens.xs),
            TextField(
              controller: _landmarkController,
              maxLength: 300,
              enabled: !_saving,
              decoration: InputDecoration(
                labelText: cText(context, 'Landmark and floor for the rider', 'রাইডারের জন্য ল্যান্ডমার্ক ও ফ্লোর'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: UndalSpacingTokens.sm),
            FilledButton.icon(
              key: const ValueKey<String>('checkout-address-save'),
              onPressed: _saving || !inLocalZone || !addressValid ? null : _saveAddress,
              icon: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.check),
              label: Text(cText(context, 'Save delivery address', 'ডেলিভারি ঠিকানা সংরক্ষণ করুন')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _saveAddress() async {
    setState(() => _saving = true);
    await widget.controller.updateDraftPin(_pin);
    if (!mounted) return;
    if (!widget.controller.draftPinVerdict.inServiceArea) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(cText(context, 'Choose a pin inside an active Undal service zone.', 'উন্দালের চালু সার্ভিস জোনের মধ্যে পিন বাছুন।'))),
      );
      return;
    }
    widget.controller.updateActiveAddress(
      point: _pin,
      streetAddress: _streetController.text,
      landmarkNote: _landmarkController.text,
    );
    if (widget.controller.isAuthenticated) await widget.controller.commerce.refreshServerQuote();
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }
}
