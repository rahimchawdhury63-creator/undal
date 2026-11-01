/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// The root build exists to pin the toolchain once for every module rather than
// trusting each module to remember it. Fifteen modules with fifteen Kotlin
// versions is a repository that compiles differently on two laptops.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
}

allprojects {
    group = "app.undal"
    version = "0.0.0"
}
