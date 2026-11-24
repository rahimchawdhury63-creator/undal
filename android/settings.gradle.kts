/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// The Android build starts with the money module because it is the only part
// that must agree with two other languages before any screen exists. The three
// apps join this build in their own responses.
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "undal"

include(":shared:money")
