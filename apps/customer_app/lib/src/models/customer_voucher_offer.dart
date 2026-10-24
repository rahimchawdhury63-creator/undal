/// Public, currently active voucher offer returned by the authenticated W1 wallet endpoint.
///
/// Codes are only hints until W1 validates them against this customer's cart and the live budget.
library;

/// One eligible voucher card in the customer cart's picker (`c-19`).
final class CustomerVoucherOffer {
  /// Creates a sanitized offer row containing integer-poisha limits only.
  const CustomerVoucherOffer({
    required this.id,
    required this.code,
    required this.titleEn,
    required this.titleBn,
    required this.kind,
    required this.value,
    required this.minimumOrderPoisha,
    required this.endsAt,
    this.capPoisha,
  });

  /// Stable voucher UUID.
  final String id;

  /// Normalized redemption code; W1 remains the eligibility authority.
  final String code;

  /// English promotional title.
  final String titleEn;

  /// Bengali promotional title, or an empty string when not supplied.
  final String titleBn;

  /// Server-defined voucher kind (`percent`, `flat`, or `free_delivery`).
  final String kind;

  /// Integer percent basis points, flat poisha, or the free-delivery marker value.
  final int value;

  /// Optional maximum discount in integer poisha.
  final int? capPoisha;

  /// Minimum food subtotal in integer poisha.
  final int minimumOrderPoisha;

  /// ISO-8601 server expiry timestamp.
  final String endsAt;

  /// Returns the best available title for the active language.
  String title(String localeCode) => localeCode == 'bn' && titleBn.isNotEmpty ? titleBn : titleEn;

  /// Parses only public fields and rejects malformed identifiers, kinds, or fractional money.
  factory CustomerVoucherOffer.fromJson(Map<String, Object?> json) {
    final String id = _string(json['id']);
    final String code = _string(json['code']);
    final String kind = _string(json['kind']);
    final int? value = _integer(json['value_num']);
    final int? minimum = _integer(json['min_order_poisha']);
    final int? cap = json['cap_poisha'] == null ? null : _integer(json['cap_poisha']);
    final String endsAt = _string(json['ends_at']);
    if (!RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false).hasMatch(id) ||
        !RegExp(r'^[A-Z0-9][A-Z0-9_-]{2,31}$').hasMatch(code) ||
        !<String>{'percent', 'flat', 'free_delivery'}.contains(kind) ||
        value == null || value < 0 || minimum == null || minimum < 0 ||
        (json['cap_poisha'] != null && (cap == null || cap < 0)) ||
        DateTime.tryParse(endsAt) == null) {
      throw const FormatException('VOUCHER_OFFER_INVALID');
    }
    return CustomerVoucherOffer(
      id: id,
      code: code,
      titleEn: _string(json['title_en'], fallback: 'Voucher'),
      titleBn: _string(json['title_bn']),
      kind: kind,
      value: value,
      capPoisha: cap,
      minimumOrderPoisha: minimum,
      endsAt: endsAt,
    );
  }
}

String _string(Object? raw, {String fallback = ''}) => raw is String ? raw : fallback;

int? _integer(Object? raw) {
  if (raw is int) return raw;
  if (raw is String) return int.tryParse(raw);
  return null;
}
