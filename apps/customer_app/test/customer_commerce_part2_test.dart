/// Widget and state coverage for the customer commerce journey (`c-13..c-21`, Build Responses 13–14).
///
/// A deterministic fake W1 transport supplies one privacy-safe, UUID-backed storefront and verifies
/// that guest intents resume, modifiers reach a single-vendor cart, and c-21 requires a W1 receipt.
import 'package:customer_app/main.dart';
import 'package:customer_app/src/state/customer_commerce_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

part 'customer_commerce_part2_fixtures.part.dart';

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

    testWidgets('c-20 blocks delivery on the generic zone label until a specific address is entered', (WidgetTester tester) async {
      _setViewport(tester);
      final _CommerceTransport transport = _CommerceTransport();
      final CustomerController controller = _controller(transport);
      addTearDown(controller.dispose);
      await tester.pumpWidget(UndalCustomerApp(controller: controller));
      controller.commerce.openVendor(controller.rankedFeed.first);
      await tester.pumpAndSettle();
      controller.commerce.openItem(controller.commerce.storefront!.items.first);
      expect(controller.commerce.addConfiguredItem(), CartAddResult.added);
      expect(controller.commerce.hasSpecificDeliveryAddress, isFalse);

      expect(
        await controller.submitSignIn(
          identifier: '01712345678',
          secretOrOtp: 'not-a-real-secret',
          method: 'phone',
        ),
        isTrue,
      );
      await tester.pumpAndSettle();
      controller.commerce.openCheckout();
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey<String>('screen-c-20')), findsOneWidget);
      expect(controller.commerce.commerceErrorCode, 'ADDRESS_REQUIRED');
      expect(controller.commerce.serverQuote, isNull);
      expect(controller.commerce.canPlaceLiveOrder, isFalse);
      expect(transport.addressSaves, 0);
      expect(transport.cartReads, 0);
      expect(transport.quoteRequests, 0);
      expect(find.textContaining('Add a specific house, road, or area'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const ValueKey<String>('checkout-place-cod-order'))).onPressed, isNull);
      await tester.ensureVisible(find.byKey(const ValueKey<String>('checkout-edit-address')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('checkout-edit-address')));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const ValueKey<String>('checkout-address-street-input'))).controller!.text, isEmpty);
      await tester.tap(find.byTooltip('Back to checkout'));
      await tester.pumpAndSettle();

      _setSpecificDeliveryAddress(controller);
      expect(controller.commerce.hasSpecificDeliveryAddress, isTrue);
      expect(await controller.commerce.refreshServerQuote(), isTrue);
      await tester.pumpAndSettle();
      expect(controller.commerce.serverQuote?['cod_collect_poisha'], 16500);
      expect(controller.commerce.canPlaceLiveOrder, isTrue);
      expect(transport.addressSaves, 1);
      expect(transport.quoteRequests, 1);
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
      _setSpecificDeliveryAddress(controller);
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
      _setSpecificDeliveryAddress(controller);
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
