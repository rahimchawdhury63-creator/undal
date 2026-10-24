/// @file apps/partner_app/test/app_smoke_test.dart
/// @description Smoke coverage for the authenticated Partner entry point and bilingual sign-in shell.

import 'package:flutter_test/flutter_test.dart';
import 'package:partner_app/main.dart';

void main() {
  testWidgets('Partner App opens the real applicant sign-in screen in EN and বাংলা', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const UndalPartnerApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('Apply to become an Undal partner'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.textContaining('উন্দাল পার্টনার হিসেবে আবেদন করুন'), findsOneWidget);
    expect(find.text('অ্যাকাউন্ট খুলুন'), findsOneWidget);
  });
}
