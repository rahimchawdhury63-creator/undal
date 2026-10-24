/// Owner-private KYC document vault using only W1-authorized Cloudinary uploads and views.
library;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import '../services/partner_api_client.dart';

/// Direct-upload UI for owner-bound Cloudinary authenticated KYC documents.
class PartnerDocumentVault extends StatefulWidget {
  /// Creates the private document vault for the selected vendor track.
  const PartnerDocumentVault({super.key, required this.track, required this.documents, required this.isBangla, required this.onUpload, required this.onView, this.canUpload = true});

  /// Applicant's current application track.
  final PartnerTrack track;

  /// Safe W1 document projections (never raw bytes or Cloudinary signed URLs).
  final List<Map<String, Object?>> documents;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Uploads bytes through the signed private lane and returns after the W1 binding is saved.
  final Future<void> Function(PartnerDocumentSpec spec, List<int> bytes, String filename, String? expiresOn, String? issuedOn) onUpload;

  /// Opens a short-lived W1-audited owner view for a previously bound private asset.
  final Future<void> Function(String assetId) onView;

  /// Disables uploads while submitted KYC is under review; views remain available.
  final bool canUpload;

  @override
  State<PartnerDocumentVault> createState() => _PartnerDocumentVaultState();
}

class _PartnerDocumentVaultState extends State<PartnerDocumentVault> {
  String? _busyType;
  String? _error;

  String _text(String en, String bn) => widget.isBangla ? bn : en;

  @override
  Widget build(BuildContext context) {
    final List<PartnerDocumentSpec> specs = partnerDocumentSpecs(widget.track);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(_text('Private KYC vault · Cloudinary authenticated', 'ব্যক্তিগত KYC ভল্ট · Cloudinary authenticated'), style: Theme.of(context).textTheme.titleMedium),
        Text(_text('Files are limited to 5 MiB. Sensitive documents never use Supabase Storage or public ImgBB.', 'প্রতিটি ফাইল সর্বোচ্চ ৫ MiB। সংবেদনশীল নথি Supabase Storage বা পাবলিক ImgBB-তে যায় না।')),
        if (!widget.canUpload) Text(_text('Uploads are paused while the review team checks this submitted application; saved documents remain available to view.', 'রিভিউ টিম যাচাই করার সময় আপলোড বন্ধ; সংরক্ষিত নথি দেখা যাবে।')),
        const SizedBox(height: UndalSpacingTokens.sm),
        if (widget.track != PartnerTrack.restaurant)
          Padding(
            padding: const EdgeInsets.only(bottom: UndalSpacingTokens.sm),
            child: Text(_text('Upload either both NID sides or both passport pages. Trade licence, TIN and BIN are recommended, not required at start.', 'NID-এর দুই পাশ অথবা পাসপোর্টের দুই পৃষ্ঠা দিন। শুরুতে ট্রেড লাইসেন্স, TIN ও BIN প্রস্তাবিত—বাধ্যতামূলক নয়।')),
          ),
        for (final PartnerDocumentSpec spec in specs) _buildDocumentCard(context, spec),
        Text(_text('Add one bank, bKash or Nagad proof. Re-upload is available if a reviewer requests a fix.', 'ব্যাংক, বিকাশ বা নগদের যেকোনো একটি প্রমাণ দিন। রিভিউতে সংশোধন চাইলে আবার আপলোড করতে পারবেন।')),
        if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ],
    );
  }

  Widget _buildDocumentCard(BuildContext context, PartnerDocumentSpec spec) {
    final Map<String, Object?>? doc = widget.documents.cast<Map<String, Object?>?>().firstWhere(
      (Map<String, Object?>? row) => row?['doc_type'] == spec.docType,
      orElse: () => null,
    );
    final String? status = doc?['review_status'] as String?;
    final String? expires = doc?['expires_on'] as String?;
    final bool expiryWarning = expires != null && DateTime.tryParse(expires)?.isBefore(DateTime.now().add(const Duration(days: 30))) == true;
    final String? assetId = doc?['media_asset_id'] as String?;
    final bool busy = _busyType == spec.docType;
    final bool approvedLocked = status == 'approved';
    final bool canUpload = widget.canUpload && !approvedLocked;
    final String label = widget.isBangla ? spec.labelBn : spec.labelEn;
    final String statusLabel = status == null
        ? _text('Not uploaded', 'আপলোড হয়নি')
        : status == 'approved'
            ? _text('Approved', 'অনুমোদিত')
            : status == 'needs_fix' || status == 'rejected'
                ? _text('Fix requested · upload again', 'সংশোধন প্রয়োজন · আবার আপলোড করুন')
                : _text('In review', 'পর্যালোচনাধীন');
    return Card(
      key: ValueKey<String>('partner-document-${spec.docType}'),
      child: Padding(
        padding: const EdgeInsets.all(UndalSpacingTokens.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(children: <Widget>[Expanded(child: Text(label, style: Theme.of(context).textTheme.titleSmall)), if (spec.optional) Text(_text('Optional', 'ঐচ্ছিক'))]),
            const SizedBox(height: UndalSpacingTokens.xs),
            Text(statusLabel),
            if (approvedLocked) Text(_text('Approved documents stay locked during partial-fix reviews.', 'আংশিক সংশোধনের রিভিউতেও অনুমোদিত নথি লক থাকে।')),
            if (expires != null) Text('${_text('Expires', 'মেয়াদ শেষ')}: $expires${expiryWarning ? ' · ${_text('renewal soon', 'শিগগির নবায়ন করুন')}' : ''}'),
            if (expiryWarning) Text(_text('Renewal reminder: this document expires within 30 days.', 'নবায়নের স্মরণ: নথিটির মেয়াদ ৩০ দিনের মধ্যে শেষ হবে।'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: !canUpload || busy ? null : () => _pickAndUpload(spec),
                    icon: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.upload_file),
                    label: Text(approvedLocked ? _text('Approved · locked', 'অনুমোদিত · লক') : status == null ? _text('Choose file', 'ফাইল বাছুন') : _text('Re-upload', 'আবার আপলোড')),
                  ),
                ),
                if (assetId != null) ...<Widget>[
                  const SizedBox(width: UndalSpacingTokens.xs),
                  IconButton(
                    tooltip: _text('Open private document', 'ব্যক্তিগত নথি খুলুন'),
                    onPressed: busy ? null : () async {
                      try {
                        await widget.onView(assetId);
                      } on Exception {
                        if (mounted) setState(() => _error = _text('Could not open this document.', 'নথিটি খোলা যায়নি।'));
                      }
                    },
                    icon: const Icon(Icons.visibility_outlined),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickAndUpload(PartnerDocumentSpec spec) async {
    setState(() { _busyType = spec.docType; _error = null; });
    try {
      final FilePickerResult? result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const <String>['jpg', 'jpeg', 'png', 'pdf'],
        withData: true,
        allowMultiple: false,
      );
      if (result == null || result.files.isEmpty) return;
      final PlatformFile file = result.files.single;
      final List<int>? bytes = file.bytes;
      if (bytes == null || bytes.length != file.size) throw const FormatException('DOCUMENT_BYTES_UNAVAILABLE');
      String? expiresOn;
      String? issuedOn;
      if (spec.expiryRequired) {
        final DateTime? expiry = await showDatePicker(
          context: context,
          firstDate: DateTime.now(),
          lastDate: DateTime.now().add(const Duration(days: 3650)),
          initialDate: DateTime.now().add(const Duration(days: 365)),
          helpText: _text('Trade licence expiry date', 'ট্রেড লাইসেন্সের মেয়াদ শেষের তারিখ'),
        );
        if (expiry == null) return;
        expiresOn = _dateOnly(expiry);
      }
      if (spec.issueDateRequired) {
        final DateTime now = DateTime.now();
        final DateTime? issue = await showDatePicker(
          context: context,
          firstDate: now.subtract(const Duration(days: 90)),
          lastDate: now,
          initialDate: now,
          helpText: _text('Utility bill issue date', 'ইউটিলিটি বিল ইস্যুর তারিখ'),
        );
        if (issue == null) return;
        issuedOn = _dateOnly(issue);
      }
      await widget.onUpload(spec, bytes, file.name, expiresOn, issuedOn);
    } on PartnerApiException catch (error) {
      if (mounted) setState(() => _error = _text('Upload failed (${error.code}). Check the file and retry.', 'আপলোড হয়নি (${error.code})। ফাইল পরীক্ষা করে আবার চেষ্টা করুন।'));
    } on Exception {
      if (mounted) setState(() => _error = _text('File could not be uploaded. Check your connection and retry.', 'ফাইল আপলোড হয়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'));
    } finally {
      if (mounted) setState(() => _busyType = null);
    }
  }

  String _dateOnly(DateTime value) => '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}
