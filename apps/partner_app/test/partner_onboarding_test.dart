/// @file apps/partner_app/test/partner_onboarding_test.dart
/// @description Tests Partner track IDs, D-24 pickup defaults, API routing, and private Cloudinary ticket handling.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:partner_app/main.dart';
import 'package:partner_app/src/config/partner_app_config.dart';
import 'package:partner_app/src/models/partner_models.dart';
import 'package:partner_app/src/services/partner_api_client.dart';

void main() {
  test('Partner track ids and document requirements remain stable for Appendix N', () {
    expect(PartnerTrack.parse('RESTAURANT'), PartnerTrack.restaurant);
    expect(PartnerTrack.parse('HOME_KITCHEN'), PartnerTrack.homeKitchen);
    expect(PartnerTrack.parse('CLOUD_KITCHEN'), PartnerTrack.cloudKitchen);
    expect(PartnerTrack.parse('restaurant'), isNull);
    expect(normalizePartnerPhone('০১৭১৬০০০০০১'), '01716000001');

    final List<PartnerDocumentSpec> restaurant = partnerDocumentSpecs(PartnerTrack.restaurant);
    expect(restaurant.map((PartnerDocumentSpec row) => row.docType), containsAll(<String>[
      'trade_license', 'nid_front', 'nid_back', 'passport_front', 'passport_back', 'tin', 'bin', 'menu_doc',
    ]));
    expect(restaurant.singleWhere((PartnerDocumentSpec row) => row.docType == 'trade_license').expiryRequired, isTrue);
    expect(restaurant.singleWhere((PartnerDocumentSpec row) => row.docType == 'bank_proof').optional, isTrue);

    final List<PartnerDocumentSpec> home = partnerDocumentSpecs(PartnerTrack.homeKitchen);
    expect(home.singleWhere((PartnerDocumentSpec row) => row.docType == 'utility_bill').issueDateRequired, isTrue);
    expect(home.singleWhere((PartnerDocumentSpec row) => row.docType == 'kitchen_hygiene_photo').optional, isFalse);
    expect(home.singleWhere((PartnerDocumentSpec row) => row.docType == 'menu_doc').optional, isTrue);
  });

  testWidgets('D-24 pickup starts on for restaurants and off for home and cloud kitchens', (WidgetTester tester) async {
    final _FakeHttpTransport transport = _FakeHttpTransport((Uri uri, String method) async {
      if (uri.path == '/v1/partner/application') return _ok(<String, Object?>{'application': null});
      if (uri.path == '/v1/partner/cuisines') {
        return _ok(<String, Object?>{'cuisines': <Map<String, Object?>>[
          <String, Object?>{'key': 'homemade', 'name_en': 'Homemade Deshi', 'name_bn': 'ঘরোয়া খাবার'},
        ]});
      }
      if (uri.path == '/v1/partner/application/terms') {
        return _ok(<String, Object?>{'version': _agreementVersion, 'sha256': _agreementHash, 'text_en': _agreementEn, 'text_bn': _agreementBn});
      }
      return _ok(<String, Object?>{});
    });
    final PartnerApiClient api = _client(transport);
    await tester.pumpWidget(UndalPartnerApp(apiClient: api, initialSession: _session));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey<String>('screen-p-01')), findsOneWidget);
    expect(_pickupValue(tester), isFalse);
    await tester.tap(find.byKey(const ValueKey<String>('partner-track-RESTAURANT')));
    await tester.pumpAndSettle();
    expect(_pickupValue(tester), isTrue);
    await tester.tap(find.byKey(const ValueKey<String>('partner-track-CLOUD_KITCHEN')));
    await tester.pumpAndSettle();
    expect(_pickupValue(tester), isFalse);
    await tester.tap(find.byKey(const ValueKey<String>('partner-track-HOME_KITCHEN')));
    await tester.pumpAndSettle();
    expect(_pickupValue(tester), isFalse);
  });

  testWidgets('submitted applications lock location, profile, hours, payout, and KYC edits while keeping private views available', (WidgetTester tester) async {
    final _FakeHttpTransport transport = _FakeHttpTransport((Uri uri, String method) async {
      if (uri.path == '/v1/partner/application') return _ok(<String, Object?>{'application': _submittedApplication});
      if (uri.path == '/v1/partner/cuisines') return _ok(<String, Object?>{'cuisines': <Object?>[]});
      if (uri.path == '/v1/partner/application/terms') {
        return _ok(<String, Object?>{'version': _agreementVersion, 'sha256': _agreementHash, 'text_en': _agreementEn, 'text_bn': _agreementBn});
      }
      if (uri.path == '/v1/zones/resolve') {
        return _ok(<String, Object?>{'in_service_area': true, 'zone_id': 'zone-sylhet-sadar', 'name_en': 'Sylhet Sadar', 'name_bn': 'সিলেট সদর'});
      }
      return _ok(<String, Object?>{});
    });
    await tester.pumpWidget(UndalPartnerApp(apiClient: _client(transport), initialSession: _session));
    await tester.pumpAndSettle();

    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-profile-continue'))).onPressed, isNull);
    await _openPartnerScreen(tester, 'p-04');
    expect(tester.widget<TextField>(find.byKey(const ValueKey<String>('partner-location-search'))).enabled, isFalse);
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-location-continue'))).onPressed, isNull);
    final Finder mapAbsorber = find.ancestor(
      of: find.byKey(const ValueKey<String>('partner-application-osm-map')),
      matching: find.byType(AbsorbPointer),
    ).first;
    expect(tester.widget<AbsorbPointer>(mapAbsorber).absorbing, isTrue);

    await _openPartnerScreen(tester, 'p-02');
    final Finder uploadButton = find.byKey(const ValueKey<String>('partner-upload-nid_front'));
    final Finder viewButton = find.byKey(const ValueKey<String>('partner-view-nid_front'));
    expect(tester.widget<OutlinedButton>(uploadButton).onPressed, isNull);
    expect(tester.widget<IconButton>(viewButton).onPressed, isNotNull);

    await _openPartnerScreen(tester, 'p-05');
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-save-hours'))).onPressed, isNull);
    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).onChanged, isNull);

    await _openPartnerScreen(tester, 'p-06');
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-save-payout'))).onPressed, isNull);
    expect(tester.widget<TextFormField>(find.byKey(const ValueKey<String>('partner-payout-account'))).enabled, isFalse);
    expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey<String>('partner-agreement-accept'))).onChanged, isNull);

    await _openPartnerScreen(tester, 'p-07');
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-submit-application'))).onPressed, isNull);

    await _openPartnerScreen(tester, 'p-35');
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey<String>('partner-upload-nid_front'))).onPressed, isNull);
    expect(tester.widget<IconButton>(find.byKey(const ValueKey<String>('partner-view-nid_front'))).onPressed, isNotNull);
  });

  testWidgets('submitted home-kitchen applications lock menu, hygiene, and cook-to-order declarations', (WidgetTester tester) async {
    final Map<String, Object?> kitchenApplication = <String, Object?>{
      ..._submittedApplication,
      'type': 'HOME_KITCHEN',
      'onboarding_menu': <Map<String, Object?>>[
        <String, Object?>{'name': 'Shatkora beef', 'price_poisha': 38000},
      ],
      'on_demand_declared': true,
      'partner_prep_minutes_estimate': 35,
      'hygiene_checklist': <String, Object?>{
        'clean_water': true,
        'safe_storage': true,
        'clean_surfaces': true,
        'food_grade_packaging': true,
      },
      'packaging_standard_accepted_at': '2026-10-20T10:00:00Z',
    };
    final _FakeHttpTransport transport = _FakeHttpTransport((Uri uri, String method) async {
      if (uri.path == '/v1/partner/application') return _ok(<String, Object?>{'application': kitchenApplication});
      if (uri.path == '/v1/partner/cuisines') return _ok(<String, Object?>{'cuisines': <Object?>[]});
      if (uri.path == '/v1/partner/application/terms') {
        return _ok(<String, Object?>{'version': _agreementVersion, 'sha256': _agreementHash, 'text_en': _agreementEn, 'text_bn': _agreementBn});
      }
      return _ok(<String, Object?>{});
    });
    await tester.pumpWidget(UndalPartnerApp(apiClient: _client(transport), initialSession: _session));
    await tester.pumpAndSettle();
    await _openPartnerScreen(tester, 'p-03');

    expect(tester.widget<TextFormField>(find.byKey(const ValueKey<String>('partner-menu-name-0'))).enabled, isFalse);
    expect(tester.widget<TextFormField>(find.byKey(const ValueKey<String>('partner-menu-price-0'))).enabled, isFalse);
    expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey<String>('partner-on-demand-declaration'))).onChanged, isNull);
    expect(tester.widget<DropdownButtonFormField<int>>(find.byKey(const ValueKey<String>('partner-prep-estimate'))).onChanged, isNull);
    expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey<String>('partner-hygiene-clean_water'))).onChanged, isNull);
    expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey<String>('partner-packaging-standard'))).onChanged, isNull);
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('partner-save-kitchen-details'))).onPressed, isNull);
  });

  testWidgets('approved KYC documents remain locked during a needs-fix resubmission', (WidgetTester tester) async {
    final Map<String, Object?> application = <String, Object?>{
      ..._submittedApplication,
      'kyc_status': 'needs_fix',
      'documents': <Map<String, Object?>>[
        <String, Object?>{'doc_type': 'nid_front', 'media_asset_id': 'asset-owner-bound', 'review_status': 'approved'},
      ],
    };
    final _FakeHttpTransport transport = _FakeHttpTransport((Uri uri, String method) async {
      if (uri.path == '/v1/partner/application') return _ok(<String, Object?>{'application': application});
      if (uri.path == '/v1/partner/cuisines') return _ok(<String, Object?>{'cuisines': <Object?>[]});
      if (uri.path == '/v1/partner/application/terms') {
        return _ok(<String, Object?>{'version': _agreementVersion, 'sha256': _agreementHash, 'text_en': _agreementEn, 'text_bn': _agreementBn});
      }
      return _ok(<String, Object?>{});
    });
    await tester.pumpWidget(UndalPartnerApp(apiClient: _client(transport), initialSession: _session));
    await tester.pumpAndSettle();
    await _openPartnerScreen(tester, 'p-35');

    final OutlinedButton upload = tester.widget<OutlinedButton>(find.byKey(const ValueKey<String>('partner-upload-nid_front')));
    expect(upload.onPressed, isNull);
    expect(find.text('Approved · locked'), findsOneWidget);
    expect(tester.widget<IconButton>(find.byKey(const ValueKey<String>('partner-view-nid_front'))).onPressed, isNotNull);
  });

  test('private upload uses only W1 tickets and authenticated Cloudinary delivery', () async {
    final List<String> paths = <String>[];
    final _FakeHttpTransport transport = _FakeHttpTransport((Uri uri, String method) async {
      paths.add(uri.path);
      if (uri.path == '/v1/images/private-upload-url') {
        return _ok(<String, Object?>{
          'asset_id': 'asset-owner-bound',
          'provider': 'cloudinary',
          'category': 'vendor_kyc',
          'ticket': <String, Object?>{
            'uploadUrl': 'https://api.cloudinary.com/v1_1/undal-private-vault/image/upload',
            'apiKey': 'public-upload-key',
            'timestamp': 1798000000,
            'signature': 'signed-ticket-value',
            'publicId': 'undal/private/vendor_kyc/owner/asset',
            'mode': 'signed_authenticated',
            'resourceType': 'image',
            'deliveryType': 'authenticated',
            'expiresInSeconds': 300,
          },
        }, status: 201);
      }
      if (uri.path == '/v1/partner/application/documents') {
        return _ok(<String, Object?>{'document': <String, Object?>{'doc_type': 'nid_front'}}, status: 201);
      }
      return _ok(<String, Object?>{});
    });
    final _FakeMultipartTransport multipart = _FakeMultipartTransport();
    final PartnerApiClient api = _client(transport, multipart: multipart);

    final Map<String, Object?> result = await api.uploadPrivateDocument(
      _session,
      docType: 'nid_front',
      bytes: <int>[137, 80, 78, 71],
      filename: 'identity.png',
    );

    expect(result['document'], isA<Map<String, Object?>>());
    expect(paths, <String>['/v1/images/private-upload-url', '/v1/partner/application/documents']);
    expect(transport.requests.every((Map<String, Object?> request) => request['headers'] is Map<String, String> && (request['headers']! as Map<String, String>).containsKey('Idempotency-Key')), isTrue);
    expect(multipart.uri?.host, 'api.cloudinary.com');
    expect(multipart.fields?['type'], 'authenticated');
    expect(multipart.fields?['transformation'], 'fl_strip_profile');
    expect(multipart.contentType, 'image/png');
  });
}

const String _agreementVersion = 'partner-commission-v1';
const String _agreementHash = 'c4fd6022b88d7f8e37250f9f5b9dc87f53586e795b54c1c8291b3ec2100f4751';
const String _agreementEn = '15% platform commission. Menu prices are VAT-inclusive and VAT is extracted as 5/105 of food payable under the published settlement schedule. No monthly listing fee and no advertising fee.';
const String _agreementBn = 'প্ল্যাটফর্ম কমিশন ১৫%। মেনুর মূল্য VAT-সহ; প্রকাশিত সেটেলমেন্ট নীতি অনুযায়ী খাবারের পরিশোধযোগ্য মূল্যের ৫/১০৫ VAT হিসেবে হিসাব করা হয়। মাসিক তালিকাভুক্তি ফি ও বিজ্ঞাপন ফি নেই।';

const Map<String, Object?> _submittedApplication = <String, Object?>{
  'id': 'b1601111-1111-4111-8111-111111111111',
  'type': 'RESTAURANT',
  'kyc_status': 'submitted',
  'legal_name': 'Undal Kitchen Ltd',
  'brand_name': 'Green Bowl',
  'brand_name_bn': 'গ্রিন বোল',
  'representative_name': 'Owner Name',
  'contact_email': 'owner@undal.test',
  'counter_phone': '01716000001',
  'public_area_label': 'Zindabazar',
  'address_text_private': 'Private kitchen address, Sylhet',
  'lat': 24.8949,
  'lng': 91.8687,
  'cuisines': <String>['homemade'],
  'accepts_pickup': true,
  'pickup_point_label': 'Green Bowl counter',
  'hours': <Map<String, Object?>>[
    <String, Object?>{'weekday': 0, 'is_closed': true},
    <String, Object?>{'weekday': 1, 'is_closed': true},
    <String, Object?>{'weekday': 2, 'is_closed': true},
    <String, Object?>{'weekday': 3, 'is_closed': true},
    <String, Object?>{'weekday': 4, 'is_closed': true},
    <String, Object?>{'weekday': 5, 'is_closed': true},
    <String, Object?>{'weekday': 6, 'is_closed': true},
  ],
  'documents': <Map<String, Object?>>[
    <String, Object?>{'doc_type': 'nid_front', 'media_asset_id': 'asset-owner-bound', 'review_status': 'pending'},
  ],
};

Future<void> _openPartnerScreen(WidgetTester tester, String screen) async {
  final Finder navigationChip = find.byKey(ValueKey<String>('partner-nav-$screen'));
  await tester.ensureVisible(navigationChip);
  await tester.tap(navigationChip);
  await tester.pumpAndSettle();
  expect(find.byKey(ValueKey<String>('screen-$screen')), findsOneWidget);
}

const PartnerSession _session = PartnerSession(
  userId: 'f1601111-1111-4111-8111-111111111111',
  email: 'owner@undal.test',
  accessToken: 'in-memory-session-token',
);

PartnerApiClient _client(_FakeHttpTransport http, {PartnerMultipartTransport? multipart}) => PartnerApiClient(
  config: const PartnerAppConfig(
    apiBaseUrl: 'https://api.undal.app',
    realtimeBaseUrl: 'https://realtime.undal.app',
    supabaseUrl: 'https://auth.undal.app',
    supabaseAnonKey: 'public-test-anon-key',
  ),
  http: http,
  multipart: multipart ?? _FakeMultipartTransport(),
);

PartnerHttpResponse _ok(Map<String, Object?> data, {int status = 200}) => PartnerHttpResponse(
  statusCode: status,
  body: <String, Object?>{'data': data},
);

bool _pickupValue(WidgetTester tester) => tester.widget<CheckboxListTile>(find.byKey(const ValueKey<String>('partner-accepts-pickup'))).value == true;

typedef _HttpHandler = Future<PartnerHttpResponse> Function(Uri uri, String method);

final class _FakeHttpTransport implements PartnerHttpTransport {
  _FakeHttpTransport(this.handler);

  final _HttpHandler handler;
  final List<Map<String, Object?>> requests = <Map<String, Object?>>[];

  @override
  Future<PartnerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    requests.add(<String, Object?>{'method': method, 'uri': uri, 'headers': headers, 'body': jsonBody});
    return await handler(uri, method);
  }
}

final class _FakeMultipartTransport implements PartnerMultipartTransport {
  Uri? uri;
  Map<String, String>? fields;
  String? contentType;

  @override
  Future<Map<String, Object?>> upload({
    required Uri uri,
    required Map<String, String> fields,
    required List<int> bytes,
    required String filename,
    required String contentType,
  }) async {
    this.uri = uri;
    this.fields = fields;
    this.contentType = contentType;
    return <String, Object?>{
      'public_id': fields['public_id'],
      'resource_type': 'image',
      'type': 'authenticated',
    };
  }
}
