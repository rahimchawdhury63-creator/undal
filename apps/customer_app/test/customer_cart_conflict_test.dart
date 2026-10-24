/// Confirms destructive single-vendor basket replacements require an explicit customer decision.
import 'package:customer_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('quick-add asks before replacing another kitchen cart and honors both choices', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final CustomerController controller = CustomerController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(UndalCustomerApp(controller: controller));
    final List<VendorFeedCard> vendors = controller.rankedFeed;
    expect(vendors.length, greaterThan(1));
    final VendorFeedCard firstVendor = vendors.first;
    final VendorFeedCard secondVendor = vendors.firstWhere((VendorFeedCard row) => row.id != firstVendor.id);
    final CatalogDishItem firstDish = firstVendor.dishes.first;
    final CatalogDishItem secondDish = secondVendor.dishes.first;

    final Finder firstCard = find.byKey(ValueKey<String>('vendor-card-${firstVendor.slug}'));
    await tester.ensureVisible(firstCard);
    await tester.pumpAndSettle();
    await tester.tap(firstCard);
    await tester.pumpAndSettle();
    final Finder firstAdd = find.byKey(ValueKey<String>('quick-menu-add-${firstDish.id}'));
    await tester.ensureVisible(firstAdd);
    await tester.pumpAndSettle();
    await tester.tap(firstAdd);
    await tester.pumpAndSettle();
    expect(controller.basket.single.dish.vendorId, firstVendor.id);

    final Finder secondCard = find.byKey(ValueKey<String>('vendor-card-${secondVendor.slug}'));
    await tester.ensureVisible(secondCard);
    await tester.pumpAndSettle();
    await tester.tap(secondCard);
    await tester.pumpAndSettle();
    final Finder secondAdd = find.byKey(ValueKey<String>('quick-menu-add-${secondDish.id}'));
    await tester.ensureVisible(secondAdd);
    await tester.pumpAndSettle();
    await tester.tap(secondAdd);
    await tester.pumpAndSettle();
    expect(find.text('Replace current kitchen?'), findsOneWidget);

    await tester.ensureVisible(find.text('Keep basket'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Keep basket'));
    await tester.pumpAndSettle();
    expect(controller.basket.single.dish.vendorId, firstVendor.id);

    await tester.tap(secondAdd);
    await tester.pumpAndSettle();
    expect(find.text('Replace current kitchen?'), findsOneWidget);
    await tester.ensureVisible(find.text('Replace kitchen'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Replace kitchen'));
    await tester.pumpAndSettle();
    expect(controller.basket.single.dish.vendorId, secondVendor.id);
  });
}
