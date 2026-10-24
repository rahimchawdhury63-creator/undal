/// Searchable, localized selector over the live Appendix D cuisine taxonomy.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

/// Searches active cuisine names loaded from W1 and caps the primary selection at five.
class PartnerCuisinePicker extends StatefulWidget {
  /// Creates a cuisine picker for server-owned taxonomy rows.
  const PartnerCuisinePicker({super.key, required this.isBangla, required this.items, required this.selected, required this.onChanged, this.enabled = true});

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Active cuisine rows fetched from W1.
  final List<Map<String, Object?>> items;

  /// Currently selected canonical taxonomy keys.
  final List<String> selected;

  /// Whether cuisine chips can be changed on the current application state.
  final bool enabled;

  /// Called with a new immutable selection when a chip changes.
  final ValueChanged<List<String>> onChanged;

  @override
  State<PartnerCuisinePicker> createState() => _PartnerCuisinePickerState();
}

class _PartnerCuisinePickerState extends State<PartnerCuisinePicker> {
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final List<Map<String, Object?>> visible = widget.items.where((Map<String, Object?> row) {
      final String label = '${row['name_en'] ?? ''} ${row['name_bn'] ?? ''} ${row['key'] ?? ''}'.toLowerCase();
      return label.contains(_query.toLowerCase());
    }).take(60).toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        TextField(
          controller: _search,
          onChanged: (String value) => setState(() => _query = value.trim()),
          decoration: InputDecoration(
            labelText: widget.isBangla ? 'রান্নার ধরন খুঁজুন' : 'Search cuisines',
            prefixIcon: const Icon(Icons.search),
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: UndalSpacingTokens.sm),
        Wrap(
          spacing: UndalSpacingTokens.xs,
          runSpacing: UndalSpacingTokens.xs,
          children: visible.map((Map<String, Object?> row) {
            final String key = row['key']?.toString() ?? '';
            final String label = (widget.isBangla ? row['name_bn'] : row['name_en'])?.toString() ?? key;
            if (key.isEmpty) return const SizedBox.shrink();
            final bool chosen = widget.selected.contains(key);
            return FilterChip(
              key: ValueKey<String>('partner-cuisine-$key'),
              label: Text(label),
              selected: chosen,
              onSelected: widget.enabled ? (bool value) {
                final List<String> next = List<String>.of(widget.selected);
                if (value && next.length < 5) next.add(key);
                if (!value) next.remove(key);
                widget.onChanged(next);
              } : null,
            );
          }).toList(growable: false),
        ),
        Text(widget.isBangla ? 'সর্বোচ্চ ৫টি নির্বাচন করুন (${widget.selected.length}/5)।' : 'Choose up to five primary cuisines (${widget.selected.length}/5).'),
      ],
    );
  }
}
