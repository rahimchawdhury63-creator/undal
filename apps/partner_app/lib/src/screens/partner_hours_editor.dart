/// Seven-day opening-hours editor for Partner application steps and profile review.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

/// Seven-day hours builder with explicit closed/open toggles and no assumed operating schedule.
class PartnerHoursEditor extends StatefulWidget {
  /// Creates an hours editor from the current server schedule (or seven unsaved closed days).
  const PartnerHoursEditor({super.key, required this.initialHours, required this.isBangla, required this.onChanged, this.enabled = true});

  /// Current W1-saved rows; empty for a new application.
  final List<Map<String, Object?>> initialHours;

  /// Whether Bangla day labels are active.
  final bool isBangla;

  /// Receives the complete seven-day schedule whenever a field changes.
  final ValueChanged<List<Map<String, Object?>>> onChanged;

  /// Disables every schedule control when W1 has moved the application into review.
  final bool enabled;

  @override
  State<PartnerHoursEditor> createState() => _PartnerHoursEditorState();
}

class _PartnerHoursEditorState extends State<PartnerHoursEditor> {
  static const List<String> _daysEn = <String>['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static const List<String> _daysBn = <String>['সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার', 'রবিবার'];
  late List<Map<String, Object?>> _days;

  @override
  void initState() {
    super.initState();
    _days = _buildDays(widget.initialHours);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List<Widget>.generate(7, (int index) {
        final Map<String, Object?> day = _days[index];
        final bool closed = day['is_closed'] == true;
        final String label = widget.isBangla ? _daysBn[index] : _daysEn[index];
        return Card(
          key: ValueKey<String>('partner-hours-day-$index'),
          child: Padding(
            padding: const EdgeInsets.all(UndalSpacingTokens.sm),
            child: Column(
              children: <Widget>[
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(label),
                  subtitle: Text(closed ? (widget.isBangla ? 'বন্ধ' : 'Closed') : (widget.isBangla ? 'খোলা' : 'Open')),
                  value: !closed,
                  onChanged: widget.enabled ? (bool open) => _update(index, <String, Object?>{'is_closed': !open}) : null,
                ),
                if (!closed)
                  Wrap(
                    spacing: UndalSpacingTokens.xs,
                    runSpacing: UndalSpacingTokens.xs,
                    children: <Widget>[
                      _timeField(index, 'open1', widget.isBangla ? 'খোলার সময়' : 'Opens (HH:mm)'),
                      _timeField(index, 'close1', widget.isBangla ? 'বন্ধের সময়' : 'Closes (HH:mm)'),
                      if (day['second_shift_enabled'] == true) ...<Widget>[
                        _timeField(index, 'open2', widget.isBangla ? 'আবার খোলে' : 'Reopens (HH:mm)'),
                        _timeField(index, 'close2', widget.isBangla ? 'শেষবার বন্ধ' : 'Closes again (HH:mm)'),
                      ],
                      TextButton.icon(
                        onPressed: widget.enabled ? () => _toggleSecondShift(index) : null,
                        icon: Icon(day['second_shift_enabled'] == true ? Icons.remove_circle_outline : Icons.add_circle_outline),
                        label: Text(day['second_shift_enabled'] == true
                            ? (widget.isBangla ? 'দ্বিতীয় সময় বাদ দিন' : 'Remove second session')
                            : (widget.isBangla ? 'দ্বিতীয় সময় যোগ করুন' : 'Add second session')),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        );
      }),
    );
  }

  List<Map<String, Object?>> _buildDays(List<Map<String, Object?>> current) {
    final Map<int, Map<String, Object?>> indexed = <int, Map<String, Object?>>{};
    for (final Map<String, Object?> row in current) {
      final Object? weekday = row['weekday'];
      if (weekday is num && weekday.toInt() >= 0 && weekday.toInt() <= 6) indexed[weekday.toInt()] = row;
    }
    return List<Map<String, Object?>>.generate(7, (int weekday) {
      final Map<String, Object?>? saved = indexed[weekday];
      String time(String key) {
        final String value = saved?[key]?.toString() ?? '';
        return value.length >= 5 ? value.substring(0, 5) : value;
      }
      return <String, Object?>{
        'weekday': weekday,
        'is_closed': saved?['is_closed'] is bool ? saved!['is_closed'] : true,
        'open1': time('open1'),
        'close1': time('close1'),
        'open2': time('open2'),
        'close2': time('close2'),
        'second_shift_enabled': time('open2').isNotEmpty || time('close2').isNotEmpty,
      };
    });
  }

  Widget _timeField(int index, String field, String label) {
    return SizedBox(
      width: 150,
      child: TextFormField(
        key: ValueKey<String>('partner-hours-$index-$field'),
        initialValue: '${_days[index][field]}',
        keyboardType: TextInputType.datetime,
        enabled: widget.enabled,
        decoration: InputDecoration(labelText: label, hintText: '09:00', border: const OutlineInputBorder()),
        onChanged: (String value) => _update(index, <String, Object?>{field: value.trim()}),
      ),
    );
  }

  void _toggleSecondShift(int index) {
    final bool enabled = _days[index]['second_shift_enabled'] != true;
    _update(index, <String, Object?>{
      'second_shift_enabled': enabled,
      if (!enabled) 'open2': '',
      if (!enabled) 'close2': '',
    });
  }

  void _update(int index, Map<String, Object?> patch) {
    final Map<String, Object?> next = Map<String, Object?>.from(_days[index])..addAll(patch);
    if (next['is_closed'] == true) {
      next.addAll(<String, Object?>{'open1': '', 'close1': '', 'open2': '', 'close2': ''});
    }
    _days[index] = next;
    final List<Map<String, Object?>> payload = _days.map((Map<String, Object?> row) => <String, Object?>{
      'weekday': row['weekday'],
      'is_closed': row['is_closed'],
      'open1': row['is_closed'] == true ? null : row['open1'],
      'close1': row['is_closed'] == true ? null : row['close1'],
      'open2': row['is_closed'] == true || row['open2'] == '' ? null : row['open2'],
      'close2': row['is_closed'] == true || row['close2'] == '' ? null : row['close2'],
    }).toList(growable: false);
    widget.onChanged(payload);
    setState(() {});
  }
}
