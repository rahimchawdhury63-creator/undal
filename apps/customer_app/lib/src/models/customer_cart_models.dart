/// Configured basket, checkout intent, and server-confirmed COD receipt models (`c-18..c-21`).
library;

import 'dart:convert';

import 'customer_models.dart';
import 'storefront_menu_models.dart';

/// One configured line in the single-vendor shopping cart.
final class BasketLineItem {
  /// Creates a basket row; snapshots its selected modifiers and integer unit amount.
  const BasketLineItem({
    required this.item,
    required this.quantity,
    required this.unitPricePoisha,
    this.variantId,
    this.selections = const <Map<String, Object?>>[],
    this.specialInstructions = '',
  });

  /// Selected menu item.
  final StorefrontMenuItem item;

  /// Quantity between one and fifty.
  final int quantity;

  /// Server/list-price-derived unit total in integer poisha.
  final int unitPricePoisha;

  /// Selected variant ID, if any.
  final String? variantId;

  /// Validated option and bundle-choice IDs to be rechecked by W1.
  final List<Map<String, Object?>> selections;

  /// Customer instruction, bounded to 200 characters by W1.
  final String specialInstructions;

  /// Backwards-compatible dish access for search and cart widgets.
  CatalogDishItem get dish => item.dish;

  /// Exact integer-poisha line total.
  int get lineTotalPoisha => unitPricePoisha * quantity;

  /// Stable identity for distinct modifier combinations of the same menu item.
  String get lineKey {
    final List<Map<String, Object?>> sorted = List<Map<String, Object?>>.of(selections)
      ..sort((Map<String, Object?> a, Map<String, Object?> b) => jsonEncode(a).compareTo(jsonEncode(b)));
    return '${dish.id}:${variantId ?? ''}:${jsonEncode(sorted)}';
  }

  /// Produces a quantity-updated immutable basket row.
  BasketLineItem copyWith({int? quantity}) => BasketLineItem(
        item: item,
        quantity: quantity ?? this.quantity,
        unitPricePoisha: unitPricePoisha,
        variantId: variantId,
        selections: selections,
        specialInstructions: specialInstructions,
      );
}

/// Order receipt parsed only from the successful atomic W1 `POST /v1/orders` response.
final class CustomerOrderReceipt {
  /// Creates the server-confirmed receipt shown on `c-21`.
  const CustomerOrderReceipt({
    required this.orderId,
    required this.publicCode,
    required this.status,
    required this.codCollectPoisha,
  });

  /// Server order UUID.
  final String orderId;

  /// Human-readable order code.
  final String publicCode;

  /// Initial server lifecycle state.
  final String status;

  /// Exact server-computed cash amount to be collected.
  final int codCollectPoisha;

  /// Parses the successful W1 order response; throws if required identity is absent.
  factory CustomerOrderReceipt.fromJson(Map<String, Object?> json) {
    final String id = _string(json['order_id']);
    final String code = _string(json['public_code']);
    final String status = _string(json['status']);
    final Object? codRaw = json['cod_collect_poisha'];
    final int? codPoisha = codRaw is int
        ? codRaw
        : codRaw is String
            ? int.tryParse(codRaw)
            : null;
    if (!RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false).hasMatch(id) ||
        code.isEmpty || status != 'PLACED' || codPoisha == null || codPoisha < 0) {
      throw const FormatException('ORDER_RECEIPT_INVALID');
    }
    return CustomerOrderReceipt(
      orderId: id,
      publicCode: code,
      status: status,
      codCollectPoisha: codPoisha,
    );
  }
}

String _string(Object? value, {String fallback = ''}) => value is String ? value : fallback;

