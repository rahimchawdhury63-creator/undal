# `apps/customer_app` — Undal Customer Android App (`com.undal.customer`)

- **Surface:** Flutter 3 + Riverpod + GoRouter + `flutter_map` + native Kotlin FCM handler
- **Governing Spec:** `UNDAL-MASTER-GUIDE/16-customer-app-flutter.md` (`40 screens: c-01..c-40`)
- **Build Responses:** `Build 14`, `Build 15`, `Build 16`
- **Security Invariant:** Only public `UNDAL_*` configuration values are injected via `--dart-define`; zero private API keys ever enter the APK (`D-03`, `SEC-02`).
