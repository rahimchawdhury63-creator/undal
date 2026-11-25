/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// The root build exists to pin the toolchain once for every module rather than
// trusting each module to remember it. Fifteen modules with fifteen Kotlin
// versions is a repository that compiles differently on two laptops.
plugins {
    // Resolve every plugin once, here, with a version: when an Android module and a JVM module each
    // ask for Kotlin separately Gradle ends up with the Kotlin plugin on the classpath "with an
    // unknown version" and refuses to check compatibility. Declaring all three at the root is the
    // documented way to keep one version of each.
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.android.application) apply false
}

allprojects {
    group = "app.undal"
    version = "0.0.0"
}
