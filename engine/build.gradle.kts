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
    // The whole card corpus. The :mtg-sets aggregator re-exports core and every
    // era, and it is what Argentum's own game-server and gym-server depend on;
    // Server.kt registers every set MtgSetCatalog finds on the classpath.
    implementation(project(":mtg-sets"))
    implementation(libs.bundles.kotlinxEcosystem)
    runtimeOnly(libs.slf4jApi)
}

application {
    mainClass.set("companion.ServerKt")
    // A ceiling, not a measurement: the one Argentum gives its own whole-corpus
    // test JVMs (buildSrc kotlin-jvm.gradle.kts, maxHeapSize "2g"). What the
    // corpus actually holds is in hello's load.heapMb. COMPANION_OPTS overrides it.
    applicationDefaultJvmArgs = listOf("-Xmx2g")
}
