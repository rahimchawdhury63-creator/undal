/// Authenticated customer storefront/cart/order HTTP operations (`Build Response 13`).
///
/// Every commerce mutation goes through W1 with the customer Supabase access token. The client
/// generates idempotency keys for cart mutations and COD order placement; it never synthesizes a
/// successful order when the API is absent or unreachable.
library;

import 'dart:math';

import '../config/app_config.dart';
import '../models/customer_cart_models.dart';
import '../models/customer_models.dart';
import '../models/storefront_vendor_models.dart';

/// Typed failure returned by an HTTP or domain error from W1.
final class CustomerApiProblem implements Exception {
  /// Creates a structured API problem.
  const CustomerApiProblem(this.code, {this.message, this.statusCode});

  /// Stable Appendix G domain/error code.
  final String code;

  /// Optional bilingual server message.
  final String? message;

  /// HTTP status, used to distinguish a definitive rejection from an unknown server outcome.
  final int? statusCode;

  @override
  String toString() => message == null ? code : '$code: $message';
}

/// Authenticated commerce facade sharing the app's configured native HTTP transport.
final class CustomerCommerceApi {
  /// Creates the API facade using the existing environment config and transport.
  const CustomerCommerceApi({
    required CustomerAppConfig config,
    required CustomerHttpTransport transport,
  })  : _config = config,
        _transport = transport;

  final CustomerAppConfig _config;
  final CustomerHttpTransport _transport;

  /// Whether a W1 endpoint is configured for live operations.
  bool get isConfigured => _config.hasLiveWorkers;

  /// Fetches categories, live availability, variants, options, bundles, and public hours.
  Future<VendorStorefront?> loadStorefront(String slug) async {
    if (!isConfigured) return null;
    try {
      final Map<String, Object?> data = await _request(
        method: 'GET',
        path: '/v1/vendors/${Uri.encodeComponent(slug)}/menu',
      );
      return VendorStorefront.fromJson(data);
    } on Object {
      return null;
    }
  }

  /// Fetches visible, moderated, verified-buyer reviews without exposing reviewer identity.
  Future<List<CustomerVendorReview>?> loadVendorReviews(String slug) async {
    if (!isConfigured) return null;
    try {
      final Map<String, Object?> data = await _request(
        method: 'GET',
        path: '/v1/vendors/${Uri.encodeComponent(slug)}/reviews?limit=20',
      );
      final Object? raw = data['reviews'];
      if (raw is! List<Object?>) return <CustomerVendorReview>[];
      return raw
          .whereType<Map<String, Object?>>()
          .map(CustomerVendorReview.fromJson)
          .toList(growable: false);
    } on Object {
      return null;
    }
  }

  /// Creates or updates the authenticated customer's delivery address and returns its UUID.
  Future<String> saveAddress({
    required String accessToken,
    required SavedCustomerAddress address,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/addresses',
      accessToken: accessToken,
      jsonBody: <String, Object?>{
        'label': address.label,
        'lat': address.point.lat,
        'lng': address.point.lng,
        'address_text': address.addressText,
        'delivery_instructions': address.landmarkNote,
        'is_default': true,
      },
    );
    final Object? row = data['address'];
    if (row is! Map<String, Object?> || row['id'] is! String) {
      throw const CustomerApiProblem('ADDRESS_SAVE_FAILED');
    }
    return row['id'] as String;
  }

  /// Reads the server cart so stale lines can be reconciled before checkout.
  Future<Map<String, Object?>> loadCart({required String accessToken}) async {
    return _request(
      method: 'GET',
      path: '/v1/cart',
      accessToken: accessToken,
    );
  }

  /// Opens or updates the single-vendor cart session on W1.
  Future<void> upsertCart({
    required String accessToken,
    required String vendorId,
    required String? addressId,
    required String fulfilment,
    required int tipPoisha,
    required bool cutleryRequested,
    required String? customerNote,
    required bool confirmClear,
  }) async {
    await _request(
      method: 'POST',
      path: '/v1/cart',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{
        'vendor_id': vendorId,
        'address_id': addressId,
        'fulfilment': fulfilment,
        'tip_poisha': tipPoisha,
        'cutlery_requested': cutleryRequested,
        'customer_note': customerNote,
        'confirm_clear': confirmClear,
      },
    );
  }

  /// Adds, replaces, or removes one exact item/variant/customization line.
  Future<void> mutateCartLine({
    required String accessToken,
    required String menuItemId,
    required String? variantId,
    required int quantity,
    required List<Map<String, Object?>> selections,
    required String? note,
  }) async {
    await _request(
      method: 'PATCH',
      path: '/v1/cart/items',
      accessToken: accessToken,
      idempotencyKey: _newIdempotencyKey(),
      jsonBody: <String, Object?>{
        'menu_item_id': menuItemId,
        'variant_id': variantId,
        'qty': quantity,
        'selections': selections,
        'note': note,
      },
    );
  }

  /// Applies a user-entered voucher code; W1 is authoritative for eligibility and budget.
  Future<void> applyVoucher({
    required String accessToken,
    required String code,
  }) async {
    await _request(
      method: 'POST',
      path: '/v1/cart/voucher',
      accessToken: accessToken,
      jsonBody: <String, Object?>{'code': code.trim().toUpperCase()},
    );
  }

  /// Removes the currently attached voucher from the authenticated server cart.
  Future<void> removeVoucher({required String accessToken}) async {
    await _request(
      method: 'DELETE',
      path: '/v1/cart/voucher',
      accessToken: accessToken,
    );
  }

  /// Gets the server's current cart quote before the final atomic place-order check.
  Future<Map<String, Object?>> validateCart({
    required String accessToken,
    required bool priority,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/cart/validate',
      accessToken: accessToken,
      jsonBody: <String, Object?>{'is_priority': priority},
    );
    final Object? quote = data['quote'];
    if (quote is! Map<String, Object?>) {
      throw const CustomerApiProblem('CART_QUOTE_INVALID');
    }
    return quote;
  }

  /// Places an atomic Cash-on-Delivery order and returns only a server-confirmed receipt.
  Future<CustomerOrderReceipt> placeCodOrder({
    required String accessToken,
    required bool priority,
    required int expectedCodPoisha,
    required String idempotencyKey,
  }) async {
    final Map<String, Object?> data = await _request(
      method: 'POST',
      path: '/v1/orders',
      accessToken: accessToken,
      idempotencyKey: idempotencyKey,
      jsonBody: <String, Object?>{
        'expected_cod_poisha': expectedCodPoisha,
        'is_priority': priority,
      },
    );
    return CustomerOrderReceipt.fromJson(data);
  }

  Future<Map<String, Object?>> _request({
    required String method,
    required String path,
    String? accessToken,
    String? idempotencyKey,
    Map<String, Object?>? jsonBody,
  }) async {
    if (!_config.hasLiveWorkers) {
      throw const CustomerApiProblem('SERVICE_UNAVAILABLE');
    }
    final Uri uri = Uri.parse('${_config.apiBaseUrl}$path');
    final Map<String, String> headers = <String, String>{
      if (accessToken != null && accessToken.isNotEmpty)
        'Authorization': 'Bearer $accessToken',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
    };
    final CustomerHttpResponse response = await _transport.sendJson(
      method: method,
      uri: uri,
      headers: headers,
      jsonBody: jsonBody,
    );
    if (!response.isOk) {
      final Object? error = response.body['error'];
      if (error is Map<String, Object?>) {
        throw CustomerApiProblem(
          error['code'] is String ? error['code'] as String : 'REQUEST_FAILED',
          message: error['message_en'] is String ? error['message_en'] as String : null,
          statusCode: response.statusCode,
        );
      }
      throw CustomerApiProblem('HTTP_${response.statusCode}', statusCode: response.statusCode);
    }
    final Object? data = response.body['data'];
    if (data is Map<String, Object?>) return data;
    return const <String, Object?>{};
  }
}

String _newIdempotencyKey() {
  final Random random = Random.secure();
  return List<int>.generate(24, (_) => random.nextInt(256))
      .map((int byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
}
