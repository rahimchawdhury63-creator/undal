/// Canonical UNDAL Money, VAT Extraction (`5/105`), Commission (`15%`), Rider Bonus (`3%`),
/// and BDT Formatter for Flutter (`Master Guide File 10` & `Appendix F`).
///
/// Uses pure arbitrary-precision `BigInt` rational math so Dart, TypeScript (`@undal/shared-ts`),
/// and PostgreSQL agree poisha-for-poisha across every possible input (`0` float drift).
library;

/// Supported order fulfilment modes (`Decision D-24`).
enum UndalFulfilmentMode { delivery, pickup }

/// Admin-configurable platform money policy (`Appendix M`).
final class UndalMoneyPolicy {
  const UndalMoneyPolicy({
    this.commissionPct = 15,
    this.vatInclusivePct = 5,
    this.riderBonusPct = 3,
    this.defaultPlatformFeePoisha = 500,
  });

  final double commissionPct;
  final double vatInclusivePct;
  final double riderBonusPct;
  final int defaultPlatformFeePoisha;
}

/// Validated basket pricing input for [priceOrder].
final class OrderPricingInput {
  const OrderPricingInput({
    required this.fulfilment,
    required this.itemsPoisha,
    required this.discountVendorPoisha,
    required this.discountPlatformPoisha,
    this.deliveryFeePoisha = 0,
    this.platformFeePoisha,
    this.tipPoisha = 0,
    this.commissionPctOverride,
  });

  final UndalFulfilmentMode fulfilment;
  final int itemsPoisha;
  final int discountVendorPoisha;
  final int discountPlatformPoisha;
  final int deliveryFeePoisha;
  final int? platformFeePoisha;
  final int tipPoisha;
  final double? commissionPctOverride;
}

/// Immutable integer-poisha money waterfall snapshot (`File 10 §10.2`).
final class OrderMoneySnapshot {
  const OrderMoneySnapshot({
    required this.fulfilment,
    required this.itemsPoisha,
    required this.discountVendorPoisha,
    required this.discountPlatformPoisha,
    required this.discountTotalPoisha,
    required this.foodPayablePoisha,
    required this.taxExtractedPoisha,
    required this.deliveryFeePoisha,
    required this.platformFeePoisha,
    required this.tipPoisha,
    required this.codCollectPoisha,
    required this.commissionPoisha,
    required this.riderBonusPoisha,
    required this.taxPoolRemainderPoisha,
    required this.vendorNetPoisha,
  });

  final UndalFulfilmentMode fulfilment;
  final int itemsPoisha;
  final int discountVendorPoisha;
  final int discountPlatformPoisha;
  final int discountTotalPoisha;
  final int foodPayablePoisha;
  final int taxExtractedPoisha;
  final int deliveryFeePoisha;
  final int platformFeePoisha;
  final int tipPoisha;
  final int codCollectPoisha;
  final int commissionPoisha;
  final int riderBonusPoisha;
  final int taxPoolRemainderPoisha;
  final int vendorNetPoisha;
}

const List<String> _bengaliDigits = <String>[
  '০',
  '১',
  '২',
  '৩',
  '৪',
  '৫',
  '৬',
  '৭',
  '৮',
  '৯',
];

/// Divides [numerator] by positive [denominator] using exact `ROUND_HALF_UP`.
BigInt roundHalfUpDiv(BigInt numerator, BigInt denominator) {
  if (denominator <= BigInt.zero) {
    throw RangeError('Denominator must be positive: $denominator');
  }
  final bool negative = numerator.isNegative;
  final BigInt absNum = numerator.abs();
  final BigInt quotient = absNum ~/ denominator;
  final BigInt remainder = absNum.remainder(denominator);
  final BigInt inc = (remainder * BigInt.two >= denominator) ? BigInt.one : BigInt.zero;
  final BigInt unsigned = quotient + inc;
  return negative ? -unsigned : unsigned;
}

/// Converts ASCII `0-9` digits in [input] into Bengali `০-৯` digits (`File 25 §25.3`).
String toBengaliDigits(String input) {
  final StringBuffer out = StringBuffer();
  for (final int unit in input.codeUnits) {
    if (unit >= 0x30 && unit <= 0x39) {
      out.write(_bengaliDigits[unit - 0x30]);
    } else {
      out.writeCharCode(unit);
    }
  }
  return out.toString();
}

/// Normalises Bengali `০-৯` digits back into ASCII `0-9` for numeric input parsing.
String fromBengaliDigits(String input) {
  final StringBuffer out = StringBuffer();
  for (final int rune in input.runes) {
    if (rune >= 0x09E6 && rune <= 0x09EF) {
      out.writeCharCode(0x30 + (rune - 0x09E6));
    } else {
      out.writeCharCode(rune);
    }
  }
  return out.toString();
}

/// Formats integer [poisha] in South Asian `৳` BDT notation (`৳1,839.40` / `৳১,৮৩৯.৪০`).
String formatBdt(
  int poisha, {
  String localeCode = 'en',
  bool trimZeroDecimals = false,
}) {
  final bool negative = poisha < 0;
  final int abs = poisha.abs();
  final int takaInt = abs ~/ 100;
  final String poishaPart = (abs % 100).toString().padLeft(2, '0');

  final String rawInt = takaInt.toString();
  String groupedInt;
  if (rawInt.length <= 3) {
    groupedInt = rawInt;
  } else {
    final String head = rawInt.substring(0, rawInt.length - 3);
    final String tail = rawInt.substring(rawInt.length - 3);
    final String headGrouped = head.replaceAllMapped(
      RegExp(r'\B(?=(\d{2})+(?!\d))'),
      (_) => ',',
    );
    groupedInt = '$headGrouped,$tail';
  }

  final bool showDecimals = !(trimZeroDecimals && poishaPart == '00');
  final String digits = showDecimals ? '$groupedInt.$poishaPart' : groupedInt;
  final String localized = localeCode == 'bn' ? toBengaliDigits(digits) : digits;
  return '${negative ? '-' : ''}৳$localized';
}

/// Parses an English or Bengali BDT amount string into exact integer poisha.
int parseBdtInputToPoisha(String rawInput) {
  final String cleaned = fromBengaliDigits(rawInput)
      .replaceAll(RegExp(r'৳|BDT|Tk|,', caseSensitive: false), '')
      .trim();
  if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(cleaned)) {
    throw FormatException('Invalid BDT money input', rawInput);
  }
  final List<String> parts = cleaned.split('.');
  final int taka = int.parse(parts[0]);
  final String dec = (parts.length > 1 ? parts[1] : '').padRight(2, '0');
  return taka * 100 + int.parse(dec);
}

/// Computes the exact UNDAL order money waterfall (`File 10 §10.2`).
OrderMoneySnapshot priceOrder(
  OrderPricingInput input, {
  UndalMoneyPolicy policy = const UndalMoneyPolicy(),
}) {
  final BigInt items = BigInt.from(input.itemsPoisha);
  final BigInt discV = BigInt.from(input.discountVendorPoisha);
  final BigInt discP = BigInt.from(input.discountPlatformPoisha);
  if (items < BigInt.zero || discV < BigInt.zero || discP < BigInt.zero) {
    throw RangeError('Money inputs cannot be negative');
  }
  final BigInt discTotal = discV + discP;
  if (discTotal > items) {
    throw RangeError('Total discount ($discTotal) exceeds items ($items)');
  }

  final bool isPickup = input.fulfilment == UndalFulfilmentMode.pickup;
  final BigInt deliveryFee =
      isPickup ? BigInt.zero : BigInt.from(input.deliveryFeePoisha);
  final BigInt platformFee = isPickup
      ? BigInt.zero
      : BigInt.from(input.platformFeePoisha ?? policy.defaultPlatformFeePoisha);
  final BigInt tip = isPickup ? BigInt.zero : BigInt.from(input.tipPoisha);

  final BigInt foodPayable = items - discTotal;
  final BigInt vatBps = BigInt.from((policy.vatInclusivePct * 100).round());
  final BigInt taxExtracted = roundHalfUpDiv(
    foodPayable * vatBps,
    BigInt.from(10000) + vatBps,
  );

  final BigInt commBps = BigInt.from(
    ((input.commissionPctOverride ?? policy.commissionPct) * 100).round(),
  );
  final BigInt bonusBps = BigInt.from((policy.riderBonusPct * 100).round());

  final BigInt commission = roundHalfUpDiv(foodPayable * commBps, BigInt.from(10000));
  final BigInt riderBonus = roundHalfUpDiv(foodPayable * bonusBps, BigInt.from(10000));
  final BigInt taxPoolRemainder = taxExtracted - riderBonus;
  final BigInt vendorNet = foodPayable + discP - commission;
  final BigInt codCollect = foodPayable + deliveryFee + platformFee + tip;

  return OrderMoneySnapshot(
    fulfilment: input.fulfilment,
    itemsPoisha: items.toInt(),
    discountVendorPoisha: discV.toInt(),
    discountPlatformPoisha: discP.toInt(),
    discountTotalPoisha: discTotal.toInt(),
    foodPayablePoisha: foodPayable.toInt(),
    taxExtractedPoisha: taxExtracted.toInt(),
    deliveryFeePoisha: deliveryFee.toInt(),
    platformFeePoisha: platformFee.toInt(),
    tipPoisha: tip.toInt(),
    codCollectPoisha: codCollect.toInt(),
    commissionPoisha: commission.toInt(),
    riderBonusPoisha: riderBonus.toInt(),
    taxPoolRemainderPoisha: taxPoolRemainder.toInt(),
    vendorNetPoisha: vendorNet.toInt(),
  );
}
