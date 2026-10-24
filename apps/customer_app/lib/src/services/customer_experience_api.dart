/// Authenticated W1 account, order, chat, support, and customer-experience routes (`Build Response 15`).
///
/// All private requests require the active Supabase access token. The client does not synthesize order,
/// account, reward, referral, address, or notification data when a Worker is unavailable.
library;

import 'dart:math';

import 'package:undal_core/undal_core.dart';

import '../config/app_config.dart';
import '../models/customer_experience_models.dart';
import '../models/customer_models.dart';
import 'customer_commerce_api.dart';

/// Authenticated W1/W2 client for the customer surfaces after COD checkout.
final class CustomerExperienceApi {
  /// Creates a client sharing the root app's configured transport and public endpoints.
  const CustomerExperienceApi({
    required CustomerAppConfig config,
    required CustomerHttpTransport transport,
  })  : _config = config,
        _transport = transport;

  final CustomerAppConfig _config;
  final CustomerHttpTransport _transport;

  /// Whether W1 is configured for customer account and order requests.
  bool get isConfigured => _config.hasLiveWorkers;

  /// Loads customer-scoped order history from W1.
  Future<List<CustomerOrderCard>> listOrders({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/orders?limit=50',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['orders'])
        .map(CustomerOrderCard.fromJson)
        .toList(growable: false);
  }

  /// Loads an immutable receipt and its server event timeline by public code or order UUID.
  Future<CustomerOrderDetail> loadOrder({
    required String accessToken,
    required String orderReference,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/orders/${Uri.encodeComponent(orderReference)}',
      accessToken: accessToken,
    );
    return CustomerOrderDetail.fromJson(data);
  }

  /// Loads a participant-checked live order snapshot and returns null for an unchanged `304`.
  Future<Map<String, Object?>?> loadLiveOrder({
    required String accessToken,
    required String fallbackPath,
    String? etag,
  }) async {
    final Uri uri = Uri.parse('${_config.apiBaseUrl}$fallbackPath');
    final CustomerHttpResponse response = await _transport.sendJson(
      method: 'GET',
      uri: uri,
      headers: <String, String>{
        'Authorization': 'Bearer $accessToken',
        if (etag != null && etag.isNotEmpty) 'If-None-Match': etag,
      },
    );
    if (response.statusCode == 304) return null;
    if (!response.isOk) throw _problem(response);
    final Object? envelope = response.body['data'];
    if (envelope is! Map<String, Object?>) {
      throw const CustomerApiProblem('ORDER_LIVE_INVALID');
    }
    return <String, Object?>{
      ...envelope,
      '_etag': response.headers['etag'],
    };
  }

  /// Reads a customer's saved delivery-address book.
  Future<List<CustomerAddressEntry>> listAddresses({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/addresses',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['addresses'])
        .map(CustomerAddressEntry.fromJson)
        .toList(growable: false);
  }

  /// Creates or updates one address and returns the canonical server row.
  Future<CustomerAddressEntry> saveAddress({
    required String accessToken,
    required CustomerAddressEntry address,
    String? addressId,
    bool? isDefault,
  }) async {
    final Map<String, Object?> data = await _request(
      method: addressId == null ? 'POST' : 'PATCH',
      path: addressId == null ? '/v1/addresses' : '/v1/addresses/${Uri.encodeComponent(addressId)}',
      accessToken: accessToken,
      jsonBody: <String, Object?>{
        'label': address.label,
        'lat': address.point.lat,
        'lng': address.point.lng,
        'address_text': address.addressText,
        'delivery_instructions': address.landmarkNote,
        'is_default': isDefault ?? address.isDefault,
      },
    );
    final Object? raw = data['address'];
    if (raw is! Map<String, Object?>) throw const CustomerApiProblem('ADDRESS_SAVE_FAILED');
    return CustomerAddressEntry.fromJson(raw);
  }

  /// Deletes a customer's address by UUID; W1 enforces ownership.
  Future<void> deleteAddress({required String accessToken, required String addressId}) async {
    await _request(
      method: 'DELETE',
      path: '/v1/addresses/${Uri.encodeComponent(addressId)}',
      accessToken: accessToken,
    );
  }

  /// Loads the customer's saved kitchen IDs and privacy-filtered vendor cards.
  Future<List<Map<String, Object?>>> listFavourites({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/favourites',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['favourites']);
  }

  /// Adds/removes one favourite using W1's authenticated idempotent toggle.
  Future<bool> toggleFavourite({required String accessToken, required String vendorId}) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/favourites/${Uri.encodeComponent(vendorId)}',
      accessToken: accessToken,
      jsonBody: const <String, Object?>{},
    );
    return data['is_favourite'] == true;
  }

  /// Loads the authenticated customer's editable W1 profile.
  Future<CustomerProfileSnapshot> loadProfile({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/me',
      accessToken: accessToken,
    );
    final Object? raw = data['profile'];
    if (raw is! Map<String, Object?>) throw const CustomerApiProblem('PROFILE_UNAVAILABLE');
    return CustomerProfileSnapshot.fromJson(raw);
  }

  /// Saves a validated display name and language preference to W1.
  Future<CustomerProfileSnapshot> updateProfile({
    required String accessToken,
    String? fullName,
    String? language,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'PATCH',
      path: '/v1/me',
      accessToken: accessToken,
      jsonBody: <String, Object?>{
        if (fullName != null) 'full_name': fullName.trim(),
        if (language != null) 'language': language,
      },
    );
    final Object? raw = data['profile'];
    if (raw is! Map<String, Object?>) throw const CustomerApiProblem('PROFILE_UPDATE_FAILED');
    return CustomerProfileSnapshot.fromJson(raw);
  }

  /// Loads up to 50 first-party bilingual customer inbox notifications.
  Future<List<CustomerInboxNotification>> listNotifications({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/notifications?limit=50',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['notifications'])
        .map(CustomerInboxNotification.fromJson)
        .where((CustomerInboxNotification row) => row.id.isNotEmpty)
        .toList(growable: false);
  }

  /// Marks selected notifications read; an empty list means mark all as read.
  Future<void> markNotificationsRead({
    required String accessToken,
    required List<String> ids,
  }) async {
    await _request(
      method: 'PATCH',
      path: '/v1/notifications/read',
      accessToken: accessToken,
      jsonBody: <String, Object?>{'ids': ids},
    );
  }

  /// Fetches a customer/rider or customer/kitchen conversation from W1.
  Future<List<CustomerChatMessage>> listChatMessages({
    required String accessToken,
    required String orderId,
    required String pair,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/chats/${Uri.encodeComponent(orderId)}/messages?pair=${Uri.encodeQueryComponent(pair)}',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['messages'])
        .map(CustomerChatMessage.fromJson)
        .toList(growable: false);
  }

  /// Sends a message through the W1 participant, 24-hour-lock, and phone/link-shield rules.
  Future<CustomerChatMessage> sendChatMessage({
    required String accessToken,
    required String orderId,
    required String pair,
    required String body,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/chats/${Uri.encodeComponent(orderId)}/messages',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{'pair': pair, 'body': body.trim()},
    );
    final Object? raw = data['message'];
    if (raw is! Map<String, Object?>) throw const CustomerApiProblem('CHAT_SEND_FAILED');
    return CustomerChatMessage.fromJson(raw);
  }

  /// Loads customer-owned support tickets.
  Future<List<CustomerSupportThread>> listSupportThreads({required String accessToken}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/support/threads',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['threads'])
        .map(CustomerSupportThread.fromJson)
        .toList(growable: false);
  }

  /// Opens a real support ticket, optionally linked to an order.
  Future<CustomerSupportThread> createSupportThread({
    required String accessToken,
    required String category,
    required String subject,
    required String body,
    String? orderId,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/support/threads',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{
        'category': category,
        'subject': subject,
        'body': body.trim(),
        'order_id': orderId,
      },
    );
    final Object? raw = data['thread'];
    if (raw is! Map<String, Object?>) throw const CustomerApiProblem('SUPPORT_CREATE_FAILED');
    return CustomerSupportThread.fromJson(raw);
  }

  /// Loads user-visible messages in a customer support thread.
  Future<List<Map<String, Object?>>> listSupportMessages({
    required String accessToken,
    required String threadId,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/support/threads/${Uri.encodeComponent(threadId)}/messages',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['messages']);
  }

  /// Posts a reply to an existing support ticket.
  Future<Map<String, Object?>> sendSupportMessage({
    required String accessToken,
    required String threadId,
    required String body,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/support/threads/${Uri.encodeComponent(threadId)}/messages',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{'body': body.trim()},
    );
    final Object? raw = data['message'];
    if (raw is Map<String, Object?>) return raw;
    return data;
  }

  /// Loads this customer's own vendor and rider ratings for one order.
  Future<List<CustomerReviewSnapshot>> listOrderReviews({required String accessToken, required String orderId}) async {
    final Map<String, Object?> data = await _request(
      method: 'GET',
      path: '/v1/orders/${Uri.encodeComponent(orderId)}/review',
      accessToken: accessToken,
    );
    return customerJsonMaps(data['reviews']).map(CustomerReviewSnapshot.fromJson).toList(growable: false);
  }

  /// Submits a server-verified customer review for a delivered order.
  Future<void> submitOrderReview({
    required String accessToken,
    required String orderId,
    required int rating,
    required String direction,
    required List<String> aspectTags,
    String? comment,
  }) async {
    await _request(
      method: 'POST',
      path: '/v1/orders/${Uri.encodeComponent(orderId)}/review',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{
        'rating': rating,
        'direction': direction,
        'aspect_tags': aspectTags,
        'comment': comment?.trim(),
      },
    );
  }

  /// Requests a privacy-scoped road-route estimate through W2's cached OSRM proxy.
  Future<Map<String, Object?>> estimateRoadRoute({
    required String accessToken,
    required GeoPoint origin,
    required GeoPoint destination,
  }) async {
    return _request(
      method: 'POST',
      path: '/v1/geo/route',
      accessToken: accessToken,
      realtime: true,
      jsonBody: <String, Object?>{
        'origin_lat': origin.lat,
        'origin_lng': origin.lng,
        'dest_lat': destination.lat,
        'dest_lng': destination.lng,
        'vehicle_type': 'motorbike',
      },
    );
  }

  /// Requests the W2 RTDB lease; W2 returns a safe five-second polling fallback when capped.
  Future<Map<String, Object?>> requestRealtimeGrant({

    required String accessToken,
    required String orderId,
  }) async {
    return _request(
      method: 'POST',
      path: '/v1/realtime/token',
      accessToken: accessToken,
      realtime: true,
      jsonBody: <String, Object?>{'order_id': orderId},
    );
  }

  /// Releases an order-scoped W2 RTDB lease when tracking is no longer on screen.
  Future<void> releaseRealtimeLease({
    required String accessToken,
    required String orderId,
  }) async {
    await _request(
      method: 'POST',
      path: '/v1/realtime/token',
      accessToken: accessToken,
      realtime: true,
      jsonBody: <String, Object?>{'order_id': orderId, 'release': true},
    );
  }

  Future<Map<String, Object?>> _request({
    required String method,
    required String path,
    String? accessToken,
    String? idempotencyKey,
    Map<String, Object?>? jsonBody,
    bool realtime = false,
  }) async {
    final String base = realtime ? _config.realtimeBaseUrl : _config.apiBaseUrl;
    if (base.trim().isEmpty) throw const CustomerApiProblem('SERVICE_UNAVAILABLE');
    final CustomerHttpResponse response = await _transport.sendJson(
      method: method,
      uri: Uri.parse('$base$path'),
      headers: <String, String>{
        if (accessToken != null && accessToken.isNotEmpty) 'Authorization': 'Bearer $accessToken',
        if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
      },
      jsonBody: jsonBody,
    );
    if (!response.isOk) throw _problem(response);
    final Object? data = response.body['data'];
    return data is Map<String, Object?> ? data : const <String, Object?>{};
  }

  CustomerApiProblem _problem(CustomerHttpResponse response) {
    final Map<String, Object?> error = customerJsonMap(response.body['error']);
    return CustomerApiProblem(
      customerJsonString(error['code'], fallback: 'HTTP_${response.statusCode}'),
      message: customerJsonNullableString(error['message_en']),
      statusCode: response.statusCode,
    );
  }
}

String _newIdempotencyKey() {
  final Random random = Random.secure();
  final String raw = List<int>.generate(16, (_) => random.nextInt(256))
      .map((int byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${raw.substring(0, 8)}-${raw.substring(8, 12)}-4${raw.substring(13, 16)}-a${raw.substring(17, 20)}-${raw.substring(20, 32)}';
}
