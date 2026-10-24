/// Privacy-filtered storefront summary, business hours, and verified reviews (`c-16..c-17`).
///
/// Do not add street addresses, legal identities, phone numbers, or private Cloudinary media.
library;

import 'customer_models.dart';
import 'storefront_menu_models.dart';

/// Kitchen opening-hours row returned by the public W1 storefront endpoint.
final class VendorOpeningHours {
  /// Creates a privacy-safe weekly hours row.
  const VendorOpeningHours({
    required this.weekday,
    required this.isClosed,
    this.open1,
    this.close1,
    this.open2,
    this.close2,
  });

  /// PostgreSQL day index (`0` Sunday through `6` Saturday).
  final int weekday;

  /// Whether the kitchen is closed for the full day.
  final bool isClosed;

  /// First daily opening time in `Asia/Dhaka`.
  final String? open1;

  /// First daily closing time in `Asia/Dhaka`.
  final String? close1;

  /// Optional second daily opening time.
  final String? open2;

  /// Optional second daily closing time.
  final String? close2;

  /// Parses a non-sensitive vendor-hours row.
  factory VendorOpeningHours.fromJson(Map<String, Object?> json) {
    return VendorOpeningHours(
      weekday: _int(json['weekday']).clamp(0, 6),
      isClosed: json['is_closed'] == true,
      open1: _nullableString(json['open1']),
      close1: _nullableString(json['close1']),
      open2: _nullableString(json['open2']),
      close2: _nullableString(json['close2']),
    );
  }
}

/// Vendor menu, public hours, and verified public profile data.
final class VendorStorefront {
  /// Creates an immutable storefront snapshot.
  const VendorStorefront({
    required this.vendor,
    required this.categories,
    this.openingHours = const <VendorOpeningHours>[],
    this.isLiveSnapshot = false,
  });

  /// Privacy-filtered kitchen summary.
  final StorefrontVendorSummary vendor;

  /// Categories and available item configurations.
  final List<StorefrontCategory> categories;

  /// Public weekly kitchen hours (empty only when no hours were published/returned).
  final List<VendorOpeningHours> openingHours;

  /// True only when the snapshot came from W1, not the local catalog fallback.
  final bool isLiveSnapshot;

  /// All items in their stable category order.
  List<StorefrontMenuItem> get items => categories.expand((StorefrontCategory c) => c.items).toList(growable: false);

  /// Parses the W1 `GET /v1/vendors/{slug}/menu` data envelope.
  factory VendorStorefront.fromJson(Map<String, Object?> json) {
    final Object? rawVendor = json['vendor'];
    if (rawVendor is! Map<String, Object?>) {
      throw const FormatException('STOREFRONT_VENDOR_MISSING');
    }
    final StorefrontVendorSummary vendor = StorefrontVendorSummary.fromJson(rawVendor);
    final List<StorefrontCategory> categories = <StorefrontCategory>[];
    for (final Map<String, Object?> category in _maps(json['categories'])) {
      categories.add(StorefrontCategory(
        id: _string(category['id']),
        nameEn: _string(category['name_en'], fallback: 'Menu'),
        nameBn: _string(category['name_bn'], fallback: _string(category['name_en'], fallback: 'মেনু')),
        items: _maps(category['items'])
            .map((Map<String, Object?> item) => StorefrontMenuItem.fromJson(item, vendor: vendor))
            .toList(growable: false),
      ));
    }
    return VendorStorefront(
      vendor: vendor,
      categories: categories,
      openingHours: _maps(json['vendor_hours']).map(VendorOpeningHours.fromJson).toList(growable: false),
      isLiveSnapshot: true,
    );
  }

  /// Builds a non-authoritative offline view from already-known feed dishes, adding no invented data.
  factory VendorStorefront.fromFeed(VendorFeedCard feed) {
    final StorefrontVendorSummary vendor = StorefrontVendorSummary(
      id: feed.id,
      slug: feed.slug,
      nameEn: feed.brandNameEn,
      nameBn: feed.brandNameBn,
      vendorType: feed.type.wire,
      publicAreaEn: feed.publicAreaEn,
      publicAreaBn: feed.publicAreaBn,
      hygieneVerified: feed.hygieneVerified,
      acceptsPickup: feed.acceptsPickup,
      ratingAverage: feed.ratingAvg,
      ratingCount: feed.ratingCount,
      minOrderPoisha: feed.minOrderPoisha,
      prepMinutes: feed.prepMinutes,
      pickupPointLabel: null,
      logoImgbbUrl: null,
      coverImgbbUrl: feed.coverImgbbUrl?.startsWith('https://i.ibb.co/') == true ? feed.coverImgbbUrl : null,
      operationalStatus: feed.operationalStatus,
    );
    final List<StorefrontMenuItem> items = feed.dishes
        .map(StorefrontMenuItem.fromCatalog)
        .toList(growable: false);
    return VendorStorefront(
      vendor: vendor,
      categories: items.isEmpty
          ? const <StorefrontCategory>[]
          : <StorefrontCategory>[
              StorefrontCategory(id: 'offline-menu', nameEn: 'Menu preview', nameBn: 'মেনুর নমুনা', items: items),
            ],
    );
  }
}

/// One public, moderated verified-buyer review row.
final class CustomerVendorReview {
  /// Creates a verified-buyer review.
  const CustomerVendorReview({
    required this.id,
    required this.rating,
    required this.aspectTags,
    required this.comment,
    required this.photoUrls,
    required this.vendorReply,
    required this.createdAt,
  });

  /// Review ID, without reviewer identity.
  final String id;

  /// Star score from one to five.
  final int rating;

  /// Moderated customer experience tags.
  final List<String> aspectTags;

  /// Optional customer comment.
  final String? comment;

  /// ImgBB-only review photo URLs.
  final List<String> photoUrls;

  /// Optional public kitchen reply.
  final String? vendorReply;

  /// Review creation timestamp.
  final DateTime? createdAt;

  /// Parses a visible review; unsafe photo URLs are dropped.
  factory CustomerVendorReview.fromJson(Map<String, Object?> json) {
    final List<String> photos = (json['photo_urls'] is List<Object?>
            ? (json['photo_urls'] as List<Object?>).whereType<String>()
            : const <String>[])
        .where((String url) => url.startsWith('https://i.ibb.co/'))
        .toList(growable: false);
    return CustomerVendorReview(
      id: _string(json['id']),
      rating: _int(json['rating']).clamp(1, 5),
      aspectTags: (json['aspect_tags'] is List<Object?>
              ? (json['aspect_tags'] as List<Object?>).whereType<String>()
              : const <String>[])
          .toList(growable: false),
      comment: _nullableString(json['comment']),
      photoUrls: photos,
      vendorReply: _nullableString(json['vendor_reply']),
      createdAt: DateTime.tryParse(_string(json['created_at'])),
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

double _double(Object? value) => value is num ? value.toDouble() : 0;
