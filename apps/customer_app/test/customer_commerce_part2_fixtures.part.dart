/// Shared deterministic W1 fixtures for c-13..c-21 commerce widget and state tests.
part of 'customer_commerce_part2_test.dart';

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

void _setSpecificDeliveryAddress(CustomerController controller) {
  controller.updateActiveAddress(
    point: controller.activeAddress.point,
    streetAddress: '24 Rose View, Zindabazar, Sylhet',
    landmarkNote: 'Near the central market',
  );
}

final class _CommerceTransport implements CustomerHttpTransport {
  Map<String, Object?>? lastOrderPayload;
  String? lastOrderIdempotencyKey;
  final List<String?> orderIdempotencyKeys = <String?>[];
  bool failNextOrder = false;
  int addressSaves = 0;
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
      if (method != 'GET') addressSaves++;
      return _ok(<String, Object?>{'address': <String, Object?>{'id': _addressId}});
    }
    if (uri.path == '/v1/customer/vouchers' && method == 'GET') {
      return _ok(<String, Object?>{'vouchers': <Object?>[]});
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
          'priority_delivery_fee_poisha': 2000,
          'platform_fee_poisha': 500,
          'tip_poisha': 0,
          'cod_collect_poisha': 16500,
          'line_items': <Object?>[
            <String, Object?>{
              'menu_item_id': _itemId,
              'variant_id': _variantId,
              'selections': <Object?>[
                <String, Object?>{'kind': 'option', 'group_id': _optionGroupId, 'option_id': _optionId},
              ],
              'qty': 1,
              'name_en': 'Shatkora bowl',
              'name_bn': 'সাতকরা বাটি',
              'unit_poisha': 12500,
              'line_poisha': 12500,
            },
          ],
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
