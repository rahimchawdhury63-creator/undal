/// Customer identity, routing, and auth-intent domain models (`Appendix N`, `File 16`).
///
/// Mirrors the exact PostgreSQL 16 + `W1 undal-api` + `W2 undal-realtime` contracts:
/// - `HOME_KITCHEN` vendors never expose private street coordinates in delivery feeds (`D-19`).
/// - All money fields are integer poisha (`100 poisha == ৳1.00`, `File 10`).
/// - All public image URLs validate against Unlimited `ImgBB` (`https://i.ibb.co/*`, `ADR-0006 v2`).
library;

import 'package:undal_core/undal_core.dart';

export 'customer_screen_ids.dart';
part 'customer_commerce_intents.dart';

/// Kitchen track classification (`File 21` 3-track vendor onboarding).
enum VendorTrackType {
  restaurant('RESTAURANT'),
  homeKitchen('HOME_KITCHEN'),
  cloudKitchen('CLOUD_KITCHEN');

  const VendorTrackType(this.wire);
  final String wire;

  static VendorTrackType fromWire(String? raw) {
    return switch (raw?.toUpperCase()) {
      'HOME_KITCHEN' => VendorTrackType.homeKitchen,
      'CLOUD_KITCHEN' => VendorTrackType.cloudKitchen,
      _ => VendorTrackType.restaurant,
    };
  }
}

/// Ranking sort mode in `FilterSheet` (`File 13 §13.1` & `File 16 §16.2`).
enum FeedSortOption {
  recommended('recommended'),
  fastest('fastest'),
  nearest('nearest'),
  topRated('top_rated'),
  priceLowToHigh('price_low_high');

  const FeedSortOption(this.wire);
  final String wire;
}

/// Top discovery shortcut pills on `c-08` / `c-09` (`File 16 §16.2`).
enum HomeShortcutKind {
  all,
  offers,
  flashBox,
  newKitchens,
  homeKitchens,
  topRated,
  freeDelivery,
}

/// Search scope tabs on `c-11` / `c-12` (`File 16 §16.3`).
enum SearchScopeTab {
  all,
  kitchens,
  dishes,
}

/// Intercepted user action resumed immediately after `c-06` / `c-07` login (`File 16 §16.1`).
sealed class PendingAuthIntent {
  const PendingAuthIntent();
}

/// Resumes toggling favourite status on [vendorId] right after authentication completes.
final class FavouriteVendorIntent extends PendingAuthIntent {
  const FavouriteVendorIntent(this.vendorId);
  final String vendorId;
}

/// Resumes saving an address book entry right after authentication completes.
final class SaveAddressBookIntent extends PendingAuthIntent {
  const SaveAddressBookIntent(this.address);
  final SavedCustomerAddress address;
}

/// Explicit sign-in started from the Account tab or header without side-effect action.
final class DirectSignInIntent extends PendingAuthIntent {
  const DirectSignInIntent();
}

/// Authenticated customer session hydrated from Supabase GoTrue + `GET /v1/me`.
final class CustomerSession {
  const CustomerSession({
    required this.userId,
    required this.fullName,
    required this.phone,
    this.email,
    required this.accessToken,
    required this.authMethod,
  });

  final String userId;
  final String fullName;
  final String phone;
  final String? email;
  final String accessToken;
  final String authMethod;
}

/// Resumable 3-step `c-07` sign-up draft (`Credentials -> Profile -> Address & Landmark`).
final class SignUpDraft {
  const SignUpDraft({
    this.stepIndex = 0,
    this.phone = '',
    this.email = '',
    this.password = '',
    this.fullName = '',
    this.landmarkNote = '',
  });

  final int stepIndex;
  final String phone;
  final String email;
  final String password;
  final String fullName;
  final String landmarkNote;

  bool get hasProgress =>
      stepIndex > 0 ||
      phone.isNotEmpty ||
      email.isNotEmpty ||
      fullName.isNotEmpty ||
      landmarkNote.isNotEmpty;

  SignUpDraft copyWith({
    int? stepIndex,
    String? phone,
    String? email,
    String? password,
    String? fullName,
    String? landmarkNote,
  }) {
    return SignUpDraft(
      stepIndex: stepIndex ?? this.stepIndex,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      password: password ?? this.password,
      fullName: fullName ?? this.fullName,
      landmarkNote: landmarkNote ?? this.landmarkNote,
    );
  }
}

/// Customer delivery address with Plus Code, Banglish landmark note, and resolved zone verdict.
final class SavedCustomerAddress {
  const SavedCustomerAddress({
    required this.id,
    required this.label,
    required this.point,
    required this.plusCode,
    required this.addressText,
    required this.landmarkNote,
    required this.verdict,
    this.isDefault = false,
  });

  final String id;
  final String label;
  final GeoPoint point;
  final String plusCode;
  final String addressText;
  final String landmarkNote;
  final ZoneResolutionVerdict verdict;
  final bool isDefault;

  SavedCustomerAddress copyWith({
    String? label,
    GeoPoint? point,
    String? plusCode,
    String? addressText,
    String? landmarkNote,
    ZoneResolutionVerdict? verdict,
    bool? isDefault,
  }) {
    return SavedCustomerAddress(
      id: id,
      label: label ?? this.label,
      point: point ?? this.point,
      plusCode: plusCode ?? this.plusCode,
      addressText: addressText ?? this.addressText,
      landmarkNote: landmarkNote ?? this.landmarkNote,
      verdict: verdict ?? this.verdict,
      isDefault: isDefault ?? this.isDefault,
    );
  }
}

/// Reverse-geocoded or searched landmark candidate (`W2 /v1/geo/search` proxy).
final class GeoPlaceSuggestion {
  const GeoPlaceSuggestion({
    required this.titleEn,
    required this.titleBn,
    required this.subtitleEn,
    required this.subtitleBn,
    required this.point,
    required this.searchTokens,
  });

  final String titleEn;
  final String titleBn;
  final String subtitleEn;
  final String subtitleBn;
  final GeoPoint point;
  final String searchTokens;

  String title(String lang) => lang == 'bn' ? titleBn : titleEn;
  String subtitle(String lang) => lang == 'bn' ? subtitleBn : subtitleEn;
}

/// Taxonomy cuisine item with English, Bengali, and Banglish search tokens (`Appendix D`).
final class CuisineChipModel {
  const CuisineChipModel({
    required this.key,
    required this.nameEn,
    required this.nameBn,
    required this.monogram,
    required this.searchTokens,
  });

  final String key;
  final String nameEn;
  final String nameBn;
  final String monogram;
  final String searchTokens;

  String label(String lang) => lang == 'bn' ? nameBn : nameEn;
}

/// Public home campaign banner (`ADR-0006 v2`: only `https://i.ibb.co/*` ImgBB CDN URLs accepted).
final class HomeBannerModel {
  const HomeBannerModel({
    required this.id,
    required this.titleEn,
    required this.titleBn,
    required this.subtitleEn,
    required this.subtitleBn,
    required this.ctaEn,
    required this.ctaBn,
    required this.targetShortcut,
    this.imgbbUrl,
  });

  final String id;
  final String titleEn;
  final String titleBn;
  final String subtitleEn;
  final String subtitleBn;
  final String ctaEn;
  final String ctaBn;
  final HomeShortcutKind targetShortcut;
  final String? imgbbUrl;

  /// Validates `ADR-0006 v2` ImgBB-only rule before rendering network banner media.
  String? get verifiedImgbbUrl =>
      (imgbbUrl != null && imgbbUrl!.startsWith('https://i.ibb.co/'))
          ? imgbbUrl
          : null;
}

/// Active `Undal Flash Box` campaign window (`Decision D-11`).
final class FlashBoxWindow {
  const FlashBoxWindow({
    required this.id,
    required this.titleEn,
    required this.titleBn,
    required this.discountPercent,
    required this.remainingMinutes,
    required this.remainingSeconds,
  });

  final String id;
  final String titleEn;
  final String titleBn;
  final int discountPercent;
  final int remainingMinutes;
  final int remainingSeconds;
}

/// Menu item entry inside a vendor feed/search dataset.
final class CatalogDishItem {
  const CatalogDishItem({
    required this.id,
    required this.vendorId,
    required this.vendorSlug,
    required this.vendorNameEn,
    required this.vendorNameBn,
    required this.nameEn,
    required this.nameBn,
    required this.descriptionEn,
    required this.descriptionBn,
    required this.pricePoisha,
    this.compareAtPoisha,
    this.imgbbUrl,
    this.spicyLevel = 0,
    this.isVeg = false,
    this.isPopular = false,
    required this.banglishTokens,
  });

  final String id;
  final String vendorId;
  final String vendorSlug;
  final String vendorNameEn;
  final String vendorNameBn;
  final String nameEn;
  final String nameBn;
  final String descriptionEn;
  final String descriptionBn;
  final int pricePoisha;
  final int? compareAtPoisha;
  final String? imgbbUrl;
  final int spicyLevel;
  final bool isVeg;
  final bool isPopular;
  final String banglishTokens;

  String name(String lang) => lang == 'bn' ? nameBn : nameEn;
  String description(String lang) =>
      lang == 'bn' ? descriptionBn : descriptionEn;
  String vendorName(String lang) =>
      lang == 'bn' ? vendorNameBn : vendorNameEn;
}

/// Ranked kitchen card model (`File 13 rank_v1` & `File 16 §16.2` locked anatomy).
final class VendorFeedCard {
  const VendorFeedCard({
    required this.id,
    required this.slug,
    required this.type,
    required this.brandNameEn,
    required this.brandNameBn,
    required this.publicAreaEn,
    required this.publicAreaBn,
    this.pickupPoint,
    required this.cuisines,
    required this.hygieneVerified,
    required this.acceptsPickup,
    required this.ratingAvg,
    required this.ratingCount,
    required this.isNewVendor,
    required this.operationalStatus,
    this.opensAtTimeLabel,
    required this.prepMinutes,
    required this.etaMinLow,
    required this.etaMinHigh,
    required this.roadKm,
    required this.pickupDistanceMeters,
    required this.deliveryFeePoisha,
    required this.standardDeliveryFeePoisha,
    required this.minOrderPoisha,
    required this.priceTier,
    required this.rankScore,
    this.flashDiscountPercent,
    this.offerPillsEn = const <String>[],
    this.offerPillsBn = const <String>[],
    this.orderedBefore = false,
    this.coverImgbbUrl,
    this.dishes = const <CatalogDishItem>[],
  });

  final String id;
  final String slug;
  final VendorTrackType type;
  final String brandNameEn;
  final String brandNameBn;
  final String publicAreaEn;
  final String publicAreaBn;

  /// Counter handover point (ONLY exposed when `acceptsPickup == true`; never a private home pin).
  final GeoPoint? pickupPoint;
  final List<String> cuisines;
  final bool hygieneVerified;
  final bool acceptsPickup;
  final double ratingAvg;
  final int ratingCount;
  final bool isNewVendor;
  final String operationalStatus;
  final String? opensAtTimeLabel;
  final int prepMinutes;
  final int etaMinLow;
  final int etaMinHigh;
  final double roadKm;
  final int pickupDistanceMeters;
  final int deliveryFeePoisha;
  final int standardDeliveryFeePoisha;
  final int minOrderPoisha;
  final int priceTier;
  final double rankScore;
  final int? flashDiscountPercent;
  final List<String> offerPillsEn;
  final List<String> offerPillsBn;
  final bool orderedBefore;
  final String? coverImgbbUrl;
  final List<CatalogDishItem> dishes;

  bool get isOpen => operationalStatus == 'open';
  bool get isFreeDelivery => deliveryFeePoisha == 0;
  bool get isPrimaryQualityFloor => !(ratingCount >= 5 && ratingAvg < 3.20);

  String brandName(String lang) => lang == 'bn' ? brandNameBn : brandNameEn;
  String publicArea(String lang) => lang == 'bn' ? publicAreaBn : publicAreaEn;
  List<String> offerPills(String lang) =>
      (lang == 'bn' ? offerPillsBn : offerPillsEn).take(2).toList();
  String get priceTierSymbols => '৳' * priceTier.clamp(1, 3);
}

/// Active filter & sort state applied deterministically to `c-08` and `c-09`.
final class FeedFilterState {
  const FeedFilterState({
    this.sort = FeedSortOption.recommended,
    this.selectedCuisineKey,
    this.shortcut = HomeShortcutKind.all,
    this.offersOnly = false,
    this.minRating,
    this.vegOnly = false,
    this.openNowOnly = false,
    this.maxDeliveryFeePoisha,
  });

  final FeedSortOption sort;
  final String? selectedCuisineKey;
  final HomeShortcutKind shortcut;
  final bool offersOnly;
  final double? minRating;
  final bool vegOnly;
  final bool openNowOnly;
  final int? maxDeliveryFeePoisha;

  int get activeCount {
    int n = 0;
    if (sort != FeedSortOption.recommended) n++;
    if (selectedCuisineKey != null) n++;
    if (shortcut != HomeShortcutKind.all) n++;
    if (offersOnly) n++;
    if (minRating != null) n++;
    if (vegOnly) n++;
    if (openNowOnly) n++;
    if (maxDeliveryFeePoisha != null) n++;
    return n;
  }

  FeedFilterState copyWith({
    FeedSortOption? sort,
    Object? selectedCuisineKey = _sentinel,
    HomeShortcutKind? shortcut,
    bool? offersOnly,
    Object? minRating = _sentinel,
    bool? vegOnly,
    bool? openNowOnly,
    Object? maxDeliveryFeePoisha = _sentinel,
  }) {
    return FeedFilterState(
      sort: sort ?? this.sort,
      selectedCuisineKey: identical(selectedCuisineKey, _sentinel)
          ? this.selectedCuisineKey
          : selectedCuisineKey as String?,
      shortcut: shortcut ?? this.shortcut,
      offersOnly: offersOnly ?? this.offersOnly,
      minRating: identical(minRating, _sentinel)
          ? this.minRating
          : minRating as double?,
      vegOnly: vegOnly ?? this.vegOnly,
      openNowOnly: openNowOnly ?? this.openNowOnly,
      maxDeliveryFeePoisha: identical(maxDeliveryFeePoisha, _sentinel)
          ? this.maxDeliveryFeePoisha
          : maxDeliveryFeePoisha as int?,
    );
  }

  static const Object _sentinel = Object();
}
