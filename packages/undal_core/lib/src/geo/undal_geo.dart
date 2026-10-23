/// Canonical UNDAL Geospatial, Delivery Zone Polygon, Plus-Code & Slippy-Tile Engine
/// (`Master Guide File 14 §§14.1–14.4` & `0005_zones_and_vendors.sql` / `0007_catalog_search_rpcs.sql`).
///
/// Shared across `customer_app`, `partner_app`, and `rider_app`:
/// - Ray-casting `pointInPolygon` and `resolveZoneLocal` matching PostgreSQL `public.resolve_zone()`.
/// - Open Location Code (`Plus Code`, e.g. `7MQHWVXX+XX` / `WVXX+XX`) encoder for landmark-first BD addresses.
/// - Spherical Web Mercator (`EPSG:3857`) projection helpers for `UndalOsmMap` (`z = 3..19`).
library;

import 'dart:math' as math;

/// Immutable WGS-84 geographic coordinate pair (`latitude`, `longitude`).
final class GeoPoint {
  /// Creates a validated geographic coordinate pair.
  const GeoPoint(this.lat, this.lng);

  /// Latitude in degrees (`-90.0 .. +90.0`).
  final double lat;

  /// Longitude in degrees (`-180.0 .. +180.0`).
  final double lng;

  @override
  bool operator ==(Object other) =>
      other is GeoPoint &&
      (other.lat - lat).abs() < 1e-7 &&
      (other.lng - lng).abs() < 1e-7;

  @override
  int get hashCode => Object.hash(
        (lat * 1e6).round(),
        (lng * 1e6).round(),
      );

  @override
  String toString() =>
      'GeoPoint(${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)})';
}

/// Canonical delivery zone polygon matching `public.zones` (`0005_zones_and_vendors.sql`).
final class UndalZonePolygon {
  /// Creates a delivery zone definition with outer `[lng, lat]` ring vertices.
  const UndalZonePolygon({
    required this.id,
    required this.slug,
    required this.nameEn,
    required this.nameBn,
    required this.center,
    required this.isActive,
    required this.baseDeliveryFeePoisha,
    required this.freeDeliveryAbovePoisha,
    required this.maxDeliveryKm,
    required this.ring,
  });

  final String id;
  final String slug;
  final String nameEn;
  final String nameBn;
  final GeoPoint center;
  final bool isActive;
  final int baseDeliveryFeePoisha;
  final int freeDeliveryAbovePoisha;
  final double maxDeliveryKm;

  /// Closed polygon ring in `[GeoPoint(lat, lng), ...]` order.
  final List<GeoPoint> ring;

  /// Localized display name (`English` or `বাংলা`).
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;
}

/// Result of resolving a pin against active and pre-launch UNDAL delivery zones (`File 14 §14.2`).
final class ZoneResolutionVerdict {
  /// Creates a zone resolution verdict.
  const ZoneResolutionVerdict({
    required this.inServiceArea,
    required this.zoneId,
    required this.slug,
    required this.nameEn,
    required this.nameBn,
    required this.nearestZoneSlug,
    required this.nearestZoneNameEn,
    required this.nearestZoneNameBn,
    required this.nearestDistanceKm,
    this.prelaunchZoneSlug,
    this.prelaunchZoneNameEn,
    this.prelaunchZoneNameBn,
  });

  final bool inServiceArea;
  final String? zoneId;
  final String? slug;
  final String? nameEn;
  final String? nameBn;
  final String nearestZoneSlug;
  final String nearestZoneNameEn;
  final String nearestZoneNameBn;
  final double nearestDistanceKm;
  final String? prelaunchZoneSlug;
  final String? prelaunchZoneNameEn;
  final String? prelaunchZoneNameBn;

  /// Whether the coordinate falls inside a configured paused expansion zone (e.g. `Kulaura`).
  bool get isInsidePausedExpansionZone =>
      !inServiceArea && prelaunchZoneSlug != null;

  /// Parses the `/v1/zones/resolve` response envelope from `W1 undal-api`, enriching paused zones.
  factory ZoneResolutionVerdict.fromApiJson(
    Map<String, Object?> json, {
    required GeoPoint point,
    List<UndalZonePolygon> knownZones = kSeededUndalZones,
  }) {
    final bool active = json['in_service_area'] == true;
    final String nearestSlug =
        (json['nearest_zone_slug'] as String?) ?? 'sylhet-sadar';
    final UndalZonePolygon nearestZone = knownZones.firstWhere(
      (UndalZonePolygon z) => z.slug == nearestSlug,
      orElse: () => kSylhetSadarZone,
    );
    UndalZonePolygon? pausedHit;
    if (!active) {
      for (final UndalZonePolygon z in knownZones) {
        if (!z.isActive && pointInPolygon(point, z.ring)) {
          pausedHit = z;
          break;
        }
      }
    }
    return ZoneResolutionVerdict(
      inServiceArea: active,
      zoneId: json['zone_id'] as String?,
      slug: json['slug'] as String?,
      nameEn: json['name_en'] as String?,
      nameBn: json['name_bn'] as String?,
      nearestZoneSlug: nearestSlug,
      nearestZoneNameEn: nearestZone.nameEn,
      nearestZoneNameBn: nearestZone.nameBn,
      nearestDistanceKm:
          ((json['nearest_distance_km'] as num?) ?? 0).toDouble(),
      prelaunchZoneSlug: pausedHit?.slug,
      prelaunchZoneNameEn: pausedHit?.nameEn,
      prelaunchZoneNameBn: pausedHit?.nameBn,
    );
  }
}

/// Day-1 active `Sylhet Sadar` zone seeded in `0005_zones_and_vendors.sql`.
const UndalZonePolygon kSylhetSadarZone = UndalZonePolygon(
  id: '11111111-1111-4111-8111-111111111101',
  slug: 'sylhet-sadar',
  nameEn: 'Sylhet Sadar',
  nameBn: 'সিলেট সদর',
  center: GeoPoint(24.8949, 91.8687),
  isActive: true,
  baseDeliveryFeePoisha: 4000,
  freeDeliveryAbovePoisha: 69900,
  maxDeliveryKm: 12.0,
  ring: <GeoPoint>[
    GeoPoint(24.8650, 91.8150),
    GeoPoint(24.8650, 91.9250),
    GeoPoint(24.9380, 91.9250),
    GeoPoint(24.9380, 91.8150),
    GeoPoint(24.8650, 91.8150),
  ],
);

/// Pre-configured paused `Kulaura` expansion polygon seeded in `0005_zones_and_vendors.sql`.
const UndalZonePolygon kKulauraZone = UndalZonePolygon(
  id: '11111111-1111-4111-8111-111111111102',
  slug: 'kulaura',
  nameEn: 'Kulaura',
  nameBn: 'কুলাউড়া',
  center: GeoPoint(24.5186, 92.0336),
  isActive: false,
  baseDeliveryFeePoisha: 3500,
  freeDeliveryAbovePoisha: 59900,
  maxDeliveryKm: 10.0,
  ring: <GeoPoint>[
    GeoPoint(24.4900, 91.9950),
    GeoPoint(24.4900, 92.0750),
    GeoPoint(24.5520, 92.0750),
    GeoPoint(24.5520, 91.9950),
    GeoPoint(24.4900, 91.9950),
  ],
);

/// Default seeded zones matching `0005_zones_and_vendors.sql`.
const List<UndalZonePolygon> kSeededUndalZones = <UndalZonePolygon>[
  kSylhetSadarZone,
  kKulauraZone,
];

/// Great-circle Haversine distance in kilometres matching `public.haversine_km()`.
double haversineKm(GeoPoint a, GeoPoint b) {
  const double earthRadiusKm = 6371.0088;
  final double dLat = _degToRad(b.lat - a.lat);
  final double dLng = _degToRad(b.lng - a.lng);
  final double lat1 = _degToRad(a.lat);
  final double lat2 = _degToRad(b.lat);
  final double h = math.pow(math.sin(dLat / 2), 2).toDouble() +
      math.cos(lat1) * math.cos(lat2) * math.pow(math.sin(dLng / 2), 2).toDouble();
  return 2 * earthRadiusKm * math.asin(math.min(1.0, math.sqrt(h)));
}

/// Ray-casting point-in-polygon check matching `public.point_in_polygon()`.
bool pointInPolygon(GeoPoint point, List<GeoPoint> ring) {
  if (ring.length < 3) return false;
  bool inside = false;
  for (int i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    final double xi = ring[i].lng;
    final double yi = ring[i].lat;
    final double xj = ring[j].lng;
    final double yj = ring[j].lat;
    final bool intersect = ((yi > point.lat) != (yj > point.lat)) &&
        (point.lng <
            (xj - xi) * (point.lat - yi) / ((yj - yi) == 0 ? 1e-12 : (yj - yi)) +
                xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/// Approximates polygon area in square kilometres so smallest containing zone wins (`File 14 §14.4`).
double polygonAreaKm2(List<GeoPoint> ring) {
  if (ring.length < 3) return 0;
  final double midLatRad = _degToRad(ring.first.lat);
  final double kmPerDegLat = 110.574;
  final double kmPerDegLng = 111.320 * math.cos(midLatRad);
  double sum = 0;
  for (int i = 0; i < ring.length; i++) {
    final GeoPoint p1 = ring[i];
    final GeoPoint p2 = ring[(i + 1) % ring.length];
    sum += (p1.lng * kmPerDegLng) * (p2.lat * kmPerDegLat) -
        (p2.lng * kmPerDegLng) * (p1.lat * kmPerDegLat);
  }
  return sum.abs() / 2.0;
}

/// Deterministic local zone resolver matching `public.resolve_zone()` (`0007_catalog_search_rpcs.sql`).
ZoneResolutionVerdict resolveZoneLocal(
  GeoPoint point, {
  List<UndalZonePolygon> zones = kSeededUndalZones,
}) {
  final List<UndalZonePolygon> activeZones =
      zones.where((UndalZonePolygon z) => z.isActive).toList()
        ..sort(
          (UndalZonePolygon a, UndalZonePolygon b) =>
              polygonAreaKm2(a.ring).compareTo(polygonAreaKm2(b.ring)),
        );

  for (final UndalZonePolygon z in activeZones) {
    if (pointInPolygon(point, z.ring)) {
      return ZoneResolutionVerdict(
        inServiceArea: true,
        zoneId: z.id,
        slug: z.slug,
        nameEn: z.nameEn,
        nameBn: z.nameBn,
        nearestZoneSlug: z.slug,
        nearestZoneNameEn: z.nameEn,
        nearestZoneNameBn: z.nameBn,
        nearestDistanceKm: 0,
      );
    }
  }

  UndalZonePolygon? pausedHit;
  for (final UndalZonePolygon z in zones) {
    if (!z.isActive && pointInPolygon(point, z.ring)) {
      pausedHit = z;
      break;
    }
  }

  final UndalZonePolygon fallback =
      activeZones.isNotEmpty ? activeZones.first : kSylhetSadarZone;
  UndalZonePolygon nearest = fallback;
  double bestKm = haversineKm(point, fallback.center);
  for (final UndalZonePolygon z in activeZones.skip(1)) {
    final double d = haversineKm(point, z.center);
    if (d < bestKm) {
      bestKm = d;
      nearest = z;
    }
  }

  return ZoneResolutionVerdict(
    inServiceArea: false,
    zoneId: null,
    slug: null,
    nameEn: null,
    nameBn: null,
    nearestZoneSlug: nearest.slug,
    nearestZoneNameEn: nearest.nameEn,
    nearestZoneNameBn: nearest.nameBn,
    nearestDistanceKm: double.parse(bestKm.toStringAsFixed(2)),
    prelaunchZoneSlug: pausedHit?.slug,
    prelaunchZoneNameEn: pausedHit?.nameEn,
    prelaunchZoneNameBn: pausedHit?.nameBn,
  );
}

const List<String> _kOlcAlphabet = <String>[
  '2', '3', '4', '5', '6', '7', '8', '9', 'C', 'F',
  'G', 'H', 'J', 'M', 'P', 'Q', 'R', 'V', 'W', 'X',
];

/// Encodes [point] as a standard 10-digit Open Location Code (`Plus Code`, e.g. `7MQHWVXX+XX`)
/// and optionally returns the compact 6-char local form (`WVXX+XX`, matching screenshot `#22`).
String encodePlusCode(GeoPoint point, {bool shortForm = true}) {
  double lat = point.lat.clamp(-89.999999, 89.999999) + 90.0;
  double lng = ((point.lng + 180.0) % 360.0 + 360.0) % 360.0;

  final List<double> resolutions = <double>[20.0, 1.0, 0.05, 0.0025, 0.000125];
  final StringBuffer buf = StringBuffer();
  for (int i = 0; i < resolutions.length; i++) {
    final double res = resolutions[i];
    final int latDigit = (lat / res).floor().clamp(0, 19);
    final int lngDigit = (lng / res).floor().clamp(0, 19);
    lat -= latDigit * res;
    lng -= lngDigit * res;
    buf.write(_kOlcAlphabet[latDigit]);
    buf.write(_kOlcAlphabet[lngDigit]);
    if (i == 3) {
      buf.write('+');
    }
  }
  final String full = buf.toString();
  return shortForm ? full.substring(4) : full;
}

/// Converts a WGS-84 [point] to global pixel coordinates at [zoom] (`256px` OSM tiles).
(double, double) latLngToWorldPx(GeoPoint point, double zoom) {
  final double scale = 256.0 * math.pow(2.0, zoom);
  final double x = (point.lng + 180.0) / 360.0 * scale;
  final double sinLat = math.sin(_degToRad(point.lat.clamp(-85.0511, 85.0511)));
  final double y =
      (0.5 - math.log((1 + sinLat) / (1 - sinLat)) / (4 * math.pi)) * scale;
  return (x, y);
}

/// Inverse Web Mercator conversion from global pixel coordinates `(worldX, worldY)` at [zoom].
GeoPoint worldPxToLatLng(double worldX, double worldY, double zoom) {
  final double scale = 256.0 * math.pow(2.0, zoom);
  final double lng = ((worldX / scale) * 360.0 - 180.0).clamp(-180.0, 180.0);
  final double n = math.pi - 2.0 * math.pi * (worldY / scale);
  final double lat =
      (180.0 / math.pi * math.atan(0.5 * (math.exp(n) - math.exp(-n))))
          .clamp(-85.0511, 85.0511);
  return GeoPoint(
    double.parse(lat.toStringAsFixed(6)),
    double.parse(lng.toStringAsFixed(6)),
  );
}

double _degToRad(double deg) => deg * (math.pi / 180.0);
