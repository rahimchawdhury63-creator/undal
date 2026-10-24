/// Authenticated applicant wizard host for Appendix N `p-01..p-07` and separate vault `p-35`.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import '../services/partner_api_client.dart';
import 'partner_application_documents_step.dart';
import 'partner_application_hours_step.dart';
import 'partner_application_location_step.dart';
import 'partner_application_payout_step.dart';
import 'partner_application_profile_step.dart';
import 'partner_application_status_step.dart';
import 'partner_application_step_navigation.dart';
import 'partner_onboarding_components.dart';

/// Coordinates server-backed Partner application state, autosave, navigation and private document access.
class PartnerApplicationScreen extends StatefulWidget {
  /// Creates the authenticated onboarding shell for one signed-in applicant.
  const PartnerApplicationScreen({super.key, required this.api, required this.session, required this.isBangla, required this.onToggleLanguage, required this.onToggleTheme, required this.onSignOut});

  /// Configured GoTrue/W1/W2 API client.
  final PartnerApiClient api;

  /// Short-lived in-memory Supabase GoTrue session.
  final PartnerSession session;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Toggles the root app locale.
  final VoidCallback onToggleLanguage;

  /// Toggles the shared Undal light/dark theme.
  final VoidCallback onToggleTheme;

  /// Ends the in-memory session and returns to sign-in.
  final VoidCallback onSignOut;

  @override
  State<PartnerApplicationScreen> createState() => _PartnerApplicationScreenState();
}

class _PartnerApplicationScreenState extends State<PartnerApplicationScreen> {
  Map<String, Object?>? _application;
  Map<String, Object?> _draft = <String, Object?>{};
  List<Map<String, Object?>> _cuisines = <Map<String, Object?>>[];
  Map<String, Object?> _terms = <String, Object?>{};
  String _screen = 'p-01';
  String _previousScreen = 'p-01';
  bool _loading = true;
  bool _busy = false;
  bool _waitlistSubmitted = false;
  String? _error;
  String? _autosaveState;
  List<String> _submitMissing = <String>[];
  Timer? _autosaveTimer;
  int _draftRevision = 0;
  Future<void> _autosaveQueue = Future<void>.value();

  bool get _canEdit => _application == null || _application!['kyc_status'] == 'draft' || _application!['kyc_status'] == 'needs_fix';
  bool get _isBangla => widget.isBangla;
  String _text(String en, String bn) => _isBangla ? bn : en;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _autosaveTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: _screen == 'p-01' ? null : IconButton(tooltip: _text('Back', 'ফিরে যান'), onPressed: _back, icon: const Icon(Icons.arrow_back)),
        title: Text('${_text('Partner application', 'পার্টনার আবেদন')} · $_screen', maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: <Widget>[
          if (_autosaveState != null && _screen == 'p-01') Padding(
            padding: const EdgeInsets.symmetric(horizontal: UndalSpacingTokens.xxs),
            child: Center(child: Text(_autosaveLabel(), style: Theme.of(context).textTheme.labelSmall)),
          ),
          TextButton(onPressed: widget.onToggleLanguage, child: Text(_isBangla ? 'English' : 'বাংলা')),
          IconButton(tooltip: _text('Toggle theme', 'থিম বদলান'), onPressed: widget.onToggleTheme, icon: const Icon(Icons.brightness_6_outlined)),
          IconButton(tooltip: _text('Sign out', 'লগআউট'), onPressed: widget.onSignOut, icon: const Icon(Icons.logout)),
        ],
      ),
      body: Column(
        children: <Widget>[
          if (_error != null) MaterialBanner(
            content: Text(_error!),
            leading: const Icon(Icons.error_outline),
            actions: <Widget>[TextButton(onPressed: _load, child: Text(_text('Retry', 'আবার চেষ্টা')))],
          ),
          Expanded(child: _loading ? const Center(child: CircularProgressIndicator()) : _buildScreen()),
        ],
      ),
      bottomNavigationBar: _application == null ? null : PartnerApplicationStepNavigation(
        track: PartnerTrack.parse(_application?['type']),
        activeScreen: _screen,
        isBangla: _isBangla,
        busy: _busy,
        onNavigate: _go,
      ),
    );
  }

  Widget _buildScreen() {
    final Map<String, Object?>? app = _application;
    final PartnerTrack? track = PartnerTrack.parse(app?['type'] ?? _draft['type']);
    switch (_screen) {
      case 'p-01':
        return PartnerApplicationProfileStep(
          key: const ValueKey<String>('partner-profile-step'),
          isBangla: _isBangla,
          cuisines: _cuisines,
          initialValues: _draft,
          trackLocked: app != null,
          readOnly: !_canEdit,
          onDraftChanged: _onDraftChanged,
          onContinue: (Map<String, Object?> values) => _swallow(_continueProfile(values)),
          onOpenVault: () => _go('p-35'),
          onOpenStatus: () => _go('p-07'),
        );
      case 'p-04':
        return PartnerApplicationLocationStep(
          key: const ValueKey<String>('partner-location-step'),
          api: widget.api,
          session: widget.session,
          isBangla: _isBangla,
          initialPoint: _savedPoint(app),
          hasSavedPin: app != null && app['lat'] is num && app['lng'] is num,
          busy: _busy,
          canEdit: _canEdit,
          waitlistSubmitted: _waitlistSubmitted,
          onContinue: (GeoPoint point) => _swallow(_saveLocation(point)),
          onWaitlist: (GeoPoint point) => _swallow(_requestWaitlist(point)),
        );
      case 'p-02':
      case 'p-03':
        if (app == null || track == null) return _buildScreenFor('p-01');
        return PartnerApplicationDocumentsStep(
          key: ValueKey<String>('partner-documents-${track.wire}'),
          track: track,
          application: app,
          isBangla: _isBangla,
          busy: _busy,
          canEdit: _canEdit,
          onUpload: _uploadDocument,
          onView: _openPrivateDocument,
          onSaveKitchenDetails: (Map<String, Object?> values) => _swallow(_saveKitchenDetails(values)),
          onOpenVault: () => _go('p-35'),
        );
      case 'p-05':
        if (app == null) return _buildScreenFor('p-01');
        return PartnerApplicationHoursStep(application: app, isBangla: _isBangla, busy: _busy, canEdit: _canEdit, onSave: _saveHours);
      case 'p-06':
        if (app == null) return _buildScreenFor('p-01');
        return PartnerApplicationPayoutStep(
          application: app,
          terms: _terms,
          isBangla: _isBangla,
          busy: _busy,
          canEdit: _canEdit,
          onSavePayout: _savePayout,
          onAcceptTerms: _acceptTerms,
        );
      case 'p-07':
        if (app == null || track == null) return _buildScreenFor('p-01');
        return PartnerApplicationStatusStep(
          application: app,
          track: track,
          isBangla: _isBangla,
          busy: _busy,
          submitError: _submitMissing,
          onSubmit: () => _swallow(_submitApplication()),
          onOpenVault: () => _go('p-35'),
        );
      case 'p-35':
        if (app == null || track == null) return _buildScreenFor('p-01');
        final List<Map<String, Object?>> documents = _mapList(app['documents']);
        return SingleChildScrollView(
          key: const ValueKey<String>('screen-p-35'),
          padding: const EdgeInsets.all(UndalSpacingTokens.md),
          child: PartnerDocumentVault(track: track, documents: documents, isBangla: _isBangla, onUpload: _uploadDocument, onView: _openPrivateDocument, canUpload: _canEdit),
        );
      default:
        return _buildScreenFor('p-01');
    }
  }

  Widget _buildScreenFor(String screen) {
    if (screen == 'p-01') {
      final Map<String, Object?>? app = _application;
      return PartnerApplicationProfileStep(
        isBangla: _isBangla,
        cuisines: _cuisines,
        initialValues: _draft,
        trackLocked: app != null,
        readOnly: !_canEdit,
        onDraftChanged: _onDraftChanged,
        onContinue: (Map<String, Object?> values) => _swallow(_continueProfile(values)),
        onOpenVault: () => _go('p-35'),
        onOpenStatus: () => _go('p-07'),
      );
    }
    return const SizedBox.shrink();
  }

  Future<void> _load() async {
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final Map<String, Object?>? application = await widget.api.readApplication(widget.session);
      if (!mounted) return;
      setState(() {
        _application = application;
        if (application != null) _draft = _profileFields(application);
      });
    } on PartnerApiException catch (error) {
      if (mounted) setState(() => _error = _text('Application could not load (${error.code}). Check the secure API configuration and retry.', 'আবেদন লোড হয়নি (${error.code})। নিরাপদ API কনফিগারেশন পরীক্ষা করে আবার চেষ্টা করুন।'));
    } on Exception {
      if (mounted) setState(() => _error = _text('Application could not load. Check your connection and retry.', 'আবেদন লোড হয়নি। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'));
    }
    try {
      final List<Map<String, Object?>> cuisines = await widget.api.listCuisines(widget.session);
      if (mounted) setState(() => _cuisines = cuisines);
    } on Exception {
      if (mounted) setState(() => _cuisines = <Map<String, Object?>>[]);
    }
    try {
      final Map<String, Object?> terms = await widget.api.readAgreement(widget.session);
      if (mounted) setState(() => _terms = terms);
    } on Exception {
      if (mounted) setState(() => _terms = <String, Object?>{});
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onDraftChanged(Map<String, Object?> values) {
    _draft = Map<String, Object?>.from(values);
    if (mounted) setState(() {});
    if (_application == null || !_canEdit) return;
    if (!_validForAutosave(values)) {
      _autosaveTimer?.cancel();
      _draftRevision += 1;
      setState(() => _autosaveState = 'pending');
      return;
    }
    _autosaveTimer?.cancel();
    final int revision = ++_draftRevision;
    final Map<String, Object?> snapshot = Map<String, Object?>.from(values);
    setState(() => _autosaveState = 'saving');
    _autosaveTimer = Timer(const Duration(milliseconds: 800), () {
      _autosaveQueue = _autosaveQueue.then((_) async {
        if (revision != _draftRevision) return;
        try {
          final Map<String, Object?> result = await widget.api.patchApplication(widget.session, snapshot);
          if (!mounted || revision != _draftRevision) return;
          _adoptApplication(result['application']);
          setState(() => _autosaveState = 'saved');
        } on Exception {
          if (mounted && revision == _draftRevision) setState(() => _autosaveState = 'error');
        }
      }).catchError((Object _) {});
    });
  }

  Future<void> _continueProfile(Map<String, Object?> values) async {
    _draft = Map<String, Object?>.from(values);
    if (_application == null) { _go('p-04'); return; }
    await _runBusy(() async {
      _autosaveTimer?.cancel();
      await _autosaveQueue;
      final Map<String, Object?> result = await widget.api.patchApplication(widget.session, values);
      _adoptApplication(result['application']);
      if (mounted) setState(() => _screen = 'p-04');
    });
  }

  Future<void> _saveLocation(GeoPoint point) async {
    await _runBusy(() async {
      Map<String, Object?> result;
      if (_application == null) {
        final Map<String, Object?> create = <String, Object?>{..._draft, 'lat': point.lat, 'lng': point.lng};
        result = await widget.api.createApplication(widget.session, create);
      } else {
        result = await widget.api.patchApplication(widget.session, <String, Object?>{'lat': point.lat, 'lng': point.lng});
      }
      _adoptApplication(result['application']);
      final PartnerTrack? track = PartnerTrack.parse(_application?['type']);
      if (mounted) setState(() => _screen = track == PartnerTrack.restaurant ? 'p-02' : 'p-03');
    });
  }

  Future<void> _requestWaitlist(GeoPoint point) async {
    final String? type = (_application?['type'] ?? _draft['type'])?.toString();
    final String? area = (_application?['public_area_label'] ?? _draft['public_area_label'])?.toString();
    if (type == null || area == null || area.trim().length < 2) {
      setState(() => _error = _text('Complete the profile before requesting an area launch update.', 'এলাকা চালুর খবর চাইতে আগে প্রোফাইল পূরণ করুন।'));
      return;
    }
    await _runBusy(() async {
      final Map<String, Object?> result = await widget.api.requestZoneWaitlist(widget.session, <String, Object?>{
        'vendor_type': type,
        'lat': point.lat,
        'lng': point.lng,
        'public_area_label': area,
      });
      if (result['waitlisted'] == true) {
        setState(() => _waitlistSubmitted = true);
        _snack(_text('Area launch request saved. No private street address was stored.', 'এলাকা চালুর অনুরোধ সংরক্ষিত হয়েছে। সুনির্দিষ্ট ঠিকানা রাখা হয়নি।'));
      } else {
        _snack(_text('This pin is already in an active service zone. Refresh the zone check to continue.', 'এই পিনে সার্ভিস চালু আছে। এগোতে জোন যাচাই আবার করুন।'));
      }
    });
  }

  Future<void> _saveKitchenDetails(Map<String, Object?> values) async {
    await _runBusy(() async {
      final Map<String, Object?> result = await widget.api.patchApplication(widget.session, values);
      _adoptApplication(result['application']);
      _snack(_text('Kitchen menu and declarations saved.', 'রান্নাঘরের মেনু ও ঘোষণা সংরক্ষিত হয়েছে।'));
    });
  }

  Future<void> _saveHours(List<Map<String, Object?>> hours) async {
    await _runBusy(() async {
      await widget.api.saveHours(widget.session, hours);
      await _refreshApplication();
      _snack(_text('Weekly opening hours saved.', 'সাপ্তাহিক খোলার সময় সংরক্ষিত হয়েছে।'));
    });
  }

  Future<void> _savePayout({required String method, required String holderName, required String accountNumber}) async {
    await _runBusy(() async {
      await widget.api.savePayout(widget.session, method: method, holderName: holderName, accountNumber: accountNumber);
      await _refreshApplication();
      _snack(_text('Payout account encrypted and saved. Only its mask is returned to the app.', 'পেআউট অ্যাকাউন্ট এনক্রিপ্ট করে সংরক্ষণ হয়েছে। অ্যাপে শুধু আড়াল করা নম্বর ফেরত এসেছে।'));
    });
  }

  Future<void> _acceptTerms(String version) async {
    await _runBusy(() async {
      final Map<String, Object?> result = await widget.api.patchApplication(widget.session, <String, Object?>{'accepted_terms': true, 'agreement_version': version});
      _adoptApplication(result['application']);
      _snack(_text('Agreement acceptance recorded with the server version and timestamp.', 'সার্ভারের সংস্করণ ও সময়সহ চুক্তির সম্মতি সংরক্ষিত হয়েছে।'));
    });
  }

  Future<void> _uploadDocument(PartnerDocumentSpec spec, List<int> bytes, String filename, String? expiresOn, String? issuedOn) async {
    await _runBusy(() async {
      await widget.api.uploadPrivateDocument(widget.session, docType: spec.docType, bytes: bytes, filename: filename, expiresOn: expiresOn, issuedOn: issuedOn);
      await _refreshApplication();
      _snack(_text('Private document uploaded and linked to your application.', 'ব্যক্তিগত নথি আপলোড করে আবেদনের সঙ্গে যুক্ত হয়েছে।'));
    });
  }

  Future<void> _openPrivateDocument(String assetId) async {
    final Map<String, Object?> result = await widget.api.privateDocumentViewUrl(widget.session, assetId);
    final String? rawUrl = result['signed_url'] as String?;
    final Uri? uri = rawUrl == null ? null : Uri.tryParse(rawUrl);
    if (uri == null || uri.scheme != 'https' || uri.host != 'res.cloudinary.com') throw const FormatException('PRIVATE_VIEW_URL_INVALID');
    final bool opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened) throw const FormatException('PRIVATE_VIEW_OPEN_FAILED');
  }

  Future<void> _submitApplication() async {
    setState(() => _submitMissing = <String>[]);
    try {
      await _runBusy(() async {
        await widget.api.submitApplication(widget.session);
        await _refreshApplication();
        _snack(_text('Application submitted for review. The target review time is within 48 hours.', 'আবেদন রিভিউতে জমা হয়েছে। রিভিউয়ের লক্ষ্য সময় ৪৮ ঘণ্টার মধ্যে।'));
      });
    } on PartnerApiException catch (error) {
      final Object? missing = error.details['missing'];
      if (mounted) setState(() => _submitMissing = missing is List<Object?> ? missing.whereType<String>().toList(growable: false) : <String>[]);
    } on Exception {
      if (mounted) setState(() => _error = _text('Application could not be submitted. Check the connection and retry.', 'আবেদন জমা হয়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'));
    }
  }

  Future<void> _refreshApplication() async {
    final Map<String, Object?>? application = await widget.api.readApplication(widget.session);
    if (mounted && application != null) _adoptApplication(application);
  }

  Future<void> _runBusy(Future<void> Function() action) async {
    if (_busy) return;
    setState(() { _busy = true; _error = null; });
    try {
      await action();
    } on PartnerApiException catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
      rethrow;
    } on Exception {
      if (mounted) setState(() => _error = _text('The secure service could not complete this request. Check your connection and retry.', 'নিরাপদ সার্ভিস অনুরোধটি সম্পন্ন করতে পারেনি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'));
      rethrow;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _adoptApplication(Object? value) {
    if (value is Map<String, Object?>) {
      _application = Map<String, Object?>.from(value);
      _draft = _profileFields(_application!);
      if (_application!['kyc_status'] != 'draft' && _application!['kyc_status'] != 'needs_fix') _autosaveTimer?.cancel();
      if (mounted) setState(() {});
    }
  }

  Map<String, Object?> _profileFields(Map<String, Object?> app) => <String, Object?>{
    'type': app['type'],
    'legal_name': app['legal_name'],
    'brand_name': app['brand_name'],
    'brand_name_bn': app['brand_name_bn'],
    'representative_name': app['representative_name'],
    'contact_email': app['contact_email'],
    'counter_phone': app['counter_phone'],
    'public_area_label': app['public_area_label'],
    'address_text_private': app['address_text_private'],
    'cuisines': app['cuisines'],
    'accepts_pickup': app['accepts_pickup'],
    'pickup_point_label': app['pickup_point_label'],
  };

  bool _validForAutosave(Map<String, Object?> values) {
    final String email = values['contact_email']?.toString() ?? '';
    final String phone = values['counter_phone']?.toString() ?? '';
    return (values['legal_name']?.toString().trim().length ?? 0) >= 2 &&
        (values['brand_name']?.toString().trim().length ?? 0) >= 2 &&
        (values['representative_name']?.toString().trim().length ?? 0) >= 2 &&
        RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email) &&
        RegExp(r'^01[3-9][0-9]{8}$').hasMatch(phone) &&
        (values['public_area_label']?.toString().trim().length ?? 0) >= 2 &&
        (values['address_text_private']?.toString().trim().length ?? 0) >= 4 &&
        (values['accepts_pickup'] != true || (values['pickup_point_label']?.toString().trim().length ?? 0) >= 2);
  }

  String _friendlyError(PartnerApiException error) {
    if (error.code == 'KYC_INCOMPLETE') return _text('W1 found missing KYC items. Review the exact checklist on p-07.', 'W1 অনুযায়ী KYC-এর কিছু অংশ বাকি। p-07-এ তালিকা দেখুন।');
    if (error.code == 'OUTSIDE_ZONE') return _text('This pin is outside an active zone. Request an area launch update instead.', 'এই পিন সক্রিয় জোনের বাইরে। এলাকা চালুর খবরের অনুরোধ করুন।');
    if (error.code == 'IDEMPOTENCY_KEY_REQUIRED') return _text('A secure request key was missing. Retry the action.', 'নিরাপদ অনুরোধের কী পাওয়া যায়নি। আবার চেষ্টা করুন।');
    if (error.code == 'SERVER_BUSY') return _text('W1 could not complete this secure operation. Retry later or contact support.', 'W1 নিরাপদ কাজটি সম্পন্ন করতে পারেনি। পরে আবার চেষ্টা করুন বা সাপোর্টে যোগাযোগ করুন।');
    return _text('Request failed (${error.code}). Check the fields and retry.', 'অনুরোধ ব্যর্থ হয়েছে (${error.code})। তথ্য পরীক্ষা করে আবার চেষ্টা করুন।');
  }

  String _autosaveLabel() => switch (_autosaveState) {
    'saving' => _text('Saving…', 'সংরক্ষণ…'),
    'saved' => _text('Saved', 'সংরক্ষিত'),
    'pending' => _text('Unsaved field', 'ক্ষেত্র অসম্পূর্ণ'),
    'error' => _text('Save failed', 'সংরক্ষণ হয়নি'),
    _ => '',
  };

  void _go(String screen) {
    if (screen == 'p-35') _previousScreen = _screen == 'p-35' ? _previousScreen : _screen;
    const Set<String> requiresApplication = <String>{'p-02', 'p-03', 'p-05', 'p-06', 'p-07', 'p-35'};
    if (requiresApplication.contains(screen) && _application == null) return;
    setState(() { _screen = screen; _error = null; });
  }

  void _swallow(Future<void> future) {
    unawaited(future.catchError((Object _) {}));
  }

  void _back() => _go(_screen == 'p-35' ? _previousScreen : 'p-01');

  GeoPoint _savedPoint(Map<String, Object?>? app) {
    final Object? lat = app?['lat'];
    final Object? lng = app?['lng'];
    if (lat is num && lng is num && lat.isFinite && lng.isFinite) return GeoPoint(lat.toDouble(), lng.toDouble());
    return kSylhetSadarZone.center;
  }

  List<Map<String, Object?>> _mapList(Object? value) {
    if (value is! List<Object?>) return <Map<String, Object?>>[];
    return value.whereType<Map<String, Object?>>().toList(growable: false);
  }

  void _snack(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}
