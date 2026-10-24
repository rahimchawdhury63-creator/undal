/// Public menu item, option, variant, and bundle models (`Build Response 13`, `c-13..c-15`).
///
/// Money remains integer poisha throughout. Public media is accepted only from ImgBB; private
/// compliance assets are deliberately absent from these customer-facing models (`ADR-0006 v2`).
library;

import 'customer_models.dart';

/// One customer-visible menu choice with an integer-poisha delta.
final class StorefrontChoice {
  /// Creates a localized selectable menu choice.
  const StorefrontChoice({
    required this.id,
    required this.nameEn,
    required this.nameBn,
    required this.priceDeltaPoisha,
    this.available = true,
  });

  /// Stable database ID used in the server-validated selection payload.
  final String id;

  /// English customer-facing label.
  final String nameEn;

  /// Bengali customer-facing label.
  final String nameBn;

  /// Integer-poisha addition to the menu item's base price.
  final int priceDeltaPoisha;

  /// Whether the kitchen currently allows this choice.
  final bool available;

  /// Returns the label for the active locale.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Parses a public API row without exposing internal kitchen labels.
  factory StorefrontChoice.fromJson(Map<String, Object?> json) {
    return StorefrontChoice(
      id: _string(json['id']),
      nameEn: _string(json['name_en'], fallback: 'Choice'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'পছন্দ')),
      priceDeltaPoisha: _int(json['price_delta_poisha']),
      available: json['is_available'] == true,
    );
  }
}

/// A required/optional selection group with server-defined min/max limits.
final class StorefrontChoiceGroup {
  /// Creates a bounded customer option group.
  const StorefrontChoiceGroup({
    required this.id,
    required this.nameEn,
    required this.nameBn,
    required this.minSelect,
    required this.maxSelect,
    required this.choices,
  });

  /// Stable database group ID.
  final String id;

  /// English customer prompt.
  final String nameEn;

  /// Bengali customer prompt.
  final String nameBn;

  /// Minimum number of selected options.
  final int minSelect;

  /// Maximum number of selected options.
  final int maxSelect;

  /// Choices currently returned by the public storefront API.
  final List<StorefrontChoice> choices;

  /// Returns the localized group prompt.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Parses a group and its public options, clamping malformed limits defensively.
  factory StorefrontChoiceGroup.fromJson(Map<String, Object?> json) {
    final List<StorefrontChoice> choices = _maps(json['options'])
        .map(StorefrontChoice.fromJson)
        .toList(growable: false);
    final int max = _int(json['max_select'], fallback: 1).clamp(1, 50);
    return StorefrontChoiceGroup(
      id: _string(json['id']),
      nameEn: _string(json['name_en'], fallback: 'Options'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'পছন্দ')),
      minSelect: _int(json['min_select']).clamp(0, max),
      maxSelect: max,
      choices: choices,
    );
  }
}

/// A portion or size choice priced relative to the dish base.
final class StorefrontVariantGroup {
  /// Creates a menu variant group.
  const StorefrontVariantGroup({
    required this.id,
    required this.nameEn,
    required this.nameBn,
    required this.minSelect,
    required this.maxSelect,
    required this.variants,
  });

  /// Stable database group ID.
  final String id;

  /// English customer prompt.
  final String nameEn;

  /// Bengali customer prompt.
  final String nameBn;

  /// Minimum number of selected variants.
  final int minSelect;

  /// Maximum number of selected variants.
  final int maxSelect;

  /// Choices currently available for selection.
  final List<StorefrontChoice> variants;

  /// Returns the localized group prompt.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Parses a variant group and its public variants.
  factory StorefrontVariantGroup.fromJson(Map<String, Object?> json) {
    final List<StorefrontChoice> variants = _maps(json['variants'])
        .map(StorefrontChoice.fromJson)
        .toList(growable: false);
    final int max = _int(json['max_select'], fallback: 1).clamp(1, 50);
    return StorefrontVariantGroup(
      id: _string(json['id']),
      nameEn: _string(json['name_en'], fallback: 'Size'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'পরিমাণ')),
      minSelect: _int(json['min_select'], fallback: 1).clamp(0, max),
      maxSelect: max,
      variants: variants,
    );
  }
}

/// A meal choice inside a configurable bundle slot.
final class BundleSlotChoice {
  /// Creates a bundle choice from the owning kitchen's menu.
  const BundleSlotChoice({
    required this.itemId,
    required this.nameEn,
    required this.nameBn,
    required this.priceDeltaPoisha,
    required this.available,
  });

  /// Menu-item ID checked against the selected bundle slot by W1.
  final String itemId;

  /// English choice name.
  final String nameEn;

  /// Bengali choice name.
  final String nameBn;

  /// Integer-poisha bundle price delta.
  final int priceDeltaPoisha;

  /// Whether the menu choice is currently orderable.
  final bool available;

  /// Returns the localized choice name.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Parses a database bundle-slot choice and its joined menu-item display row.
  factory BundleSlotChoice.fromJson(Map<String, Object?> json) {
    return BundleSlotChoice(
      itemId: _string(json['item_id']),
      nameEn: _string(json['name_en'], fallback: 'Menu choice'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'মেনু পছন্দ')),
      priceDeltaPoisha: _int(json['price_delta_poisha']),
      available: json['is_orderable'] == true || json['is_available'] == true,
    );
  }
}

/// One required/min-max slot in a combo meal.
final class BundleSlot {
  /// Creates a bundle selection step.
  const BundleSlot({
    required this.id,
    required this.nameEn,
    required this.nameBn,
    required this.minPick,
    required this.maxPick,
    required this.choices,
  });

  /// Stable database slot ID.
  final String id;

  /// English slot title.
  final String nameEn;

  /// Bengali slot title.
  final String nameBn;

  /// Required minimum number of choices.
  final int minPick;

  /// Maximum number of choices.
  final int maxPick;

  /// Eligible same-kitchen dishes returned by the storefront API.
  final List<BundleSlotChoice> choices;

  /// Returns the localized slot title.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Parses a bundle slot and its server-approved choices.
  factory BundleSlot.fromJson(Map<String, Object?> json) {
    final List<BundleSlotChoice> choices = _maps(json['choices'])
        .map(BundleSlotChoice.fromJson)
        .toList(growable: false);
    final int max = _int(json['max_pick'], fallback: 1).clamp(1, 50);
    return BundleSlot(
      id: _string(json['id']),
      nameEn: _string(json['name_en'], fallback: 'Choose a meal'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'খাবার বাছুন')),
      minPick: _int(json['min_pick'], fallback: 1).clamp(0, max),
      maxPick: max,
      choices: choices,
    );
  }
}

/// Public menu item with its server-supplied modifier and bundle configuration.
final class StorefrontMenuItem {
  /// Creates a storefront item.
  const StorefrontMenuItem({
    required this.dish,
    this.itemType = 'simple',
    this.isOrderable = true,
    this.isLiveSnapshot = false,
    this.serves,
    this.halal = true,
    this.variantGroups = const <StorefrontVariantGroup>[],
    this.optionGroups = const <StorefrontChoiceGroup>[],
    this.bundleSlots = const <BundleSlot>[],
  });

  /// Base bilingual dish identity and VAT-inclusive base price.
  final CatalogDishItem dish;

  /// Database item type (`simple`, `sized`, or `bundle`).
  final String itemType;

  /// Server-derived operational availability from `is_menu_item_orderable_now`.
  final bool isOrderable;

  /// True only when the row was parsed from an authenticated/current W1 storefront snapshot.
  final bool isLiveSnapshot;

  /// Public serving size if supplied by the kitchen.
  final String? serves;

  /// Public halal declaration supplied by the kitchen.
  final bool halal;

  /// Portion/size groups.
  final List<StorefrontVariantGroup> variantGroups;

  /// Add-on groups with their min/max rules.
  final List<StorefrontChoiceGroup> optionGroups;

  /// Bundle choices, if this item is a combo.
  final List<BundleSlot> bundleSlots;

  /// Returns true for a database bundle item.
  bool get isBundle => itemType == 'bundle';

  /// Parses a public storefront item while rejecting non-ImgBB image URLs.
  factory StorefrontMenuItem.fromJson(
    Map<String, Object?> json, {
    required StorefrontVendorSummary vendor,
  }) {
    final String? candidateImage = _nullableString(json['image_url']);
    final String? image = candidateImage?.startsWith('https://i.ibb.co/') == true
        ? candidateImage
        : null;
    final CatalogDishItem dish = CatalogDishItem(
      id: _string(json['id']),
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorNameEn: vendor.nameEn,
      vendorNameBn: vendor.nameBn,
      nameEn: _string(json['name_en'], fallback: 'Dish'),
      nameBn: _string(json['name_bn'], fallback: _string(json['name_en'], fallback: 'খাবার')),
      descriptionEn: _string(json['description_en']),
      descriptionBn: _string(json['description_bn']),
      pricePoisha: _int(json['price_poisha']),
      compareAtPoisha: _nullableInt(json['compare_at_poisha']),
      imgbbUrl: image,
      spicyLevel: _int(json['spicy_level']).clamp(0, 3),
      isVeg: json['is_veg'] == true,
      isPopular: json['is_popular'] == true,
      banglishTokens: _string(json['search_text']),
    );
    return StorefrontMenuItem(
      dish: dish,
      itemType: _string(json['item_type'], fallback: 'simple'),
      isOrderable: json['is_orderable'] == true,
      isLiveSnapshot: true,
      serves: _nullableString(json['serves']),
      halal: json['halal'] != false,
      variantGroups: _maps(json['variant_groups'])
          .map(StorefrontVariantGroup.fromJson)
          .toList(growable: false),
      optionGroups: _maps(json['option_groups'])
          .map(StorefrontChoiceGroup.fromJson)
          .toList(growable: false),
      bundleSlots: _maps(json['bundle_slots'])
          .map(BundleSlot.fromJson)
          .toList(growable: false),
    );
  }

  /// Wraps the existing offline catalog without fabricating modifier groups or menu details.
  factory StorefrontMenuItem.fromCatalog(CatalogDishItem dish) {
    return StorefrontMenuItem(dish: dish);
  }
}

/// Customer-facing category in the storefront menu.
final class StorefrontCategory {
  /// Creates a menu category.
  const StorefrontCategory({
    required this.id,
    required this.nameEn,
    required this.nameBn,
    required this.items,
  });

  /// Stable category ID.
  final String id;

  /// English category label.
  final String nameEn;

  /// Bengali category label.
  final String nameBn;

  /// Menu items in stable server sort order.
  final List<StorefrontMenuItem> items;

  /// Returns the localized category label.
  String label(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;
}

/// Public non-sensitive summary of a kitchen's storefront profile.
final class StorefrontVendorSummary {
  /// Creates a privacy-filtered vendor summary.
  const StorefrontVendorSummary({
    required this.id,
    required this.slug,
    required this.nameEn,
    required this.nameBn,
    required this.vendorType,
    required this.publicAreaEn,
    required this.publicAreaBn,
    required this.hygieneVerified,
    required this.acceptsPickup,
    required this.ratingAverage,
    required this.ratingCount,
    required this.minOrderPoisha,
    required this.prepMinutes,
    this.pickupPointLabel,
    this.logoImgbbUrl,
    this.coverImgbbUrl,
    required this.operationalStatus,
  });

  /// Public vendor ID used by authenticated cart routes.
  final String id;

  /// Public link slug.
  final String slug;

  /// English brand name.
  final String nameEn;

  /// Bengali brand name.
  final String nameBn;

  /// Public kitchen track, without legal-name or owner details.
  final String vendorType;

  /// Coarse public service area, never a home-kitchen street address.
  final String publicAreaEn;

  /// Bengali coarse public service area.
  final String publicAreaBn;

  /// Whether the partner's hygiene checks are marked verified.
  final bool hygieneVerified;

  /// Whether QR-based counter pickup is enabled.
  final bool acceptsPickup;

  /// Public review aggregate.
  final double ratingAverage;

  /// Count of visible, moderated reviews.
  final int ratingCount;

  /// Server-enforced food subtotal minimum in poisha.
  final int minOrderPoisha;

  /// Kitchen prep estimate in minutes.
  final int prepMinutes;

  /// Coarse public counter label, only when pickup is enabled.
  final String? pickupPointLabel;

  /// Validated public ImgBB logo URL.
  final String? logoImgbbUrl;

  /// Validated public ImgBB cover URL.
  final String? coverImgbbUrl;

  /// Server-computed operational status, never inferred client-side.
  final String operationalStatus;

  /// Returns the localized brand name.
  String brandName(String localeCode) => localeCode == 'bn' ? nameBn : nameEn;

  /// Returns the localized public area.
  String publicArea(String localeCode) => localeCode == 'bn' ? publicAreaBn : publicAreaEn;

  /// Parses the privacy-filtered `public_vendor_cards` projection.
  factory StorefrontVendorSummary.fromJson(Map<String, Object?> json) {
    final String? logo = _nullableString(json['logo_url']);
    final String? cover = _nullableString(json['cover_url']);
    return StorefrontVendorSummary(
      id: _string(json['id']),
      slug: _string(json['slug']),
      nameEn: _string(json['brand_name'], fallback: 'Kitchen'),
      nameBn: _string(json['brand_name_bn'], fallback: _string(json['brand_name'], fallback: 'রান্নাঘর')),
      vendorType: _string(json['type'], fallback: 'RESTAURANT'),
      publicAreaEn: _string(json['public_area_label']),
      publicAreaBn: _string(json['public_area_label_bn'], fallback: _string(json['public_area_label'])),
      hygieneVerified: json['hygiene_verified'] == true,
      acceptsPickup: json['accepts_pickup'] == true,
      ratingAverage: _double(json['rating_avg']),
      ratingCount: _int(json['rating_count']),
      minOrderPoisha: _int(json['min_order_poisha']),
      prepMinutes: _int(json['avg_prep_min'], fallback: 20),
      pickupPointLabel: _nullableString(json['pickup_point_label']),
      logoImgbbUrl: logo?.startsWith('https://i.ibb.co/') == true ? logo : null,
      coverImgbbUrl: cover?.startsWith('https://i.ibb.co/') == true ? cover : null,
      operationalStatus: _string(json['operational_status'], fallback: 'unknown'),
    );
  }
}


List<Map<String, Object?>> _maps(Object? raw) => raw is List<Object?>
    ? raw.whereType<Map<String, Object?>>().toList(growable: false)
    : const <Map<String, Object?>>[];

String _string(Object? value, {String fallback = ''}) => value is String ? value : fallback;

String? _nullableString(Object? value) => value is String && value.trim().isNotEmpty ? value : null;

int _int(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

int? _nullableInt(Object? value) {
  if (value is int) return value;
  if (value is String) return int.tryParse(value);
  return null;
}

double _double(Object? value) => value is num ? value.toDouble() : 0;
