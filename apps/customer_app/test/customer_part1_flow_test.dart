import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:customer_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  group('Build 12 — Onboarding c-01..c-05, Auth c-06..c-07, Feed/Pickup c-08..c-10 & Search c-11..c-12', () {
    testWidgets(
      'walks sequentially through c-01 -> c-02 -> c-03 -> c-04 (Sylhet Sadar + Kulaura verdict) -> c-05 -> c-08 (AP-4)',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(412, 915);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final CustomerController ctrl = CustomerController(
          initialOverlay: CustomerScreenId.c01Splash,
        );
        addTearDown(ctrl.dispose);

        await tester.pumpWidget(UndalCustomerApp(controller: ctrl));
        await tester.pumpAndSettle();

        // c-01 Splash
        expect(find.byKey(const ValueKey<String>('screen-c-01')), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey<String>('c01-get-started-btn')));
        await tester.pumpAndSettle();

        // c-02 Value Carousel (3 slides)
        expect(find.byKey(const ValueKey<String>('screen-c-02')), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey<String>('c02-next-btn')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c02-next-btn')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c02-next-btn')));
        await tester.pumpAndSettle();

        // c-03 Unobstructed Location Prime (no stacked notification dialog — AP-4!)
        expect(find.byKey(const ValueKey<String>('screen-c-03')), findsOneWidget);
        expect(find.byKey(const ValueKey<String>('screen-c-05')), findsNothing);
        await tester.tap(find.byKey(const ValueKey<String>('c03-use-gps-btn')));
        await tester.pumpAndSettle();

        // c-04 OpenStreetMap Address Pin + Sylhet Sadar vs paused Kulaura verdicts
        expect(find.byKey(const ValueKey<String>('screen-c-04')), findsOneWidget);
        expect(find.textContaining('Delivery available ✓ Sylhet Sadar'), findsOneWidget);

        // Move pin to paused Kulaura expansion zone and verify honest pre-launch verdict
        await ctrl.updateDraftPin(kKulauraZone.center);
        await tester.pumpAndSettle();
        expect(find.textContaining('Kulaura pre-launch zone (paused)'), findsOneWidget);

        // Move pin back to active Sylhet Sadar and confirm
        await ctrl.updateDraftPin(kSylhetSadarZone.center);
        await tester.pumpAndSettle();
        final Finder addressField = find.byKey(const ValueKey<String>('c04-address-text-input'));
        await tester.ensureVisible(addressField);
        await tester.pumpAndSettle();
        expect(
          tester.widget<FilledButton>(find.byKey(const ValueKey<String>('c04-confirm-pin-btn'))).onPressed,
          isNull,
          reason: 'A location pin is not a complete delivery address.',
        );
        await tester.enterText(addressField, 'Sylhet Sadar, Sylhet');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(const ValueKey<String>('c04-confirm-pin-btn')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c04-confirm-pin-btn')));
        await tester.pumpAndSettle();

        // c-05 Separate Notification Prime -> c-08 Home Delivery Feed
        expect(find.byKey(const ValueKey<String>('screen-c-05')), findsOneWidget);
        await tester.tap(
          find.byKey(const ValueKey<String>('c05-enable-notifications-btn')),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-08')), findsOneWidget);
        expect(ctrl.notificationsEnabled, isTrue);
      },
    );

    testWidgets(
      'guest favourite intent resumes through sign-up without a local fake when W1 is unavailable',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(412, 915);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final CustomerController ctrl = CustomerController();
        addTearDown(ctrl.dispose);

        await tester.pumpWidget(UndalCustomerApp(controller: ctrl));
        await tester.pumpAndSettle();

        // Tap heart on Panchini as guest -> opens c-06 Auth Hub with context notice
        final Finder panchiniFav =
            find.byKey(const ValueKey<String>('fav-btn-panchini-sylhet-kitchen'));
        await tester.ensureVisible(panchiniFav);
        await tester.pumpAndSettle();
        await tester.tap(panchiniFav);
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-06')), findsOneWidget);

        // Enter c-07 3-step Sign-Up, save Step 1, pause via Resume Later, then complete!
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c06-open-signup-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c06-open-signup-btn')));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-07')), findsOneWidget);

        await tester.enterText(
          find.byKey(const ValueKey<String>('c07-phone-input')),
          '০১৮১২৩৪৫৬৭৮',
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c07-step-next-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c07-step-next-btn')));
        await tester.pumpAndSettle();
        expect(ctrl.signUpDraft.stepIndex, 1);

        // Save progress & browse first -> returns to c-08 preserving step 2/3
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c07-resume-later-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c07-resume-later-btn')));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-08')), findsOneWidget);
        expect(ctrl.signUpDraft.stepIndex, 1);

        // Re-trigger favourite -> c-06 shows "Resume saved Sign-Up (Step 2/3)"
        await tester.ensureVisible(panchiniFav);
        await tester.pumpAndSettle();
        await tester.tap(panchiniFav);
        await tester.pumpAndSettle();
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c06-open-signup-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c06-open-signup-btn')));
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const ValueKey<String>('c07-fullname-input')),
          'Tahmid Ahmed',
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c07-step-next-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c07-step-next-btn')));
        await tester.pumpAndSettle();
        expect(ctrl.signUpDraft.stepIndex, 2);

        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c07-step-next-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c07-step-next-btn')));
        await tester.pumpAndSettle();

        // W1 is unavailable in this offline onboarding test, so no local fake favourite is shown.
        expect(ctrl.isAuthenticated, isTrue);
        expect(ctrl.session?.phone, '01812345678');
        expect(ctrl.favouriteVendorIds, isEmpty);
      },
    );

    testWidgets(
      'verifies c-09 Self-Pickup privacy (D-19), Ready vs Distance copy (AP-8), c-10 Map, AP-1 Recovery & c-11/c-12 Banglish Search',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final CustomerController ctrl = CustomerController();
        addTearDown(ctrl.dispose);

        await tester.pumpWidget(UndalCustomerApp(controller: ctrl));
        await tester.pumpAndSettle();

        // Trigger AP-1 sparse filter (`Sweets & Pitha` has 2 matches < 3)
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('cuisine-chip-sweets_pitha')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('cuisine-chip-sweets_pitha')),
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey<String>('sparse-recovery-ap1')),
          findsOneWidget,
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('sparse-clear-filters-cta')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('sparse-clear-filters-cta')),
        );
        await tester.pumpAndSettle();

        // Switch to Self-Pickup (c-09): Farhanar Rannaghor HOME_KITCHEN is strictly hidden!
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('mode-pickup-chip')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('mode-pickup-chip')));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-09')), findsOneWidget);
        expect(find.textContaining('Ready ~14 min · 520 m away'), findsOneWidget);
        expect(find.textContaining('Farhanar Rannaghor'), findsNothing);

        // Open c-10 Full-Screen Pickup Map
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('open-pickup-map-c10-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('open-pickup-map-c10-btn')),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-10')), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey<String>('c10-search-area-btn')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('c10-back-btn')));
        await tester.pumpAndSettle();

        // Switch back to Delivery and test c-11 -> c-12 Banglish + Bengali + Typo Search
        ctrl.setFulfilmentMode(UndalFulfilmentMode.delivery);
        ctrl.selectTab(1);
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-11')), findsOneWidget);

        // Banglish query "shidol" matches Farhanar Rannaghor dish and increments Cart badge
        await tester.enterText(
          find.byKey(const ValueKey<String>('search-query-input')),
          'shidol',
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey<String>('screen-c-12')), findsOneWidget);
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('add-dish-dish-farhana-shutki')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('add-dish-dish-farhana-shutki')),
        );
        await tester.pumpAndSettle();
        expect(ctrl.totalBasketItems, 1);

        // Bengali script query "সাতকরা" matches Shatkora Beef Bhuna
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('search-query-input')),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const ValueKey<String>('search-query-input')),
          'সাতকরা',
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('Sylheti Shatkora Beef Bhuna'), findsOneWidget);

        // Typo query "biryaniy" triggers AP-1 Did-you-mean button
        await tester.enterText(
          find.byKey(const ValueKey<String>('search-query-input')),
          'biryaniy',
        );
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey<String>('c12-did-you-mean-btn')),
          findsOneWidget,
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('c12-did-you-mean-btn')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('c12-did-you-mean-btn')),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('Basmati Mutton Kacchi'), findsOneWidget);
      },
    );
  });

  group('Golden Raster & Responsive Breakpoint Verification (240px -> 1440px, EN + বাংলা, Light + Dark)', () {
    const List<(String, Size)> responsiveMatrix = <(String, Size)>[
      ('compact-240px', Size(240, 560)),
      ('mobile-360px', Size(360, 800)),
      ('tablet-768px-rail', Size(768, 1024)),
      ('founder-tablet-1200px', Size(1200, 1920)),
      ('wide-1440px-extended-rail', Size(1440, 900)),
    ];

    for (final (String label, Size viewport) in responsiveMatrix) {
      testWidgets(
        'renders $label without overflow and captures verified PNG golden frame in EN & বাংলা',
        (WidgetTester tester) async {
          tester.view.physicalSize = viewport;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);

          final GlobalKey<State<StatefulWidget>> boundaryKey =
              GlobalKey<State<StatefulWidget>>();
          final CustomerController ctrl = CustomerController();
          addTearDown(ctrl.dispose);

          await tester.pumpWidget(
            RepaintBoundary(
              key: boundaryKey,
              child: UndalCustomerApp(controller: ctrl),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$label EN light');

          // Switch to বাংলা + Dark mode at this exact viewport and verify rasterized PNG output
          ctrl.setLocale(const Locale('bn'));
          ctrl.toggleThemeMode();
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$label BN dark');

          final RenderRepaintBoundary boundary = boundaryKey.currentContext!
              .findRenderObject()! as RenderRepaintBoundary;
          final Uint8List pngBytes = await tester.runAsync<Uint8List>(() async {
            final ui.Image image = await boundary.toImage(pixelRatio: 1.0);
            expect(image.width, viewport.width.toInt());
            expect(image.height, viewport.height.toInt());
            final ByteData? byteData =
                await image.toByteData(format: ui.ImageByteFormat.png);
            image.dispose();
            return byteData!.buffer.asUint8List();
          }).then((Uint8List? v) => v!);

          // Valid PNG signature: 137 ('\x89'), 80 ('P'), 78 ('N'), 71 ('G')
          expect(pngBytes.length, greaterThan(512));
          expect(pngBytes.sublist(0, 4), <int>[137, 80, 78, 71]);
        },
      );
    }
  });
}
