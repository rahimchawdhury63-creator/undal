/// Explicit food-safety and packaging attestations for home/cloud kitchen applicants.
library;

import 'package:flutter/material.dart';

/// Four required hygiene attestations for cook-to-order kitchen applications.
class PartnerHygieneChecklist extends StatelessWidget {
  /// Creates a required check-all hygiene declaration for cook-to-order kitchens.
  const PartnerHygieneChecklist({super.key, required this.isBangla, required this.value, required this.onChanged, this.enabled = true});

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Current checklist values from the private application.
  final Map<String, Object?> value;

  /// Called when an attestation is changed.
  final ValueChanged<Map<String, Object?>> onChanged;

  /// Disables attestation editing after W1 moves the application into review.
  final bool enabled;

  static const Map<String, String> _labelsEn = <String, String>{
    'clean_water': 'I use clean water for preparation.',
    'safe_storage': 'Ingredients are stored safely and at suitable temperatures.',
    'clean_surfaces': 'Preparation surfaces and utensils are cleaned before use.',
    'food_grade_packaging': 'I use clean, food-grade packaging.',
  };

  static const Map<String, String> _labelsBn = <String, String>{
    'clean_water': 'খাবার তৈরিতে পরিষ্কার পানি ব্যবহার করি।',
    'safe_storage': 'উপকরণ নিরাপদে ও উপযুক্ত তাপমাত্রায় সংরক্ষণ করি।',
    'clean_surfaces': 'ব্যবহারের আগে রান্নার স্থান ও সরঞ্জাম পরিষ্কার করি।',
    'food_grade_packaging': 'পরিষ্কার, খাবার-উপযোগী প্যাকেজিং ব্যবহার করি।',
  };

  @override
  Widget build(BuildContext context) {
    final Map<String, String> labels = isBangla ? _labelsBn : _labelsEn;
    return Column(
      children: labels.entries.map((MapEntry<String, String> entry) => CheckboxListTile(
        key: ValueKey<String>('partner-hygiene-${entry.key}'),
        value: value[entry.key] == true,
        title: Text(entry.value),
        onChanged: enabled ? (bool? checked) => onChanged(<String, Object?>{...value, entry.key: checked == true}) : null,
      )).toList(growable: false),
    );
  }
}
