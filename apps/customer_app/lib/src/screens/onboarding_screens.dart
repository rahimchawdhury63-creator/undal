/// Onboarding & OpenStreetMap Address Pinning Screens (`c-01` .. `c-05`, `File 16 §16.1` & `File 14`).
///
/// Enforces `AP-4` unstacked permission priming:
/// - `c-01` Splash brand intro -> `c-02` 3-slide skippable Value Carousel -> `c-03` Location Prime
///   (single unobstructed prompt + manual map escape) -> `c-04` Interactive OSM Pin + live
///   `Sylhet Sadar` / `Kulaura` polygon verdict + Banglish landmark note -> `c-05` Notification Prime.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_models.dart';
import '../state/customer_controller.dart';

/// Renders the active `c-01..c-05` screen cleanly inside a responsive centered scaffold.
class CustomerOnboardingFlow extends StatefulWidget {
  const CustomerOnboardingFlow({
    super.key,
    required this.controller,
  });

  final CustomerController controller;

  @override
  State<CustomerOnboardingFlow> createState() => _CustomerOnboardingFlowState();
}

class _CustomerOnboardingFlowState extends State<CustomerOnboardingFlow> {
  final TextEditingController _searchLandmarkCtrl = TextEditingController();
  final TextEditingController _streetCtrl = TextEditingController(
    text: 'Zindabazar Water Works Rd, Sylhet',
  );
  final TextEditingController _landmarkCtrl = TextEditingController(
    text: 'Opposite Water Works blue gate, 3rd floor',
  );
  String _selectedLabel = 'Home';

  @override
  void dispose() {
    _searchLandmarkCtrl.dispose();
    _streetCtrl.dispose();
    _landmarkCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerController ctrl = widget.controller;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(
          '${UndalLocalizations.of(context).t('app.name')} · ${ctrl.activeOverlay.code.toUpperCase()}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: ctrl.toggleLocale,
            child: Text(
              UndalLocalizations.of(context).t('app.switch_language'),
            ),
          ),
          if (ctrl.activeOverlay != CustomerScreenId.c04AddressPin)
            TextButton(
              key: const ValueKey<String>('onboarding-skip-btn'),
              onPressed: ctrl.dismissOverlayToShell,
              child: Text(cText(context, 'Skip', 'এড়িয়ে যান')),
            ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: switch (ctrl.activeOverlay) {
              CustomerScreenId.c01Splash => _buildSplash(context, ctrl),
              CustomerScreenId.c02Carousel => _buildCarousel(context, ctrl),
              CustomerScreenId.c03LocationPrime =>
                _buildLocationPrime(context, ctrl),
              CustomerScreenId.c04AddressPin =>
                _buildOsmAddressPin(context, ctrl),
              CustomerScreenId.c05NotificationPrime =>
                _buildNotificationPrime(context, ctrl),
              _ => const SizedBox.shrink(),
            },
          ),
        ),
      ),
    );
  }

  Widget _buildSplash(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-01'),
      padding: const EdgeInsets.all(UndalSpacingTokens.xl),
      child: Column(
        children: <Widget>[
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: scheme.primary,
              borderRadius: BorderRadius.circular(UndalRadiusTokens.modal),
            ),
            child: Icon(
              Icons.ramen_dining_rounded,
              size: 46,
              color: semantic.sun,
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.lg),
          Text(
            UndalLocalizations.of(context).t('app.name'),
            textAlign: TextAlign.center,
            style: theme.textTheme.displaySmall,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            UndalLocalizations.of(context).t('app.tagline'),
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.xs),
          Text(
            UndalLocalizations.of(context).t('app.subtitle_food_only'),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
          FilledButton.icon(
            key: const ValueKey<String>('c01-get-started-btn'),
            onPressed: ctrl.advanceSplashToCarousel,
            icon: const Icon(Icons.arrow_forward),
            label: Text(
              cText(context, 'Get started', 'শুরু করুন'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCarousel(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final OnboardingSlideCopy slide = kOnboardingSlides[ctrl.carouselIndex];
    final String lang = Localizations.localeOf(context).languageCode;

    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-02'),
      padding: const EdgeInsets.all(UndalSpacingTokens.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            slide.stepBadge,
            style: theme.textTheme.labelSmall?.copyWith(color: scheme.primary),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            lang == 'bn' ? slide.titleBn : slide.titleEn,
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(
            lang == 'bn' ? slide.bodyBn : slide.bodyEn,
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: UndalSpacingTokens.lg),
          Wrap(
            spacing: UndalSpacingTokens.sm,
            children: List<Widget>.generate(3, (int idx) {
              final bool active = idx == ctrl.carouselIndex;
              return ChoiceChip(
                label: Text('${idx + 1}'),
                selected: active,
                onSelected: (_) => ctrl.setCarouselIndex(idx),
              );
            }),
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
          FilledButton(
            key: const ValueKey<String>('c02-next-btn'),
            onPressed: ctrl.advanceCarouselOrPrimeLocation,
            child: Text(
              ctrl.carouselIndex < 2
                  ? UndalLocalizations.of(context).t('common.continue')
                  : cText(
                      context,
                      'Set delivery area',
                      'ডেলিভারি এলাকা নির্বাচন করুন',
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocationPrime(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-03'),
      padding: const EdgeInsets.all(UndalSpacingTokens.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Icon(
            Icons.pin_drop_outlined,
            size: 52,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(
            cText(
              context,
              'Show open kitchens in your zone',
              'আপনার জোনের খোলা রান্নাঘরগুলো দেখুন',
            ),
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            cText(
              context,
              'Undal checks whether your street is inside Sylhet Sadar so riders arrive while food is piping hot.',
              'খাবার গরম থাকতে রাইডার পৌঁছাতে পারবে কি না তা নিশ্চিত করতে উন্দাল আপনার পিন যাচাই করে।',
            ),
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
          FilledButton.icon(
            key: const ValueKey<String>('c03-use-gps-btn'),
            onPressed: () =>
                ctrl.openAddressPinScreen(initialPoint: kSylhetSadarZone.center),
            icon: const Icon(Icons.my_location),
            label: Text(
              cText(
                context,
                'Use current GPS pin',
                'বর্তমান GPS লোকেশন ব্যবহার করুন',
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          OutlinedButton.icon(
            key: const ValueKey<String>('c03-manual-pin-btn'),
            onPressed: () => ctrl.openAddressPinScreen(),
            icon: const Icon(Icons.map_outlined),
            label: Text(
              cText(
                context,
                'Place pin on OpenStreetMap',
                'ম্যাপে নিজে পিন বসান',
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOsmAddressPin(BuildContext context, CustomerController ctrl) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final UndalSemanticColors semantic =
        theme.extension<UndalSemanticColors>()!;
    final String lang = Localizations.localeOf(context).languageCode;
    final ZoneResolutionVerdict verdict = ctrl.draftPinVerdict;

    final String verdictBannerText = verdict.inServiceArea
        ? cText(
            context,
            'Delivery available ✓ ${verdict.nameEn} (${encodePlusCode(ctrl.draftPin)})',
            'ডেলিভারি চালু আছে ✓ ${verdict.nameBn} (${encodePlusCode(ctrl.draftPin)})',
          )
        : (verdict.isInsidePausedExpansionZone
            ? cText(
                context,
                '${verdict.prelaunchZoneNameEn} pre-launch zone (paused) — nearest active zone ${verdict.nearestZoneNameEn} (${verdict.nearestDistanceKm} km)',
                '${verdict.prelaunchZoneNameBn} জোন শীঘ্রই চালু হচ্ছে — নিকটতম সক্রিয় জোন ${verdict.nearestZoneNameBn} (${toBengaliDigits('${verdict.nearestDistanceKm}')} কি.মি.)',
              )
            : cText(
                context,
                'Outside active zones — nearest ${verdict.nearestZoneNameEn} (${verdict.nearestDistanceKm} km)',
                'সক্রিয় জোনের বাইরে — নিকটতম ${verdict.nearestZoneNameBn} (${toBengaliDigits('${verdict.nearestDistanceKm}')} কি.মি.)',
              ));

    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-04'),
      padding: const EdgeInsets.all(UndalSpacingTokens.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TextField(
            key: const ValueKey<String>('c04-landmark-search-input'),
            controller: _searchLandmarkCtrl,
            onChanged: ctrl.filterLandmarks,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: cText(
                context,
                'Search Zindabazar, Amberkhana, SUST, Kulaura...',
                'জিন্দাবাজার, আম্বরখানা, শাবিপ্রবি, কুলাউড়া খুঁজুন...',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Wrap(
            spacing: UndalSpacingTokens.xs,
            runSpacing: UndalSpacingTokens.xs,
            children: ctrl.landmarkSuggestions.take(5).map((
              GeoPlaceSuggestion place,
            ) {
              return ActionChip(
                key: ValueKey<String>('preset-pin-${place.point.lat}'),
                avatar: const Icon(Icons.place_outlined, size: 16),
                label: Text(place.title(lang)),
                onPressed: () {
                  _streetCtrl.text = place.title(lang);
                  ctrl.updateDraftPin(place.point);
                },
              );
            }).toList(),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          SizedBox(
            height: 220,
            child: UndalOsmMap(
              center: ctrl.draftPin,
              showCenterPin: true,
              tileProxyBaseUrl: ctrl.api.config.effectiveTileProxyUrl,
              onCenterChanged: ctrl.updateDraftPin,
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Container(
            key: const ValueKey<String>('c04-zone-verdict-banner'),
            padding: const EdgeInsets.all(UndalSpacingTokens.md),
            decoration: BoxDecoration(
              color: verdict.inServiceArea
                  ? semantic.successSoft
                  : semantic.warningSoft,
              borderRadius: BorderRadius.circular(UndalRadiusTokens.card),
            ),
            child: Row(
              children: <Widget>[
                Icon(
                  verdict.inServiceArea
                      ? Icons.check_circle_outline
                      : Icons.info_outline,
                  color:
                      verdict.inServiceArea ? semantic.success : semantic.warning,
                ),
                const SizedBox(width: UndalSpacingTokens.sm),
                Expanded(
                  child: Text(
                    verdictBannerText,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          Wrap(
            spacing: UndalSpacingTokens.xs,
            children: <String>['Home', 'Work', 'Campus'].map((String label) {
              return ChoiceChip(
                label: Text(label),
                selected: _selectedLabel == label,
                onSelected: (_) => setState(() => _selectedLabel = label),
              );
            }).toList(),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          TextField(
            controller: _streetCtrl,
            decoration: InputDecoration(
              labelText: cText(
                context,
                'House / Road / Area',
                'বাসা / রোড / এলাকা',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          TextField(
            key: const ValueKey<String>('c04-landmark-note-input'),
            controller: _landmarkCtrl,
            decoration: InputDecoration(
              labelText: cText(
                context,
                'Landmark & floor note for rider (Banglish welcome)',
                'রাইডারের জন্য ল্যান্ডমার্ক ও ফ্লোর নোট',
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          FilledButton.icon(
            key: const ValueKey<String>('c04-confirm-pin-btn'),
            onPressed: () => ctrl.savePinnedAddress(
              label: _selectedLabel,
              streetAddress: _streetCtrl.text,
              landmarkNote: _landmarkCtrl.text,
              proceedToNotificationPrime: !ctrl.notificationsEnabled,
            ),
            icon: const Icon(Icons.check),
            label: Text(
              cText(context, 'Save pin & continue', 'পিন সংরক্ষণ করুন'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationPrime(
    BuildContext context,
    CustomerController ctrl,
  ) {
    final ThemeData theme = Theme.of(context);
    return SingleChildScrollView(
      key: const ValueKey<String>('screen-c-05'),
      padding: const EdgeInsets.all(UndalSpacingTokens.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Icon(
            Icons.notifications_active_outlined,
            size: 52,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(height: UndalSpacingTokens.md),
          Text(
            cText(
              context,
              'Live rider arrival & kitchen status updates',
              'রাইডার পৌঁছানো ও খাবারের লাইভ আপডেট পান',
            ),
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          Text(
            cText(
              context,
              'Only real order milestones and opted-in Flash Box alerts — quiet hours respected (23:00–08:00).',
              'শুধুমাত্র অর্ডারের ধাপ ও আপনার পছন্দের ফ্ল্যাশ বক্স আপডেট — রাত ১১টা থেকে সকাল ৮টা নীরব থাকে।',
            ),
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: UndalSpacingTokens.xl),
          FilledButton(
            key: const ValueKey<String>('c05-enable-notifications-btn'),
            onPressed: () => ctrl.completeNotificationPrime(enabled: true),
            child: Text(
              cText(context, 'Turn on order alerts', 'অর্ডার আপডেট চালু করুন'),
            ),
          ),
          const SizedBox(height: UndalSpacingTokens.sm),
          OutlinedButton(
            key: const ValueKey<String>('c05-not-now-btn'),
            onPressed: () => ctrl.completeNotificationPrime(enabled: false),
            child: Text(cText(context, 'Not now', 'এখন নয়')),
          ),
        ],
      ),
    );
  }
}
