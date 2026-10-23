import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  group('UndalGeo delivery polygon & Plus Code engine (File 14)', () {
    test('resolves active Sylhet Sadar, paused Kulaura, and outside-zone coordinates identically to SQL', () {
      final ZoneResolutionVerdict zindabazar =
          resolveZoneLocal(const GeoPoint(24.8949, 91.8687));
      expect(zindabazar.inServiceArea, isTrue);
      expect(zindabazar.slug, 'sylhet-sadar');
      expect(zindabazar.nameBn, 'সিলেট সদর');

      final ZoneResolutionVerdict kulaura =
          resolveZoneLocal(const GeoPoint(24.5186, 92.0336));
      expect(kulaura.inServiceArea, isFalse);
      expect(kulaura.isInsidePausedExpansionZone, isTrue);
      expect(kulaura.prelaunchZoneSlug, 'kulaura');
      expect(kulaura.nearestZoneSlug, 'sylhet-sadar');
      expect(kulaura.nearestDistanceKm, greaterThan(40.0));

      final String shortPlus =
          encodePlusCode(const GeoPoint(24.8949, 91.8687), shortForm: true);
      expect(shortPlus, matches(RegExp(r'^[23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2}$')));

      final (double wx, double wy) =
          latLngToWorldPx(const GeoPoint(24.8949, 91.8687), 14.0);
      final GeoPoint roundTrip = worldPxToLatLng(wx, wy, 14.0);
      expect((roundTrip.lat - 24.8949).abs(), lessThan(0.0001));
      expect((roundTrip.lng - 91.8687).abs(), lessThan(0.0001));
    });
  });

  testWidgets('UndalOsmMap renders OSM attribution, center pin, markers & pan/zoom', (
    WidgetTester tester,
  ) async {
    GeoPoint currentCenter = kSylhetSadarZone.center;
    bool markerTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        theme: buildUndalTheme(brightness: Brightness.light),
        home: Scaffold(
          body: SizedBox(
            width: 360,
            height: 300,
            child: StatefulBuilder(
              builder: (BuildContext context, StateSetter setState) {
                return UndalOsmMap(
                  center: currentCenter,
                  showCenterPin: true,
                  markers: <UndalMapMarker>[
                    UndalMapMarker(
                      id: 'v-1',
                      point: const GeoPoint(24.8960, 91.8695),
                      label: 'Panchini',
                      onTap: () => markerTapped = true,
                    ),
                  ],
                  onCenterChanged: (GeoPoint next) =>
                      setState(() => currentCenter = next),
                );
              },
            ),
          ),
        ),
      ),
    );

    expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('undal-map-center-pin')), findsOneWidget);
    await tester.tap(find.text('Panchini'));
    await tester.pump();
    expect(markerTapped, isTrue);

    final GeoPoint beforeDrag = currentCenter;
    await tester.dragFrom(const Offset(40, 40), const Offset(-120, -90));
    await tester.pump();
    expect(currentCenter, isNot(equals(beforeDrag)));
  });
}
