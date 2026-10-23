import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  group('Appendix F Golden Money Vectors M-1..M-8 (MNY-01)', () {
    test('matches all 8 golden vectors poisha-for-poisha', () {
      final cases = <(String, OrderPricingInput, (int, int, int, int, int, int))>[
        (
          'M-1',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 54100,
            discountVendorPoisha: 10820,
            discountPlatformPoisha: 0,
            deliveryFeePoisha: 0,
            platformFeePoisha: 500,
          ),
          (43280, 2061, 6492, 1298, 36788, 43780),
        ),
        (
          'M-2',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 30000,
            discountVendorPoisha: 0,
            discountPlatformPoisha: 0,
            deliveryFeePoisha: 6000,
            platformFeePoisha: 500,
          ),
          (30000, 1429, 4500, 900, 25500, 36500),
        ),
        (
          'M-3',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 40000,
            discountVendorPoisha: 5000,
            discountPlatformPoisha: 5000,
            deliveryFeePoisha: 2000,
            platformFeePoisha: 500,
          ),
          (30000, 1429, 4500, 900, 30500, 32500),
        ),
        (
          'M-4',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.pickup,
            itemsPoisha: 25000,
            discountVendorPoisha: 2500,
            discountPlatformPoisha: 0,
          ),
          (22500, 1071, 3375, 675, 19125, 22500),
        ),
        (
          'M-5',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 270500,
            discountVendorPoisha: 54100,
            discountPlatformPoisha: 0,
            deliveryFeePoisha: 13000,
            platformFeePoisha: 500,
          ),
          (216400, 10305, 32460, 6492, 183940, 229900),
        ),
        (
          'M-6',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 9900,
            discountVendorPoisha: 0,
            discountPlatformPoisha: 0,
            deliveryFeePoisha: 5000,
            platformFeePoisha: 500,
          ),
          (9900, 471, 1485, 297, 8415, 15400),
        ),
        (
          'M-7',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 35000,
            discountVendorPoisha: 0,
            discountPlatformPoisha: 11000,
            deliveryFeePoisha: 5000,
            platformFeePoisha: 500,
          ),
          (24000, 1143, 3600, 720, 31400, 29500),
        ),
        (
          'M-8',
          const OrderPricingInput(
            fulfilment: UndalFulfilmentMode.delivery,
            itemsPoisha: 18000,
            discountVendorPoisha: 1800,
            discountPlatformPoisha: 0,
            deliveryFeePoisha: 0,
            platformFeePoisha: 500,
          ),
          (16200, 771, 2430, 486, 13770, 16700),
        ),
      ];

      for (final (id, input, exp) in cases) {
        final snap = priceOrder(input);
        expect(snap.foodPayablePoisha, exp.$1, reason: '$id foodPayable');
        expect(snap.taxExtractedPoisha, exp.$2, reason: '$id taxExtracted');
        expect(snap.commissionPoisha, exp.$3, reason: '$id commission');
        expect(snap.riderBonusPoisha, exp.$4, reason: '$id riderBonus');
        expect(snap.vendorNetPoisha, exp.$5, reason: '$id vendorNet');
        expect(snap.codCollectPoisha, exp.$6, reason: '$id codCollect');
      }
    });

    test('formats and parses EN and Bengali BDT numerals cleanly', () {
      expect(formatBdt(183940, localeCode: 'en'), '৳1,839.40');
      expect(formatBdt(183940, localeCode: 'bn'), '৳১,৮৩৯.৪০');
      expect(parseBdtInputToPoisha('৳১,৮৩৯.৪০'), 183940);
      expect(parseBdtInputToPoisha('437.80'), 43780);
    });
  });

  group('Appendix F Golden Rider Fare Vectors F-1..F-6', () {
    test('matches all 6 dynamic rider fare vectors poisha-for-poisha', () {
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.motorbike,
            travelDistanceKm: 5.0,
            toVendorKm: 1.2,
            trafficDelayMinutes: 12,
            activeRidersInZone: 3,
            activeOrdersInZone: 8,
            weatherCondition: WeatherCondition.rain,
            batchPosition: 1,
            orderFoodPayablePoisha: 43280,
            isPriority: false,
          ),
        ).riderFarePoisha,
        13584,
      );
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.bicycle,
            travelDistanceKm: 2.3,
            toVendorKm: 0.6,
            trafficDelayMinutes: 0,
            activeRidersInZone: 5,
            activeOrdersInZone: 3,
            weatherCondition: WeatherCondition.clear,
            batchPosition: 1,
            orderFoodPayablePoisha: 22500,
            isPriority: false,
          ),
        ).riderFarePoisha,
        3000,
      );
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.motorbike,
            travelDistanceKm: 8.5,
            toVendorKm: 2.0,
            trafficDelayMinutes: 16,
            activeRidersInZone: 1,
            activeOrdersInZone: 6,
            weatherCondition: WeatherCondition.storm,
            batchPosition: 1,
            orderFoodPayablePoisha: 216400,
            isPriority: false,
          ),
        ).riderFarePoisha,
        30661,
      );
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.motorbike,
            travelDistanceKm: 5.0,
            toVendorKm: 1.2,
            trafficDelayMinutes: 12,
            activeRidersInZone: 3,
            activeOrdersInZone: 8,
            weatherCondition: WeatherCondition.rain,
            batchPosition: 2,
            orderFoodPayablePoisha: 30000,
            isPriority: false,
          ),
        ).riderFarePoisha,
        11172,
      );
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.bicycle,
            travelDistanceKm: 4.1,
            toVendorKm: 0.8,
            trafficDelayMinutes: 7,
            activeRidersInZone: 2,
            activeOrdersInZone: 3,
            weatherCondition: WeatherCondition.extremeHeat,
            batchPosition: 1,
            orderFoodPayablePoisha: 30000,
            isPriority: false,
          ),
        ).riderFarePoisha,
        6061,
      );
      expect(
        calculateRiderFare(
          const FareInputs(
            vehicleType: RiderVehicleType.motorbike,
            travelDistanceKm: 12.5,
            toVendorKm: 2.0,
            trafficDelayMinutes: 3,
            activeRidersInZone: 6,
            activeOrdersInZone: 4,
            weatherCondition: WeatherCondition.clear,
            batchPosition: 1,
            orderFoodPayablePoisha: 54100,
            isPriority: false,
          ),
        ).riderFarePoisha,
        16300,
      );
    });
  });

  group('Responsive Scaffold & EN/BN Theme Tests (D-15, WEB-02)', () {
    for (final Size viewport in const <Size>[
      Size(240, 480),
      Size(360, 800),
      Size(800, 1280),
      Size(1440, 900),
    ]) {
      testWidgets('renders zero overflow at ${viewport.width.toInt()}px', (
        WidgetTester tester,
      ) async {
        tester.view.physicalSize = viewport;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        int selected = 0;
        await tester.pumpWidget(
          MaterialApp(
            locale: const Locale('bn'),
            supportedLocales: UndalSupportedLocales.all,
            localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
              UndalLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            theme: buildUndalTheme(
              brightness: Brightness.light,
              locale: const Locale('bn'),
            ),
            home: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                final l10n = UndalLocalizations.of(context);
                return UndalResponsiveScaffold(
                  title: l10n.t('app.name'),
                  selectedIndex: selected,
                  onDestinationSelected: (int next) =>
                      setState(() => selected = next),
                  destinations: <UndalNavItem>[
                    UndalNavItem(
                      icon: Icons.home_outlined,
                      selectedIcon: Icons.home,
                      label: l10n.t('nav.home'),
                    ),
                    UndalNavItem(
                      icon: Icons.receipt_long_outlined,
                      selectedIcon: Icons.receipt_long,
                      label: l10n.t('nav.orders'),
                    ),
                  ],
                  body: Center(child: Text(l10n.t('app.tagline'))),
                );
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('আসল খাবার। সত্যিকারের দ্রুত।'), findsOneWidget);
      });
    }
  });
}
