/// Applicant shell profile form and track selection (`p-01`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import 'partner_onboarding_components.dart';

/// Collects the minimum private business profile needed to create an owner-bound draft.
class PartnerApplicationProfileStep extends StatefulWidget {
  /// Creates the applicant profile shell with live taxonomy rows and optional saved values.
  const PartnerApplicationProfileStep({super.key, required this.isBangla, required this.cuisines, required this.initialValues, required this.trackLocked, required this.readOnly, required this.onDraftChanged, required this.onContinue, required this.onOpenVault, required this.onOpenStatus});

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Cuisine taxonomy rows fetched through W1.
  final List<Map<String, Object?>> cuisines;

  /// Current unsaved values or the owner's persisted application projection.
  final Map<String, Object?> initialValues;

  /// Whether the application track is immutable because a draft already exists.
  final bool trackLocked;

  /// Whether this submitted/reviewed application is locked against applicant edits.
  final bool readOnly;

  /// Keeps the parent wizard's in-memory draft current while the applicant types.
  final ValueChanged<Map<String, Object?>> onDraftChanged;

  /// Continues to the owner pin step with validated profile values.
  final ValueChanged<Map<String, Object?>> onContinue;

  /// Opens the separately identified private document vault (`p-35`).
  final VoidCallback onOpenVault;

  /// Opens the KYC status tracker (`p-07`).
  final VoidCallback onOpenStatus;

  @override
  State<PartnerApplicationProfileStep> createState() => _PartnerApplicationProfileStepState();
}

class _PartnerApplicationProfileStepState extends State<PartnerApplicationProfileStep> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _legalName = TextEditingController(text: _initial('legal_name'));
  late final TextEditingController _brandName = TextEditingController(text: _initial('brand_name'));
  late final TextEditingController _brandNameBn = TextEditingController(text: _initial('brand_name_bn'));
  late final TextEditingController _representativeName = TextEditingController(text: _initial('representative_name'));
  late final TextEditingController _email = TextEditingController(text: _initial('contact_email'));
  late final TextEditingController _phone = TextEditingController(text: _initial('counter_phone'));
  late final TextEditingController _publicArea = TextEditingController(text: _initial('public_area_label'));
  late final TextEditingController _privateAddress = TextEditingController(text: _initial('address_text_private'));
  late final TextEditingController _pickupPoint = TextEditingController(text: _initial('pickup_point_label'));
  PartnerTrack? _track;
  List<String> _selectedCuisines = <String>[];
  bool _acceptsPickup = false;
  String? _error;

  String _initial(String key) => widget.initialValues[key]?.toString() ?? '';
  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  void initState() {
    super.initState();
    _track = PartnerTrack.parse(widget.initialValues['type']);
    _acceptsPickup = widget.initialValues['accepts_pickup'] is bool
        ? widget.initialValues['accepts_pickup'] == true
        : _track == PartnerTrack.restaurant;
    final Object? current = widget.initialValues['cuisines'];
    if (current is List<Object?>) _selectedCuisines = current.whereType<String>().take(5).toList();
  }

  @override
  void dispose() {
    _legalName.dispose();
    _brandName.dispose();
    _brandNameBn.dispose();
    _representativeName.dispose();
    _email.dispose();
    _phone.dispose();
    _publicArea.dispose();
    _privateAddress.dispose();
    _pickupPoint.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-p-01'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(_text('Partner application', 'পার্টনার আবেদন'), style: theme.textTheme.headlineSmall),
            const SizedBox(height: UndalSpacingTokens.xs),
            Text(_text('Restaurant, home kitchen and cloud kitchen applicants use the same private application shell.', 'রেস্টুরেন্ট, হোম কিচেন ও ক্লাউড কিচেনের আবেদন এই ব্যক্তিগত ফর্মে সংরক্ষিত হয়।')),
            const SizedBox(height: UndalSpacingTokens.md),
            if (widget.readOnly) Padding(
              padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm),
              child: Text(_text('This application is locked while it is being reviewed. Use the status screen for review updates.', 'রিভিউ চলাকালে এই আবেদন সম্পাদনা করা যাবে না। আপডেট দেখতে অবস্থা স্ক্রিন খুলুন।')),
            ),
            if (widget.trackLocked)
              _trackCard(context, _track ?? PartnerTrack.restaurant, locked: true)
            else ...<Widget>[
              Text(_text('Choose your business type', 'আপনার ব্যবসার ধরন বাছুন'), style: theme.textTheme.titleMedium),
              const SizedBox(height: UndalSpacingTokens.xs),
              for (final PartnerTrack track in PartnerTrack.values) _trackCard(context, track),
            ],
            const SizedBox(height: UndalSpacingTokens.md),
            _textField(_legalName, _track == PartnerTrack.restaurant ? 'Official legal business name' : 'Owner / chef legal name', 'আইনগত ব্যবসা / মালিকের নাম', min: 2, max: 140),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_brandName, 'Public brand name', 'সবার জন্য প্রদর্শিত ব্র্যান্ডের নাম', min: 2, max: 120),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_brandNameBn, 'Brand name in Bangla (optional)', 'বাংলায় ব্র্যান্ডের নাম (ঐচ্ছিক)', max: 120, optional: true),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_representativeName, 'Owner / representative legal name', 'মালিক / প্রতিনিধির আইনগত নাম', min: 2, max: 140),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_email, 'Contact email', 'যোগাযোগের ইমেইল', keyboardType: TextInputType.emailAddress, customValidator: _validateEmail),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_phone, 'Bangladesh mobile number', 'বাংলাদেশের মোবাইল নম্বর', keyboardType: TextInputType.phone, customValidator: _validatePhone),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_publicArea, 'Public area / neighbourhood label', 'প্রকাশ্য এলাকা / মহল্লার নাম', min: 2, max: 120, helper: _text('This label is customer-facing; do not enter a house or flat number.', 'এই নামটি গ্রাহক দেখতে পাবেন; বাড়ি বা ফ্ল্যাট নম্বর লিখবেন না।')),
            const SizedBox(height: UndalSpacingTokens.sm),
            _textField(_privateAddress, 'Exact private kitchen address', 'রান্নাঘরের সুনির্দিষ্ট ব্যক্তিগত ঠিকানা', min: 4, max: 400, maxLines: 3, helper: _text('Private for onboarding and delivery operations. It is never exposed in the public catalogue.', 'শুধু যাচাই ও ডেলিভারি ব্যবস্থাপনার জন্য ব্যক্তিগত। পাবলিক ক্যাটালগে দেখানো হয় না.')),
            const SizedBox(height: UndalSpacingTokens.md),
            CheckboxListTile(
              key: const ValueKey<String>('partner-accepts-pickup'),
              value: _acceptsPickup,
              title: Text(_text('Allow customer counter pickup', 'গ্রাহকের কাউন্টার পিকআপ চালু করুন')),
              subtitle: Text(_text(_track == PartnerTrack.restaurant ? 'Restaurants start with pickup on; you may turn it off.' : 'Home/cloud kitchens start with pickup off. Only an approved pickup label is shown; never the exact home address.', 'রেস্টুরেন্টে পিকআপ শুরুতে চালু থাকে; চাইলে বন্ধ করুন। হোম/ক্লাউড কিচেনে বন্ধ থাকে। অনুমোদিত পিকআপ নাম দেখানো হবে, সুনির্দিষ্ট ঠিকানা নয়।')),
              onChanged: widget.readOnly ? null : (bool? value) {
                setState(() { _acceptsPickup = value == true; if (!_acceptsPickup) _pickupPoint.clear(); });
                _emitDraft();
              },
            ),
            if (_acceptsPickup) ...<Widget>[
              const SizedBox(height: UndalSpacingTokens.xs),
              _textField(_pickupPoint, 'Pickup counter / approved pickup-point label', 'পিকআপ কাউন্টার / অনুমোদিত পিকআপ পয়েন্টের নাম', min: 2, max: 120, helper: _text('Use a public-facing counter label only, not a home address.', 'শুধু প্রকাশযোগ্য কাউন্টার নাম লিখুন; বাড়ির ঠিকানা নয়।')),
            ],
            const SizedBox(height: UndalSpacingTokens.lg),
            Text(_text('Primary cuisines', 'প্রধান রান্নার ধরন'), style: theme.textTheme.titleMedium),
            if (widget.cuisines.isEmpty) Padding(
              padding: const EdgeInsets.symmetric(vertical: UndalSpacingTokens.sm),
              child: Text(_text('The live cuisine list is unavailable. Refresh before continuing; no sample categories are shown.', 'সার্ভারের রান্নার তালিকা পাওয়া যায়নি। এগোনোর আগে রিফ্রেশ করুন; কোনো নমুনা তালিকা দেখানো হচ্ছে না।')),
            ) else PartnerCuisinePicker(isBangla: widget.isBangla, items: widget.cuisines, selected: _selectedCuisines, enabled: !widget.readOnly, onChanged: (List<String> next) {
              setState(() { _selectedCuisines = next; _error = null; });
              _emitDraft();
            }),
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: UndalSpacingTokens.sm),
              child: Text(_error!, key: const ValueKey<String>('partner-profile-error'), style: TextStyle(color: theme.colorScheme.error)),
            ),
            const SizedBox(height: UndalSpacingTokens.lg),
            FilledButton.icon(
              key: const ValueKey<String>('partner-profile-continue'),
              onPressed: widget.readOnly ? null : _continue,
              icon: const Icon(Icons.map_outlined),
              label: Text(_text(widget.trackLocked ? 'Save profile and continue' : 'Continue to pin & zone check', widget.trackLocked ? 'প্রোফাইল সংরক্ষণ করে এগোন' : 'পিন ও জোন যাচাইয়ে এগোন')),
            ),
            if (widget.trackLocked) ...<Widget>[
              const SizedBox(height: UndalSpacingTokens.sm),
              OutlinedButton.icon(onPressed: widget.onOpenVault, icon: const Icon(Icons.folder_open), label: Text(_text('Documents vault · p-35', 'নথির ভল্ট · p-35'))),
              OutlinedButton.icon(onPressed: widget.onOpenStatus, icon: const Icon(Icons.fact_check_outlined), label: Text(_text('Application status · p-07', 'আবেদনের অবস্থা · p-07'))),
            ],
            const SizedBox(height: UndalSpacingTokens.xl),
          ],
        ),
      ),
    );
  }

  Widget _trackCard(BuildContext context, PartnerTrack track, {bool locked = false}) {
    final String label = widget.isBangla ? track.labelBn : track.labelEn;
    final String detail = switch (track) {
      PartnerTrack.restaurant => _text('Licensed outlet with trade and tax documents.', 'লাইসেন্সধারী রেস্টুরেন্ট; ট্রেড ও কর-সংক্রান্ত নথি লাগবে।'),
      PartnerTrack.homeKitchen => _text('Cook-to-order home kitchen; exact address stays private.', 'অর্ডার অনুযায়ী রান্না; সুনির্দিষ্ট ঠিকানা ব্যক্তিগত থাকবে।'),
      PartnerTrack.cloudKitchen => _text('Delivery-first cloud kitchen; exact address stays private.', 'ডেলিভারি-কেন্দ্রিক ক্লাউড কিচেন; সুনির্দিষ্ট ঠিকানা ব্যক্তিগত থাকবে।'),
    };
    return Card(
      child: RadioListTile<PartnerTrack>(
        key: ValueKey<String>('partner-track-${track.wire}'),
        value: track,
        groupValue: _track,
        onChanged: locked ? null : (PartnerTrack? value) {
          setState(() {
            _track = value;
            _acceptsPickup = value == PartnerTrack.restaurant;
            if (!_acceptsPickup) _pickupPoint.clear();
            _error = null;
          });
          _emitDraft();
        },
        title: Text(label),
        subtitle: Text(detail),
        secondary: Icon(switch (track) { PartnerTrack.restaurant => Icons.storefront_outlined, PartnerTrack.homeKitchen => Icons.home_work_outlined, PartnerTrack.cloudKitchen => Icons.cloud_outlined }),
      ),
    );
  }

  Widget _textField(TextEditingController controller, String en, String bn, {int min = 2, int max = 120, int maxLines = 1, bool optional = false, TextInputType? keyboardType, String? helper, String? Function(String?)? customValidator}) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      enabled: !widget.readOnly,
      maxLines: maxLines,
      textCapitalization: keyboardType == TextInputType.emailAddress ? TextCapitalization.none : TextCapitalization.words,
      maxLength: max,
      decoration: InputDecoration(labelText: _text(en, bn), helperText: helper, border: const OutlineInputBorder()),
      validator: (String? value) {
        final String text = value?.trim() ?? '';
        if (optional && text.isEmpty) return null;
        if (customValidator != null) return customValidator(text);
        if (text.length < min || text.length > max) return _text('Enter $min–$max characters.', '$min–$max অক্ষর লিখুন।');
        return null;
      },
      onChanged: (_) => _emitDraft(),
    );
  }

  String? _validateEmail(String? raw) {
    final String value = raw?.trim() ?? '';
    return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value) ? null : _text('Enter a valid email address.', 'সঠিক ইমেইল ঠিকানা লিখুন।');
  }

  String? _validatePhone(String? raw) {
    final String value = normalizePartnerPhone(raw ?? '');
    return RegExp(r'^01[3-9][0-9]{8}$').hasMatch(value) ? null : _text('Enter a valid Bangladesh mobile number.', 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।');
  }

  Map<String, Object?> _values() => <String, Object?>{
    'type': _track?.wire,
    'legal_name': _legalName.text.trim(),
    'brand_name': _brandName.text.trim(),
    'brand_name_bn': _brandNameBn.text.trim().isEmpty ? null : _brandNameBn.text.trim(),
    'representative_name': _representativeName.text.trim(),
    'contact_email': _email.text.trim().toLowerCase(),
    'counter_phone': normalizePartnerPhone(_phone.text),
    'public_area_label': _publicArea.text.trim(),
    'address_text_private': _privateAddress.text.trim(),
    'cuisines': List<String>.unmodifiable(_selectedCuisines),
    'accepts_pickup': _acceptsPickup,
    'pickup_point_label': _acceptsPickup && _pickupPoint.text.trim().isNotEmpty ? _pickupPoint.text.trim() : null,
  };

  void _emitDraft() => widget.onDraftChanged(_values());

  void _continue() {
    if (_track == null) {
      setState(() => _error = _text('Choose a business type to continue.', 'এগোতে ব্যবসার ধরন বাছুন।'));
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    if (_selectedCuisines.isEmpty) {
      setState(() => _error = _text('Choose at least one active cuisine.', 'অন্তত একটি চালু রান্নার ধরন বাছুন।'));
      return;
    }
    final Map<String, Object?> values = _values();
    widget.onDraftChanged(values);
    widget.onContinue(values);
  }
}
