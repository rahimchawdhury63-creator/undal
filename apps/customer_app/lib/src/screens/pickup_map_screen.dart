/// Full-Screen Self-Pickup OpenStreetMap Explorer (`c-10`, `File 16 §16.2` & Screenshot `#33`).
///
/// Features:
/// - Interactive `UndalOsmMap` showing ONLY verified counter-pickup kitchens (`acceptsPickup == true`,
///   strictly excluding private `HOME_KITCHEN` residences per `Decision D-19`).
/// - Floating `"Search this area"` pill updating visible counters when panning the map.
/// - Bidirectional marker <-> bottom kitchen preview card sync with honest `Ready ~X min · Y m away` (`AP-8`).
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';

/// Full-screen interactive OpenStreetMap pickup discovery screen (`c-10`).
class CustomerPickupMapScreen extends StatelessWidget {
  const CustomerPickupMapScreen({
    super.key,
    required this.controller,
    required this.onSelectVendor,
  });

  final CustomerController controller;
  final ValueChanged<VendorFeedCard> onSelectVendor;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final String lang = Localizations.localeOf(context).languageCode;
    final List<VendorFeedCard> counters = controller.pickupMapVendors;
    final VendorFeedCard? activeVendor = counters
            .where(
              (VendorFeedCard v) => v.id == controller.selectedPickupVendorId,
            )
            .firstOrNull ??
        (counters.isNotEmpty ? counters.first : null);

    return Scaffold(
      key: const ValueKey<String>('screen-c-10'),
      appBar: AppBar(
        leading: IconButton(
          key: const ValueKey<String>('c10-back-btn'),
          tooltip: UndalLocalizations.of(context).t('common.cancel'),
          onPressed: controller.dismissOverlayToShell,
          icon: const Icon(Icons.arrow_back),
        ),
        title: Text(
          cText(
            context,
            'Self-Pickup Map · C-10',
            'পিকআপ ম্যাপ · C-10',
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: controller.toggleLocale,
            child: Text(
              UndalLocalizations.of(context).t('app.switch_language'),
            ),
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          UndalOsmMap(
            center: controller.pickupMapCenter,
            zoom: 14.5,
            tileProxyBaseUrl: controller.api.config.effectiveTileProxyUrl,
            onCenterChanged: controller.movePickupMapCamera,
            markers: counters
                .where((VendorFeedCard v) => v.pickupPoint != null)
                .map(
                  (VendorFeedCard v) => UndalMapMarker(
                    id: v.id,
                    point: v.pickupPoint!,
                    label: v.brandName(lang),
                    selected: activeVendor?.id == v.id,
                    onTap: () => controller.selectPickupMarker(v.id),
                  ),
                )
                .toList(),
          ),
          Positioned(
            top: UndalSpacingTokens.md,
            left: UndalSpacingTokens.md,
            right: 64,
            child: Align(
              alignment: Alignment.topLeft,
              child: FilledButton.icon(
                key: const ValueKey<String>('c10-search-area-btn'),
                onPressed: controller.searchPickupArea,
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(
                  cText(
                    context,
                    'Search area (${counters.length})',
                    'এখানে খুঁজুন (${toBengaliDigits('${counters.length}')})',
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ),
          if (activeVendor != null)
            Positioned(
              left: UndalSpacingTokens.md,
              right: UndalSpacingTokens.md,
              bottom: UndalSpacingTokens.lg,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: Card(
                    key: ValueKey<String>('c10-preview-${activeVendor.slug}'),
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(UndalRadiusTokens.card),
                      side: BorderSide(color: scheme.outline),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(UndalSpacingTokens.md),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            activeVendor.brandName(lang),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: UndalSpacingTokens.xxs),
                          Text(
                            formatPickupReadyAndDistance(
                              localeCode: lang,
                              prepMinutes: activeVendor.prepMinutes,
                              distanceMeters: activeVendor.pickupDistanceMeters,
                            ),
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: scheme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: UndalSpacingTokens.sm),
                          FilledButton(
                            key: const ValueKey<String>('c10-open-kitchen-btn'),
                            onPressed: () {
                              controller.dismissOverlayToShell();
                              onSelectVendor(activeVendor);
                            },
                            child: Text(
                              cText(
                                context,
                                'View counter menu',
                                'মেনু দেখুন',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
