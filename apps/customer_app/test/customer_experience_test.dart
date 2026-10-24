/// Customer order, realtime, review, and routing parser tests for Build Response 15.
import 'package:customer_app/src/config/app_config.dart';
import 'package:customer_app/src/models/customer_experience_models.dart';
import 'package:customer_app/src/services/customer_commerce_api.dart';
import 'package:customer_app/src/services/customer_experience_api.dart';
import 'package:customer_app/src/services/customer_order_realtime.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  test('order parser accepts integer poisha and rejects fractional money', () {
    final CustomerOrderCard order = CustomerOrderCard.fromJson(_orderJson());
    expect(order.codCollectPoisha, 12550);
    expect(order.vendorName('bn'), 'রান্নাঘর');
    expect(() => CustomerOrderCard.fromJson(<String, Object?>{..._orderJson(), 'cod_collect_poisha': 125.5}), throwsA(isA<FormatException>()));
  });

  test('pickup QR parser only exposes a well-formed customer pickup secret', () {
    final Map<String, Object?> pickup = _orderJson()
      ..['fulfilment'] = 'pickup'
      ..['status'] = 'READY_FOR_PICKUP'
      ..['pickup_qr_token'] = List<String>.filled(64, 'a').join()
      ..['pickup_code_4'] = '7314';
    final CustomerOrderDetail detail = CustomerOrderDetail.fromJson(<String, Object?>{
      'order': pickup,
      'items': <Object?>[],
      'events': <Object?>[],
    });
    expect(detail.pickupQrToken, List<String>.filled(64, 'a').join());
    expect(detail.pickupCode4, '7314');

    final CustomerOrderDetail delivery = CustomerOrderDetail.fromJson(<String, Object?>{
      'order': <String, Object?>{...pickup, 'fulfilment': 'delivery'},
      'items': <Object?>[],
      'events': <Object?>[],
    });
    expect(delivery.pickupQrToken, isNull);
    expect(delivery.pickupCode4, isNull);
  });

  test('precision-5 OSRM polyline decodes WGS-84 coordinates and rejects malformed geometry', () {
    final List<GeoPoint> points = decodeCustomerRoutePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points, hasLength(3));
    expect(points[0].lat, closeTo(38.5, 0.00001));
    expect(points[0].lng, closeTo(-120.2, 0.00001));
    expect(points[1].lat, closeTo(40.7, 0.00001));
    expect(points[2].lng, closeTo(-126.453, 0.00001));
    expect(decodeCustomerRoutePolyline('not-a-polyline'), isEmpty);
  });

  test('Firebase RTDB put and patch SSE messages decode without trusting unknown event types', () {
    final RtdbSseDecoder decoder = RtdbSseDecoder();
    expect(decoder.addLine('event: put'), isNull);
    expect(decoder.addLine('data: {"path":"/loc","data":{"la":24.9,"ln":91.8,"ts":1000}}'), isNull);
    final Map<String, Object?>? event = decoder.addLine('');
    expect(event?['event'], '/loc');
    expect(event?['type'], 'put');
    expect(customerJsonMap(event?['data'])['ts'], 1000);
    expect(decoder.addLine('event: cancel'), isNull);
  });

  test('review loader uses the authenticated customer order review route', () async {
    final _ReviewTransport transport = _ReviewTransport();
    final CustomerExperienceApi api = CustomerExperienceApi(
      config: const CustomerAppConfig(apiBaseUrl: 'https://api.undal.test'),
      transport: transport,
    );
    final List<CustomerReviewSnapshot> reviews = await api.listOrderReviews(
      accessToken: 'customer-access-token',
      orderId: '7e290000-0000-4000-8000-000000000001',
    );
    expect(transport.lastUri?.path, '/v1/orders/7e290000-0000-4000-8000-000000000001/review');
    expect(reviews.single.rating, 4);
    expect(reviews.single.direction, 'customer_to_vendor');
  });
}

Map<String, Object?> _orderJson() => <String, Object?>{
      'id': '7e290000-0000-4000-8000-000000000001',
      'public_code': 'UN-20261024-001',
      'status': 'PLACED',
      'fulfilment': 'delivery',
      'cod_collect_poisha': '12550',
      'placed_at': '2026-10-24T05:00:00Z',
      'vendor_snapshot': <String, Object?>{'brand_name': 'Kitchen', 'brand_name_bn': 'রান্নাঘর', 'slug': 'kitchen'},
      'address_snapshot': <String, Object?>{'label': 'Home', 'address_text': 'Example Road', 'lat': 24.9, 'lng': 91.8},
      'vendor_location': <String, Object?>{'lat': 24.91, 'lng': 91.81},
      'pickup_qr_token': null,
      'pickup_code_4': null,
    };

final class _ReviewTransport implements CustomerHttpTransport {
  Uri? lastUri;

  @override
  Future<CustomerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    lastUri = uri;
    return const CustomerHttpResponse(
      statusCode: 200,
      body: <String, Object?>{
        'data': <String, Object?>{
          'reviews': <Object?>[
            <String, Object?>{
              'id': '7e290000-0000-4000-8000-000000000009',
              'direction': 'customer_to_vendor',
              'rating': 4,
              'aspect_tags': <String>['fresh'],
              'comment': 'Good food',
              'created_at': '2026-10-24T05:10:00Z',
            },
          ],
        },
      },
    );
  }
}
