import 'package:customer_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'Customer App c-08 boots cleanly in EN, switches live to বাংলা & Dark mode, and enforces 0 Ads',
    (WidgetTester tester) async {
      await tester.pumpWidget(const UndalCustomerApp());
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey<String>('screen-c-08')), findsOneWidget);
      expect(find.textContaining('Explore kitchens near you'), findsOneWidget);
      expect(find.textContaining('Panchini Sylheti Dining'), findsOneWidget);
      expect(find.textContaining('Farhanar Rannaghor'), findsOneWidget);
      expect(find.text('[Ad]'), findsNothing);
      expect(find.text('Sponsored'), findsNothing);

      // Switch live to বাংলা
      await tester.tap(find.byKey(const ValueKey<String>('appbar-locale-switch')));
      await tester.pumpAndSettle();
      expect(find.textContaining('কাছের রান্নাঘর দেখুন'), findsOneWidget);
      expect(find.textContaining('পাঁচভাই সিলেটি ডাইনিং'), findsOneWidget);

      // Toggle Dark night theme
      await tester.tap(find.byKey(const ValueKey<String>('appbar-theme-switch')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
