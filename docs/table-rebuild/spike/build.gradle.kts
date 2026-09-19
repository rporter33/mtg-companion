plugins {
    id("buildsrc.convention.kotlin-jvm")
    application
}

dependencies {
    implementation(project(":rules-engine"))
    implementation(project(":mtg-sdk"))
    implementation(project(":gym"))
    implementation(project(":ai"))
    // Portal only — the whole corpus is 22k files and this spike needs one small set.
    implementation(project(":mtg-sets:1993-1999"))
    implementation(libs.bundles.kotlinxEcosystem)
    runtimeOnly(libs.slf4jApi)
}

application { mainClass.set("spike.SpikeKt") }

tasks.register<JavaExec>("wire") {
    group = "application"
    mainClass.set("spike.WireKt")
    classpath = sourceSets["main"].runtimeClasspath
}
