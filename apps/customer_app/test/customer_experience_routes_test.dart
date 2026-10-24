/// Root-route smoke coverage for customer tracking, pickup handover, and order history.
import 'package:customer_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('c-22, c-23, and c-26 are reachable without fabricated guest orders', (WidgetTester tester) async {
    final CustomerController controller = CustomerController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(UndalCustomerApp(controller: controller));

    controller.openCustomerExperienceScreen(CustomerScreenId.c22LiveTracking);
    await tester.pump();
    expect(find.byKey(const ValueKey<String>('screen-c-22')), findsOneWidget);
    expect(find.textContaining('Live order unavailable'), findsOneWidget);
    expect(tester.takeException(), isNull);

    controller.openCustomerExperienceScreen(CustomerScreenId.c23PickupReady);
    await tester.pump();
    expect(find.byKey(const ValueKey<String>('screen-c-23')), findsOneWidget);
    expect(tester.takeException(), isNull);

    controller.openCustomerExperienceScreen(CustomerScreenId.c26Orders);
    await tester.pump();
    expect(find.byKey(const ValueKey<String>('screen-c-26')), findsOneWidget);
    expect(find.textContaining('Sign in'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
