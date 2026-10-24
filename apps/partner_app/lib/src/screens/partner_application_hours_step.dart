/// Week-long opening-hours builder enforcing the W1 four-hours-by-five-days rule (`p-05`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import 'partner_onboarding_components.dart';

/// Collects and saves a complete seven-day opening schedule through W1.
class PartnerApplicationHoursStep extends StatefulWidget {
  /// Creates the hours step from saved rows (or a blank schedule for a new application).
  const PartnerApplicationHoursStep({super.key, required this.application, required this.isBangla, required this.busy, required this.canEdit, required this.onSave});

  /// Owner-scoped application with the current `hours` array.
  final Map<String, Object?> application;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Whether W1 is saving the schedule.
  final bool busy;

  /// Whether the server application is still editable by this applicant.
  final bool canEdit;

  /// Saves the complete seven-day schedule; W1 checks each interval and weekly minimum.
  final Future<void> Function(List<Map<String, Object?>> hours) onSave;

  @override
  State<PartnerApplicationHoursStep> createState() => _PartnerApplicationHoursStepState();
}

class _PartnerApplicationHoursStepState extends State<PartnerApplicationHoursStep> {
  late final List<Map<String, Object?>> _initialHours = _mapList(widget.application['hours']);
  List<Map<String, Object?>> _hours = <Map<String, Object?>>[];
  String? _error;

  @override
  void initState() {
    super.initState();
    _hours = List<Map<String, Object?>>.from(_initialHours);
  }

  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-p-05'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(_text('Opening hours', 'খোলার সময়'), style: Theme.of(context).textTheme.headlineSmall),
          Text(_text('Set exact local times for all seven days. At least five days must be open for four hours or more; overnight shifts are supported.', 'সপ্তাহের সাত দিনের সঠিক সময় দিন। অন্তত পাঁচ দিন চার ঘণ্টা বা তার বেশি খোলা থাকতে হবে; রাত পেরিয়ে চলা সময়ও দেওয়া যায়।')),
          if (!widget.canEdit) Text(_text('Hours are read-only after submission while the review team checks your application.', 'আবেদন জমা দেওয়ার পর রিভিউ টিম যাচাই করার সময় খোলার সময় সম্পাদনা করা যাবে না।')),
          const SizedBox(height: UndalSpacingTokens.md),
          PartnerHoursEditor(
            key: const ValueKey<String>('partner-hours-editor'),
            initialHours: _initialHours,
            isBangla: widget.isBangla,
            enabled: widget.canEdit,
            onChanged: (List<Map<String, Object?>> hours) => setState(() { _hours = hours; _error = null; }),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          FilledButton.icon(
            key: const ValueKey<String>('partner-save-hours'),
            onPressed: !widget.canEdit || widget.busy || _hours.length != 7 ? null : () async {
              try {
                await widget.onSave(_hours);
                if (mounted) setState(() => _error = null);
              } on Exception {
                if (mounted) setState(() => _error = _text('Hours did not save. Check that five days each cover at least four hours.', 'সময় সংরক্ষণ হয়নি। পাঁচ দিন অন্তত চার ঘণ্টা করে আছে কি না পরীক্ষা করুন।'));
              }
            },
            icon: widget.busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
            label: Text(_text('Save weekly hours', 'সাপ্তাহিক সময় সংরক্ষণ করুন')),
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
        ],
      ),
    );
  }

  List<Map<String, Object?>> _mapList(Object? value) {
    if (value is! List<Object?>) return <Map<String, Object?>>[];
    return value.whereType<Map<String, Object?>>().map((Map<String, Object?> row) => Map<String, Object?>.from(row)).toList(growable: false);
  }
}
