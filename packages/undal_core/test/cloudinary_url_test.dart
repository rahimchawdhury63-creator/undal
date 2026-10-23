import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  test('Cloudinary Dart helper strips EXIF and emits smart crop & blur LQIP URLs (ADR-0006)', () {
    final cardUrl = buildCloudinaryPublicUrl(
      cloudName: 'undal-bd',
      publicId: 'undal/public/menu_item/kacchi_01',
      width: 400,
      height: 300,
    );
    expect(
      cardUrl,
      'https://res.cloudinary.com/undal-bd/image/upload/fl_strip_profile,c_fill,g_auto,w_400,h_300,q_auto,f_auto/undal/public/menu_item/kacchi_01',
    );

    final blurUrl = buildCloudinaryPublicUrl(
      cloudName: 'undal-bd',
      publicId: 'undal/public/menu_item/kacchi_01',
      width: 32,
      blurPlaceholder: true,
    );
    expect(blurUrl, contains('e_blur:1000'));
    expect(blurUrl, contains('fl_strip_profile'));

    const preset = CloudinaryUnsignedPresetTarget(
      cloudName: 'undal-bd',
      uploadPreset: 'undal_public_unsigned',
      folder: 'undal/public/menu_item',
    );
    expect(
      preset.uploadEndpoint.toString(),
      'https://api.cloudinary.com/v1_1/undal-bd/image/upload',
    );
  });
}
