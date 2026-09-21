# The engine module

The rules-enforced table's engine is Argentum (`docs/table-rebuild/ENGINE.md`),
and this is the thin process the app puts around it: one game, JSON lines on
stdin and stdout, nothing else. The relay spawns it for an enforced room; the
browser never sees it.

It is a Gradle module meant to be dropped into a checkout of the engine, the
same way the spike was:

```bash
scripts/engine-build.sh            # clones or updates ../argentum, copies this in, builds
scripts/engine-build.sh --play     # then plays one game through it as a smoke test
```

JDK 21 and Maven Central. The first build compiles `rules-engine`, `gym`,
`ai` and one era of the card corpus, about five minutes; after that, seconds.
The launcher lands at `../argentum/companion/build/install/companion/bin/companion`
and `scripts/engine-bridge.mjs` finds it there (or wherever `ENGINE_CMD` says).

## The protocol

One request per line, one reply per line, correlated by `id`:

| Request | Reply |
| --- | --- |
| `{"op":"hello"}` | `{"engine":"argentum","protocol":1,"cards":178,"sets":["por"]}` |
| `{"op":"cards"}` | `{"names":[…]}` — every card the engine knows, for checking a deck before sitting |
| `{"op":"new","players":[{"name":"You","deck":{"Mountain":14,"Raging Goblin":12},"autoPass":true},{"name":"Bot","deck":{…},"ai":"heuristic"}]}` | the table's status (below) plus `seats` |
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

`ClientGameState` and `StateDelta` are the engine's own client DTOs
(`rules-engine/…/view/`), passed through untouched: per-viewer, with the
opponent's hand as a count and no ids. `src/lib/engine/board.js` lays them
onto the board model the table draws; `scripts/relay-engine.mjs` is the
room around this process.

## What is deliberately not here

- **Several games in one process.** One process per room keeps a crash to
  one table and the code to a page.
- **Persistence.** A room's engine state lives only in the process for now.
- **The whole card corpus.** One era is registered (Portal, for the smoke
  test). Widening it is `build.gradle.kts` and `registry()` in `Server.kt`,
  and a longer first build.
