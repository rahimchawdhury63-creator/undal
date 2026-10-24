/// Widget and state coverage for the customer commerce journey (`c-13..c-21`, Build Response 13).
///
/// A deterministic fake W1 transport supplies one privacy-safe, UUID-backed storefront and verifies
/// that guest intents resume, modifiers reach a single-vendor cart, and c-21 requires a W1 receipt.
import 'package:customer_app/main.dart';
import 'package:customer_app/src/state/customer_commerce_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const String _vendorId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000101';
const String _itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000102';
const String _bundleId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000103';
const String _variantGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000201';
const String _variantId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000202';
const String _optionGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000301';
const String _optionId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000302';
const String _optionExtraId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000303';
const String _bundleSlotId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000401';
const String _bundleChoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000402';
const String _addressId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000501';
const String _orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000601';

void main() {
  test('server receipt rejects fractional poisha and non-PLACED responses', () {
    expect(
      () => CustomerOrderReceipt.fromJson(<String, Object?>{
        'order_id': _orderId,
        'public_code': 'SYL-20261024-001',
        'status': 'PLACED',
        'cod_collect_poisha': 16500.5,
      }),
      throwsFormatException,
    );
    expect(
      () => CustomerOrderReceipt.fromJson(<String, Object?>{
        'order_id': _orderId,
        'public_code': 'SYL-20261024-001',
        'status': 'ACCEPTED',
        'cod_collect_poisha': 16500,
      }),
      throwsFormatException,
    );
  });

  group('Build 13 — live storefront, customizer, bundles, kitchen info and verified reviews', () {
    testWidgets('c-13 -> c-14 builds a current modifier basket and resumes checkout auth intent', (WidgetTester tester) async {
      _setViewport(tester);
      final _CommerceTransport transport = _CommerceTransport();
      final CustomerController controller = _controller(transport);
      addTearDown(controller.dispose);
      await tester.pumpWidget(UndalCustomerApp(controller: controller));
      controller.commerce.openVendor(controller.rankedFeed.first);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey<String>('screen-c-13')), findsOneWidget);
      expect(find.text('Test Kitchen'), findsWidgets);
      expect(controller.commerce.storefront!.items.first.dish.imgbbUrl, isNull);
      final Finder customize = find.byKey(const ValueKey<String>('storefront-customize-$_itemId'));
      await tester.ensureVisible(customize);
      await tester.pumpAndSettle();
      await tester.tap(customize);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-14')), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('variant-$_variantId')), findsOneWidget);
      expect(controller.commerce.itemConfigurationValid, isTrue);
      expect(controller.commerce.itemUnitPricePoisha, 12500);

      await tester.ensureVisible(find.byKey(const ValueKey<String>('customizer-add-to-basket')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('customizer-add-to-basket')));
      await tester.pumpAndSettle();
      expect(controller.currentScreenId, CustomerScreenId.c18Cart);
      expect(find.byKey(const ValueKey<String>('screen-c-18')), findsOneWidget);
      expect(controller.basket.single.unitPricePoisha, 12500);
      expect(controller.totalBasketItems, 1);

      await tester.ensureVisible(find.byKey(const ValueKey<String>('cart-open-checkout')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('cart-open-checkout')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-06')), findsOneWidget);
      expect(controller.pendingIntent, isA<CheckoutOrderIntent>());
    });

    testWidgets('c-15 enforces a required bundle slot and c-16/c-17 keep kitchen data public-only', (WidgetTester tester) async {
      _setViewport(tester);
      final _CommerceTransport transport = _CommerceTransport();
      final CustomerController controller = _controller(transport);
      addTearDown(controller.dispose);
      await tester.pumpWidget(UndalCustomerApp(controller: controller));
      controller.commerce.openVendor(controller.rankedFeed.first);
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey<String>('storefront-kitchen-info')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('storefront-kitchen-info')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-16')), findsOneWidget);
      expect(find.textContaining('Weekly hours'), findsOneWidget);
      expect(find.textContaining('Secret street address'), findsNothing);
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey<String>('storefront-verified-reviews')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('storefront-verified-reviews')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-17')), findsOneWidget);
      expect(find.text('Verified buyer'), findsOneWidget);
      expect(find.text('Warm and ready'), findsOneWidget);
      expect(find.text('Authentic taste'), findsOneWidget);
      expect(find.text('Tahmid Rahman'), findsNothing);
      expect(find.byType(Image), findsNothing);
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();

      final Finder bundleCustomizer = find.byKey(const ValueKey<String>('storefront-customize-$_bundleId'));
      await tester.ensureVisible(bundleCustomizer);
      await tester.pumpAndSettle();
      await tester.tap(bundleCustomizer);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey<String>('customizer-open-bundle-builder')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('customizer-open-bundle-builder')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-15')), findsOneWidget);
      expect(controller.commerce.itemConfigurationValid, isFalse);

      final Finder choice = find.byKey(const ValueKey<String>('bundle-choice-$_bundleSlotId-$_bundleChoiceId'));
      await tester.ensureVisible(choice);
      await tester.pumpAndSettle();
      await tester.tap(choice);
      await tester.pumpAndSettle();
      expect(controller.commerce.itemConfigurationValid, isTrue);
      expect(controller.commerce.itemUnitPricePoisha, 12000);
    });

    testWidgets('a timeout retries the identical COD idempotency request without rebuilding the cart', (WidgetTester tester) async {
      _setViewport(tester);
      final _CommerceTransport transport = _CommerceTransport()..failNextOrder = true;
      final CustomerController controller = _controller(transport);
      addTearDown(controller.dispose);
      await tester.pumpWidget(UndalCustomerApp(controller: controller));
      controller.commerce.openVendor(controller.rankedFeed.first);
      await tester.pumpAndSettle();
      controller.commerce.openItem(controller.commerce.storefront!.items.first);
      expect(controller.commerce.addConfiguredItem(), CartAddResult.added);
      controller.selectTab(3);
      final bool signedIn = await controller.submitSignIn(
        identifier: '01712345678',
        secretOrOtp: 'not-a-real-secret',
        method: 'phone',
      );
      expect(signedIn, isTrue);
      controller.commerce.openCheckout();
      await tester.pumpAndSettle();
      expect(controller.commerce.serverQuote, isNotNull);

      expect(await controller.commerce.placeCodOrder(), isFalse);
      await tester.pumpAndSettle();
      expect(controller.commerce.orderResolutionPending, isTrue);
      final int cartReadsAfterUnknown = transport.cartReads;
      final int quoteRequestsAfterUnknown = transport.quoteRequests;
      final List<String?> keysAfterUnknown = List<String?>.of(transport.orderIdempotencyKeys);
      expect(keysAfterUnknown, hasLength(1));
      expect(controller.totalBasketItems, 1);

      expect(await controller.commerce.placeCodOrder(), isTrue);
      await tester.pumpAndSettle();
      expect(transport.orderIdempotencyKeys, <String?>[keysAfterUnknown.single, keysAfterUnknown.single]);
      expect(transport.cartReads, cartReadsAfterUnknown);
      expect(transport.quoteRequests, quoteRequestsAfterUnknown);
      expect(controller.totalBasketItems, 0);
      expect(controller.currentScreenId, CustomerScreenId.c21OrderConfirmation);
    });

    testWidgets('c-19 guest voucher resumes, c-20 quotes integer poisha, c-21 is server confirmed', (WidgetTester tester) async {
      _setViewport(tester);
      final _CommerceTransport transport = _CommerceTransport();
      final CustomerController controller = _controller(transport);
      addTearDown(controller.dispose);
      await tester.pumpWidget(UndalCustomerApp(controller: controller));
      controller.commerce.openVendor(controller.rankedFeed.first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey<String>('storefront-customize-$_itemId')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('storefront-customize-$_itemId')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const ValueKey<String>('customizer-add-to-basket')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('customizer-add-to-basket')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey<String>('cart-open-voucher-picker')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('cart-open-voucher-picker')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-19')), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey<String>('voucher-code-input')), 'SAVE10');
      await tester.ensureVisible(find.byKey(const ValueKey<String>('voucher-apply')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('voucher-apply')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-06')), findsOneWidget);
      expect(controller.commerce.voucherInput, 'SAVE10');

      final bool signedIn = await controller.submitSignIn(
        identifier: '01712345678',
        secretOrOtp: 'not-a-real-secret',
        method: 'phone',
      );
      expect(signedIn, isTrue);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-19')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey<String>('voucher-apply')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('voucher-apply')));
      await tester.pumpAndSettle();
      expect(controller.commerce.appliedVoucherCode, 'SAVE10');
      expect(find.byKey(const ValueKey<String>('screen-c-18')), findsOneWidget);

      await tester.ensureVisible(find.byKey(const ValueKey<String>('cart-open-checkout')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('cart-open-checkout')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-20')), findsOneWidget);
      expect(find.textContaining('W1-confirmed price breakdown'), findsOneWidget);
      expect(controller.commerce.serverQuote?['cod_collect_poisha'], 16500);
      await tester.ensureVisible(find.byKey(const ValueKey<String>('checkout-place-cod-order')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('checkout-place-cod-order')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey<String>('screen-c-21')), findsOneWidget);
      expect(find.text('SYL-20261024-001'), findsOneWidget);
      expect(controller.commerce.receipt?.codCollectPoisha, 16500);
      expect(transport.lastOrderPayload?['expected_cod_poisha'], 16500);
      expect(transport.lastOrderPayload?['expected_cod_poisha'], isA<int>());
      expect(transport.lastOrderPayload?.containsKey('delivery_fee_poisha'), isFalse);
      expect(transport.lastOrderPayload?.containsKey('platform_fee_poisha'), isFalse);
      expect(transport.lastOrderIdempotencyKey, isNotEmpty);
    });
  });
}

void _setViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(412, 915);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

CustomerController _controller(_CommerceTransport transport) => CustomerController(
      apiClient: CustomerApiClient(
        config: const CustomerAppConfig(
          apiBaseUrl: 'https://api.undal.test',
          supabaseUrl: 'https://auth.undal.test',
          supabaseAnonKey: 'public-key-for-tests',
        ),
        transport: transport,
      ),
    );

final class _CommerceTransport implements CustomerHttpTransport {
  Map<String, Object?>? lastOrderPayload;
  String? lastOrderIdempotencyKey;
  final List<String?> orderIdempotencyKeys = <String?>[];
  bool failNextOrder = false;
  int cartReads = 0;
  int quoteRequests = 0;

  @override
  Future<CustomerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    if (uri.path == '/auth/v1/token') {
      return CustomerHttpResponse(
        statusCode: 200,
        body: <String, Object?>{
          'access_token': 'header.payload.signature',
          'user': <String, Object?>{'id': _addressId},
        },
      );
    }
    if (uri.path.endsWith('/menu')) return _ok(_menuPayload());
    if (uri.path.endsWith('/reviews')) {
      return _ok(<String, Object?>{
        'reviews': <Object?>[
          <String, Object?>{
            'id': _id('701'),
            'reviewer_id': _addressId,
            'customer_name': 'Tahmid Rahman',
            'rating': 5,
            'aspect_tags': <String>['Fresh', 'cv_taste_great'],
            'comment': 'Warm and ready',
            'photo_urls': <String>['https://res.cloudinary.com/test/public-review.jpg'],
            'vendor_reply': 'Thank you',
            'created_at': '2026-10-24T10:00:00Z',
          },
        ],
      });
    }
    if (uri.path == '/v1/addresses') {
      return _ok(<String, Object?>{'address': <String, Object?>{'id': _addressId}});
    }
    if (uri.path == '/v1/cart' && method == 'GET') {
      cartReads += 1;
      return _ok(<String, Object?>{'cart': null, 'items': <Object?>[]});
    }
    if (uri.path == '/v1/cart/validate') {
      quoteRequests += 1;
      return _ok(<String, Object?>{
        'quote': <String, Object?>{
          'items_poisha': 12500,
          'discount_total_poisha': 500,
          'food_payable_poisha': 12000,
          'tax_extracted_poisha': 571,
          'delivery_fee_poisha': 4000,
          'platform_fee_poisha': 500,
          'tip_poisha': 0,
          'cod_collect_poisha': 16500,
        },
      });
    }
    if (uri.path == '/v1/orders' && method == 'POST') {
      lastOrderPayload = jsonBody;
      lastOrderIdempotencyKey = headers['Idempotency-Key'];
      orderIdempotencyKeys.add(lastOrderIdempotencyKey);
      if (failNextOrder) {
        failNextOrder = false;
        return const CustomerHttpResponse(statusCode: 500, body: <String, Object?>{});
      }
      return _ok(<String, Object?>{
        'order_id': _orderId,
        'public_code': 'SYL-20261024-001',
        'status': 'PLACED',
        'cod_collect_poisha': 16500,
      });
    }
    if (uri.path == '/v1/cart/voucher' && method == 'POST') {
      return _ok(<String, Object?>{'cart': <String, Object?>{'voucher_code': 'SAVE10'}});
    }
    return _ok(<String, Object?>{});
  }

  CustomerHttpResponse _ok(Map<String, Object?> data) => CustomerHttpResponse(
        statusCode: 200,
        body: <String, Object?>{'data': data},
      );

  Map<String, Object?> _menuPayload() => <String, Object?>{
        'vendor': <String, Object?>{
          'id': _vendorId,
          'slug': 'test-kitchen',
          'type': 'RESTAURANT',
          'brand_name': 'Test Kitchen',
          'brand_name_bn': 'টেস্ট কিচেন',
          'public_area_label': 'Zindabazar, Sylhet',
          'address_text_private': 'Secret street address',
          'owner_profile_id': 'private-owner-only',
          'counter_phone': '01712345678',
          'logo_url': null,
          'cover_url': null,
          'hygiene_verified': true,
          'min_order_poisha': 10000,
          'accepts_pickup': true,
          'pickup_point_label': 'Front counter',
          'rating_avg': 4.8,
          'rating_count': 12,
          'avg_prep_min': 20,
          'operational_status': 'open',
        },
        'categories': <Object?>[
          <String, Object?>{
            'id': _id('801'),
            'name_en': 'Meals',
            'name_bn': 'খাবার',
            'items': <Object?>[
              _item(id: _itemId, type: 'sized'),
              _item(id: _bundleId, type: 'bundle'),
            ],
          },
        ],
        'vendor_hours': <Object?>[
          <String, Object?>{
            'weekday': 6,
            'is_closed': false,
            'open1': '10:00',
            'close1': '22:00',
            'open2': null,
            'close2': null,
          },
        ],
      };

  Map<String, Object?> _item({required String id, required String type}) => <String, Object?>{
        'id': id,
        'name_en': type == 'bundle' ? 'Meal bundle' : 'Shatkora bowl',
        'name_bn': type == 'bundle' ? 'মিল কম্বো' : 'সাতকরা বাটি',
        'description_en': 'Kitchen-made meal',
        'description_bn': 'রান্নাঘরে তৈরি খাবার',
        'price_poisha': 10000,
        'compare_at_poisha': null,
        'image_url': 'https://res.cloudinary.com/test/public-menu.jpg',
        'item_type': type,
        'spicy_level': 1,
        'is_veg': false,
        'halal': true,
        'serves': '1 person',
        'is_orderable': true,
        'variant_groups': type == 'bundle'
            ? <Object?>[]
            : <Object?>[
                <String, Object?>{
                  'id': _variantGroupId,
                  'name_en': 'Portion',
                  'name_bn': 'পরিমাণ',
                  'min_select': 1,
                  'max_select': 1,
                  'variants': <Object?>[
                    <String, Object?>{
                      'id': _variantId,
                      'name_en': 'Regular',
                      'name_bn': 'সাধারণ',
                      'price_delta_poisha': 2000,
                      'is_available': true,
                    },
                  ],
                },
              ],
        'option_groups': type == 'bundle'
            ? <Object?>[]
            : <Object?>[
                <String, Object?>{
                  'id': _optionGroupId,
                  'name_en': 'Choose a side',
                  'name_bn': 'সাইড বাছুন',
                  'min_select': 1,
                  'max_select': 2,
                  'options': <Object?>[
                    <String, Object?>{
                      'id': _optionId,
                      'name_en': 'Salad',
                      'name_bn': 'সালাদ',
                      'price_delta_poisha': 500,
                      'is_available': true,
                    },
                    <String, Object?>{
                      'id': _optionExtraId,
                      'name_en': 'Lime',
                      'name_bn': 'লেবু',
                      'price_delta_poisha': 0,
                      'is_available': true,
                    },
                  ],
                },
              ],
        'bundle_slots': type == 'bundle'
            ? <Object?>[
                <String, Object?>{
                  'id': _bundleSlotId,
                  'name_en': 'Pick a side',
                  'name_bn': 'সাইড বাছুন',
                  'min_pick': 1,
                  'max_pick': 1,
                  'choices': <Object?>[
                    <String, Object?>{
                      'item_id': _bundleChoiceId,
                      'name_en': 'Rice and dal',
                      'name_bn': 'ভাত ও ডাল',
                      'price_delta_poisha': 2000,
                      'is_orderable': true,
                    },
                  ],
                },
              ]
            : <Object?>[],
      };
}

String _id(String suffix) => 'aaaaaaaa-aaaa-4aaa-8aaa-${suffix.padLeft(12, '0')}';
