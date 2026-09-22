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
incomplete by Argentum itself, and 13,242 card names a deck may hold. Loading
them, and building the printing registry from them, is most of the engine's
first answer: 15.2 s of 15.4 s on the owner's machine (15.9 s on a second run),
after which they hold 110 MB. The printings cost about 2.5 s and 6 MB of that;
the cards alone took 12.8 s and 104 MB. The launcher's heap ceiling is 2 GB
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
| `{"op":"hello"}` | `{"engine":"argentum","protocol":3,"cards":13242,"sets":[{"code":"POR","name":"Portal","released":"1997-05-01","incomplete":false},…],"load":{"ms":15207,"heapMb":110,"maxHeapMb":2048}}` — `cards` counts the names a deck may hold; `sets` are in release order |
| `{"op":"cards"}` | `{"names":[…]}` — every name a deck may hold: no tokens and no back faces, though the engine knows both |
| `{"op":"check","deck":{"Delver of Secrets // Insectile Aberration":4,"Made-Up Card":2},"sideboard":{…}}` | `{"known":4,"total":6,"unknown":["Made-Up Card"],"unknownSideboard":[]}` — which of a deck's cards the engine knows, before any game; unknown names come back exactly as sent |
| `{"op":"new","players":[{"name":"You","deck":{"Mountain":{"count":14,"set":"por","number":"208"},"Raging Goblin":12},"sideboard":{"Lava Axe":2},"autoPass":true},{"name":"Bot","deck":{…},"ai":"heuristic"}],"seed":20260921,"pace":true}` | the table's status (below) plus `seats` and the `seed` it was dealt from, and `paced` when the table was paced; each seat says `sideboardLeftOut`, the sideboard cards it did not know, and `unknownPrintings`, the cards whose named printing it has not got |
| `{"op":"turn"}` | the table's status |
| `{"op":"continue"}` | the next step of a paced table: the status once the engine's seat has made its next play |
| `{"op":"act","index":3}` | the status after that action and everything that followed it |
| `{"op":"act","index":0,"attackers":{"e16":"e1"}}` / `{"blockers":{"e20":["e16"]}}` | a declare-attackers or declare-blockers offer, filled in: which creatures, at whom |
| `{"op":"decide","targets":{"0":["e12"]}}` / `{"yes":true}` / `{"option":1}` / `{"auto":true}` | likewise |
| `{"op":"view","viewer":"<seat id>","delta":true}` | `{"state":ClientGameState,"log":[ClientEvent…]}` first, `{"delta":StateDelta,"log":[…]}` after; a full view's `log` is everything that seat has been told so far, a delta's only what is new since its last view |
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

`waiting` is `"action"` with `actions`, `"decision"` with `decision`,
`"engine"` on a paced table that has stopped after one of the engine's own
plays (nothing on offer, nothing to decide, and `actor` the seat that made
it), or null when the game is over or nobody is to act. `autoPassed` is how
many priority windows the server passed on the human's behalf since the last
stop, because nothing meaningful was affordable there (FRICTION.md Law 1,
asked with the engine's own `MeaningfulActionFilter`). `decided` lists the
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

**Pacing, and `continue`.** Without a pace the process runs every one of the
engine's actions before it answers, so a whole turn of the engine's arrives as
one jump and there is nothing to watch. `new` takes `pace` — `true`, or the
relay's own pace in milliseconds, which the engine reads only as a yes — and
the table then stops as soon as the engine's seat has taken one action worth
watching, with `waiting: "engine"`, `actor` that seat and nothing on offer.
`continue` takes the next step and answers the same way; when what comes next
is the player's turn to act or the game has ended, the status is what it would
have been without a pace. A decision the engine answers for itself belongs to
the action that raised it and is not a stop of its own. The waiting itself is
the relay's: this process never sleeps, because one line serves one table and a
sleeping process holds up every request on it.

"Worth watching" is `MeaningfulActionFilter` again — the engine's own
judgement, the same question Law 1 asks on the player's behalf. A priority
pass, a land tapped for mana and a declaration of nothing are not worth a
pace: the engine passes in every window of *your* turn too, so pausing for
those would put "the engine is thinking" between every step of a turn it is
only watching. What is left is what a person would call a play — a land, a
spell, an ability, a real attack or block — and a turn the engine does nothing
in arrives whole, as it does without a pace, because there was nothing in it
to see.

The stopping is all a pace changes. The same seed plays the same game with one
and without — the same actions, in the same order, to the same end — which
`tests/engine-live.test.js` checks by playing both and comparing the courses.
`continue` on a table that was not paced is refused, and so is one sent while
the table is waiting on the player rather than on itself: a relay that asks is
a relay that believes it is paced, and silence would leave it believing it.

Neither exists before protocol 3. An engine at 2 ignores `pace` — it ignores
every key it does not know — and refuses `continue` as an unknown op, so a
relay reading `hello.protocol` below 3 must not ask for a pace and must never
send `continue`. The reply to `new` says `paced` when the pace was taken, so a
relay can see that it was rather than assume.

**The log.** Each seat's log is Argentum's `ClientEvent`s for that seat, with
three changes, all found in M1's run in a browser. Every line carries its
`description`: most events work it out as a default, which `encodeDefaults =
false` left off the wire, so the table had nothing to say for a land played or
for the engine's whole turn. A card moving between another seat's hidden zones
(library, hand) is left out of your log, because Argentum names every zone
change whoever is looking, and the opponent's opening hand arrived card by card;
it was on the wire before the words were. A card drawn or discarded is said
once, by its own event, not again as a move into hand or graveyard. Taps,
untaps and mana are left out, as Argentum's own game server leaves them out
(`GameSession`). The engine marks each turn with a `turnChanged` line; the
table draws it as its own turn header and files what follows under that turn.

The `log` beside a full `state` is that seat's whole log. The `log` beside a
`delta` is only the lines added since that seat's last view, in order, and the
client appends them to the log it already holds; a full view sends everything
again and starts the count over, which is what a client does when it has missed
a delta. (`StateDelta` has a `newLogEntries` of its own, which is always absent
here: `ClientStateTransformer` never fills `ClientGameState.gameLog`, and this
process keeps each seat's log itself so it can mask and phrase it.) Every line
still carries its `description` and its `step`, whichever way it arrives. A
paced turn asks for a view every few hundred milliseconds, and the whole log
each time would soon be most of what the wire carried.

**Printings.** A deck line may name the printing the player chose, by
Scryfall's set and collector number, and the deal puts that printing's art on
the card. `env.reset` cannot do that: it builds its GameInitializer without a
printing registry. So the process deals the game itself, with Argentum's
`GameInitializer(registry, printings)`, installs it with `env.restore`, and
keeps the deal's events for the log, which `restore` would drop. The printing
registry is built the way game-server builds its own: a default printing from
every definition, then each set's reprint rows. A pin is kept only when the
engine has that printing and it is the same card, compared by the card's front,
so a double-faced card's pin survives. One it has not got is dealt with the
engine's own art, and the seat's `unknownPrintings` says which, so the table
can say so once in the log: the owner's choice on 2026-09-21, the engine's art
for every seat rather than a different face for each. Protocol 2 is this shape;
the relay sends an engine at protocol 1 plain counts.

**The sideboard.** `sideboard` sits beside `deck`, in the same shape, and is
left out when empty, so an older engine never sees it. It becomes Argentum's
`Deck.sideboard`: the cards a player owns outside the game, which only a wish
reaches (Argentum cites CR 100.4 for it). The seat's own view gains a sideboard
zone; another seat sees only its count. A sideboard card the engine does not
know is left out rather than refusing the game, as the owner chose on
2026-09-21, and each seat in the reply to `new` names what was left out as
`sideboardLeftOut`, so the table can say so. The app sends a sideboard only for
a format that has one: the Commander family's holds nothing, and what a
Commander deck keeps there is usually its maybeboard.

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
onto the board model the table draws (`applyDelta` is that DTO's contract in
JavaScript, with the two fields it cannot carry named in its header:
`voidActive` and `activeYields` are on the state and on no delta, so a
delta-fed view holds the last whole view's word for them, as Argentum's own
client does); `scripts/relay-engine.mjs` is the room around this process.

**The captured run.** `node scripts/engine-capture.mjs` plays a paced game
from a fixed seed and writes `tests/fixtures/engine-views.json`: every stop as
the delta since the one before it, and, at the moments worth pinning, the
whole state the engine would have sent instead. `tests/engine-delta.test.js`
walks that run and holds the applied deltas against those full views, which is
what says `applyDelta` agrees with `StateDiffCalculator` rather than with this
app's reading of it. It takes about 40 s, needs a built engine, and keeps the
first capture's `shots` unless asked for `--shots`, because the adapter's older
tests hold those to exact life totals and card ids. Its header says what the
window holds and what it could not reach, and a run that reached neither a
decision nor declared blockers says so on the way out rather than reporting
success with the gap in. The mark for a stop where blockers may be declared is
`blockable`; `blocks` is blockers actually on the board, which no view a client
is sent has ever carried.

## What is deliberately not here

- **Several games in one process.** One process per room keeps a crash to
  one table and the code to a page.
- **Persistence.** A room's engine state lives only in the process for now.
- **A warm engine.** Each room starts its own process and waits out the 15 s
  load. Keeping one loaded and ready is a question for hosting (M8), once the
  cost of an idle JVM is measured against the wait.
