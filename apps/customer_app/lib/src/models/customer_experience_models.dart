/// Server-backed customer orders, tracking, account, and support models (`Build Response 15`).
///
/// Parses only W1/W2 payloads. Monetary values are integral poisha; unsafe public images and
/// malformed pickup QR values are discarded before reaching a widget.
library;

import 'package:undal_core/undal_core.dart';

import 'customer_experience_helpers.dart';
export 'customer_experience_helpers.dart';
export 'customer_review_model.dart';

/// One customer-visible row from `GET /v1/orders`.
final class CustomerOrderCard {
  /// Creates a read-only server order summary.
  const CustomerOrderCard({
    required this.id,
    required this.publicCode,
    required this.status,
    required this.fulfilment,
    required this.codCollectPoisha,
    required this.placedAt,
    required this.vendorNameEn,
    required this.vendorNameBn,
    required this.vendorSlug,
    required this.addressLabel,
    required this.addressText,
    required this.batchId,
    required this.cancelReasonKey,
    required this.riderId,
  });

  /// UUID used by participant-scoped detail, chat, and review routes.
  final String id;

  /// Human-readable order code.
  final String publicCode;

  /// Canonical W1 lifecycle status.
  final String status;

  /// `delivery` or `pickup`.
  final String fulfilment;

  /// Server-computed Cash-on-Delivery amount, in integer poisha.
  final int codCollectPoisha;

  /// Placement timestamp, if returned by W1.
  final DateTime? placedAt;

  /// Immutable English kitchen name snapshot.
  final String vendorNameEn;

  /// Immutable Bengali kitchen name snapshot.
  final String vendorNameBn;

  /// Public kitchen slug for a live-menu reorder.
  final String vendorSlug;

  /// Address label in the order snapshot.
  final String addressLabel;

  /// Address text in the order snapshot.
  final String addressText;

  /// Non-null when dispatch assigned the order to a shared route.
  final String? batchId;

  /// Canonical cancellation reason key, if the order was cancelled.
  final String? cancelReasonKey;

  /// Assigned rider UUID, if present.
  final String? riderId;

  /// Whether the order reached a terminal status.
  bool get isTerminal => status.startsWith('DELIVERED') ||
      status.startsWith('CANCELLED') ||
      status == 'FAILED_DELIVERY';

  /// Returns the kitchen name for the active interface language.
  String vendorName(String languageCode) =>
      languageCode == 'bn' && vendorNameBn.isNotEmpty ? vendorNameBn : vendorNameEn;

  /// Parses an order summary while rejecting fractional or unsafe COD values.
  factory CustomerOrderCard.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> vendor = customerJsonMap(json['vendor_snapshot']);
    final Map<String, Object?> address = customerJsonMap(json['address_snapshot']);
    final int amount = customerExactInt(json['cod_collect_poisha']) ?? -1;
    final String id = customerJsonString(json['id']);
    final String code = customerJsonString(json['public_code']);
    if (id.isEmpty || code.isEmpty || amount < 0) {
      throw const FormatException('CUSTOMER_ORDER_INVALID');
    }
    return CustomerOrderCard(
      id: id,
      publicCode: code,
      status: customerJsonString(json['status'], fallback: 'PLACED').toUpperCase(),
      fulfilment: customerJsonString(json['fulfilment'], fallback: 'delivery'),
      codCollectPoisha: amount,
      placedAt: DateTime.tryParse(customerJsonString(json['placed_at'])),
      vendorNameEn: customerJsonString(vendor['brand_name']),
      vendorNameBn: customerJsonString(vendor['brand_name_bn']),
      vendorSlug: customerJsonString(json['vendor_slug'], fallback: customerJsonString(vendor['slug'])),
      addressLabel: customerJsonString(address['label']),
      addressText: customerJsonString(address['address_text']),
      batchId: customerJsonNullableString(json['batch_id']),
      cancelReasonKey: customerJsonNullableString(json['cancel_reason_key']),
      riderId: customerJsonNullableString(json['rider_id']),
    );
  }
}

/// Detailed immutable receipt, events, safe pickup handover secret, and public map endpoints.
final class CustomerOrderDetail {
  /// Creates an order detail snapshot returned by W1.
  const CustomerOrderDetail({
    required this.summary,
    required this.order,
    required this.items,
    required this.events,
    required this.pickupQrToken,
    required this.pickupCode4,
    required this.vendorPoint,
    required this.customerPoint,
    required this.riderPoint,
  });

  /// Summary identity and status.
  final CustomerOrderCard summary;

  /// Sanitized order fields needed for an itemized receipt.
  final Map<String, Object?> order;

  /// Snapshot item rows; all `*_poisha` values are parsed as integer values by the UI.
  final List<Map<String, Object?>> items;

  /// Append-only order lifecycle events in server order.
  final List<Map<String, Object?>> events;

  /// Customer-only pickup HMAC token (64 lowercase hexadecimal characters).
  final String? pickupQrToken;

  /// Customer-only four-digit fallback handover code.
  final String? pickupCode4;

  /// Privacy-filtered kitchen coordinate; may be null for delivery-only home kitchens.
  final GeoPoint? vendorPoint;

  /// Customer's own order-time delivery coordinate, if available.
  final GeoPoint? customerPoint;

  /// Most recent rider coordinate from the active RTDB room, if available.
  final GeoPoint? riderPoint;

  /// Parses the W1 `GET /v1/orders/{code}` envelope.
  factory CustomerOrderDetail.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> order = customerJsonMap(json['order']);
    final Map<String, Object?> location = customerJsonMap(order['vendor_location']);
    final Map<String, Object?> address = customerJsonMap(order['address_snapshot']);
    final String rawQr = customerJsonString(order['pickup_qr_token']).toLowerCase();
    final String rawCode = customerJsonString(order['pickup_code_4']);
    final String fulfilment = customerJsonString(order['fulfilment']);
    return CustomerOrderDetail(
      summary: CustomerOrderCard.fromJson(order),
      order: Map<String, Object?>.unmodifiable(order),
      items: customerJsonMaps(json['items']),
      events: customerJsonMaps(json['events']),
      pickupQrToken: fulfilment == 'pickup' && RegExp(r'^[0-9a-f]{64}$').hasMatch(rawQr) ? rawQr : null,
      pickupCode4: fulfilment == 'pickup' && RegExp(r'^\d{4}$').hasMatch(rawCode) ? rawCode : null,
      vendorPoint: customerGeoPoint(location['lat'], location['lng']),
      customerPoint: customerGeoPoint(address['lat'], address['lng']),
      riderPoint: null,
    );
  }

  /// Returns a new immutable snapshot after applying an RTDB rider coordinate.
  CustomerOrderDetail copyWithRiderPoint(GeoPoint? point) => CustomerOrderDetail(
        summary: summary,
        order: order,
        items: items,
        events: events,
        pickupQrToken: pickupQrToken,
        pickupCode4: pickupCode4,
        vendorPoint: vendorPoint,
        customerPoint: customerPoint,
        riderPoint: point,
      );
}

/// Privacy-filtered favourite kitchen card returned by the authenticated W1 account route.
final class CustomerFavouriteEntry {
  /// Creates an immutable favourite row.
  const CustomerFavouriteEntry({
    required this.vendorId,
    required this.slug,
    required this.nameEn,
    required this.nameBn,
    required this.areaEn,
    required this.areaBn,
    required this.ratingAverage,
    required this.ratingCount,
    required this.logoUrl,
    required this.coverUrl,
  });

  /// Kitchen UUID used by the server-backed favourite toggle.
  final String vendorId;

  /// Public kitchen route slug.
  final String slug;

  /// English public kitchen name.
  final String nameEn;

  /// Bengali public kitchen name.
  final String nameBn;

  /// English coarse public area; never an exact home address.
  final String areaEn;

  /// Bengali coarse public area; never an exact home address.
  final String areaBn;

  /// Public verified-buyer average rating.
  final double ratingAverage;

  /// Public verified-buyer rating count.
  final int ratingCount;

  /// ImgBB-only public kitchen logo.
  final String? logoUrl;

  /// ImgBB-only public kitchen cover.
  final String? coverUrl;

  /// Kitchen name for the active interface language.
  String name(String languageCode) => languageCode == 'bn' && nameBn.isNotEmpty ? nameBn : nameEn;

  /// Coarse public area for the active interface language.
  String area(String languageCode) => languageCode == 'bn' && areaBn.isNotEmpty ? areaBn : areaEn;

  /// Parses the W1 favourite row and validates public media hosts.
  factory CustomerFavouriteEntry.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> vendor = customerJsonMap(json['vendor']);
    final String logo = customerJsonString(vendor['logo_url']);
    final String cover = customerJsonString(vendor['cover_url']);
    return CustomerFavouriteEntry(
      vendorId: customerJsonString(json['vendor_id'], fallback: customerJsonString(vendor['id'])),
      slug: customerJsonString(vendor['slug']),
      nameEn: customerJsonString(vendor['brand_name']),
      nameBn: customerJsonString(vendor['brand_name_bn']),
      areaEn: customerJsonString(vendor['public_area_label']),
      areaBn: customerJsonString(vendor['public_area_label_bn']),
      ratingAverage: customerJsonDouble(vendor['rating_avg']) ?? 0,
      ratingCount: customerExactInt(vendor['rating_count']) ?? 0,
      logoUrl: logo.startsWith('https://i.ibb.co/') ? logo : null,
      coverUrl: cover.startsWith('https://i.ibb.co/') ? cover : null,
    );
  }
}

/// One first-party inbox notification with bilingual title and body.
final class CustomerInboxNotification {
  /// Creates an immutable inbox item.
  const CustomerInboxNotification({
    required this.id,
    required this.kind,
    required this.titleEn,
    required this.titleBn,
    required this.bodyEn,
    required this.bodyBn,
    required this.createdAt,
    required this.readAt,
  });

  /// Notification UUID.
  final String id;

  /// First-party notification category.
  final String kind;

  /// English title.
  final String titleEn;

  /// Bengali title.
  final String titleBn;

  /// English message body.
  final String bodyEn;

  /// Bengali message body.
  final String bodyBn;

  /// Server creation timestamp.
  final DateTime? createdAt;

  /// Server read timestamp, or null for unread.
  final DateTime? readAt;

  /// Localized notification title.
  String title(String languageCode) => languageCode == 'bn' && titleBn.isNotEmpty ? titleBn : titleEn;

  /// Localized notification body.
  String body(String languageCode) => languageCode == 'bn' && bodyBn.isNotEmpty ? bodyBn : bodyEn;

  /// Parses a row from `GET /v1/notifications`.
  factory CustomerInboxNotification.fromJson(Map<String, Object?> json) => CustomerInboxNotification(
        id: customerJsonString(json['id']),
        kind: customerJsonString(json['kind']),
        titleEn: customerJsonString(json['title_en']),
        titleBn: customerJsonString(json['title_bn']),
        bodyEn: customerJsonString(json['body_en']),
        bodyBn: customerJsonString(json['body_bn']),
        createdAt: DateTime.tryParse(customerJsonString(json['created_at'])),
        readAt: DateTime.tryParse(customerJsonString(json['read_at'])),
      );
}

/// Safe server address row with a calculated Plus Code and zone-verdict hint.
final class CustomerAddressEntry {
  /// Creates an immutable customer address entry.
  const CustomerAddressEntry({
    required this.id,
    required this.label,
    required this.point,
    required this.addressText,
    required this.landmarkNote,
    required this.zoneId,
    required this.isDefault,
  });

  /// Address UUID.
  final String id;

  /// User-chosen label (`Home`, `Work`, or another short name).
  final String label;

  /// Address map pin.
  final GeoPoint point;

  /// Address landmark or Plus Code text.
  final String addressText;

  /// Directions for the rider.
  final String landmarkNote;

  /// Resolved service zone UUID; null means outside active delivery coverage.
  final String? zoneId;

  /// Whether this is the current server default address.
  final bool isDefault;

  /// Plus Code derived from the saved coordinate.
  String get plusCode => encodePlusCode(point);

  /// Whether the server resolved this coordinate inside a live zone.
  bool get inServiceArea => zoneId != null;

  /// Parses a row from `GET /v1/addresses`.
  factory CustomerAddressEntry.fromJson(Map<String, Object?> json) {
    final double? lat = customerJsonDouble(json['lat']);
    final double? lng = customerJsonDouble(json['lng']);
    final String id = customerJsonString(json['id']);
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180 || id.isEmpty) {
      throw const FormatException('CUSTOMER_ADDRESS_INVALID');
    }
    return CustomerAddressEntry(
      id: id,
      label: customerJsonString(json['label'], fallback: 'Home'),
      point: GeoPoint(lat, lng),
      addressText: customerJsonString(json['address_text']),
      landmarkNote: customerJsonString(json['delivery_instructions']),
      zoneId: customerJsonNullableString(json['zone_id']),
      isDefault: json['is_default'] == true,
    );
  }
}

/// User profile values editable by the customer (security roles are never parsed as editable data).
final class CustomerProfileSnapshot {
  /// Creates a server-backed profile snapshot.
  const CustomerProfileSnapshot({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.email,
    required this.language,
    required this.avatarUrl,
  });

  /// Authenticated profile UUID.
  final String id;

  /// Profile display name.
  final String fullName;

  /// Masked or stored Bangladesh phone as returned by W1.
  final String? phone;

  /// Email address, if present.
  final String? email;

  /// Persisted `en` or `bn` preference.
  final String language;

  /// Validated ImgBB-only avatar URL.
  final String? avatarUrl;

  /// Parses the W1 `/v1/me` profile while rejecting non-ImgBB public media.
  factory CustomerProfileSnapshot.fromJson(Map<String, Object?> json) {
    final String avatar = customerJsonString(json['avatar_url']);
    return CustomerProfileSnapshot(
      id: customerJsonString(json['id']),
      fullName: customerJsonString(json['full_name']),
      phone: customerJsonNullableString(json['phone']),
      email: customerJsonNullableString(json['email']),
      language: json['language'] == 'bn' ? 'bn' : 'en',
      avatarUrl: avatar.startsWith('https://i.ibb.co/') ? avatar : null,
    );
  }
}

/// Order-chat message rendered without exposing another participant's private identity.
final class CustomerChatMessage {
  /// Creates a chat message model.
  const CustomerChatMessage({
    required this.id,
    required this.senderId,
    required this.body,
    required this.createdAt,
    required this.isBlocked,
  });

  /// Chat message UUID.
  final String id;

  /// Sender UUID, used only to distinguish the current customer from the other participant.
  final String senderId;

  /// Text, if the server allowed it through its phone/link shield.
  final String body;

  /// Server creation timestamp.
  final DateTime? createdAt;

  /// Whether the server marked a blocked/filtered contact attempt.
  final bool isBlocked;

  /// Parses a W1 order chat message.
  factory CustomerChatMessage.fromJson(Map<String, Object?> json) => CustomerChatMessage(
        id: customerJsonString(json['id']),
        senderId: customerJsonString(json['sender_id']),
        body: customerJsonString(json['body']),
        createdAt: DateTime.tryParse(customerJsonString(json['created_at'])),
        isBlocked: json['contains_phone_or_link'] == true,
      );
}

/// Customer-readable support-ticket row.
final class CustomerSupportThread {
  /// Creates a support ticket snapshot.
  const CustomerSupportThread({
    required this.id,
    required this.category,
    required this.subject,
    required this.status,
    required this.orderId,
    required this.createdAt,
  });

  /// Ticket UUID.
  final String id;

  /// Ticket category key.
  final String category;

  /// Customer-visible ticket subject.
  final String subject;

  /// Current server support status.
  final String status;

  /// Linked order UUID, if applicable.
  final String? orderId;

  /// Ticket creation timestamp.
  final DateTime? createdAt;

  /// Parses a ticket from `/v1/support/threads`.
  factory CustomerSupportThread.fromJson(Map<String, Object?> json) => CustomerSupportThread(
        id: customerJsonString(json['id']),
        category: customerJsonString(json['category']),
        subject: customerJsonString(json['subject']),
        status: customerJsonString(json['status'], fallback: 'open'),
        orderId: customerJsonNullableString(json['order_id']),
        createdAt: DateTime.tryParse(customerJsonString(json['created_at'])),
      );
}

