# `apps/rider_app` — Undal Delivery Rider Android App (`com.undal.rider`)

- **Surface:** Flutter 3 + native Kotlin `UndalAlarmService` + foreground shift location + RTDB 120-byte presence writer
- **Governing Spec:** `UNDAL-MASTER-GUIDE/07-fcm-data-only-alert-engine.md`, `11`, `12`, `18-rider-app-flutter.md` (`29 screens: r-01..r-29`)
- **Build Responses:** `Build 13`, `Build 20`, `Build 21`, `Build 22`
- **Core Capabilities:** Motorbike vs Bicycle KYC (`age >= 18` hard check), full-screen offer ring with `"Why this fare?"` transparency breakdown, solo-rider acceptance guard (`D-23`), QR scan (`D-22`), corridor batching (`D-20`), shift cash gate & `TrxID` remittance (`File 23`).
