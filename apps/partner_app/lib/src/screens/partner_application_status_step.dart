/// Server-backed Partner KYC completeness and review-status tracker (`p-07`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';

/// Shows exact W1 application/document states and allows an incomplete-checklist submission attempt.
class PartnerApplicationStatusStep extends StatelessWidget {
  /// Creates the applicant KYC tracker from the current W1 response.
  const PartnerApplicationStatusStep({super.key, required this.application, required this.track, required this.isBangla, required this.busy, required this.submitError, required this.onSubmit, required this.onOpenVault});

  /// Owner-private server application response.
  final Map<String, Object?> application;

  /// Current restaurant/home/cloud track.
  final PartnerTrack track;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Whether the W1 submission request is in progress.
  final bool busy;

  /// Exact `KYC_INCOMPLETE` missing codes from W1, if a prior submit was attempted.
  final List<String> submitError;

  /// Submits the application through W1 after local review.
  final VoidCallback onSubmit;

  /// Opens the separate private document vault (`p-35`).
  final VoidCallback onOpenVault;

  String _text(String en, String bn) => isBangla ? bn : en;

  @override
  Widget build(BuildContext context) {
    final String status = application['kyc_status']?.toString() ?? 'draft';
    final List<Map<String, Object?>> docs = _mapList(application['documents']);
    final List<String> statusSteps = <String>['draft', 'submitted', 'under_review', 'approved'];
    final int currentIndex = statusSteps.indexOf(status);
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-p-07'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(_text('Application status', 'আবেদনের অবস্থা'), style: Theme.of(context).textTheme.headlineSmall),
          Card(child: Padding(
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
              Text(isBangla ? track.labelBn : track.labelEn, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: UndalSpacingTokens.xs),
              Text(_statusLabel(status)),
              if (status == 'submitted' || status == 'under_review') Text(_text('Target review time: within 48 hours. We will update this status when the review changes.', 'রিভিউয়ের লক্ষ্য সময়: ৪৮ ঘণ্টার মধ্যে। রিভিউতে পরিবর্তন হলে এই অবস্থা হালনাগাদ হবে।')),
              if (status == 'approved') Text(_text('Approval is recorded by the review team. Follow the in-app activation checklist before accepting orders.', 'রিভিউ টিম অনুমোদন দিয়েছে। অর্ডার নেওয়ার আগে অ্যাপের চালু করার চেকলিস্ট অনুসরণ করুন।')),
              if (status == 'rejected') Text(_text('The application was not approved. Review the notes below and contact Undal support for the re-application path.', 'আবেদন অনুমোদিত হয়নি। নিচের নোট দেখুন এবং পুনরায় আবেদনের জন্য উন্দাল সাপোর্টে যোগাযোগ করুন।')),
            ]),
          )),
          if (currentIndex >= 0) ...<Widget>[
            for (int index = 0; index < statusSteps.length; index++) ListTile(
              leading: Icon(index <= currentIndex ? Icons.check_circle : Icons.radio_button_unchecked, color: index <= currentIndex ? Theme.of(context).colorScheme.primary : null),
              title: Text(_statusLabel(statusSteps[index])),
              dense: true,
            ),
          ],
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(_text('Documents & reviewer notes', 'নথি ও রিভিউ নোট'), style: Theme.of(context).textTheme.titleLarge),
          for (final Map<String, Object?> document in docs) _documentRow(context, document),
          if (docs.isEmpty) Text(_text('No private KYC documents have been uploaded yet.', 'এখনো কোনো ব্যক্তিগত KYC নথি আপলোড হয়নি।')),
          if (submitError.isNotEmpty) ...<Widget>[
            const SizedBox(height: UndalSpacingTokens.md),
            Text(_text('Items W1 says are still missing', 'W1 অনুযায়ী এখনো যা বাকি'), style: Theme.of(context).textTheme.titleMedium),
            for (final String item in submitError) ListTile(leading: const Icon(Icons.error_outline), title: Text(_missingLabel(item)), dense: true),
          ],
          const SizedBox(height: UndalSpacingTokens.md),
          OutlinedButton.icon(onPressed: onOpenVault, icon: const Icon(Icons.folder_open), label: Text(_text('Review or re-upload in documents vault · p-35', 'নথির ভল্টে দেখুন বা আবার আপলোড করুন · p-35'))),
          const SizedBox(height: UndalSpacingTokens.sm),
          FilledButton.icon(
            key: const ValueKey<String>('partner-submit-application'),
            onPressed: busy || (status != 'draft' && status != 'needs_fix') ? null : onSubmit,
            icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_outlined),
            label: Text(_text(status == 'needs_fix' ? 'Resubmit updated application' : 'Submit for KYC review', status == 'needs_fix' ? 'সংশোধিত আবেদন আবার পাঠান' : 'KYC রিভিউতে আবেদন পাঠান')),
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
        ],
      ),
    );
  }

  Widget _documentRow(BuildContext context, Map<String, Object?> document) {
    final String docType = document['doc_type']?.toString() ?? _text('Document', 'নথি');
    final String status = document['review_status']?.toString() ?? 'pending';
    final String? note = document['review_note'] as String?;
    final IconData icon = status == 'approved' ? Icons.verified_outlined : status == 'needs_fix' || status == 'rejected' ? Icons.warning_amber_outlined : Icons.hourglass_empty;
    return Card(child: ListTile(
      leading: Icon(icon),
      title: Text(docType.replaceAll('_', ' ')),
      subtitle: note == null || note.trim().isEmpty ? Text(_statusLabel(status)) : Text('${_statusLabel(status)} · $note'),
      trailing: document['expires_on'] is String ? Text('${_text('Expires', 'মেয়াদ')}: ${document['expires_on']}') : null,
    ));
  }

  String _statusLabel(String status) => switch (status) {
    'draft' => _text('Draft · keep editing', 'খসড়া · সম্পাদনা চালিয়ে যান'),
    'submitted' => _text('Submitted', 'জমা হয়েছে'),
    'under_review' => _text('Under review', 'রিভিউ চলছে'),
    'approved' => _text('Approved', 'অনুমোদিত'),
    'needs_fix' => _text('Changes requested', 'সংশোধন চাওয়া হয়েছে'),
    'rejected' => _text('Not approved', 'অনুমোদিত হয়নি'),
    'pending' => _text('In review', 'পর্যালোচনাধীন'),
    _ => _text('Status: $status', 'অবস্থা: $status'),
  };

  String _missingLabel(String code) => switch (code) {
    'trade_license' => _text('Trade licence', 'ট্রেড লাইসেন্স'),
    'nid_or_passport_front_and_back' => _text('NID or passport front and back', 'NID বা পাসপোর্টের দুই পাশ'),
    'tin' => _text('TIN certificate', 'TIN সনদ'),
    'bin' => _text('BIN certificate', 'BIN সনদ'),
    'bank_proof_or_bkash_or_nagad_proof' => _text('Bank, bKash or Nagad proof', 'ব্যাংক, বিকাশ বা নগদের প্রমাণ'),
    'trade_license_expiry' => _text('A current trade licence expiry date', 'ট্রেড লাইসেন্সের বৈধ মেয়াদ'),
    'utility_bill' => _text('Recent utility bill', 'সাম্প্রতিক ইউটিলিটি বিল'),
    'utility_bill_issued_within_90_days' => _text('Utility bill issued within the last 90 days', 'গত ৯০ দিনের মধ্যে ইস্যু করা ইউটিলিটি বিল'),
    'kitchen_hygiene_photo' => _text('Kitchen hygiene photo', 'রান্নাঘরের পরিচ্ছন্নতার ছবি'),
    'menu_doc' => _text('Menu photo or PDF', 'মেনুর ছবি বা PDF'),
    'structured_menu' => _text('At least one structured dish and price', 'অন্তত একটি খাবার ও দাম'),
    'on_demand_declaration' => _text('Cook-to-order declaration', 'অর্ডার অনুযায়ী রান্নার ঘোষণা'),
    'typical_prep_minutes' => _text('Typical self-estimated preparation time', 'নিজের অনুমান করা সাধারণ রান্নার সময়'),
    'hygiene_checklist' => _text('Complete hygiene checklist', 'পরিচ্ছন্নতার সম্পূর্ণ তালিকা'),
    'packaging_standard_acknowledgement' => _text('Packaging standard acknowledgement', 'প্যাকেজিং মানের সম্মতি'),
    'hours_4h_x_5days' => _text('Hours: at least 4 hours on 5 days', 'সময়: ৫ দিন অন্তত ৪ ঘণ্টা'),
    'payout_account' => _text('Payout account', 'পেআউট অ্যাকাউন্ট'),
    'partner_agreement' => _text('Partner agreement acceptance', 'পার্টনার চুক্তির সম্মতি'),
    _ => code.replaceAll('_', ' '),
  };

  List<Map<String, Object?>> _mapList(Object? value) {
    if (value is! List<Object?>) return <Map<String, Object?>>[];
    return value.whereType<Map<String, Object?>>().toList(growable: false);
  }
}
