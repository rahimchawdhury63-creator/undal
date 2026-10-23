import 'package:customer_app/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Customer App shell boots in EN and toggles cleanly to বাংলা', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const UndalCustomerApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('Real food. Real-time. No games.'), findsOneWidget);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.textContaining('আসল খাবার। সত্যিকারের দ্রুত।'), findsOneWidget);
  });
}
