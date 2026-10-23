/// Canonical UNDAL Dynamic Rider Fare, Surge, Weather, Traffic & Batching Engine for Flutter
/// (`Master Guide File 11` & `Appendix F` Golden Vectors `F-1..F-6`).
///
/// Mirrors `@undal/shared-ts` (`packages/shared_ts/src/fare.ts`) bit-for-bit using pure `BigInt`
/// rational arithmetic (`0` floating-point discrepancy across all vehicles and surge bands).
library;

import '../money/undal_money.dart';

/// Supported rider vehicle tracks in v1 (`File 11 §11.1`).
enum RiderVehicleType { motorbike, bicycle }

/// Supported weather states (`File 11 §11.1`).
enum WeatherCondition { clear, rain, storm, extremeHeat }

/// Zone/platform rider fare configuration (`Appendix M` group `fare.*`).
final class UndalFarePolicy {
  const UndalFarePolicy({
    this.baseMotorbikePoisha = 3000,
    this.baseBicyclePoisha = 2500,
    this.perKmMotorbikePoisha = 1400,
    this.perKmBicyclePoisha = 800,
    this.includedKm = 2.0,
    this.deadheadFactor = 0.5,
    this.floorMotorbikePoisha = 4000,
    this.floorBicyclePoisha = 3000,
    this.surgeMidLow = 1.2,
    this.surgeMidHigh = 1.4,
    this.surgeSevereLow = 1.5,
    this.surgeSevereCap = 2.2,
    this.weatherRainPct = 20,
    this.weatherStormPct = 40,
    this.weatherHeatPct = 10,
    this.trafficBlockMinutes = 5,
    this.trafficBlockPoisha = 400,
    this.batchFactor2 = 0.6,
    this.batchFactor3 = 0.5,
    this.priorityUpliftPoisha = 1000,
    this.waitCompPerMinPoisha = 200,
    this.waitGraceMinutes = 10,
    this.maxLoadedKmBicycle = 4.0,
    this.maxLoadedKmMotorbike = 12.0,
  });

  final int baseMotorbikePoisha;
  final int baseBicyclePoisha;
  final int perKmMotorbikePoisha;
  final int perKmBicyclePoisha;
  final double includedKm;
  final double deadheadFactor;
  final int floorMotorbikePoisha;
  final int floorBicyclePoisha;
  final double surgeMidLow;
  final double surgeMidHigh;
  final double surgeSevereLow;
  final double surgeSevereCap;
  final double weatherRainPct;
  final double weatherStormPct;
  final double weatherHeatPct;
  final int trafficBlockMinutes;
  final int trafficBlockPoisha;
  final double batchFactor2;
  final double batchFactor3;
  final int priorityUpliftPoisha;
  final int waitCompPerMinPoisha;
  final int waitGraceMinutes;
  final double maxLoadedKmBicycle;
  final double maxLoadedKmMotorbike;
}

/// Input contract matching `File 11 §11.1` verbatim.
final class FareInputs {
  const FareInputs({
    required this.travelDistanceKm,
    required this.toVendorKm,
    required this.trafficDelayMinutes,
    required this.activeOrdersInZone,
    required this.activeRidersInZone,
    required this.weatherCondition,
    required this.vehicleType,
    required this.batchPosition,
    required this.orderFoodPayablePoisha,
    required this.isPriority,
    this.baseFarePoisha,
    this.perKmRatePoisha,
    this.includedKm,
    this.minimumFareFloorPoisha,
  });

  final int? baseFarePoisha;
  final int? perKmRatePoisha;
  final double? includedKm;
  final int? minimumFareFloorPoisha;
  final double travelDistanceKm;
  final double toVendorKm;
  final int trafficDelayMinutes;
  final int activeOrdersInZone;
  final int activeRidersInZone;
  final WeatherCondition weatherCondition;
  final RiderVehicleType vehicleType;
  final int batchPosition;
  final int orderFoodPayablePoisha;
  final bool isPriority;
}

/// Complete itemised rider fare breakdown (`r-09` `"Why this fare?"` sheet).
final class CalculatedRiderFare {
  const CalculatedRiderFare({
    required this.riderFarePoisha,
    required this.foodBonusPoisha,
    required this.baseAppliedPoisha,
    required this.loadedKm,
    required this.billableKm,
    required this.distancePayPoisha,
    required this.sdr,
    required this.surgeMultiplier,
    required this.weatherPct,
    required this.trafficBlocks,
    required this.trafficPayPoisha,
    required this.priorityUpliftPoisha,
    required this.floorApplied,
    required this.withinVehicleRadius,
  });

  final int riderFarePoisha;
  final int foodBonusPoisha;
  final int baseAppliedPoisha;
  final double loadedKm;
  final double billableKm;
  final int distancePayPoisha;
  final double sdr;
  final double surgeMultiplier;
  final double weatherPct;
  final int trafficBlocks;
  final int trafficPayPoisha;
  final int priorityUpliftPoisha;
  final bool floorApplied;
  final bool withinVehicleRadius;
}

BigInt _factorToPpm(double factor) {
  final List<String> parts = factor.toStringAsFixed(6).split('.');
  return BigInt.parse(parts[0]) * BigInt.from(1000000) +
      BigInt.parse(parts[1].padRight(6, '0').substring(0, 6));
}

BigInt _kmToMeters(double km) {
  return roundHalfUpDiv(_factorToPpm(km), BigInt.from(1000));
}

/// Computes exact rider payout fare in integer poisha (`File 11 §11.2`).
CalculatedRiderFare calculateRiderFare(
  FareInputs input, {
  UndalFarePolicy policy = const UndalFarePolicy(),
}) {
  final bool isBike = input.vehicleType == RiderVehicleType.motorbike;
  final BigInt basePoisha = BigInt.from(
    input.baseFarePoisha ??
        (isBike ? policy.baseMotorbikePoisha : policy.baseBicyclePoisha),
  );
  final BigInt perKmPoisha = BigInt.from(
    input.perKmRatePoisha ??
        (isBike ? policy.perKmMotorbikePoisha : policy.perKmBicyclePoisha),
  );
  final BigInt floorPoisha = BigInt.from(
    input.minimumFareFloorPoisha ??
        (isBike ? policy.floorMotorbikePoisha : policy.floorBicyclePoisha),
  );

  final BigInt travelM = _kmToMeters(input.travelDistanceKm);
  final BigInt toVendorM = _kmToMeters(input.toVendorKm);
  final BigInt includedM = _kmToMeters(input.includedKm ?? policy.includedKm);
  final BigInt deadheadPpm = _factorToPpm(policy.deadheadFactor);

  final BigInt loadedM = travelM > toVendorM ? travelM - toVendorM : BigInt.zero;
  final BigInt excessLoadedM = loadedM > includedM ? loadedM - includedM : BigInt.zero;
  final BigInt billableNanoKm =
      excessLoadedM * BigInt.from(1000000) + toVendorM * deadheadPpm;

  final BigInt batchBasePpm = input.batchPosition <= 1
      ? BigInt.from(1000000)
      : input.batchPosition == 2
          ? _factorToPpm(policy.batchFactor2)
          : _factorToPpm(policy.batchFactor3);

  final BigInt effectiveBaseNanoPoisha =
      basePoisha * batchBasePpm * BigInt.from(1000);
  final BigInt distanceNanoPoisha = perKmPoisha * billableNanoKm;
  final BigInt subtotalNanoPoisha = effectiveBaseNanoPoisha + distanceNanoPoisha;

  final BigInt riders =
      BigInt.from(input.activeRidersInZone < 0 ? 0 : input.activeRidersInZone);
  final BigInt ordersDen =
      BigInt.from(input.activeOrdersInZone < 1 ? 1 : input.activeOrdersInZone);

  final BigInt surgeDen = ordersDen * BigInt.from(1000000);
  late final BigInt surgeNum;
  if (riders >= ordersDen) {
    surgeNum = surgeDen;
  } else if (riders * BigInt.two >= ordersDen) {
    final BigInt lowPpm = _factorToPpm(policy.surgeMidLow);
    final BigInt spanPpm = _factorToPpm(policy.surgeMidHigh - policy.surgeMidLow);
    surgeNum = lowPpm * ordersDen + BigInt.two * (ordersDen - riders) * spanPpm;
  } else {
    final BigInt lowPpm = _factorToPpm(policy.surgeSevereLow);
    final BigInt spanPpm =
        _factorToPpm(policy.surgeSevereCap - policy.surgeSevereLow);
    surgeNum = lowPpm * ordersDen + (ordersDen - BigInt.two * riders) * spanPpm;
  }

  final double weatherPct = switch (input.weatherCondition) {
    WeatherCondition.rain => policy.weatherRainPct,
    WeatherCondition.storm => policy.weatherStormPct,
    WeatherCondition.extremeHeat => policy.weatherHeatPct,
    WeatherCondition.clear => 0.0,
  };
  final BigInt weatherBps = BigInt.from(((100.0 + weatherPct) * 100.0).round());

  final int delayMin = input.trafficDelayMinutes < 0 ? 0 : input.trafficDelayMinutes;
  final BigInt trafficBlocks = BigInt.from(delayMin ~/ policy.trafficBlockMinutes);
  final BigInt trafficPay = trafficBlocks * BigInt.from(policy.trafficBlockPoisha);
  final BigInt priorityPay = input.isPriority
      ? BigInt.from(policy.priorityUpliftPoisha)
      : BigInt.zero;

  final BigInt billion = BigInt.from(1000000000);
  final BigInt tenThousand = BigInt.from(10000);
  final BigInt totalNum = subtotalNanoPoisha * surgeNum * weatherBps +
      (trafficPay + priorityPay) * billion * surgeDen * tenThousand;
  final BigInt totalDen = billion * surgeDen * tenThousand;

  final BigInt roundedPoisha = roundHalfUpDiv(totalNum, totalDen);
  final BigInt finalPoisha =
      roundedPoisha < floorPoisha ? floorPoisha : roundedPoisha;
  final BigInt foodBonus = roundHalfUpDiv(
    BigInt.from(input.orderFoodPayablePoisha) * BigInt.from(3),
    BigInt.from(100),
  );

  final double loadedKmNum = loadedM.toInt() / 1000.0;
  final double maxRadius =
      isBike ? policy.maxLoadedKmMotorbike : policy.maxLoadedKmBicycle;

  return CalculatedRiderFare(
    riderFarePoisha: finalPoisha.toInt(),
    foodBonusPoisha: foodBonus.toInt(),
    baseAppliedPoisha: roundHalfUpDiv(effectiveBaseNanoPoisha, billion).toInt(),
    loadedKm: loadedKmNum,
    billableKm: billableNanoKm.toInt() / 1000000000.0,
    distancePayPoisha: roundHalfUpDiv(distanceNanoPoisha, billion).toInt(),
    sdr: riders.toInt() / ordersDen.toInt(),
    surgeMultiplier: surgeNum.toInt() / surgeDen.toInt(),
    weatherPct: weatherPct,
    trafficBlocks: trafficBlocks.toInt(),
    trafficPayPoisha: trafficPay.toInt(),
    priorityUpliftPoisha: priorityPay.toInt(),
    floorApplied: roundedPoisha < floorPoisha,
    withinVehicleRadius: loadedKmNum <= maxRadius,
  );
}
