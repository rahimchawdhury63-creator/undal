/// Zero-Supabase-Storage Dual-Provider Media Helpers (`ADR-0006` v2):
/// - **All Public & Platform Images (`menu_item`, `vendor_logo`, `vendor_cover`, `profile_avatar`,
///   `banner`, `review_photo`) -> `ImgBB` Unlimited Free CDN** (`POST /v1/images/public` via `W1`).
/// - **Sensitive Compliance Files ONLY (`vendor_kyc`, `rider_kyc`, `rider_shift_selfie`,
///   `cash_remittance_proof`, `dispute_evidence`, `chat_attachment`, `invoice_pdf`) ->
///   `Cloudinary Free Private Vault`** (`undal/private/<category>/<ownerId>`).
library;

/// Canonical sensitive categories permitted on private Cloudinary storage.
const Set<String> sensitiveCloudinaryCategories = <String>{
  'vendor_kyc',
  'rider_kyc',
  'rider_shift_selfie',
  'cash_remittance_proof',
  'dispute_evidence',
  'chat_attachment',
  'invoice_pdf',
};

/// Canonical public categories served on Unlimited Free ImgBB CDN.
const Set<String> publicImgbbCategories = <String>{
  'menu_item',
  'vendor_logo',
  'vendor_cover',
  'profile_avatar',
  'banner',
  'review_photo',
};

/// Restricted Cloudinary Unsigned Upload Preset target strictly for sensitive compliance media.
class CloudinarySensitiveUploadTarget {
  /// Creates a sensitive-only upload target; throws [ArgumentError] on any public category.
  CloudinarySensitiveUploadTarget({
    required this.cloudName,
    required this.secureUploadPreset,
    required this.category,
    required this.ownerProfileId,
  }) {
    if (!sensitiveCloudinaryCategories.contains(category)) {
      throw ArgumentError.value(
        category,
        'category',
        'Public images must use W1 /v1/images/public (Unlimited ImgBB); Cloudinary is strictly for sensitive private media.',
      );
    }
  }

  /// Cloudinary cloud name (`UNDAL_CLOUDINARY_CLOUD_NAME`).
  final String cloudName;

  /// Restricted secure unsigned upload preset (`UNDAL_CLOUDINARY_UNSIGNED_PRESET_SECURE`).
  final String secureUploadPreset;

  /// Sensitive category (`vendor_kyc`, `rider_kyc`, `cash_remittance_proof`, etc.).
  final String category;

  /// Authenticated owner profile UUID.
  final String ownerProfileId;

  /// Private isolated folder path inside Cloudinary.
  String get folder => 'undal/private/$category/$ownerProfileId';

  /// HTTPS upload endpoint receiving `multipart/form-data`.
  Uri get uploadEndpoint =>
      Uri.parse('https://api.cloudinary.com/v1_1/$cloudName/image/upload');
}

/// Resolves the best responsive Unlimited ImgBB URL for a target logical viewport width (`<= 200` thumb, `<= 720` medium, else full).
String selectResponsiveImgbbUrl({
  required String fullUrl,
  String? mediumUrl,
  String? thumbUrl,
  required double logicalWidthPx,
}) {
  if (logicalWidthPx <= 200 && thumbUrl != null && thumbUrl.isNotEmpty) {
    return thumbUrl;
  }
  if (logicalWidthPx <= 720 && mediumUrl != null && mediumUrl.isNotEmpty) {
    return mediumUrl;
  }
  return fullUrl;
}
