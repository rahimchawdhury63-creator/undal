import 'package:flutter_test/flutter_test.dart';
import 'package:partner_app/main.dart';

void main() {
  testWidgets('Partner App shell boots in EN and switches cleanly to বাংলা', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const UndalPartnerApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('NEW ORDER'), findsOneWidget);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.textContaining('নতুন অর্ডার'), findsOneWidget);
  });
}
