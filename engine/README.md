# The engine module

The rules-enforced table's engine is Argentum (`docs/table-rebuild/ENGINE.md`),
and this is the thin process the app puts around it: one game, JSON lines on
stdin and stdout, nothing else. The relay spawns it for an enforced room; the
browser never sees it.

It is a Gradle module meant to be dropped into a checkout of the engine, the
same way the spike was:

```bash
scripts/engine-build.sh            # fetches ../argentum at the pinned commit, copies this in, builds
scripts/engine-build.sh --play     # then plays one game through it as a smoke test
```

JDK 21 and Maven Central. The build compiles `rules-engine`, `gym`, `ai` and
the whole card corpus. Measured on the owner's Windows machine on 2026-09-21:
280 s for the base modules with one era, then 153 s more for every other era;
after that, seconds.

**The whole corpus, loaded.** Every set Argentum has: 179 of them, 137 marked
incomplete by Argentum itself, and 13,246 card names a deck may hold. Loading
them is most of the engine's first answer, 12.8 s of 13.1 s on the owner's
machine, and they then hold 104 MB. The launcher's heap ceiling is 2 GB
(`-Xmx2g`, the ceiling Argentum gives its own whole-corpus tests; set
`COMPANION_OPTS` to change it), and `hello` reports what was actually used. The
relay gives an engine's first answer two minutes (`STARTUP_MS` in
`relay-engine.mjs`) and every later one 30 s, so a hung engine is still noticed.

A bare basic land wears the newest art that registered its name, which at the
pinned commit is The Hobbit's: the registry keeps the last definition under a
name, and basic lands are the one card upstream defines in many sets.

**The pin.** Argentum is fetched at one commit, `70d525c` (2026-09-20), and
not at upstream `main`, which moves daily. `ENGINE_REV` overrides it for an
experiment. Moving the default is a deliberate commit, with the first compile
and a game measured again.

**`JAVA_HOME`.** Gradle builds with whatever `JAVA_HOME` names. Where that is
a Java runtime rather than a JDK, the script builds with the JDK on `PATH`
instead and says so, rather than let Gradle fail with "No Java compiler found",
which does not mention `JAVA_HOME` at all.

The launchers land in `../argentum/companion/build/install/companion/bin/`:
`companion`, a shell script, and `companion.bat`. `scripts/engine-bridge.mjs`
picks the one the platform can run (or runs whatever `ENGINE_CMD` says). On
Windows it starts the `.bat` through a shell, and if it ever has to force the
engine closed it ends the whole process tree, because killing the shell alone
leaves the JVM running.

## The protocol

One request per line, one reply per line, correlated by `id`:

| Request | Reply |
| --- | --- |
| `{"op":"hello"}` | `{"engine":"argentum","protocol":1,"cards":13246,"sets":[{"code":"POR","name":"Portal","released":"1997-05-01","incomplete":false},…],"load":{"ms":12842,"heapMb":104,"maxHeapMb":2048}}` — `cards` counts the names a deck may hold; `sets` are in release order |
| `{"op":"cards"}` | `{"names":[…]}` — every name a deck may hold: no tokens and no back faces, though the engine knows both |
| `{"op":"check","deck":{"Delver of Secrets // Insectile Aberration":4,"Made-Up Card":2},"sideboard":{…}}` | `{"known":4,"total":6,"unknown":["Made-Up Card"],"unknownSideboard":[]}` — which of a deck's cards the engine knows, before any game; unknown names come back exactly as sent |
| `{"op":"new","players":[{"name":"You","deck":{"Mountain":14,"Raging Goblin":12},"autoPass":true},{"name":"Bot","deck":{…},"ai":"heuristic"}],"seed":20260921}` | the table's status (below) plus `seats` and the `seed` it was dealt from |
| `{"op":"turn"}` | the table's status |
| `{"op":"act","index":3}` | the status after that action and everything that followed it |
| `{"op":"act","index":0,"attackers":{"e16":"e1"}}` / `{"blockers":{"e20":["e16"]}}` | a declare-attackers or declare-blockers offer, filled in: which creatures, at whom |
| `{"op":"decide","targets":{"0":["e12"]}}` / `{"yes":true}` / `{"option":1}` / `{"auto":true}` | likewise |
| `{"op":"view","viewer":"<seat id>","delta":true}` | `{"state":ClientGameState,"log":[ClientEvent…]}` first, `{"delta":StateDelta,"log":[…]}` after; the log is everything that seat has been told so far, phrased for it |
| `{"op":"quit"}` | `{"ok":true}` and the process ends |

The status is where the table stands and what it is waiting for:

```json
{"ok":true,"over":false,"winner":null,"turn":3,"phase":"PRECOMBAT_MAIN","step":"PRECOMBAT_MAIN",
 "actor":"e0","waiting":"action",
 "actions":[{"index":0,"type":"PassPriority","description":"Pass priority","affordable":true,"meaningful":false},
            {"index":1,"type":"PlayLand","description":"Play Mountain","affordable":true,"meaningful":true,"card":"e14"},
            {"index":2,"type":"ActivateAbility","description":"{T}: Add {R}","affordable":true,"meaningful":false,"mana":true,"card":"e13"}],
 "autoPassed":4,"decided":[]}
```

`card` is the card an action is about, so a tap on it can find its offer;
`meaningful` is the engine's own judgement of whether the action is worth
stopping for (a mana ability is not, and is marked `mana`); a
declare-attackers offer carries `validAttackers` and `validAttackTargets`,
a declare-blockers one `validBlockers`.

`waiting` is `"action"` with `actions`, `"decision"` with `decision`, or null
when the game is over or nobody is to act. `autoPassed` is how many priority
windows the server passed on the human's behalf since the last stop, because
nothing meaningful was affordable there (FRICTION.md Law 1, asked with the
engine's own `MeaningfulActionFilter`). `decided` lists the
decisions the engine's responder answered for a human seat because this
protocol cannot yet ask them (ordering, damage assignment, mana sources), so
the table can say so.

`seed` decides the shuffle and every other "at random" (Argentum's
`GameConfig.seed`), so the same seed with the same decks plays the same game,
the AI's choices included; `tests/engine-live.test.js` holds it to that. Sent
without one, the process picks a seed and returns it in the reply to `new`,
so any game can be played again exactly. A seed it picks stays below 2^53,
because the relay reads it as a JavaScript number and a larger one would
come back as a different game. The relay passes a seed only when told to
(`createRelay({ engineSeed })`), which the engine's browser spec does so as
to play one known game.

**Names.** A deck is sent in Scryfall's spelling, because that is what the app
holds, and `new` and `check` resolve it the same way. A name the engine knows
exactly is taken as it is; split cards and Rooms are known whole ("Assault //
Battery"). A card with two faces is "Front // Back" to Scryfall and known by its
front here, which is taken only when every later part really is one of that
card's faces: a transforming or modal card's back, an adventure's, an Omen's or
a prepare card's other half. Refused: a back face on its own, two unrelated
cards glued together, a token, and "X // X", which is how Scryfall names an
art-series card; the app sends a reversible card, which Scryfall names the same
way, by its single name. A deck line may be a count, `{"count":4,"set":"mid",
"number":"50"}`, or a list of those, and one card sent in two spellings or two
printings is one line of the deck.

`ClientGameState` and `StateDelta` are the engine's own client DTOs
(`rules-engine/…/view/`), passed through untouched: per-viewer, with the
opponent's hand as a count and no ids. `src/lib/engine/board.js` lays them
onto the board model the table draws; `scripts/relay-engine.mjs` is the
room around this process.

## What is deliberately not here

- **Several games in one process.** One process per room keeps a crash to
  one table and the code to a page.
- **Persistence.** A room's engine state lives only in the process for now.
- **A warm engine.** Each room starts its own process and waits out the 13 s
  load. Keeping one loaded and ready is a question for hosting (M8), once the
  cost of an idle JVM is measured against the wait.
