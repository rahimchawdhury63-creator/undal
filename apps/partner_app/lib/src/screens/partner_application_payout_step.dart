/// Owner payout setup and exact versioned partner agreement acceptance (`p-06`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';

/// Collects a payout rail for W1 transport encryption and records a versioned terms e-signature.
class PartnerApplicationPayoutStep extends StatefulWidget {
  /// Creates the payout and agreement step with a masked existing beneficiary projection.
  const PartnerApplicationPayoutStep({super.key, required this.application, required this.terms, required this.isBangla, required this.busy, required this.canEdit, required this.onSavePayout, required this.onAcceptTerms});

  /// Owner-private application payload; payout data is masked only.
  final Map<String, Object?> application;

  /// Exact public W1 terms response (`version`, `sha256`, `text_en`, `text_bn`).
  final Map<String, Object?> terms;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Whether a W1 write is in progress.
  final bool busy;

  /// Whether the applicant may still change payout and agreement fields.
  final bool canEdit;

  /// Sends the entered account to W1 over TLS; W1 encrypts it before PostgREST persistence.
  final Future<void> Function({required String method, required String holderName, required String accountNumber}) onSavePayout;

  /// Saves the authenticated user's acceptance of the exact server terms version and hash.
  final Future<void> Function(String agreementVersion) onAcceptTerms;

  @override
  State<PartnerApplicationPayoutStep> createState() => _PartnerApplicationPayoutStepState();
}

class _PartnerApplicationPayoutStepState extends State<PartnerApplicationPayoutStep> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _holder = TextEditingController();
  final TextEditingController _account = TextEditingController();
  String _method = 'bkash';
  bool _accepted = false;
  String? _error;

  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  void dispose() {
    _holder.dispose();
    _account.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, Object?>? payout = widget.application['payout'] is Map<String, Object?> ? widget.application['payout']! as Map<String, Object?> : null;
    final String? version = widget.terms['version'] as String?;
    final String? hash = widget.terms['sha256'] as String?;
    final String? terms = (widget.isBangla ? widget.terms['text_bn'] : widget.terms['text_en']) as String?;
    final bool termsReady = version != null && hash != null && RegExp(r'^[0-9a-f]{64}$').hasMatch(hash) && terms != null;
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-p-06'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(_text('Payout account & agreement', 'পেআউট অ্যাকাউন্ট ও চুক্তি'), style: Theme.of(context).textTheme.headlineSmall),
          Text(_text('Your account number is sent only to W1 over HTTPS. It is RSA-encrypted before storage; the app receives a masked value.', 'আপনার অ্যাকাউন্ট নম্বর HTTPS-এ শুধু W1-এ যায়। সংরক্ষণের আগে RSA এনক্রিপ্ট হয়; অ্যাপে শুধু আড়াল করা নম্বর ফেরত আসে।')),
          if (!widget.canEdit) Text(_text('Payout details and agreement acceptance are read-only after submission.', 'আবেদন জমা দেওয়ার পর পেআউট তথ্য ও চুক্তির সম্মতি সম্পাদনা করা যাবে না।')),
          const SizedBox(height: UndalSpacingTokens.md),
          if (payout != null) Card(child: ListTile(
            leading: const Icon(Icons.account_balance_wallet_outlined),
            title: Text(_text('Saved payout method', 'সংরক্ষিত পেআউট পদ্ধতি')),
            subtitle: Text('${payout['method'] ?? ''} · ${payout['holder_name'] ?? ''} · ${payout['masked'] ?? ''}'),
          )),
          Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                DropdownButtonFormField<String>(
                  key: const ValueKey<String>('partner-payout-method'),
                  value: _method,
                  decoration: InputDecoration(labelText: _text('Payout method', 'পেআউট পদ্ধতি'), border: const OutlineInputBorder()),
                  items: <DropdownMenuItem<String>>[
                    DropdownMenuItem<String>(value: 'bkash', child: Text(_text('bKash · recommended', 'বিকাশ · প্রস্তাবিত'))),
                    DropdownMenuItem<String>(value: 'nagad', child: const Text('Nagad')),
                    DropdownMenuItem<String>(value: 'bank', child: Text(_text('Bank account', 'ব্যাংক অ্যাকাউন্ট'))),
                  ],
                  onChanged: widget.busy || !widget.canEdit ? null : (String? method) => setState(() { if (method != null) _method = method; }),
                ),
                const SizedBox(height: UndalSpacingTokens.sm),
                TextFormField(
                  key: const ValueKey<String>('partner-payout-holder'),
                  controller: _holder,
                  enabled: widget.canEdit,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(labelText: _text('Account holder name', 'অ্যাকাউন্টধারীর নাম'), border: const OutlineInputBorder()),
                  validator: (String? value) => (value?.trim().length ?? 0) >= 2 ? null : _text('Enter the legal account holder name.', 'অ্যাকাউন্টধারীর আইনগত নাম লিখুন।'),
                ),
                const SizedBox(height: UndalSpacingTokens.sm),
                TextFormField(
                  key: const ValueKey<String>('partner-payout-account'),
                  controller: _account,
                  enabled: widget.canEdit,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: _text(_method == 'bank' ? 'Bank account number' : 'Mobile wallet number', _method == 'bank' ? 'ব্যাংক অ্যাকাউন্ট নম্বর' : 'মোবাইল ওয়ালেট নম্বর'), border: const OutlineInputBorder()),
                  validator: _validateAccount,
                ),
                const SizedBox(height: UndalSpacingTokens.sm),
                FilledButton.icon(
                  key: const ValueKey<String>('partner-save-payout'),
                  onPressed: widget.busy || !widget.canEdit ? null : _savePayout,
                  icon: const Icon(Icons.lock_outline),
                  label: Text(_text('Save encrypted payout method', 'এনক্রিপ্ট করা পেআউট পদ্ধতি সংরক্ষণ করুন')),
                ),
              ],
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.lg),
          Text(_text('Partner agreement', 'পার্টনার চুক্তি'), style: Theme.of(context).textTheme.titleLarge),
          if (!termsReady)
            Text(_text('Versioned agreement is unavailable. Refresh from W1 before accepting.', 'সংস্করণযুক্ত চুক্তি পাওয়া যায়নি। গ্রহণের আগে W1 থেকে রিফ্রেশ করুন।'))
          else ...<Widget>[
            Card(child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.md), child: SelectableText(terms))),
            Text(_text('Version: $version · SHA-256: $hash', 'সংস্করণ: $version · SHA-256: $hash'), style: Theme.of(context).textTheme.bodySmall),
            CheckboxListTile(
              key: const ValueKey<String>('partner-agreement-accept'),
              value: _accepted,
              title: Text(_text('I have read and accept this partner agreement.', 'আমি এই পার্টনার চুক্তি পড়েছি এবং গ্রহণ করছি।')),
              onChanged: widget.busy || !widget.canEdit ? null : (bool? accepted) => setState(() { _accepted = accepted == true; _error = null; }),
            ),
            FilledButton.icon(
              key: const ValueKey<String>('partner-save-agreement'),
              onPressed: widget.busy || !widget.canEdit || !_accepted ? null : () async {
                try {
                  await widget.onAcceptTerms(version);
                  if (mounted) setState(() => _error = null);
                } on Exception {
                  if (mounted) setState(() => _error = _text('Agreement could not be saved. Retry after checking your connection.', 'চুক্তি সংরক্ষণ হয়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'));
                }
              },
              icon: const Icon(Icons.draw_outlined),
              label: Text(_text('Record my acceptance', 'আমার সম্মতি সংরক্ষণ করুন')),
            ),
          ],
          if (_error != null) Padding(padding: const EdgeInsets.only(top: UndalSpacingTokens.sm), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          const SizedBox(height: UndalSpacingTokens.xl),
        ],
      ),
    );
  }

  String? _validateAccount(String? value) {
    if (_method == 'bank') {
      final String normalized = _normalizeBankDigits(value ?? '');
      return RegExp(r'^[0-9]{8,34}$').hasMatch(normalized) ? null : _text('Enter 8–34 digits.', '৮–৩৪টি সংখ্যা লিখুন।');
    }
    final String normalized = normalizePartnerPhone(value ?? '');
    return RegExp(r'^01[3-9][0-9]{8}$').hasMatch(normalized) ? null : _text('Enter a valid Bangladesh mobile number.', 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।');
  }

  String _normalizeBankDigits(String value) {
    final String ascii = String.fromCharCodes(value.runes.map((int codePoint) =>
      codePoint >= 0x09e6 && codePoint <= 0x09ef ? 0x30 + codePoint - 0x09e6 : codePoint,
    ));
    return ascii.replaceAll(RegExp(r'[\s-]'), '');
  }

  Future<void> _savePayout() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      await widget.onSavePayout(method: _method, holderName: _holder.text.trim(), accountNumber: _account.text.trim());
      _account.clear();
      _holder.clear();
      if (mounted) setState(() => _error = null);
    } on Exception {
      if (mounted) setState(() => _error = _text('Payout account was not saved. Check the number and retry.', 'পেআউট অ্যাকাউন্ট সংরক্ষণ হয়নি। নম্বর পরীক্ষা করে আবার চেষ্টা করুন।'));
    }
  }
}
