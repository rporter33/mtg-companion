plugins {
    id("buildsrc.convention.kotlin-jvm")
    application
}

// This module is dropped into a checkout of Argentum as `:companion` by
// scripts/engine-build.sh; it is not a standalone build. See engine/README.md.
dependencies {
    implementation(project(":rules-engine"))
    implementation(project(":mtg-sdk"))
    implementation(project(":gym"))
    implementation(project(":ai"))
    // One era of the card corpus, the same one the spike compiled, so a first
    // build is minutes rather than the better part of an hour. Widening it is
    // a matter of adding eras here and registering their sets in Server.kt.
    implementation(project(":mtg-sets:1993-1999"))
    implementation(libs.bundles.kotlinxEcosystem)
    runtimeOnly(libs.slf4jApi)
}

application { mainClass.set("companion.ServerKt") }
