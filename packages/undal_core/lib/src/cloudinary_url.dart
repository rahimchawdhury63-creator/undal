/// Zero-Supabase-Storage Free Cloudinary URL & upload helper (`ADR-0006`).
///
/// Builds bandwidth-saving responsive AVIF/WebP URLs (`fl_strip_profile,f_auto,q_auto`)
/// and `< 500B` LQIP blur placeholders across `customer_app`, `partner_app`, and `rider_app`.
library;

/// Cloudinary upload preset descriptor consumed by mobile multipart uploaders.
class CloudinaryUnsignedPresetTarget {
  /// Creates an unsigned upload descriptor for `cloudName` + `uploadPreset`.
  const CloudinaryUnsignedPresetTarget({
    required this.cloudName,
    required this.uploadPreset,
    required this.folder,
  });

  /// Cloudinary cloud name (`UNDAL_CLOUDINARY_CLOUD_NAME`).
  final String cloudName;

  /// Scoped unsigned upload preset name configured in Cloudinary Console.
  final String uploadPreset;

  /// Logical folder prefix (`undal/public/...` or `undal/private/...`).
  final String folder;

  /// HTTPS upload endpoint receiving `multipart/form-data`.
  Uri get uploadEndpoint =>
      Uri.parse('https://api.cloudinary.com/v1_1/$cloudName/image/upload');
}

/// Builds an EXIF-stripped auto-AVIF/WebP public Cloudinary URL.
String buildCloudinaryPublicUrl({
  required String cloudName,
  required String publicId,
  required int width,
  int? height,
  bool blurPlaceholder = false,
}) {
  final cleanId = publicId.replaceAll(RegExp(r'^/+'), '');
  final transforms = <String>['fl_strip_profile'];
  if (blurPlaceholder) {
    transforms.addAll(<String>['c_scale', 'w_32', 'e_blur:1000', 'q_auto:low', 'f_auto']);
  } else {
    transforms.add(height != null ? 'c_fill,g_auto' : 'c_limit');
    transforms.add('w_$width');
    if (height != null) {
      transforms.add('h_$height');
    }
    transforms.addAll(<String>['q_auto', 'f_auto']);
  }
  return 'https://res.cloudinary.com/$cloudName/image/upload/${transforms.join(",")}/$cleanId';
}
