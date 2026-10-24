/// Wallet model and c-19 UI coverage for Build Response 14.
import 'package:customer_app/main.dart';
import 'package:customer_app/src/models/customer_voucher_offer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('voucher offer parser rejects fractional-poisha minimums', () {
    expect(
      () => CustomerVoucherOffer.fromJson(<String, Object?>{
        'id': 'd6007777-7777-4777-8777-777777777777',
        'code': 'SAVE10',
        'title_en': 'Meal offer',
        'kind': 'flat',
        'value_num': 500,
        'min_order_poisha': 200.5,
        'ends_at': '2026-10-26T00:00:00Z',
      }),
      throwsFormatException,
    );
  });

  testWidgets('c-19 renders active W1 wallet offers in English and Bengali', (WidgetTester tester) async {
    final _WalletTransport transport = _WalletTransport();
    final CustomerController controller = CustomerController(
      apiClient: CustomerApiClient(
        config: const CustomerAppConfig(
          apiBaseUrl: 'https://api.undal.test',
          supabaseUrl: 'https://auth.undal.test',
          supabaseAnonKey: 'test-public-key',
        ),
        transport: transport,
      ),
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(UndalCustomerApp(controller: controller));

    expect(
      await controller.submitSignIn(
        identifier: '01712345678',
        secretOrOtp: 'test-only-passcode',
        method: 'phone',
      ),
      isTrue,
    );
    controller.commerce.openVoucherPicker();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey<String>('screen-c-19')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('voucher-offer-SAVE10')), findsOneWidget);
    expect(find.text('12.5% off · Minimum order ৳200.00'), findsOneWidget);
    expect(transport.walletReads, 1);

    controller.setLocale(const Locale('bn'));
    await tester.pumpAndSettle();
    expect(find.text('খাবারে ছাড়'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey<String>('voucher-wallet-refresh')));
    await tester.pumpAndSettle();
    expect(transport.walletReads, 2);
  });
}

final class _WalletTransport implements CustomerHttpTransport {
  int walletReads = 0;

  @override
  Future<CustomerHttpResponse> sendJson({
    required String method,
    required Uri uri,
    Map<String, String> headers = const <String, String>{},
    Map<String, Object?>? jsonBody,
  }) async {
    if (uri.path == '/auth/v1/token') {
      return const CustomerHttpResponse(
        statusCode: 200,
        body: <String, Object?>{
          'access_token': 'header.payload.signature',
          'user': <String, Object?>{'id': 'd6001111-1111-4111-8111-111111111111'},
        },
      );
    }
    if (uri.path == '/v1/customer/vouchers' && method == 'GET') {
      walletReads++;
      return const CustomerHttpResponse(
        statusCode: 200,
        body: <String, Object?>{
          'data': <String, Object?>{
            'vouchers': <Object?>[
              <String, Object?>{
                'id': 'd6007777-7777-4777-8777-777777777777',
                'code': 'SAVE10',
                'title_en': 'Meal discount',
                'title_bn': 'খাবারে ছাড়',
                'kind': 'percent',
                'value_num': 1250,
                'cap_poisha': 10000,
                'min_order_poisha': 20000,
                'ends_at': '2026-10-26T00:00:00Z',
              },
            ],
          },
        },
      );
    }
    return const CustomerHttpResponse(statusCode: 404, body: <String, Object?>{});
  }
}
