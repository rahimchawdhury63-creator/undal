import 'package:flutter_test/flutter_test.dart';
import 'package:undal_core/undal_core.dart';

void main() {
  test('ADR-0006 v2: ImgBB handles all responsive public images while Cloudinary strictly isolates sensitive compliance files', () {
    expect(
      () => CloudinarySensitiveUploadTarget(
        cloudName: 'undal-bd',
        secureUploadPreset: 'undal_secure_unsigned',
        category: 'menu_item',
        ownerProfileId: '11111111-1111-4111-8111-111111111111',
      ),
      throwsArgumentError,
    );

    final kycTarget = CloudinarySensitiveUploadTarget(
      cloudName: 'undal-bd',
      secureUploadPreset: 'undal_secure_unsigned',
      category: 'rider_kyc',
      ownerProfileId: '33333333-3333-4333-8333-333333333333',
    );
    expect(kycTarget.folder, 'undal/private/rider_kyc/33333333-3333-4333-8333-333333333333');
    expect(kycTarget.uploadEndpoint.toString(), 'https://api.cloudinary.com/v1_1/undal-bd/image/upload');

    expect(
      selectResponsiveImgbbUrl(
        fullUrl: 'https://i.ibb.co/full/dish.jpg',
        mediumUrl: 'https://i.ibb.co/medium/dish.jpg',
        thumbUrl: 'https://i.ibb.co/thumb/dish.jpg',
        logicalWidthPx: 140,
      ),
      'https://i.ibb.co/thumb/dish.jpg',
    );
    expect(
      selectResponsiveImgbbUrl(
        fullUrl: 'https://i.ibb.co/full/dish.jpg',
        mediumUrl: 'https://i.ibb.co/medium/dish.jpg',
        thumbUrl: 'https://i.ibb.co/thumb/dish.jpg',
        logicalWidthPx: 420,
      ),
      'https://i.ibb.co/medium/dish.jpg',
    );
  });
}
