/// OSM kitchen pin selection and authoritative active-zone verdict (`p-04`).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../models/partner_models.dart';
import '../services/partner_api_client.dart';

/// Lets applicants search landmarks, move an OSM pin, and verify the location with W1.
class PartnerApplicationLocationStep extends StatefulWidget {
  /// Creates the private kitchen pin step; no initial map centre is treated as a saved address.
  const PartnerApplicationLocationStep({super.key, required this.api, required this.session, required this.isBangla, required this.initialPoint, required this.hasSavedPin, required this.busy, required this.waitlistSubmitted, required this.onContinue, required this.onWaitlist, this.canEdit = true});

  /// Configured W1/W2 client used for zone verification and proxied landmark search.
  final PartnerApiClient api;

  /// Authenticated owner session for authoritative zone checks and waitlist capture.
  final PartnerSession session;

  /// Whether Bangla labels are active.
  final bool isBangla;

  /// Saved owner pin or the service-area map starting centre (not saved until confirmed).
  final GeoPoint initialPoint;

  /// Whether an existing server-side application already has this pin.
  final bool hasSavedPin;

  /// Whether application/waitlist submission is in progress.
  final bool busy;

  /// Whether this applicant may change the kitchen pin while the application is editable.
  final bool canEdit;

  /// Whether W1 has already recorded this outside-zone interest in the current screen session.
  final bool waitlistSubmitted;

  /// Persists a verified active-zone pin to W1.
  final ValueChanged<GeoPoint> onContinue;

  /// Captures an outside-zone launch interest without persisting a private street address.
  final ValueChanged<GeoPoint> onWaitlist;

  @override
  State<PartnerApplicationLocationStep> createState() => _PartnerApplicationLocationStepState();
}

class _PartnerApplicationLocationStepState extends State<PartnerApplicationLocationStep> {
  final TextEditingController _search = TextEditingController();
  Timer? _resolveTimer;
  Timer? _searchTimer;
  late GeoPoint _point;
  List<Map<String, Object?>> _results = <Map<String, Object?>>[];
  ZoneResolutionVerdict? _verdict;
  bool _resolving = false;
  bool _searching = false;
  String? _zoneError;
  String? _searchError;

  bool get _isBangla => widget.isBangla;
  String _text(String en, String bn) => _isBangla ? bn : en;

  @override
  void initState() {
    super.initState();
    _point = widget.initialPoint;
    _scheduleResolve(Duration.zero);
  }

  @override
  void dispose() {
    _resolveTimer?.cancel();
    _searchTimer?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final UndalSemanticColors semantic = theme.extension<UndalSemanticColors>()!;
    final bool inZone = _verdict?.inServiceArea == true;
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-p-04'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(_text('Kitchen pin & service zone', 'রান্নাঘরের পিন ও সার্ভিস জোন'), style: theme.textTheme.headlineSmall),
          Text(_text('Search a real place, choose a result, or pan the map. The exact home-kitchen address stays private.', 'বাস্তব জায়গা খুঁজুন, ফলাফল বাছুন অথবা মানচিত্র সরান। হোম কিচেনের সুনির্দিষ্ট ঠিকানা ব্যক্তিগত থাকবে।')),
          if (!widget.canEdit) Padding(
            padding: const EdgeInsets.only(top: UndalSpacingTokens.xs),
            child: Text(_text('The kitchen pin is read-only while this application is under review.', 'আবেদন রিভিউ চলাকালে রান্নাঘরের পিন সম্পাদনা করা যাবে না।')),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          TextField(
            key: const ValueKey<String>('partner-location-search'),
            controller: _search,
            enabled: widget.canEdit,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              labelText: _text('Search a neighbourhood or landmark', 'মহল্লা বা পরিচিত স্থান খুঁজুন'),
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searching ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))) : null,
              border: const OutlineInputBorder(),
            ),
          ),
          if (_searchError != null) Padding(padding: const EdgeInsets.only(top: UndalSpacingTokens.xs), child: Text(_searchError!, style: TextStyle(color: theme.colorScheme.error))),
          if (_results.isNotEmpty) ...<Widget>[
            const SizedBox(height: UndalSpacingTokens.xs),
            Wrap(
              spacing: UndalSpacingTokens.xs,
              children: _results.map((Map<String, Object?> row) {
                final String label = row['display_name']?.toString() ?? '';
                final double? lat = _asDouble(row['lat']);
                final double? lng = _asDouble(row['lng']);
                if (label.isEmpty || lat == null || lng == null) return const SizedBox.shrink();
                return ActionChip(
                  key: ValueKey<String>('partner-location-result-${row['place_id'] ?? label}'),
                  avatar: const Icon(Icons.place_outlined, size: 16),
                  label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
                  onPressed: widget.canEdit ? () { _search.text = label; _results = <Map<String, Object?>>[]; _setPoint(GeoPoint(lat, lng)); } : null,
                );
              }).toList(growable: false),
            ),
          ],
          const SizedBox(height: UndalSpacingTokens.md),
          SizedBox(
            height: 300,
            child: AbsorbPointer(
              absorbing: !widget.canEdit,
              child: UndalOsmMap(
                key: const ValueKey<String>('partner-application-osm-map'),
                center: _point,
                showCenterPin: true,
                tileProxyBaseUrl: widget.api.config.tileProxyBaseUrl,
                onCenterChanged: widget.canEdit ? _setPoint : null,
              ),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          SelectableText('${_text('Selected pin', 'নির্বাচিত পিন')}: ${_point.lat.toStringAsFixed(6)}, ${_point.lng.toStringAsFixed(6)}'),
          const SizedBox(height: UndalSpacingTokens.xs),
          Container(
            key: const ValueKey<String>('partner-zone-verdict'),
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            decoration: BoxDecoration(
              color: inZone ? semantic.successSoft : semantic.warningSoft,
              borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
            ),
            child: Row(
              children: <Widget>[
                Icon(_resolving ? Icons.sync : inZone ? Icons.check_circle_outline : Icons.info_outline, color: inZone ? semantic.success : semantic.warning),
                const SizedBox(width: UndalSpacingTokens.sm),
                Expanded(child: Text(_zoneMessage(), style: theme.textTheme.bodyMedium)),
              ],
            ),
          ),
          if (_zoneError != null) Padding(padding: const EdgeInsets.only(top: UndalSpacingTokens.xs), child: Text(_zoneError!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton.icon(
            key: const ValueKey<String>('partner-location-continue'),
            onPressed: !widget.canEdit || widget.busy || _resolving || !inZone ? null : () => widget.onContinue(_point),
            icon: const Icon(Icons.check),
            label: Text(_text(widget.hasSavedPin ? 'Save verified pin' : 'Save private draft at this pin', widget.hasSavedPin ? 'যাচাইকৃত পিন সংরক্ষণ করুন' : 'এই পিনে ব্যক্তিগত খসড়া সংরক্ষণ করুন')),
          ),
          if (!inZone && _verdict != null) ...<Widget>[
            const SizedBox(height: UndalSpacingTokens.sm),
            Text(_text('Undal is not yet serving this pin. You can request an update when this area opens; only the pin, type and public neighbourhood label are retained for this request.', 'এই পিনে উন্দালের সেবা এখনো চালু নয়। এলাকা চালু হলে জানাতে অনুরোধ করতে পারেন; অনুরোধে শুধু পিন, ব্যবসার ধরন ও প্রকাশ্য মহল্লার নাম রাখা হবে।')),
            OutlinedButton.icon(
              key: const ValueKey<String>('partner-zone-waitlist'),
              onPressed: !widget.canEdit || widget.busy || _resolving || widget.waitlistSubmitted ? null : () => widget.onWaitlist(_point),
              icon: Icon(widget.waitlistSubmitted ? Icons.check_circle_outline : Icons.notifications_active_outlined),
              label: Text(_text(widget.waitlistSubmitted ? 'Area update requested' : 'Request an area launch update', widget.waitlistSubmitted ? 'এলাকা চালুর খবরের অনুরোধ হয়েছে' : 'এলাকা চালুর খবর পেতে অনুরোধ করুন')),
            ),
          ],
          const SizedBox(height: UndalSpacingTokens.xl),
        ],
      ),
    );
  }

  String _zoneMessage() {
    if (_resolving) return _text('Checking this pin with Undal service zones…', 'উন্দালের সার্ভিস জোনে পিনটি যাচাই হচ্ছে…');
    final ZoneResolutionVerdict? verdict = _verdict;
    if (verdict == null) return _text('A live zone check is required before saving.', 'সংরক্ষণের আগে সার্ভারের জোন যাচাই দরকার।');
    if (verdict.inServiceArea) {
      final String zoneName = _isBangla ? (verdict.nameBn ?? verdict.nameEn ?? '') : (verdict.nameEn ?? verdict.slug ?? '');
      return _text('We serve this area ✓ $zoneName', 'এই এলাকায় উন্দালের সেবা চালু ✓ $zoneName');
    }
    if (verdict.isInsidePausedExpansionZone) {
      return _text('${verdict.prelaunchZoneNameEn ?? verdict.prelaunchZoneSlug} is configured but paused. Nearest active zone: ${verdict.nearestZoneNameEn}.', '${verdict.prelaunchZoneNameBn ?? verdict.prelaunchZoneSlug} জোন প্রস্তুত, তবে এখনো বন্ধ। নিকটতম চালু জোন: ${verdict.nearestZoneNameBn}।');
    }
    return _text('Outside active service zones. Nearest active zone: ${verdict.nearestZoneNameEn} (${verdict.nearestDistanceKm.toStringAsFixed(1)} km).', 'চালু সার্ভিস জোনের বাইরে। নিকটতম জোন: ${verdict.nearestZoneNameBn} (${verdict.nearestDistanceKm.toStringAsFixed(1)} কি.মি.)।');
  }

  void _setPoint(GeoPoint next) {
    if (!widget.canEdit) return;
    setState(() { _point = next; _verdict = null; _zoneError = null; });
    _scheduleResolve(const Duration(milliseconds: 400));
  }

  void _scheduleResolve(Duration delay) {
    _resolveTimer?.cancel();
    _resolveTimer = Timer(delay, _resolve);
  }

  Future<void> _resolve() async {
    if (!mounted) return;
    final GeoPoint requestPoint = _point;
    setState(() { _resolving = true; _zoneError = null; });
    try {
      final Map<String, Object?> result = await widget.api.resolveZone(widget.session, lat: requestPoint.lat, lng: requestPoint.lng);
      if (!mounted || requestPoint != _point) return;
      setState(() {
        _verdict = ZoneResolutionVerdict.fromApiJson(result, point: requestPoint);
        _resolving = false;
      });
    } on PartnerApiException catch (error) {
      if (!mounted || requestPoint != _point) return;
      setState(() { _zoneError = _text('Live zone check failed (${error.code}). Retry before saving.', 'সার্ভিস জোন যাচাই হয়নি (${error.code})। সংরক্ষণের আগে আবার চেষ্টা করুন।'); _resolving = false; _verdict = null; });
    } on Exception {
      if (!mounted || requestPoint != _point) return;
      setState(() { _zoneError = _text('Could not reach the zone service. Check the connection and retry.', 'জোন সার্ভিসে সংযোগ হয়নি। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); _resolving = false; _verdict = null; });
    }
  }

  void _onSearchChanged(String value) {
    if (!widget.canEdit) return;
    _searchTimer?.cancel();
    if (value.trim().length < 2) { setState(() { _results = <Map<String, Object?>>[]; _searchError = null; }); return; }
    _searchTimer = Timer(const Duration(milliseconds: 400), () async {
      if (!mounted) return;
      setState(() { _searching = true; _searchError = null; });
      try {
        final List<Map<String, Object?>> results = await widget.api.searchLandmarks(value);
        if (mounted) setState(() { _results = results; _searching = false; });
      } on PartnerApiException catch (error) {
        if (mounted) setState(() { _searchError = _text('Place search unavailable (${error.code}); pan the map to set a pin.', 'জায়গা খোঁজা যাচ্ছে না (${error.code}); মানচিত্র সরিয়ে পিন দিন।'); _searching = false; });
      } on Exception {
        if (mounted) setState(() { _searchError = _text('Place search could not connect; pan the map to set a pin.', 'জায়গা খোঁজার সংযোগ হয়নি; মানচিত্র সরিয়ে পিন দিন।'); _searching = false; });
      }
    });
  }

  double? _asDouble(Object? value) {
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}
