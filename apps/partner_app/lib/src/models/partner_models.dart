/// Partner track, application, document, and UI value models for Response 16.
library;

/// Three vendor application tracks defined in `21-onboarding-kyc.md`.
enum PartnerTrack {
  /// Licensed restaurant application with trade, NID, TIN/BIN, and menu evidence.
  restaurant('RESTAURANT', 'Restaurant', 'রেস্টুরেন্ট'),

  /// Home kitchen application with private address, utility evidence, and cook-to-order declaration.
  homeKitchen('HOME_KITCHEN', 'Home kitchen', 'হোম কিচেন'),

  /// Cloud kitchen application with private address and cook-to-order declaration.
  cloudKitchen('CLOUD_KITCHEN', 'Cloud kitchen', 'ক্লাউড কিচেন');

  const PartnerTrack(this.wire, this.labelEn, this.labelBn);

  /// Exact W1/PostgreSQL wire value.
  final String wire;

  /// English display label.
  final String labelEn;

  /// Bangla display label.
  final String labelBn;

  /// Resolves a supported vendor wire value without inventing a fallback track.
  static PartnerTrack? parse(Object? value) {
    for (final PartnerTrack track in PartnerTrack.values) {
      if (track.wire == value) return track;
    }
    return null;
  }
}

/// Applicant's authenticated Supabase session retained only in app memory.
final class PartnerSession {
  /// Creates an authenticated applicant session.
  const PartnerSession({required this.userId, required this.email, required this.accessToken});

  /// Supabase `auth.users.id` bound to the application owner.
  final String userId;

  /// Email address used for account authentication.
  final String email;

  /// Short-lived Supabase access token; never persisted to disk or logged.
  final String accessToken;
}

/// Private KYC document requirement shown in the applicant's vault.
final class PartnerDocumentSpec {
  /// Creates a document row label and date-capture policy.
  const PartnerDocumentSpec({
    required this.docType,
    required this.labelEn,
    required this.labelBn,
    this.expiryRequired = false,
    this.issueDateRequired = false,
    this.optional = false,
  });

  /// `vendor_documents.doc_type` value accepted by W1.
  final String docType;

  /// English document label.
  final String labelEn;

  /// Bangla document label.
  final String labelBn;

  /// Whether a renewal/expiry date must be captured at upload time.
  final bool expiryRequired;

  /// Whether an issue date must be captured at upload time.
  final bool issueDateRequired;

  /// Whether the track can submit without this document.
  final bool optional;
}

/// Returns the server-accepted document types for the selected Partner track.
List<PartnerDocumentSpec> partnerDocumentSpecs(PartnerTrack track) {
  const PartnerDocumentSpec trade = PartnerDocumentSpec(
    docType: 'trade_license', labelEn: 'Trade licence', labelBn: 'ট্রেড লাইসেন্স', expiryRequired: true,
  );
  const PartnerDocumentSpec nidFront = PartnerDocumentSpec(
    docType: 'nid_front', labelEn: 'NID front', labelBn: 'জাতীয় পরিচয়পত্রের সামনের দিক', optional: true,
  );
  const PartnerDocumentSpec nidBack = PartnerDocumentSpec(
    docType: 'nid_back', labelEn: 'NID back', labelBn: 'জাতীয় পরিচয়পত্রের পেছনের দিক', optional: true,
  );
  const PartnerDocumentSpec passportFront = PartnerDocumentSpec(
    docType: 'passport_front', labelEn: 'Passport photo page', labelBn: 'পাসপোর্টের ছবি-যুক্ত পৃষ্ঠা', optional: true,
  );
  const PartnerDocumentSpec passportBack = PartnerDocumentSpec(
    docType: 'passport_back', labelEn: 'Passport address page', labelBn: 'পাসপোর্টের ঠিকানার পৃষ্ঠা', optional: true,
  );
  const PartnerDocumentSpec bank = PartnerDocumentSpec(
    docType: 'bank_proof', labelEn: 'Bank statement / cheque', labelBn: 'ব্যাংক স্টেটমেন্ট / চেক', optional: true,
  );
  const PartnerDocumentSpec bkash = PartnerDocumentSpec(
    docType: 'bkash_proof', labelEn: 'bKash statement screenshot', labelBn: 'বিকাশ স্টেটমেন্টের স্ক্রিনশট', optional: true,
  );
  const PartnerDocumentSpec nagad = PartnerDocumentSpec(
    docType: 'nagad_proof', labelEn: 'Nagad statement screenshot', labelBn: 'নগদ স্টেটমেন্টের স্ক্রিনশট', optional: true,
  );
  const PartnerDocumentSpec menu = PartnerDocumentSpec(
    docType: 'menu_doc', labelEn: 'Menu photo or PDF', labelBn: 'মেনুর ছবি বা PDF',
  );
  if (track == PartnerTrack.restaurant) {
    return <PartnerDocumentSpec>[
      trade,
      nidFront,
      nidBack,
      passportFront,
      passportBack,
      const PartnerDocumentSpec(docType: 'tin', labelEn: 'TIN certificate', labelBn: 'TIN সনদ'),
      const PartnerDocumentSpec(docType: 'bin', labelEn: 'BIN certificate', labelBn: 'BIN সনদ'),
      bank,
      bkash,
      nagad,
      menu,
    ];
  }
  return <PartnerDocumentSpec>[
    nidFront,
    nidBack,
    passportFront,
    passportBack,
    const PartnerDocumentSpec(
      docType: 'utility_bill', labelEn: 'Utility bill issued in the last 90 days', labelBn: 'গত ৯০ দিনের ইউটিলিটি বিল', issueDateRequired: true,
    ),
    bank,
    bkash,
    nagad,
    const PartnerDocumentSpec(docType: 'kitchen_hygiene_photo', labelEn: 'Kitchen hygiene photo', labelBn: 'রান্নাঘরের পরিচ্ছন্নতার ছবি'),
    const PartnerDocumentSpec(docType: 'menu_doc', labelEn: 'Optional menu photo or PDF', labelBn: 'মেনুর ঐচ্ছিক ছবি বা PDF', optional: true),
    trade.copyWithOptional(),
    const PartnerDocumentSpec(docType: 'tin', labelEn: 'TIN certificate (recommended)', labelBn: 'TIN সনদ (প্রস্তাবিত)', optional: true),
    const PartnerDocumentSpec(docType: 'bin', labelEn: 'BIN certificate (recommended)', labelBn: 'BIN সনদ (প্রস্তাবিত)', optional: true),
  ];
}

/// Helper extension allowing the shared trade-licence row to be optional for kitchen tracks.
extension on PartnerDocumentSpec {
  /// Copies the current specification with the optional flag enabled.
  PartnerDocumentSpec copyWithOptional() => PartnerDocumentSpec(
        docType: docType,
        labelEn: '$labelEn (recommended)',
        labelBn: '$labelBn (প্রস্তাবিত)',
        expiryRequired: expiryRequired,
        issueDateRequired: issueDateRequired,
        optional: true,
      );
}

/// Normalizes ASCII and Bengali numerals to digits and removes safe Bangladesh phone separators.
String normalizePartnerPhone(String value) {
  return String.fromCharCodes(value.runes.map((int cp) {
    if (cp >= 0x09e6 && cp <= 0x09ef) return 0x30 + cp - 0x09e6;
    return cp;
  })).replaceAll(RegExp(r'[\s()+-]'), '');
}
