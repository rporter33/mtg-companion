# The spike: Argentum, actually run

**Run 2026-09-19. Everything below is measured, not estimated.**

`PLAN.md` Phase 3 step 2 says to stand the engine up and drive a whole game
through it before committing to anything. This is that, done. The code is in
`spike/` and reproduces in about six minutes from a clean clone.

The short version: **it works, it is fast enough, the protocol is already
there, and one measurement changed how `FRICTION.md` Law 1 has to be written.**

---

## How to reproduce

```bash
git clone --depth 1 https://github.com/ronoccc/engine-choo-choo.git argentum
cd argentum
cp -r <this folder>/spike ./spike                 # the module below
printf '\ninclude(":spike")\n' >> settings.gradle.kts
./gradlew :spike:run     # part 1 — the engine and Law 1
./gradlew :spike:wire    # part 2 — the wire
```

Needs JDK 21. No Docker, no Redis, no Keycloak, no network beyond Maven
Central. `just` is not required — it only wraps `scripts/gradle-locked`.

**Build times, measured in a cold sandbox container:**

| Task | Time |
| --- | --- |
| `:rules-engine:compileKotlin :gym:compileKotlin` | **4m 06s** |
| `:mtg-sets:1993-1999:compileKotlin :ai:compileKotlin` | **43s** |
| `:spike:compileKotlin` | 12s |

The card corpus is 22,234 Kotlin files split into nine era modules. **You do
not have to compile all of them** — the spike registers Portal only (158 cards
+ 20 basic lands) and depends on `:mtg-sets:1993-1999` alone. That is what
keeps the loop fast.

---

## 1. Does a whole game run? Yes — 20 out of 20

Two `RandomActionSelector` agents, seeded, 26-card Portal decks.

| | |
| --- | --- |
| Games reaching a natural end | **20 / 20** |
| Average turns per game | 40 |
| Average engine steps per game | 1,016 |
| Wall clock per complete game | **809 ms** (min 560, max 1,871) |

A full game of Magic, rules-enforced end to end, in under a second. Not a
demo — twenty of them, unattended, no crashes.

## 2. Law 1, measured — and the number is not what I assumed

`FRICTION.md` Law 1: *never stop at a priority window where the player can do
nothing.* Across 20 games, **20,337 priority windows**:

| Measure | Count | Share |
| --- | --- | --- |
| Windows where **PASS is the only legal action** | 280 | **1.4%** |
| Windows where **nothing is affordable** | 10,145 | **49.9%** |

**These two numbers are very different, and the difference is the finding.**

The engine enumerates actions the player cannot pay for and marks them
`affordable = false`. So "there is a legal action" and "the player can actually
do something" are not the same question, and Law 1 must ask the second one.
Written against `nonPass > 0` it would fire on 1.4% of windows and leave the
other half of the ceremony in place.

> **Law 1, corrected**: stop only when the player has at least one
> **affordable** non-pass action. `LegalAction.affordable` is the field.

By step, dead by the strict "only pass" measure:

| Step | Windows | Dead | |
| --- | --- | --- | --- |
| `BEGINNING.UNTAP` | 40 | 40 | **100%** |
| `BEGINNING.DRAW` | 3,065 | 60 | 2.0% |
| `COMBAT.END_COMBAT` | 1,650 | 24 | 1.5% |
| `BEGINNING.UPKEEP` | 4,561 | 60 | 1.3% |
| `ENDING.END` | 1,598 | 20 | 1.3% |
| `COMBAT.BEGIN_COMBAT` | 1,942 | 24 | 1.2% |
| `POSTCOMBAT_MAIN` | 1,865 | 20 | 1.1% |
| `PRECOMBAT_MAIN` | 3,125 | 20 | 0.6% |
| `COMBAT.DECLARE_ATTACKERS` | 2,491 | 12 | 0.5% |

**Caveat, stated honestly.** These are random agents. A random player dumps its
hand and taps out, which probably *inflates* the "nothing affordable" share
against a real player who holds mana up for a trick. Treat 49.9% as the shape
of the answer, not a promise. Re-measure against the built-in heuristic AI
before quoting it anywhere.

Even so: roughly **1,000 priority windows per game**. Whatever the exact
fraction, the number of confirmations Moxgate can ask for in "Controlled" mode
is in the hundreds per game. That is the complaint, quantified.

## 3. Is asking cheap enough to do every window? Yes

`legalActions()` timed at 20,337 real game states:

| | |
| --- | --- |
| median | **260 µs** |
| p90 | 509 µs |
| p99 | 854 µs |
| max | 11.9 ms |

Law 1 calls this once per window, **server-side**, before deciding whether to
prompt at all. At ~1,000 windows per game that is **about 0.26 s of enumeration
across an entire game**. Law 1 is free.

## 4. The wire

**`GameState` cannot be serialised naively.** Encoding it throws:

```
SerializationException: Serializer for subclass 'PlayerComponent' is not found
in the polymorphic scope of 'Component'.
```

That is not a defect — it is an ECS with polymorphic components, and it is
exactly why the engine ships a `view/` package. The real protocol is:

```
GameState ──ClientStateTransformer.transform(state, viewer)──▶ ClientGameState
ClientGameState(prev, next) ──StateDiffCalculator.computeDelta──▶ StateDelta
```

Both DTOs are `@Serializable`. Measured over 400 actions to turn 18:

| Payload | median | p90 | max |
| --- | --- | --- | --- |
| Full `ClientGameState` | **16.7 KB** | 23.4 KB | 23.5 KB |
| `StateDelta` | **2.65 KB** | 5.0 KB | 7.2 KB |

**A delta is 15.9% of a full push.** Building a view costs a median of
**1.03 ms** (p90 1.68 ms). So the update loop is: transform, diff, send ~2.6 KB.
That is comfortable on a phone on venue wifi, which was the original worry.

## 5. Hidden information is already enforced

Transforming the same state for each player:

```
Alice sees her own hand:   7 cards, 7 with a name
Alice sees Bob's hand:     7 cards, 0 with a name
```

The opponent's hand arrives as **opaque ids with a correct count**. So
`TARGET.md` §9 — *"hidden information is visibly hidden"*, greyed with no
thumbnail — is handed to us by the engine rather than being a rule we have to
implement and then be careful never to break. `Visibility.kt` does it.

---

## What this changes in the plan

### The protocol layer lives in `rules-engine`, not in their server

`ClientStateTransformer`, `StateDiffCalculator`, `StateDelta`, `ClientDTO` and
`Visibility` are all under
`rules-engine/src/main/kotlin/com/wingedsheep/engine/view/`.

**We do not need their `game-server`.** It brings Spring Boot, Keycloak,
Redis, matchmaking and their own lobby — and `TARGET.md` says we are building
our own lobby anyway. We can write a thin server of our own around
`rules-engine` + `gym` + `view/`, own the protocol, and skip all of it.

That is a much smaller integration surface than Phase 3 assumed, and it means
**we control the wire format** — so Law 1 and Law 2 can be designed into the
protocol rather than worked around in the client.

### `LegalAction` already carries what the UI needs

```kotlin
data class LegalAction(
    val action: GameAction,
    val actionType: String,      // "PassPriority", "CastSpell", "PlayLand", …
    val description: String,     // human text, ready for the actions panel
    val affordable: Boolean,     // ← the castability glow, TARGET.md §11
    val validTargets: List<EntityId>?,
    val requiresTargets: Boolean,
    val targetCount: Int,
    val minTargets: Int,
    …
)
```

`affordable` is the green glow in `TARGET.md` §11, given to us correctly
instead of approximated. `description` is the Available Actions row text.
`validTargets` is what Law 2 needs to make targeting a post-action step rather
than a pre-action guess.

### Things worth knowing that were not on the list

- **Games are deterministic and seedable.** `GameConfig.seed` drives turn
  order, shuffles and every "at random" choice, and the chosen seed is recorded
  on the result. A bug in a game can be replayed exactly. That is worth
  building the browser specs around from day one.
- **`Format.Commander` is supported** — `GameConfig.format` plus
  `PlayerConfig.commanderCardName`. Partner/Background is noted as later work.
- **Free-for-all is real**, with `AttackMode` and a `teams` field for Two-Headed
  Giant (CR 810). Commander pods are not speculative.
- **The engine ships a heuristic AI** and a `DecisionResponder` that answers
  scry/target/search prompts, so a solo opponent needs no work from us.

## 6. The browser question, measured — and it is much more open than I thought

`ENGINE.md` recorded Argentum as JVM-only, which it is: the build has no
Kotlin Multiplatform, no `js()` target, no WASM. The interesting question is
how *hard-wired* to the JVM the engine actually is. Counted over
`rules-engine/src/main` — **824 Kotlin files**:

| Construct | Files | Kotlin/JS? |
| --- | --- | --- |
| `import kotlin.reflect.KClass` | 370 | **Yes** — `KClass` and `::class` exist in Kotlin/JS |
| `::class` | 408 | **Yes** |
| `import java.*` / `javax.*` | **4** | No — must be replaced |
| `::class.java` | **4** | No — must be replaced |
| `.javaClass` | **1** | No |

Every one of the 370 `kotlin.reflect` files imports **`KClass` and nothing
else**. That is not JVM reflection; it is type-keyed lookup, and it ports.

The entire JVM-bound surface of the engine core is these four files:

```
handlers/effects/library/LibraryExecutors.kt   java.util.concurrent.atomic.AtomicReference
handlers/effects/zones/ZonesExecutors.kt       java.util.concurrent.atomic.AtomicReference
replacement/ReplacementEffectProcessor.kt      java.util.*
loader/SetLoader.kt                            java.util.ServiceLoader
```

plus the ECS component container keying components by `Class<T>`
(`components[T::class.java]`) in about four call sites.

So a Kotlin Multiplatform port would mean: swap the component map to `KClass`
keys, replace two `AtomicReference`s (trivial in single-threaded JS), and
replace `ServiceLoader` set discovery with explicit registration. **A dozen
call sites, not a rewrite.**

That does not change the immediate plan — build against the JVM server, it
works today. But it means the long-term outcome where the engine runs **in the
browser with no server at all** is credible rather than wishful, and it is
worth raising with upstream, whose own `mtg-sdk` is already free of `java.*`
in 224 of its 228 files.

## Still open after this spike

- **Re-run Law 1 against the built-in AI** rather than the random agents used
  here, to get an honest "nothing affordable" figure for realistic play. This
  is the one number in this document that should not be quoted until it is
  redone.
- **Bundle size** with a jlink-trimmed JRE — untouched here, and the last
  thing standing between this and a desktop build.
- **The Kotlin/JS port**, per section 6. Not now, but no longer fanciful.
