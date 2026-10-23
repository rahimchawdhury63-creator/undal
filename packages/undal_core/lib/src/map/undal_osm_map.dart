/// Reusable OpenStreetMap Slippy-Tile, Zone-Polygon & Interactive Pin Canvas (`File 14 §§14.1–14.4`).
///
/// Renders cached `W1 /v1/tiles/{z}/{x}/{y}.png` OpenStreetMap raster tiles (when `tileProxyBaseUrl`
/// is active) over [UndalVectorBasemapPainter], `>= 48dp` interactive pins, centre Bowl-Pin crosshair,
/// accessible `+/-` zoom controls, and mandatory `"© OpenStreetMap contributors"` attribution.
library;

import 'package:flutter/material.dart';

import '../geo/undal_geo.dart';
import '../theme/undal_theme.dart';
import '../tokens/undal_tokens.dart';
import 'undal_osm_painter.dart';

/// Interactive pin rendered on an [UndalOsmMap] viewport.
final class UndalMapMarker {
  const UndalMapMarker({
    required this.id,
    required this.point,
    required this.label,
    this.subtitle,
    this.selected = false,
    this.isHomeKitchen = false,
    this.onTap,
  });

  final String id;
  final GeoPoint point;
  final String label;
  final String? subtitle;
  final bool selected;
  final bool isHomeKitchen;
  final VoidCallback? onTap;
}

/// Interactive OpenStreetMap surface shared across `customer_app`, `partner_app`, and `rider_app`.
class UndalOsmMap extends StatefulWidget {
  const UndalOsmMap({
    super.key,
    required this.center,
    this.zoom = 14.0,
    this.zones = kSeededUndalZones,
    this.markers = const <UndalMapMarker>[],
    this.showCenterPin = false,
    this.tileProxyBaseUrl,
    this.onCenterChanged,
    this.onZoomChanged,
  });

  final GeoPoint center;
  final double zoom;
  final List<UndalZonePolygon> zones;
  final List<UndalMapMarker> markers;
  final bool showCenterPin;
  final String? tileProxyBaseUrl;
  final ValueChanged<GeoPoint>? onCenterChanged;
  final ValueChanged<double>? onZoomChanged;

  @override
  State<UndalOsmMap> createState() => _UndalOsmMapState();
}

class _UndalOsmMapState extends State<UndalOsmMap> {
  late double _zoom = widget.zoom.clamp(10.0, 18.0);
  Offset? _lastPanPosition;

  @override
  void didUpdateWidget(covariant UndalOsmMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if ((oldWidget.zoom - widget.zoom).abs() > 0.01) {
      _zoom = widget.zoom.clamp(10.0, 18.0);
    }
  }

  void _stepZoom(double delta) {
    final double next = (_zoom + delta).clamp(10.0, 18.0);
    if ((next - _zoom).abs() < 0.001) return;
    setState(() => _zoom = next);
    widget.onZoomChanged?.call(next);
  }

  void _panByPixels(Offset deltaPx) {
    final ValueChanged<GeoPoint>? cb = widget.onCenterChanged;
    if (cb == null) return;
    final (double cx, double cy) = latLngToWorldPx(widget.center, _zoom);
    cb(worldPxToLatLng(cx - deltaPx.dx, cy - deltaPx.dy, _zoom));
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final bool isDark = theme.brightness == Brightness.dark;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width =
            constraints.maxWidth.isFinite ? constraints.maxWidth : 360;
        final double height =
            constraints.maxHeight.isFinite ? constraints.maxHeight : 280;
        final Size viewport = Size(width, height);
        final (double centerWorldX, double centerWorldY) =
            latLngToWorldPx(widget.center, _zoom);

        Offset projectPoint(GeoPoint pt) {
          final (double px, double py) = latLngToWorldPx(pt, _zoom);
          return Offset(
            width / 2 + (px - centerWorldX),
            height / 2 + (py - centerWorldY),
          );
        }

        return ClipRRect(
          borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
          child: Semantics(
            label:
                'OpenStreetMap (${widget.center.lat.toStringAsFixed(4)}, ${widget.center.lng.toStringAsFixed(4)})',
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onDoubleTap: () => _stepZoom(1.0),
              onPanStart: (DragStartDetails d) =>
                  _lastPanPosition = d.localPosition,
              onPanUpdate: (DragUpdateDetails d) {
                final Offset prev = _lastPanPosition ?? d.localPosition;
                _lastPanPosition = d.localPosition;
                _panByPixels(d.localPosition - prev);
              },
              onPanEnd: (_) => _lastPanPosition = null,
              child: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  CustomPaint(
                    size: viewport,
                    painter: UndalVectorBasemapPainter(
                      center: widget.center,
                      zoom: _zoom,
                      zones: widget.zones,
                      isDark: isDark,
                      primaryGreen: scheme.primary,
                      warning: semantic.warning,
                      info: semantic.info,
                      canvasBg: theme.scaffoldBackgroundColor,
                      gridStroke: scheme.outline,
                    ),
                  ),
                  if (widget.tileProxyBaseUrl != null &&
                      widget.tileProxyBaseUrl!.isNotEmpty)
                    ..._buildOsmTiles(
                      viewport: viewport,
                      baseUrl: widget.tileProxyBaseUrl!,
                      isDark: isDark,
                    ),
                  for (final UndalMapMarker marker in widget.markers)
                    _buildMarkerWidget(
                      marker: marker,
                      offset: projectPoint(marker.point),
                      viewport: viewport,
                      scheme: scheme,
                      semantic: semantic,
                    ),
                  if (widget.showCenterPin) _buildCenterPin(scheme),
                  Positioned(
                    right: UndalSpacingTokens.sm,
                    top: UndalSpacingTokens.sm,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        _ZoomButton(
                          key: const ValueKey<String>('undal-map-zoom-in'),
                          icon: Icons.add,
                          tooltip: 'Zoom in',
                          onPressed: () => _stepZoom(1.0),
                        ),
                        const SizedBox(height: UndalSpacingTokens.xs),
                        _ZoomButton(
                          key: const ValueKey<String>('undal-map-zoom-out'),
                          icon: Icons.remove,
                          tooltip: 'Zoom out',
                          onPressed: () => _stepZoom(-1.0),
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    left: UndalSpacingTokens.sm,
                    bottom: UndalSpacingTokens.xs,
                    child: IgnorePointer(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: UndalSpacingTokens.sm,
                          vertical: UndalSpacingTokens.xxs,
                        ),
                        decoration: BoxDecoration(
                          color: scheme.surface.withValues(alpha: 0.88),
                          borderRadius:
                              BorderRadius.circular(UndalRadiusTokens.xs),
                        ),
                        child: Text(
                          '© OpenStreetMap contributors',
                          style: theme.textTheme.labelSmall,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildCenterPin(ColorScheme scheme) {
    return IgnorePointer(
      child: Center(
        child: Transform.translate(
          offset: const Offset(0, -18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(UndalSpacingTokens.xs),
                decoration: BoxDecoration(
                  color: scheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.location_on,
                  key: const ValueKey<String>('undal-map-center-pin'),
                  color: scheme.onPrimary,
                  size: 26,
                ),
              ),
              Container(
                width: 8,
                height: 4,
                decoration: BoxDecoration(
                  color: scheme.onSurface.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _buildOsmTiles({
    required Size viewport,
    required String baseUrl,
    required bool isDark,
  }) {
    final int z = _zoom.round().clamp(10, 18);
    final int maxTile = (1 << z) - 1;
    final (double cx, double cy) =
        latLngToWorldPx(widget.center, z.toDouble());
    final double leftPx = cx - viewport.width / 2;
    final double topPx = cy - viewport.height / 2;
    final int minTileX = (leftPx / 256.0).floor();
    final int maxTileX = ((leftPx + viewport.width) / 256.0).floor();
    final int minTileY = (topPx / 256.0).floor().clamp(0, maxTile);
    final int maxTileY =
        ((topPx + viewport.height) / 256.0).floor().clamp(0, maxTile);
    final String trimmed = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;

    final List<Widget> tiles = <Widget>[];
    for (int tx = minTileX; tx <= maxTileX; tx++) {
      final int wrappedX = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
      for (int ty = minTileY; ty <= maxTileY; ty++) {
        Widget img = Image.network(
          '$trimmed/v1/tiles/$z/$wrappedX/$ty.png',
          width: 256,
          height: 256,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
        );
        if (isDark) img = Opacity(opacity: 0.72, child: img);
        tiles.add(
          Positioned(
            left: tx * 256.0 - leftPx,
            top: ty * 256.0 - topPx,
            width: 256,
            height: 256,
            child: IgnorePointer(child: img),
          ),
        );
      }
    }
    return tiles;
  }

  Widget _buildMarkerWidget({
    required UndalMapMarker marker,
    required Offset offset,
    required Size viewport,
    required ColorScheme scheme,
    required UndalSemanticColors semantic,
  }) {
    if (offset.dx < -80 ||
        offset.dx > viewport.width + 80 ||
        offset.dy < -60 ||
        offset.dy > viewport.height + 60) {
      return const SizedBox.shrink();
    }
    final Color bg = marker.selected
        ? semantic.flame
        : (marker.isHomeKitchen ? semantic.success : scheme.primary);
    final Color fg = marker.selected ? semantic.onFlame : scheme.onPrimary;

    return Positioned(
      left: offset.dx - 56,
      top: offset.dy - 24,
      width: 112,
      child: Center(
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
            onTap: marker.onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: UndalSpacingTokens.sm,
                    vertical: UndalSpacingTokens.xs,
                  ),
                  decoration: BoxDecoration(
                    color: bg,
                    borderRadius:
                        BorderRadius.circular(UndalRadiusTokens.pill),
                    border: Border.all(color: scheme.surface, width: 1.5),
                  ),
                  child: Text(
                    marker.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: fg,
                      fontSize: UndalTypographyTokens.xs,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ZoomButton extends StatelessWidget {
  const _ZoomButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      elevation: 2,
      borderRadius: BorderRadius.circular(UndalRadiusTokens.sm),
      child: IconButton(
        tooltip: tooltip,
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        onPressed: onPressed,
        icon: Icon(icon, color: scheme.onSurface),
      ),
    );
  }
}
