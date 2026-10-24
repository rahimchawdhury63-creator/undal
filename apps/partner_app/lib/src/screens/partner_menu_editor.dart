/// Structured cook-to-order menu editor with exact integer-poisha transport values.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

/// Structured menu editor using exact integer poisha values for W1 submission.
class PartnerMenuEditor extends StatefulWidget {
  /// Creates an editor for up to thirty dish names with exact BDT input conversion.
  const PartnerMenuEditor({super.key, required this.initialMenu, required this.isBangla, required this.onChanged, this.enabled = true});

  /// Previously saved application menu rows.
  final List<Map<String, Object?>> initialMenu;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Receives valid structured rows after edits, with `price_poisha` always an integer.
  final ValueChanged<List<Map<String, Object?>>> onChanged;

  /// Disables changes after W1 moves the application into review.
  final bool enabled;

  @override
  State<PartnerMenuEditor> createState() => _PartnerMenuEditorState();
}

class _PartnerMenuEditorState extends State<PartnerMenuEditor> {
  late List<Map<String, String>> _rows;

  @override
  void initState() { super.initState(); _rows = _fromSaved(widget.initialMenu); }

  List<Map<String, String>> _fromSaved(List<Map<String, Object?>> saved) => saved.map((Map<String, Object?> row) {
    final int? poisha = row['price_poisha'] is num ? (row['price_poisha']! as num).toInt() : null;
    return <String, String>{'name': row['name']?.toString() ?? '', 'price_taka': poisha == null ? '' : _formatInput(poisha)};
  }).toList();

  String _formatInput(int poisha) {
    final int taka = poisha ~/ 100;
    final int remainder = poisha % 100;
    return remainder == 0 ? '$taka' : '$taka.${remainder.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(widget.isBangla ? 'মেনুর খাবার ও দাম' : 'Structured menu · exact BDT prices', style: Theme.of(context).textTheme.titleMedium),
        Text(widget.isBangla ? '১০০ পয়সা = ৳১। দাম দশমিক টাকা হিসেবে দিন; সার্ভারে পূর্ণসংখ্যা পয়সা পাঠানো হয়।' : 'Enter taka with up to two decimal places. Values are parsed into integer poisha; no floating-point money.'),
        for (int index = 0; index < _rows.length; index++) _row(index),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: !widget.enabled || _rows.length >= 30 ? null : () { _rows.add(<String, String>{'name': '', 'price_taka': ''}); setState(() {}); },
            icon: const Icon(Icons.add),
            label: Text(widget.isBangla ? 'খাবার যোগ করুন' : 'Add dish'),
          ),
        ),
      ],
    );
  }

  Widget _row(int index) {
    final Map<String, String> row = _rows[index];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.sm),
        child: Row(
          children: <Widget>[
            Expanded(
              child: TextFormField(
                key: ValueKey<String>('partner-menu-name-$index'),
                initialValue: row['name'],
                enabled: widget.enabled,
                decoration: InputDecoration(labelText: widget.isBangla ? 'খাবারের নাম' : 'Dish name', border: const OutlineInputBorder()),
                onChanged: (String value) => _set(index, 'name', value),
              ),
            ),
            const SizedBox(width: UndalSpacingTokens.xs),
            SizedBox(
              width: 130,
              child: TextFormField(
                key: ValueKey<String>('partner-menu-price-$index'),
                initialValue: row['price_taka'],
                enabled: widget.enabled,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: widget.isBangla ? 'দাম (৳)' : 'Price (৳)', border: const OutlineInputBorder()),
                onChanged: (String value) => _set(index, 'price_taka', value),
              ),
            ),
            IconButton(
              tooltip: widget.isBangla ? 'খাবার বাদ দিন' : 'Remove dish',
              onPressed: widget.enabled ? () { _rows.removeAt(index); _publish(); setState(() {}); } : null,
              icon: const Icon(Icons.delete_outline),
            ),
          ],
        ),
      ),
    );
  }

  void _set(int index, String key, String value) {
    _rows[index][key] = value.trim();
    _publish();
  }

  void _publish() {
    final List<Map<String, Object?>> valid = <Map<String, Object?>>[];
    for (final Map<String, String> row in _rows) {
      final String name = row['name']!.trim();
      if (name.length < 2 || name.length > 100) continue;
      try {
        final int poisha = parseBdtInputToPoisha(row['price_taka']!.trim());
        if (poisha > 0 && poisha <= 50000000) valid.add(<String, Object?>{'name': name, 'price_poisha': poisha});
      } on FormatException {
        continue;
      } on RangeError {
        continue;
      }
    }
    widget.onChanged(valid);
  }
}
