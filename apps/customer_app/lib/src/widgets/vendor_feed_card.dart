/// Locked Vendor Card component for `c-08`, `c-09`, `c-10`, and `c-12` (`File 16 §16.2`).
///
/// Structural guarantees:
/// - `AP-6`: Authentic `ImgBB` cover image (`https://i.ibb.co/*`) or clean Undal monogram plate — zero stock photos.
/// - `AP-8`: Self-Pickup mode displays `Ready ~X min · Y m away` (never deceptive walking estimates).
/// - `AP-9`: 2-line title wrap so compound Sylheti/Bengali kitchen names never clip at 1 line.
/// - `D-12`: Zero `[Ad]` or `[Sponsored]` badges anywhere in card anatomy.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';

/// Renders a single ranked kitchen card in Delivery or Self-Pickup mode.
class VendorFeedCardTile extends StatelessWidget {
  const VendorFeedCardTile({
    super.key,
    required this.vendor,
    required this.fulfilmentMode,
    required this.isFavourite,
    required this.notifyArmed,
    required this.onTapCard,
    required this.onToggleFavourite,
    required this.onToggleNotifyOpen,
  });

  final VendorFeedCard vendor;
  final UndalFulfilmentMode fulfilmentMode;
  final bool isFavourite;
  final bool notifyArmed;
  final VoidCallback onTapCard;
  final VoidCallback onToggleFavourite;
  final VoidCallback onToggleNotifyOpen;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final String lang = Localizations.localeOf(context).languageCode;
    final bool isPickup = fulfilmentMode == UndalFulfilmentMode.pickup;

    final String trackLabel = switch (vendor.type) {
      VendorTrackType.homeKitchen =>
        cText(context, 'Home Kitchen', 'হোম কিচেন'),
      VendorTrackType.cloudKitchen =>
        cText(context, 'Cloud Kitchen', 'ক্লাউড কিচেন'),
      VendorTrackType.restaurant => cText(context, 'Restaurant', 'রেস্টুরেন্ট'),
    };

    final String timingMeta = isPickup
        ? formatPickupReadyAndDistance(
            localeCode: lang,
            prepMinutes: vendor.prepMinutes,
            distanceMeters: vendor.pickupDistanceMeters,
          )
        : (lang == 'bn'
            ? '${toBengaliDigits('${vendor.etaMinLow}-${vendor.etaMinHigh}')} মি. · ${vendor.priceTierSymbols}'
            : '${vendor.etaMinLow}-${vendor.etaMinHigh} min · ${vendor.priceTierSymbols}');

    return Opacity(
      opacity: vendor.isOpen ? 1.0 : 0.78,
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
          side: BorderSide(color: scheme.outline),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey<String>('vendor-card-${vendor.slug}'),
          onTap: onTapCard,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _buildCoverHeader(
                context: context,
                scheme: scheme,
                semantic: semantic,
                lang: lang,
                trackLabel: trackLabel,
              ),
              Padding(
                padding: const EdgeInsets.all(UndalSpacingTokens.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            vendor.brandName(lang),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: UndalSpacingTokens.xs),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: UndalSpacingTokens.sm,
                            vertical: UndalSpacingTokens.xxs,
                          ),
                          decoration: BoxDecoration(
                            color: semantic.sun.withValues(alpha: 0.25),
                            borderRadius:
                                BorderRadius.circular(UndalRadiusTokens.pill),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Icon(Icons.star_rounded,
                                  size: 16, color: semantic.onSun),
                              const SizedBox(width: 2),
                              Text(
                                lang == 'bn'
                                    ? '${toBengaliDigits(vendor.ratingAvg.toStringAsFixed(1))} (${toBengaliDigits('${vendor.ratingCount}')})'
                                    : '${vendor.ratingAvg.toStringAsFixed(1)} (${vendor.ratingCount})',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: scheme.onSurface,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: UndalSpacingTokens.xs),
                    Text(
                      '$timingMeta · ${vendor.publicArea(lang)}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: UndalSpacingTokens.xs),
                    _buildFeeOrClosedLine(
                      context: context,
                      theme: theme,
                      scheme: scheme,
                      semantic: semantic,
                      lang: lang,
                      isPickup: isPickup,
                    ),
                    if (vendor.offerPills(lang).isNotEmpty) ...<Widget>[
                      const SizedBox(height: UndalSpacingTokens.sm),
                      Wrap(
                        spacing: UndalSpacingTokens.xs,
                        runSpacing: UndalSpacingTokens.xs,
                        children: vendor
                            .offerPills(lang)
                            .map(
                              (String pill) => Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: UndalSpacingTokens.sm,
                                  vertical: UndalSpacingTokens.xxs,
                                ),
                                decoration: BoxDecoration(
                                  color: semantic.successSoft,
                                  borderRadius: BorderRadius.circular(
                                    UndalRadiusTokens.pill,
                                  ),
                                ),
                                child: Text(
                                  pill,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: semantic.success,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            )
                            .toList(),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCoverHeader({
    required BuildContext context,
    required ColorScheme scheme,
    required UndalSemanticColors semantic,
    required String lang,
    required String trackLabel,
  }) {
    final String initials = vendor
        .brandNameEn
        .split(' ')
        .where((String s) => s.isNotEmpty)
        .take(2)
        .map((String s) => s.substring(0, 1).toUpperCase())
        .join();
    final String? validCover = (vendor.coverImgbbUrl != null &&
            vendor.coverImgbbUrl!.startsWith('https://i.ibb.co/'))
        ? vendor.coverImgbbUrl
        : null;

    return SizedBox(
      height: 112,
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: <Color>[
                  scheme.primary.withValues(alpha: 0.90),
                  Color(UndalLightColors.greenDeep.argb),
                ],
              ),
            ),
            child: validCover != null
                ? Image.network(
                    validCover,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  )
                : Center(
                    child: Text(
                      initials,
                      style: TextStyle(
                        fontFamily: UndalTypographyTokens.fontDisplay,
                        fontSize: UndalTypographyTokens.xl,
                        fontWeight: FontWeight.w800,
                        color: scheme.onPrimary.withValues(alpha: 0.85),
                      ),
                    ),
                  ),
          ),
          Positioned(
            left: UndalSpacingTokens.sm,
            top: UndalSpacingTokens.sm,
            right: 56,
            child: Wrap(
              spacing: UndalSpacingTokens.xs,
              runSpacing: UndalSpacingTokens.xs,
              children: <Widget>[
                _CoverBadge(
                  text: trackLabel,
                  background: vendor.type == VendorTrackType.homeKitchen
                      ? semantic.sun
                      : scheme.surface.withValues(alpha: 0.92),
                  foreground: vendor.type == VendorTrackType.homeKitchen
                      ? semantic.onSun
                      : scheme.onSurface,
                ),
                if (vendor.flashDiscountPercent != null)
                  _CoverBadge(
                    text: lang == 'bn'
                        ? 'ফ্ল্যাশ -${toBengaliDigits('${vendor.flashDiscountPercent}')}%'
                        : 'Flash -${vendor.flashDiscountPercent}%',
                    background: semantic.flame,
                    foreground: semantic.onFlame,
                  ),
                if (vendor.isNewVendor)
                  _CoverBadge(
                    text: cText(context, 'New', 'নতুন'),
                    background: semantic.infoSoft,
                    foreground: semantic.info,
                  ),
              ],
            ),
          ),
          Positioned(
            right: UndalSpacingTokens.xs,
            top: UndalSpacingTokens.xs,
            child: Material(
              color: scheme.surface.withValues(alpha: 0.92),
              shape: const CircleBorder(),
              child: IconButton(
                key: ValueKey<String>('fav-btn-${vendor.slug}'),
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                tooltip: cText(context, 'Save favourite', 'পছন্দে রাখুন'),
                onPressed: onToggleFavourite,
                icon: Icon(
                  isFavourite ? Icons.favorite : Icons.favorite_border,
                  color: isFavourite ? semantic.danger : scheme.onSurface,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFeeOrClosedLine({
    required BuildContext context,
    required ThemeData theme,
    required ColorScheme scheme,
    required UndalSemanticColors semantic,
    required String lang,
    required bool isPickup,
  }) {
    if (!vendor.isOpen) {
      final String opensText = vendor.opensAtTimeLabel ?? '10:00';
      return Wrap(
        spacing: UndalSpacingTokens.sm,
        runSpacing: UndalSpacingTokens.xs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(
            lang == 'bn'
                ? 'বন্ধ আছে · খুলবে ${toBengaliDigits(opensText)}'
                : 'Closed · Opens $opensText',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: semantic.warning,
              fontWeight: FontWeight.w700,
            ),
          ),
          OutlinedButton.icon(
            key: ValueKey<String>('notify-open-${vendor.slug}'),
            onPressed: onToggleNotifyOpen,
            icon: Icon(
              notifyArmed
                  ? Icons.notifications_active
                  : Icons.notifications_none,
              size: 16,
            ),
            label: Text(
              notifyArmed
                  ? cText(context, 'Reminder set', 'রিমাইন্ডার চালু')
                  : cText(context, 'Notify me', 'খুললে জানান'),
            ),
          ),
        ],
      );
    }

    if (isPickup) {
      return Text(
        cText(
          context,
          'Pay cash at counter · ৳0 delivery fee',
          'কাউন্টারে নগদ দিন · ডেলিভারি ফি ৳০',
        ),
        style: theme.textTheme.bodyMedium?.copyWith(
          color: semantic.success,
          fontWeight: FontWeight.w600,
        ),
      );
    }

    if (vendor.isFreeDelivery) {
      return Wrap(
        spacing: UndalSpacingTokens.xs,
        children: <Widget>[
          if (vendor.standardDeliveryFeePoisha > 0)
            Text(
              formatBdt(vendor.standardDeliveryFeePoisha, localeCode: lang),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
                decoration: TextDecoration.lineThrough,
              ),
            ),
          Text(
            cText(context, 'Free delivery', 'ফ্রি ডেলিভারি'),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: semantic.success,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      );
    }

    return Text(
      lang == 'bn'
          ? 'ডেলিভারি ${formatBdt(vendor.deliveryFeePoisha, localeCode: lang)} · সর্বনিম্ন ${formatBdt(vendor.minOrderPoisha, localeCode: lang)}'
          : 'Delivery ${formatBdt(vendor.deliveryFeePoisha, localeCode: lang)} · Min ${formatBdt(vendor.minOrderPoisha, localeCode: lang)}',
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: theme.textTheme.bodyMedium,
    );
  }
}

class _CoverBadge extends StatelessWidget {
  const _CoverBadge({
    required this.text,
    required this.background,
    required this.foreground,
  });

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UndalSpacingTokens.sm,
        vertical: UndalSpacingTokens.xxs,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(UndalRadiusTokens.pill),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: foreground,
          fontSize: UndalTypographyTokens.xs,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
