/// Strict JSON scalar, WGS-84, and OSRM-polyline parsers shared by customer experience models.
library;

import 'package:undal_core/undal_core.dart';

/// Parses a JSON object, or returns an immutable empty object for an absent field.
Map<String, Object?> customerJsonMap(Object? value) =>
    value is Map<String, Object?> ? value : const <String, Object?>{};

/// Parses an array of JSON objects, dropping malformed array members.
List<Map<String, Object?>> customerJsonMaps(Object? value) => value is List<Object?>
    ? value.whereType<Map<String, Object?>>().toList(growable: false)
    : const <Map<String, Object?>>[];

/// Reads a string value with a non-sensitive caller-provided fallback.
String customerJsonString(Object? value, {String fallback = ''}) =>
    value is String ? value : fallback;

/// Reads a non-empty string value; other values become null.
String? customerJsonNullableString(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;

/// Reads only exact, safe non-negative integer values used for poisha and counts.
int? customerExactInt(Object? value) {
  if (value is int && value >= 0) return value;
  if (value is String && RegExp(r'^\d+$').hasMatch(value)) return int.tryParse(value);
  return null;
}

/// Reads finite numeric coordinates and other non-money scalar values.
double? customerJsonDouble(Object? value) {
  final double? result = value is num ? value.toDouble() : double.tryParse('$value');
  return result != null && result.isFinite ? result : null;
}

/// Parses a WGS-84 point from W1/W2 scalar coordinates.
GeoPoint? customerGeoPoint(Object? latitude, Object? longitude) {
  final double? lat = customerJsonDouble(latitude);
  final double? lng = customerJsonDouble(longitude);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return GeoPoint(lat, lng);
}

/// Decodes an OSRM precision-5 polyline; malformed or out-of-range geometry returns an empty list.
List<GeoPoint> decodeCustomerRoutePolyline(String encoded) {
  final List<GeoPoint> points = <GeoPoint>[];
  int index = 0;
  int latitude = 0;
  int longitude = 0;
  while (index < encoded.length) {
    final List<int> pair = <int>[];
    for (int coordinate = 0; coordinate < 2; coordinate++) {
      int result = 0;
      int shift = 0;
      int byte;
      do {
        if (index >= encoded.length || shift > 30) return const <GeoPoint>[];
        byte = encoded.codeUnitAt(index++) - 63;
        if (byte < 0 || byte > 63) return const <GeoPoint>[];
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      pair.add((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
    }
    latitude += pair[0];
    longitude += pair[1];
    final double lat = latitude / 100000;
    final double lng = longitude / 100000;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return const <GeoPoint>[];
    points.add(GeoPoint(lat, lng));
  }
  return List<GeoPoint>.unmodifiable(points);
}
