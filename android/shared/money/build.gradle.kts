/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

// A plain JVM library, not an Android library: the money arithmetic is used by
// all three apps and by nothing platform-specific, so it should be testable in
// three seconds on a CI runner without an emulator or an SDK download.

plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

/**
 * Answers the shared vectors in Kotlin, for the three-language differential.
 *
 * The paths are resolved from the root project's parent because `.artifacts` lives beside
 * `android`, not inside it: the vectors belong to the repository, and a copy per module
 * would be a third place for the seed to drift.
 */
tasks.register<JavaExec>("kotlinDifferential") {
    group = "verification"
    description = "Answers the shared money vectors in Kotlin and writes .artifacts/money/kotlin.json"
    mainClass.set("app.undal.money.Differential")
    classpath = sourceSets["main"].runtimeClasspath
    val artifacts = rootProject.layout.projectDirectory.dir("../.artifacts/money")
    argumentProviders.add(CommandLineArgumentProvider {
        listOf(
            artifacts.file("vectors.json").asFile.path,
            artifacts.file("kotlin.json").asFile.path,
        )
    })
}
