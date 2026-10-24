/// Track-specific KYC documents and home/cloud kitchen preparation declarations (`p-02`, `p-03`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import 'partner_onboarding_components.dart';

/// Renders the correct private KYC document checklist and structured kitchen menu fields.
class PartnerApplicationDocumentsStep extends StatefulWidget {
  /// Creates the restaurant or kitchen document step with real W1 document projections.
  const PartnerApplicationDocumentsStep({super.key, required this.track, required this.application, required this.isBangla, required this.busy, required this.canEdit, required this.onUpload, required this.onView, required this.onSaveKitchenDetails, required this.onOpenVault});

  /// Persisted restaurant, home-kitchen, or cloud-kitchen application track.
  final PartnerTrack track;

  /// Safe owner-scoped W1 application projection.
  final Map<String, Object?> application;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Whether the parent wizard is saving application fields.
  final bool busy;

  /// Whether W1 still accepts edits for this application state.
  final bool canEdit;

  /// Uploads selected document bytes through W1 and Cloudinary authenticated storage.
  final Future<void> Function(PartnerDocumentSpec spec, List<int> bytes, String filename, String? expiresOn, String? issuedOn) onUpload;

  /// Opens a W1-audited short-lived view of an owner-bound document.
  final Future<void> Function(String assetId) onView;

  /// Saves a structured menu, cook-to-order declaration, prep estimate, hygiene attestations and packaging acknowledgement.
  final ValueChanged<Map<String, Object?>> onSaveKitchenDetails;

  /// Opens the separately identified documents vault (`p-35`).
  final VoidCallback onOpenVault;

  @override
  State<PartnerApplicationDocumentsStep> createState() => _PartnerApplicationDocumentsStepState();
}

class _PartnerApplicationDocumentsStepState extends State<PartnerApplicationDocumentsStep> {
  List<Map<String, Object?>> _menu = <Map<String, Object?>>[];
  Map<String, Object?> _hygiene = <String, Object?>{};
  bool _onDemand = false;
  bool _packagingAccepted = false;
  int? _prepMinutes;

  bool get _isKitchen => widget.track != PartnerTrack.restaurant;
  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  void initState() {
    super.initState();
    _menu = _mapList(widget.application['onboarding_menu']);
    _hygiene = _map(widget.application['hygiene_checklist']);
    _onDemand = widget.application['on_demand_declared'] == true;
    _packagingAccepted = widget.application['packaging_standard_accepted_at'] is String;
    final Object? prep = widget.application['partner_prep_minutes_estimate'];
    if (prep is int && prep >= 5 && prep <= 200) _prepMinutes = prep;
  }

  @override
  Widget build(BuildContext context) {
    final String screenId = widget.track == PartnerTrack.restaurant ? 'p-02' : 'p-03';
    final List<Map<String, Object?>> documents = _mapList(widget.application['documents']);
    return SingleChildScrollView(
      key: ValueKey<String>('screen-$screenId'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(_text(widget.track == PartnerTrack.restaurant ? 'Restaurant KYC documents' : '${widget.track.labelEn} KYC documents', widget.track == PartnerTrack.restaurant ? 'রেস্টুরেন্ট KYC নথি' : '${widget.track.labelBn} KYC নথি'), style: Theme.of(context).textTheme.headlineSmall),
          Text(_text('Every file is private and owner-bound. Upload a clear photo or PDF, up to 5 MiB per file.', 'প্রতিটি ফাইল ব্যক্তিগত ও মালিক-নির্দিষ্ট। পরিষ্কার ছবি বা PDF দিন; প্রতি ফাইল সর্বোচ্চ ৫ MiB।')),
          const SizedBox(height: UndalSpacingTokens.md),
          PartnerDocumentVault(
            track: widget.track,
            documents: documents,
            isBangla: widget.isBangla,
            onUpload: widget.onUpload,
            onView: widget.onView,
            canUpload: widget.canEdit,
          ),
          if (_isKitchen) ...<Widget>[
            const SizedBox(height: UndalSpacingTokens.lg),
            const Divider(),
            Text(_text('Cook-to-order menu', 'অর্ডার অনুযায়ী রান্নার মেনু'), style: Theme.of(context).textTheme.titleLarge),
            Text(_text('Add real dishes and prices. The digital menu can be reviewed before launch; no sample dishes are inserted.', 'বাস্তব খাবার ও দাম লিখুন। চালুর আগে ডিজিটাল মেনু যাচাই হবে; কোনো নমুনা খাবার যোগ করা হয় না.')),
            if (!widget.canEdit) Text(_text('Kitchen details are read-only while this application is being reviewed.', 'আবেদন রিভিউ চলাকালে রান্নাঘরের তথ্য সম্পাদনা করা যাবে না।')),
            PartnerMenuEditor(initialMenu: _menu, isBangla: widget.isBangla, enabled: widget.canEdit, onChanged: (List<Map<String, Object?>> menu) => _menu = menu),
            const SizedBox(height: UndalSpacingTokens.md),
            CheckboxListTile(
              key: const ValueKey<String>('partner-on-demand-declaration'),
              value: _onDemand,
              title: Text(_text('I prepare each item after an order is received.', 'অর্ডার পাওয়ার পর প্রতিটি খাবার রান্না করি।')),
              subtitle: Text(_text('This self-declaration helps estimate honest preparation times.', 'এই স্ব-ঘোষণা বাস্তবসম্মত রান্নার সময় অনুমানে সাহায্য করে।')),
              onChanged: widget.canEdit ? (bool? value) => setState(() => _onDemand = value == true) : null,
            ),
            DropdownButtonFormField<int>(
              key: const ValueKey<String>('partner-prep-estimate'),
              value: _prepMinutes,
              decoration: InputDecoration(labelText: _text('Typical preparation time (minutes)', 'সাধারণ রান্নার সময় (মিনিট)'), border: const OutlineInputBorder()),
              items: <int>[5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 200].map((int minutes) => DropdownMenuItem<int>(value: minutes, child: Text('$minutes ${_text('min', 'মিনিট')}'))).toList(growable: false),
              onChanged: widget.canEdit ? (int? minutes) => setState(() => _prepMinutes = minutes) : null,
            ),
            const SizedBox(height: UndalSpacingTokens.lg),
            Text(_text('Kitchen hygiene self-check', 'রান্নাঘরের পরিচ্ছন্নতা যাচাই'), style: Theme.of(context).textTheme.titleLarge),
            PartnerHygieneChecklist(isBangla: widget.isBangla, value: _hygiene, enabled: widget.canEdit, onChanged: (Map<String, Object?> next) => setState(() => _hygiene = next)),
            CheckboxListTile(
              key: const ValueKey<String>('partner-packaging-standard'),
              value: _packagingAccepted,
              title: Text(_text('I accept the Undal food-grade packaging standard.', 'উন্দালের খাবার-উপযোগী প্যাকেজিং মান মেনে নিচ্ছি।')),
              onChanged: widget.canEdit ? (bool? value) => setState(() => _packagingAccepted = value == true) : null,
            ),
            FilledButton.icon(
              key: const ValueKey<String>('partner-save-kitchen-details'),
              onPressed: widget.busy || !widget.canEdit ? null : () => widget.onSaveKitchenDetails(<String, Object?>{
                'onboarding_menu': _menu,
                'on_demand_declared': _onDemand,
                if (_prepMinutes != null) 'typical_prep_minutes': _prepMinutes,
                'hygiene_checklist': _hygiene,
                'packaging_standard_accepted': _packagingAccepted,
              }),
              icon: const Icon(Icons.save_outlined),
              label: Text(_text('Save menu & kitchen declarations', 'মেনু ও রান্নাঘরের ঘোষণা সংরক্ষণ করুন')),
            ),
          ],
          const SizedBox(height: UndalSpacingTokens.sm),
          OutlinedButton.icon(onPressed: widget.onOpenVault, icon: const Icon(Icons.folder_open), label: Text(_text('Open separate documents vault · p-35', 'আলাদা নথির ভল্ট খুলুন · p-35'))),
          const SizedBox(height: UndalSpacingTokens.xl),
        ],
      ),
    );
  }

  List<Map<String, Object?>> _mapList(Object? value) {
    if (value is! List<Object?>) return <Map<String, Object?>>[];
    return value.whereType<Map<String, Object?>>().map((Map<String, Object?> row) => Map<String, Object?>.from(row)).toList(growable: false);
  }

  Map<String, Object?> _map(Object? value) => value is Map<String, Object?> ? Map<String, Object?>.from(value) : <String, Object?>{};
}
