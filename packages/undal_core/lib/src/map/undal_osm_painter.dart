/// Vector OpenStreetMap Cartography & Delivery Polygon Painter (`File 14 §§14.1, 14.4`).
///
/// Renders coordinate-projected grid lines, Sylhet's Surma River trace, active UNDAL emerald
/// service polygons (`Sylhet Sadar`), and pre-configured amber expansion polygons (`Kulaura`).
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../geo/undal_geo.dart';

/// High-frame-rate `CustomPainter` rendering projected zone rings and offline vector cartography.
final class UndalVectorBasemapPainter extends CustomPainter {
  const UndalVectorBasemapPainter({
    required this.center,
    required this.zoom,
    required this.zones,
    required this.isDark,
    required this.primaryGreen,
    required this.warning,
    required this.info,
    required this.canvasBg,
    required this.gridStroke,
  });

  final GeoPoint center;
  final double zoom;
  final List<UndalZonePolygon> zones;
  final bool isDark;
  final Color primaryGreen;
  final Color warning;
  final Color info;
  final Color canvasBg;
  final Color gridStroke;

  static const List<GeoPoint> _surmaRiverTrace = <GeoPoint>[
    GeoPoint(24.8832, 91.8150),
    GeoPoint(24.8878, 91.8420),
    GeoPoint(24.8895, 91.8685),
    GeoPoint(24.8860, 91.8920),
    GeoPoint(24.8915, 91.9250),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = canvasBg);

    final (double cx, double cy) = latLngToWorldPx(center, zoom);
    Offset project(GeoPoint p) {
      final (double px, double py) = latLngToWorldPx(p, zoom);
      return Offset(size.width / 2 + (px - cx), size.height / 2 + (py - cy));
    }

    final Paint gridPaint = Paint()
      ..color = gridStroke.withValues(alpha: isDark ? 0.35 : 0.55)
      ..strokeWidth = 1.0;
    const double step = 64.0;
    final double startX = -(cx % step);
    final double startY = -(cy % step);
    for (double x = startX; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
    }
    for (double y = startY; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final Path riverPath = Path();
    for (int i = 0; i < _surmaRiverTrace.length; i++) {
      final Offset o = project(_surmaRiverTrace[i]);
      if (i == 0) {
        riverPath.moveTo(o.dx, o.dy);
      } else {
        riverPath.lineTo(o.dx, o.dy);
      }
    }
    canvas.drawPath(
      riverPath,
      Paint()
        ..color = info.withValues(alpha: isDark ? 0.32 : 0.22)
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = math.max(6.0, zoom - 4.0),
    );

    for (final UndalZonePolygon z in zones) {
      if (z.ring.length < 3) continue;
      final Path poly = Path();
      for (int i = 0; i < z.ring.length; i++) {
        final Offset o = project(z.ring[i]);
        if (i == 0) {
          poly.moveTo(o.dx, o.dy);
        } else {
          poly.lineTo(o.dx, o.dy);
        }
      }
      poly.close();
      final Color stroke = z.isActive ? primaryGreen : warning;
      canvas.drawPath(
        poly,
        Paint()
          ..color = stroke.withValues(alpha: z.isActive ? 0.14 : 0.10)
          ..style = PaintingStyle.fill,
      );
      canvas.drawPath(
        poly,
        Paint()
          ..color = stroke.withValues(alpha: 0.78)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.0,
      );
    }
  }

  @override
  bool shouldRepaint(covariant UndalVectorBasemapPainter old) =>
      old.center != center ||
      old.zoom != zoom ||
      old.isDark != isDark ||
      old.zones != zones;
}
