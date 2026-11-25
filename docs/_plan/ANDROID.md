# The mobile apps, honestly

**No. The three Android apps are not built.** Not scaffolded either — `android/` contains one module,
`shared/money`, and nothing else. The storefront is a website; the console is a website. There is no
customer app, no rider app, no vendor app.

This page exists so that gap is a fact on the record rather than an omission somebody discovers later.

## What is actually there

| Path | What it is | Compiled? |
|---|---|---|
| `android/shared/money` | `Money.kt` — `applyRate`, `floorToTaka`, `groupBdt`, `machineBdt`, mirroring `packages/money` | **never** |
| `android/shared/money/MoneyTest.kt` | JUnit tests for the above | **never run** |

`settings.gradle.kts` and `libs.versions.toml` are configuration for a build that has never executed.

## Why it cannot be built here

Verified in this environment, not assumed:

- `java`, `kotlinc`, `gradle`: not installed.
- A JDK *was* obtainable (`jdk4py` from PyPI, OpenJDK 25). The Kotlin compiler was not: the release
  asset redirects to `release-assets.githubusercontent.com`, which this sandbox cannot reach
  (`curl: (35) SSL_ERROR_SYSCALL`).
- The Android SDK is on `dl.google.com`; the Android Gradle Plugin is on Google's Maven repository;
  Gradle itself is on `services.gradle.org`. All three are outside the network allowlist.
- Even with a compiler, an APK needs `aapt2`, `d8` and a platform jar — all from the blocked SDK.

So any Kotlin written here would be **uncompiled and untested**, which is exactly the failure mode
this project has spent a week removing: eight broken queries shipped green because nothing parsed
them, and an Android tree that has never compiled is the same mistake with a bigger surface.

## What the four apps need, in order

1. `shared/money` compiling with its tests passing (the block above).
2. `shared/api` — a Ktor client over the same 68 routes, with the error register (`ERRORS`, 187 codes)
   and the same envelope as `web/storefront/src/lib/api.ts`.
3. `shared/session` — token storage in EncryptedSharedPreferences, refresh rotation, 401 → login.
4. One app per role, each a thin Compose surface over those three: customer (browse, cart, checkout,
   order tracking), rider (offers, shift, cash), vendor (menu, orders, pause), and no admin app — the
   console is a website and an operator tool on a phone is a worse product than the console on a
   laptop.

That is months, not a turn. The storefront's PWA installs today and covers the customer on a phone in
the meantime; that is the honest interim answer, not an app.

## What would unblock it

A CI runner with the Android SDK (`ubuntu-latest` plus `setup-android` is enough), or any machine with
Android Studio. Given one, the order above is the build order and each step lands with a compile and a
test run, the same way the rest of this repository has.
