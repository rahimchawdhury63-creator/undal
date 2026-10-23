import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/main.dart';

void main() {
  testWidgets('Rider App shell boots in EN and toggles cleanly to বাংলা', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const UndalRiderApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('Why this fare?'), findsOneWidget);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.textContaining('এই ভাড়া কীভাবে নির্ধারিত হলো?'), findsOneWidget);
  });
}
