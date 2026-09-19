# The spike module

Two programs that measure Argentum against what this project needs. The
findings are written up in `../SPIKE.md`; this is the code that produced them.

It is a Gradle module meant to be dropped into a clone of the engine:

```bash
git clone --depth 1 https://github.com/ronoccc/engine-choo-choo.git argentum
mkdir -p argentum/spike/src/main/kotlin/spike
cp build.gradle.kts            argentum/spike/
cp Spike.kt Wire.kt            argentum/spike/src/main/kotlin/spike/
printf '\ninclude(":spike")\n' >> argentum/settings.gradle.kts

cd argentum
./gradlew :spike:run     # the engine, and FRICTION.md Law 1
./gradlew :spike:wire    # payload sizes, visibility, transform cost
```

JDK 21 and network access to Maven Central. Nothing else — no Docker, no
Redis, no Keycloak. First build is about five minutes, mostly compiling
`rules-engine`; after that the loop is seconds.

`Spike.kt` plays twenty seeded games with random agents and records every
priority window — how many actions were offered, how many were affordable, and
how long enumerating them took.

`Wire.kt` walks one game building a per-player `ClientGameState` at each step,
diffs consecutive ones into a `StateDelta`, and measures both as JSON.

The module deliberately depends on `:mtg-sets:1993-1999` alone rather than the
whole 22,234-file corpus, and registers Portal only. That is what keeps the
build usable.
