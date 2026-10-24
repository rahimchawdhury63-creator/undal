/// Existing customer-owned rating for one verified order.
library;

import 'customer_experience_helpers.dart';

/// Existing customer-owned vendor or rider rating returned for one verified order.
final class CustomerReviewSnapshot {
  /// Creates an immutable review snapshot.
  const CustomerReviewSnapshot({required this.id, required this.direction, required this.rating, required this.aspectTags, required this.comment, required this.createdAt});

  /// Review UUID.
  final String id;

  /// `customer_to_vendor` or `customer_to_rider`.
  final String direction;

  /// Server-stored one-to-five-star rating.
  final int rating;

  /// Customer-selected review aspect keys.
  final List<String> aspectTags;

  /// Optional customer comment.
  final String? comment;

  /// Server creation timestamp.
  final DateTime? createdAt;

  /// Parses one review returned by `GET /v1/orders/{id}/review`.
  factory CustomerReviewSnapshot.fromJson(Map<String, Object?> json) {
    final int rating = customerExactInt(json['rating']) ?? 0;
    final String direction = customerJsonString(json['direction']);
    final String id = customerJsonString(json['id']);
    if (rating < 1 || rating > 5 || id.isEmpty || !<String>{'customer_to_vendor', 'customer_to_rider'}.contains(direction)) {
      throw const FormatException('CUSTOMER_REVIEW_INVALID');
    }
    return CustomerReviewSnapshot(
      id: id,
      direction: direction,
      rating: rating,
      aspectTags: json['aspect_tags'] is List<Object?> ? (json['aspect_tags'] as List<Object?>).whereType<String>().toList(growable: false) : const <String>[],
      comment: customerJsonNullableString(json['comment']),
      createdAt: DateTime.tryParse(customerJsonString(json['created_at'])),
    );
  }
}

