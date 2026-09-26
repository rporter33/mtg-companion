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
scripts/engine-build.sh --rev      # says the commit it would build, and does nothing else
scripts/engine-build.sh --repo     # says where it fetches Argentum from, and does nothing else
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

**In CI** (`.github/workflows/deploy.yml`, since `HANDOFF.md` M9) the same
script builds the engine on `ubuntu-latest` with Temurin 21, into `../argentum`
beside the checkout, where `findEngine` looks. The install it leaves is cached
whole, keyed on the pin as `--rev` says it and a hash of `build.gradle.kts`,
`src/` and the script itself, so a push that changes none of them runs the
engine without compiling it; one that does restores Gradle's own cache first.
The job sets `ENGINE_REQUIRED`, and there a suite that finds no engine fails
rather than skipping (`engineRequired` in `scripts/engine-bridge.mjs`).

**Moving the pin, offered weekly** (`.github/workflows/engine-pin.yml`, since
`HANDOFF.md` §3 item 12). Every Monday, and when run by hand, a workflow builds
upstream `main` with this module, beside the pin's own build, and runs the live
suite and the engine's two browser specs against it. Only where every one passes
does it open a pull request moving the default above, and only where none it opened
is open; its body, written by `scripts/engine-pin.mjs` from what the run kept, says
the sets new since the pin from each engine's `hello.sets`, both engines' `load.ms`
and `heapMb` as measured on the same runner, the build's time and the results. The
owner merges it. Upstream's code is built and run on a branch the workflow makes for
the one run, `engine-pin-try/`, and deletes after it, in a job whose token can only
read the repository, whose checkout keeps no credentials and which has no step that
saves a cache. Those settings govern the workflow's steps, not what upstream's code
does beside them on the runner, where the token that writes the Actions cache is held;
the branch is what keeps anything it wrote from `main`'s runs, since a run restores
only its own branch's caches and `main`'s. The jobs that can write run none of it, and
push only to the workflow's own branches, never `main`. It needs the repository
setting "Allow GitHub Actions to create and approve pull requests" switched on.

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
| `{"op":"hello"}` | `{"engine":"argentum","protocol":10,"cards":13242,"sets":[{"code":"POR","name":"Portal","released":"1997-05-01","incomplete":false},…],"levels":{"easy":"v0","intermediate":"production-raceclock","hard":"production-candidate-expiring"},"choices":{"act":["targets","x","damage","cost","auto","cards"],"costs":["DiscardCard",…],"decisions":["ChooseTargets","YesNo","ChooseOption","SelectCards",…]},"formats":["standard","commander","duel","brawl"],"decks":{"formats":["standard","pioneer","modern","legacy","vintage","pauper","premodern","commander","brawl"]},"load":{"ms":27342,"legalitiesMs":601,"heapMb":127,"maxHeapMb":2048}}` — `cards` counts the names a deck may hold; `sets` are in release order; `levels` are the strengths an engine seat may play at, weakest first, each with the Argentum profile behind it; `choices` is what a person may choose over this protocol (below); `formats` the games it deals (protocol 8, and since 10 Duel Commander and Brawl, below); `decks.formats` the formats an engine's seat can be dealt a deck of its own in (protocol 7, below; Commander's only at a Commander table, and Brawl's only at a Brawl one); `load.legalitiesMs` what stamping every card with the formats it is legal in took, of `load.ms` |
| `{"op":"cards"}` | `{"names":[…]}` — every name a deck may hold: no tokens and no back faces, though the engine knows both |
| `{"op":"check","deck":{"Delver of Secrets // Insectile Aberration":4,"Made-Up Card":2},"sideboard":{…}}` | `{"known":4,"total":6,"unknown":["Made-Up Card"],"unknownSideboard":[]}` — which of a deck's cards the engine knows, before any game; unknown names come back exactly as sent |
| `{"op":"new","players":[{"name":"You","deck":{"Mountain":{"count":14,"set":"por","number":"208"},"Raging Goblin":12},"sideboard":{"Lava Axe":2},"autoPass":true,"answers":["SelectCards","CombatResolution"]},{"name":"Bot","deck":{…},"ai":"heuristic","level":"intermediate"}],"seed":20260921,"pace":true,"mulligans":true}` | the table's status (below) plus `seats` and the `seed` it was dealt from, `paced` when the table was paced, and `mulligans` when it was dealt with the hands to keep (protocol 6, below); each seat says `sideboardLeftOut`, the sideboard cards it did not know, and `unknownPrintings`, the cards whose named printing it has not got; a seat the engine plays with its own judgement also says the `level` it took (null for none) and the Argentum `profile` it plays with; a person's seat says `asked`, the decisions it will be put rather than have answered for it |
| `{"op":"new","players":[{"name":"You","deck":{…}},{"name":"Bot","ai":"heuristic","deck":"own","format":"standard","sets":["blb","dsk"]}],…}` / `"deck":"mirror"` | as above, and the engine's seat says what it was dealt as `deck`: `{"asked":"own","played":"own","cards":60,"colours":["W","G"],"format":"standard","formatName":"Standard","from":"sets","sets":[{"code":"BLB","name":"Bloomburrow"},…],"missingSets":[…]?,"fellBack":…?,"why":…?}` — a seat the engine plays may bring no deck and ask for a copy of the first person's or one of its own (protocol 7, below) |
| `{"op":"new","format":"commander","players":[{"name":"You","deck":{"Forest":50,"Plains":49},"commander":{"name":"Rhys the Redeemed","set":"shm","number":"237"}},{"name":"Bot","ai":"heuristic","deck":"own","format":"commander"}]}` | as above, dealt as a Commander game (protocol 8, below): the reply says `"format":"commander"` and, since protocol 10, `"rules":{"life":40,"deckSize":100,"commanderDamage":21}`, each seat its `commander`, and a seat the engine plays says its commander in its `deck` too, with `cards` counting it — `{"asked":"own","played":"own","cards":100,"colours":["W"],"commander":"Jareth, Leonine Titan","format":"commander",…}` |
| `{"op":"decklist","seat":"e1"}` | `{"commander":"Jareth, Leonine Titan","deck":{"Plains":{"count":17,"set":"BLB","number":"262"},…},"cards":[{"name":"Plains","typeLine":"Basic Land — Plains","manaCost":"","colours":[],"identity":["W"],"legal":["standard",…]},…]}` — the deck a seat was dealt, with what the engine's own card data says of each card, its colour identity among it; at a Commander table the commander, apart from the deck as it was dealt apart; for measuring and tests, and never sent by the relay, since the engine's deck is as hidden as any opponent's |
| `{"op":"turn"}` | the table's status |
| `{"op":"continue"}` | the next step of a paced table: the status once the engine's seat has made its next play |
| `{"op":"act","index":3}` | the status after that action and everything that followed it |
| `{"op":"act","index":0,"attackers":{"e16":"e1"}}` / `{"blockers":{"e20":["e16"]}}` | a declare-attackers or declare-blockers offer, filled in: which creatures, at whom |
| `{"op":"act","index":1,"targets":{"0":["e1"]},"x":2,"damage":{"e1":2,"e0":1},"cost":["e22"]}` / `{"auto":true}` | a spell or an ability, filled in with what the person chose — its targets requirement by requirement, its X, how its damage is divided, what its cost takes — or with the engine's choice of all of them (protocol 5) |
| `{"op":"act","index":0,"cards":["e31"]}` / `{"auto":true}` | the cards put on the bottom after keeping a hand with mulligans taken, or the engine's choice of them (protocol 6) |
| `{"op":"decide","targets":{"0":["e12"]}}` / `{"yes":true}` / `{"option":1}` / `{"auto":true}` | likewise; since protocol 5 also `{"cards":[…]}`, `{"order":[…]}`, `{"distribution":{"e1":2}}`, `{"edges":{"e27->e71":2}}`, `{"sources":[…]}` / `{"autoPay":true}` / `{"decline":true}`, `{"number":2}`, `{"color":"RED"}`, `{"modes":[0]}`, `{"yes":true,"all":true}` (below) |
| `{"op":"view","viewer":"<seat id>","delta":true}` | `{"state":ClientGameState,"log":[ClientEvent…]}` first, `{"delta":StateDelta,"log":[…]}` after; a full view's `log` is everything that seat has been told so far, a delta's only what is new since its last view |
| `{"op":"snapshot"}` | `{"snapshot":"{\"kind\":\"companion-game\",\"version\":1,…}","bytes":130067}` — the game as it stands, as text: Argentum's `GameState` and what this process keeps beside it (protocol 9, below); `bytes` its length in UTF-8 |
| `{"op":"restore","snapshot":"…"}` | the reply `new` gives, at the stop the game was kept at, and `"restored":true` — a kept game taken back by a process that holds none yet; `"replace":true` takes it into one that does, for measuring and tests, and the relay never sends it (protocol 9) |
| `{"op":"clock"}` | `{"seats":[{"id":"e1","ai":"heuristic","level":"hard","profile":"production-candidate-expiring","choices":[{"ms":88.4,"meaningful":true},{"ms":0.1,"meaningful":false},{"ms":12.0,"decision":true,"meaningful":true}]}]}` — how long each of the engine's seats took over every choice since the last `clock`, which starts the record again; for measuring, and never sent by the relay |
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

An offer whose cost has more in it than mana says so: `additionalCost` is
Argentum's own kind for it (`DiscardCard`, `SacrificePermanent`,
`SacrificeSelf`, `PayLife` and so on, from `LegalAction.additionalCostInfo`)
and `additionalCostText` its words, and a forage cost adds `requiresForage`.
Sent bare, an offer whose cost is a choice is refused — Flamecache Gecko's
`{"additionalCost":"DiscardCard","additionalCostText":"Discard a card"}` comes
back "Must choose 1 card(s) to discard", which `tests/engine-live.test.js`
checks. Sacrificing the source itself and paying life need nothing chosen. The
keys are said only where there is such a cost, so an older client reads every
offer as before; they came after M3, in its review, without a new protocol
number, because nothing that reads the status is asked to do anything new.

**What a person chooses (protocol 5, M4).** Argentum's own client sends a
spell or an ability whole: a `CastSpell` or `ActivateAbility` with its targets,
its X, its division of damage and its cost's payment filled in (web-client
`pipelinePhases.ts`), and the engine refuses one that needed any of them and
came without. So `act` now carries them, and an offer says what it needs:

- `targetRequirements`, beside the flat `validTargets` an offer needing targets
  always had: every requirement in order, `{index, description, min, max,
  legal, distinct?}`. Argentum lists them itself only where there are several;
  one is said the same way so a client reads one shape. `act`'s `targets` is
  `{"0": [ids], "1": [ids]}`, the shape `decide` already took, and each id
  becomes the kind of target its object is where it stands — a player, a
  permanent, a spell on the stack, a card in a zone — by Argentum's own
  `entityIdToChosenTarget`. Argentum reads a play's targets by position, each
  requirement from where the ones before it could have ended, so a requirement
  given fewer than it could take with targets chosen for a later one is refused
  here in words rather than read as something nobody chose. A requirement left
  out of `targets` counts as given none, and a key naming no requirement the
  offer has is refused by its name.
- `x: {min, max}` on a spell with an X in its cost: `act`'s `x`. A `CastSpell`
  sent without one is cast at X = 0, which is what every table before this sent.
  An ability's X is not described: Argentum asks it as a `ChooseNumber` once
  the ability is activated bare.
- `divide: {total, min}` on a spell that divides its damage among its targets:
  `act`'s `damage`, `{"e1": 2, "e0": 1}`. Argentum requires it at more than one
  target, and refuses a division that does not add up to the total.
- `costChoice: {min, max, candidates}` where the cost is one `act`'s `cost` can
  pay with the ids chosen: discarding, sacrificing, tapping, returning,
  exiling from a graveyard or a hand, beholding, revealing, blighting
  (`PAYABLE` in `Server.kt`, the same mapping Argentum's own client and AI use
  onto `AdditionalCostPayment`). A kind not among them — a sum of mana values,
  a forage — has no `costChoice`, and a client holds it back as before; `cost`
  sent for one is refused in words.
- `act`'s `auto: true` hands the lot to the engine: the person's own responder
  (Argentum's `Strategist`, given that one offer) fills in X, targets and the
  automatic payments, as it does for the engine's seat. It chooses the play
  whole, so anything sent beside `auto` is not read: a client that has had
  some of it chosen already says those choices go.

And `new` takes, on a person's player, `answers`: the decisions their client
can put on screen. Those are asked rather than answered for them, as targets, a
yes or no and an option always were; the reply's seat says `asked`, the whole
list that seat will be put. The decisions this process can ask, each described
in full in the status and answered in `decide` with the response Argentum's own
validator expects:

| Decision | Described with | `decide` |
| --- | --- | --- |
| `SelectCards` | `min`, `max`, `options`, `shown`, `selectedLabel`, `remainderLabel`, `ordered`, `cards` | `{"cards":[…]}` |
| `OrderObjects`, `ReorderLibrary` | `objects` (first first), `cards`; for a library, `placement` and `library` (below) | `{"order":[…]}` |
| `Distribute` | `total`, `minPer`, `maxPer`, `targets`, `allowPartial` | `{"distribution":{id:n}}` |
| `CombatResolution` | `firstStrike`, `edges` (`id`, `source`, `target`, `amount` — the engine's own split — `maximum`, `lethal`, `trample`, `mine`), `attackers`, `blockers`, `defenders` | `{"edges":{edgeId:n}}`, this seat's edges only |
| `SelectManaSources` | `cost`, `canDecline`, `sources`, `suggested` | `{"sources":[…]}`, `{"autoPay":true}` or `{"decline":true}` |
| `ChooseNumber` | `min`, `max` | `{"number":n}` |
| `ChooseColor` | `colors` (Argentum's names, `"RED"`) | `{"color":"RED"}` |
| `ChooseMode` | `min`, `max`, `modes` (`index`, `text`, `available`) | `{"modes":[…]}` |
| `BatchYesNo` | `count`, `yesText`, `noText` | `{"yes":true,"all":true}` |

`cards` carries the name, cost and type of cards the view does not show — the
top of a library, looked at — and the relay keeps it from every seat but the
one deciding. Argentum asks `ReorderLibrary` for cards going to the bottom of a
library as well as the top (Prophetic Bolt's rest), and to another player's
library as well as the decider's, and the decision says neither; the
continuation it waits with holds both, and the process reads them there:
`placement` is `"top"`, the first card becoming the library's top, or
`"bottom"`, the cards going under it in the order given and the last the very
bottom; `library` is the library's owner. Added after M4's review without a new
protocol number, as the status's other late fields were; a client reading an
engine without them says only that the first ends up highest. `AssignDamageDecision`, which the brief for M4 named, is not
raised by Argentum at the pin: its combat asks the whole damage step as one
`CombatResolutionDecision`, and that is what is asked here. A client that
sends no `answers` — every one before protocol 5 — is asked what it always was.

An engine at 4 ignores all of these keys: it would take a play's targets
nowhere and refuse the cast, and answer every decision itself. So a relay
reading 4 sends no `answers` and tells no client that it may choose
(`seated.choices`, `scripts/relay-engine.mjs`), and the client holds back what
it cannot send, as it did before.

**The opening hand (protocol 6, M4).** `new` with `mulligans: true` deals the
game in Argentum's own mulligan phase — the London mulligan, CR 103.5, as
Argentum implements it (`MulliganHandler`): a hand sent back is shuffled into
the library and seven drawn again, and once a player keeps with mulligans
taken they put that many on the bottom. Without the key every hand is kept, as
every engine before this dealt (`skipMulligans`, Argentum's own name for it, is
read too). The reply says `mulligans: true` where the phase was dealt.

The phase is neither a priority window nor a decision. Argentum's
`legalActions()` knows nothing of it — asked, it offers the first player a
spell in the untap step — and no `PendingDecision` is raised for it; its own
game server drives it beside the priority loop with messages of its own, and so
does this process. While it lasts, the status names the seat it waits on, in
Argentum's order (the first in turn order still to keep, then, once every hand
is kept, the first still to put cards on the bottom), at turn 1, `BEGINNING`,
`UNTAP`, which is where Argentum holds the game, and offers Argentum's own
actions in the shape every offer has:

```json
{"index":0,"type":"KeepHand","description":"Keep this hand","affordable":true,"meaningful":true,"mulligans":0,"bottom":0}
{"index":1,"type":"TakeMulligan","description":"Take a mulligan","affordable":true,"meaningful":true,"mulligans":0,"draws":7,"bottom":1}
{"index":0,"type":"BottomCards","description":"Put 1 card on the bottom of your library","affordable":true,"meaningful":true,"mulligans":1,"bottom":1,"candidates":["e31",…]}
```

Every number is read off Argentum's `MulliganStateComponent`: `mulligans` the
ones taken; on keeping, `bottom` how many keeping this hand puts on the
bottom; on a mulligan, `draws` the hand drawn again and `bottom` how many
keeping that one would; `TakeMulligan` is offered only while one may still be
taken. `act` takes keeping and a mulligan by index alone, and the cards put on
the bottom as `cards` (in the order given, each below the last) or `auto`,
Argentum's own responder's choice. A card named twice ("Each card goes on the
bottom once") and a count other than the one owed ("Put exactly 1 on the
bottom: 0 were chosen.") are refused here, in this process's words: Argentum
counts the cards and checks each is in hand, and no more, so a card named
twice passed its count, moved once, and settled the mulligan with a card still
owed kept in hand (found in M4's review). A card not in hand is refused in
Argentum's words. The engine's seat decides by `EngineAiPlayerController`, the
mulligan responder Argentum's game server plays with — it keeps a hand of two
to five lands, and any hand once two mulligans are taken — so every level
mulligans alike. It decides at once, and is not a stop of a paced table: the
opening hands are part of the deal. Once the last hand is kept Argentum asks
any opening-hand choices of CR 103.6 (a Leyline) as a yes or no, which every
client can answer, and the first turn begins. When everybody keeps, the game is
the one the same seed deals without the phase: keeping draws nothing and
shuffles nothing (`tests/engine-live.test.js` holds it to that).

The log says a mulligan once, as "You took a mulligan" or "Opponent took a
mulligan", where Argentum says each card of the hand going into the library;
and the cards put on the bottom as "You put … on the bottom of your library",
to their owner alone.

An engine at 5 ignores `mulligans` and deals every hand kept, so a relay reading
5 must not tell a client a mulligan is coming.

**The engine's own deck (protocol 7, M5).** A seat the engine plays need not
bring a list. Its `deck` in `new` may be `"mirror"`, the first person's deck and
sideboard as they were sent, printings and all; or `"own"`, a deck Argentum's
`ConstructedDeckGenerator` builds for it (`ai/…/engine/deck/`, the builder its
own game server seats against people who bring no deck). `format` is Scryfall's
word for the format, as the app's formats name their legality key; `sets` the
Scryfall codes of the sets to build from, in either case. A list, even an empty
one, asks for those sets; no list asks for the whole format. The owner's choice
(HANDOFF.md §3 item 16): the lobby asks, by default, for the sets the person's
own deck uses — a fair fight — and a switch asks for the whole format.

The generator builds a sixty-card deck of basics and the format's legal cards
from those sets' own cards and reprints, through Draftsim's ratings (weighted
sampling of 120 cards, four of each, then Argentum's port of Draftsim's
autobuilder), and falls back to its random builder where that builds nothing.
Its randomness is seeded from the game's seed (and the seat's place), so the
same seed builds the same deck and any game can still be played again exactly,
and every game the relay starts without a seed builds another. Two things were
found in measuring it, both Argentum's and said here rather than worked around:
a pool of no more than 120 spells leaves the sampling nothing to choose, so it
builds the same deck from every seed (Portal's commons in Pauper: one deck in 20
seeds); and 21 of 100 of its builds, over five pools, hold a spell of a colour none of its basics
make (PLAN.md, M5).

What makes the legal pool is each card's `legalFormats`, which a card
definition does not carry: game-server stamps them at start-up from the
Scryfall legalities Argentum ships (`LegalityData`), and so does this process
now, for every card it registers. Without them every format's pool was empty,
which is how the first build answered "No Standard-legal cards available".
Measured on the owner's machine on 2026-09-25: 0.6–0.8 s of a load that took
27–34 s that day, and a heap of 126 MB after it where M1 measured 110.

What was dealt is held to what this table can deal: at least 60 cards, each a
name a deck may hold. Where it cannot be, the seat falls back rather than
refuse a game somebody sat down to, and its `deck` says why in `fellBack`, with
Argentum's own words in `why` where it gave any:

| `fellBack` | What happened | Dealt instead |
| --- | --- | --- |
| `format` | no format given, or one it builds no deck to: the Commander family at a table dealt by the ordinary rules (`ConstructedDeckGenerator` refuses it, and a Commander deck needs a Commander game), and anything but Commander at a Commander table (protocol 8, below) | a copy of the person's deck |
| `sets` | none of the sets asked is one the engine has, or none was asked in a list | a deck from the whole format |
| `thin` | the format's legal cards in those sets could not fill a deck — Argentum's "No Standard-legal cards available in POR", or its random builder coming back short | a deck from the whole format; if that fails too, the copy |
| `failed` | anything else the generator did | as `thin` |

A set asked for that the engine has not got is left out and named in
`missingSets`, in the words it was asked in. `colours` are the colours the
deck's basic lands make, and for a deck with none, the colours of its spells:
Argentum's builder gives every deck a manabase of basics for the two colours it
plays, and its spells can say more than that — a hybrid card counts as both its
colours, and a spell its lands cannot cast is still in the deck. The seat never
names a card of its deck: `decklist` does, for measuring, and the relay never
asks for it.

An engine at 6 reads a `deck` that is not a list as no deck and refuses the
game, so a relay reading 6 sends the person's own names for a copy, and deals
the copy where a deck of its own was asked (`scripts/relay-engine.mjs` says so
to the client). A seat that brings names says `{"asked":"deck","played":"deck"}`,
whatever the relay meant by them. The relay asks for the phase only
where every person at the table said in their sit that their client can show
one (`mulligans: true`), since a seat that cannot would be offered keeping and
bottoming it has no prompt for, and the game would wait on it for good.

**Commander (protocol 8, M6).** `new` takes `format`: `"commander"` deals the
game as Argentum's own `Format.Commander` stands at the pin — each player at 40
life (CR 903.7), a hundred cards, each commander face up in its owner's command
zone at the start (903.6), castable from there for {2} more for each time before
(903.8), and 21 combat damage from one commander losing the game (903.10a) — and
`"standard"`, or no key at all, the ordinary rules every engine before this
dealt, whatever the decks' own format. Any other word is refused: "The engine
deals no \"oathbreaker\" game; it deals \"standard\", \"commander\", \"duel\" and \"brawl\"."
(since protocol 10, below; before it the words named the two it dealt). `hello.formats`
lists them. Argentum's `alwaysDivertToCommand` is left off, as Argentum leaves it,
so the question of CR 903.9a is the commander's owner's to answer (below).

Every player in a Commander game has a `commander`: a name, or `{"name", "set",
"number"}` where a printing was chosen for it, dealt in that printing as a deck
line's is. It is dealt into the command zone, not the library, and a deck line
naming it too would deal a second copy into the library, so a client sends a
Commander deck's library alone; the app's decks keep their commanders apart
already. A player with none is refused ("You has no commander, and every player
in a Commander game has one."), as Argentum's `GameInitializer` refuses one, and
so is a commander the engine does not know ("The engine does not know You's
commander, Made-Up Legend."). One commander each: Argentum's `PlayerConfig` takes
one, partners being later work upstream. At a table dealt by the ordinary rules
a `commander` sent is not read.

A seat the engine plays is given one the same way: a list of names brings its own
`commander`; `"mirror"` copies the first person's with their deck; and `"own"`
with `format: "commander"` is a Commander deck of its own, built by Argentum's
`CommanderDeckGenerator` — the builder its own game server uses for a seat that
brings no commander deck — which chooses the commander first, weighted towards
the cards Draftsim rates highly and towards narrow colour identities, then fills a
singleton library inside that identity along a curve, with a manabase of basics
alone. It is seeded from the game as a constructed deck of its own is, held to a
hundred cards exactly, and falls back as that does: from sets it has not got, or
none asked in a list, to the whole format (`sets`); from sets holding no legal
commander with colours to build around — Portal has no legendary creature — to
the whole format (`thin`); and to a copy of the person's deck, commander and all,
where that fails too, or where the word is not `commander` (`format`). At a table
dealt by the ordinary rules a Commander deck of its own is not built, and the
copy is dealt, as before (`format`, "A \"commander\" deck of its own is built
only for a Commander game.").

The reply says `format: "commander"` where the game is Commander, said only when
on, as `paced` and `mulligans` are, and each seat its `commander`, the engine's
too: a commander begins the game face up (903.6), so it is no secret, where the
rest of a deck is. The engine's `deck` counts its commander among its `cards`
(903.5a) and names it, and its `colours` are the commander's colour identity
(903.4), which every card in the deck fits inside (903.5c).

The view is Argentum's own: `ClientGameState` lists each player's `Command`
zone, public to every seat, and a commander card says `isCommander` wherever it
goes; each `ClientPlayer` carries `commanderDamage`, one entry per commander that
has dealt that player combat damage — `commanderId`, `commanderName`,
`controllerId`, `amount` and `threshold` (21, or past reach where commander damage loses nobody, below) — left off where there is none, as
`encodeDefaults = false` leaves off an empty list. A delta carries `players`
whole, so the tally travels in every one.

A commander cast from the command zone is an offer like any other, `card` its
id, with two more keys said only for it: `from: "command"`, and `commanderTax`,
`{"casts": 1, "generic": 2}` — how many times its owner has cast it from there,
read off Argentum's own `CommanderComponent`, and the generic mana that adds,
{2} apiece. Argentum has already put the tax in the offer's `manaCost`
(`CostCalculator`), so `{G/W}` becomes `{2}{G/W}` after one cast; the key says
why. Argentum offers the cast only where it is affordable.

When a commander goes to a graveyard or exile, Argentum's state-based action
(`CommanderZoneChoiceCheck`) asks its owner, as a `YesNo` in its own words —
"Put Rhys the Redeemed into the command zone instead of leaving it in the
graveyard?", "Command zone" or "Leave in the graveyard" — which every client can
answer. It asks the same of a commander in a hand or a library, where the rules
make it a replacement instead (903.9b). The decision says `commanderZone`, where
the commander is — `graveyard`, `exile`, `hand` or `library` — read off the
continuation Argentum suspended with the question, as `ReorderLibrary`'s
`placement` is, so a client can cite the rule that asks it. The engine's seat
answers by its own responder.

An engine at 7 ignores `format` and `commander`, and deals the decks as sent by
the ordinary rules, so a relay reading 7 must not tell anybody a Commander game
is coming (`scripts/relay-engine.mjs` deals it without the commanders, as every
room before M6 did, and says why).

A stand-in commander (HANDOFF.md §3 item 19, the owner's decision of 2026-09-25)
asks nothing new of the process, and no new protocol. Where the engine does not
know a Commander deck's commander, the person may choose in the lobby one of the
deck's own legendary creatures the engine knows, in the deck's colours, to lead it
instead (`src/lib/engine/stand-in.js`); the process is sent it as the player's
`commander` like any other, out of the library, and deals it as the commander it
is — `isCommander`, cast from the command zone with its tax, commander damage and
all. What it stands in for is the relay's to know and say: the sit brings the
commander with `standsFor`, which the room keeps and never sends here, and tells
the person (`seated.format.standIn`, `seats[].standIn`) and says of the engine's
copy of the deck, led by the same card (`seated.engineDeck.standsFor`). Played
against the engine at the pin on 2026-09-25 with the app's Commodore Guff example
deck, led by Narset, Enlightened Master, the one of its legendary creatures the
engine knows (`tests/engine-live.test.js`, which sends the commander through the
relay's own `commanderOf` and `toEngine`). Two things the process does that the
room allows for: it names a card of two faces, sent as Scryfall's "Front //
Back", by its front, in `seats[].commander` and in `deck.commander` (`resolveName`),
so the room takes the two as one card (`sameCard`); and where it is asked for a
deck of its own it builds none of — every Duel Commander table — its copy is the
person's deck with their commander, a stand-in included, which the room says as
such. In a game dealt by the ordinary rules the room sends a stand-in back in the
library, as the deck line it is, and no `commander` (HANDOFF.md §7).

**Duel Commander and Brawl (protocol 10, HANDOFF.md §3 item 20).** `new` takes
`format: "duel"` and `format: "brawl"` too, each dealt as the same Argentum
`Format.Commander` with the game's own numbers — which is how Argentum's own
comments on the type say those games are to be had — for two players only, a
table of more refused in words ("A Brawl game is dealt to two players, and this
one has 3."). Every player brings a `commander` as at a Commander table, and
everything above holds: the command zone, the cast from it and its tax, the
903.9a question.

| | Duel Commander | Brawl |
| --- | --- | --- |
| Life each | 20 (its committee's rules, 300.1a) | 25 (CR 903.12f, a game of two) |
| Commander damage | loses nobody (506.1a) | loses nobody (903.12h, setting aside 704.6c) |
| Deck | a hundred (402.1b) | a hundred: Scryfall's `brawl`, Argentum's `DeckFormat.BRAWL`; the CR's Brawl is sixty (903.12d) |
| Deck of the engine's own | none: Argentum has no Duel Commander card pool, so the copy (`fellBack: "format"`) | a Brawl deck by `CommanderDeckGenerator` to `DeckFormat.BRAWL`, a hundred cards |

Duel Commander is not in the Comprehensive Rules; its numbers are its rules
committee's (mtgdc.info, read 2026-09-25, which keeps that document as an archive
since the committee replaced the format with another on 2026-03-03). Argentum's
`Format.Commander` always has a commander-damage threshold — a game uses
commanders exactly where it has one — so a game in which commander damage loses
nobody is dealt with a threshold no tally reaches (`Int.MAX_VALUE`,
`NO_COMMANDER_DAMAGE_LOSS`): Argentum still keeps the tally and puts it in the
view, with that as its `threshold`, and the reply's `rules` says null. Played
against the engine at the pin: a 6/1 commander unblocked four times deals 24, which
ends a Commander game at 16 life and leaves a Brawl game going at 1
(`tests/engine-live.test.js`). What Argentum does not take from a format is not
dealt either, and the table says so: Brawl's free first mulligan (903.12g) —
Argentum makes a first mulligan free only at a table of more than two — and every
rule of deck construction, which is the app's deck checker's, not the engine's.
Argentum's own Brawl preset (`CommanderPreset.BRAWL`: 25 life, 16 commander damage,
sixty cards) is its tuning for drafted decks, and not this.

The reply to `new` and to `restore` says `rules` for any Commander game, read off
the game itself — `{"life":25,"deckSize":100,"commanderDamage":null}` — so a game
taken back says what it was dealt with. An engine at 9 refuses both words as games
it does not deal, so a relay reading 9 asks for neither and deals such a deck by
the ordinary rules without its commander, as every room before item 20 did, and
says why (`fellBack: "engine"`); a relay also deals the ordinary game, and says
why, at a table of more than two (`players`) and where the people at it asked for
different games of the family (`games`).

**Keeping a game (protocol 9, M7).** `snapshot` answers the game as it stands,
and `restore` takes it back into another process at the same stop, so a room
the relay holds outlives the relay and its own engine (`scripts/relay-engine.mjs`
keeps one after every stop, and `scripts/relay-server.mjs` writes it to disk).

What Argentum offers for this was read first. Its `SnapshotCodec`
(`gym/…/service/SnapshotCodec.kt`) keeps a game in the process's memory by
reference, for search, and cannot write one down at all. What can be written is
`GameState` itself, which is `@Serializable` and which Argentum's own game server
persists as JSON (`game-server/…/persistence`, `persistenceJson`); this process
writes it with the same settings, less the log types that server registers for
itself. `GameEnvironment.restore(state, playerIds, stepCount)` installs one, as
the deal already does. The game's random number generator is in the state
(`GameState.rng`, a SplitMix64 state of one 64-bit number), and so is every
question waiting on an answer, with what follows it (Argentum's suspended
continuations), so a game taken back shuffles, flips and asks as the one kept
would have.

Beside the state the text holds what this process keeps that Argentum does not:
the seats — who plays each, at which level and profile, what each person is
asked, what each was dealt and what the engine's deck was said to be — each
seat's log in its own words, the step the next line is filed under, and a paced
table's pause after one of the engine's plays, which `continue` then takes on.
The offers of the stop are not kept: they are the engine's own legal actions at
that position, and are found again when the game is taken back, without the game
moving on. Nor are the views each seat was last sent: a process taken back sends
each seat the table whole, log and all.

Two things do not travel, both Argentum's own memory outside the state. The
engine's players are built again, and Argentum's search seeds itself from the
position alone (`RolloutCandidateEvaluator.rootSeedFor`,
`Determinizer.sampleForSearch`), so they choose as the old ones would — except
that a `Strategist` remembers the last 32 positions it acted from, each marked
with its turn and step, so as not to go round in circles, and a new one
remembers none. That can matter only inside the step the game was kept in. And a
random seat (`ai: "random"`, a test opponent) starts its own sequence again.
Measured on the owner's machine (PLAN.md, M7): sixteen games kept at the opening
hand, at one of the engine's paced stops, at a question put to the person and at
an ordinary stop, sixty-card and Commander, each taken back into another process
and played on to turn 14 beside the game that was not — every status on the way
the same, and every seat's view the same at the stop kept and at the end, in all
sixteen. (`scripts/engine-restore.mjs` compares the status's own terms at every
stop, and the views at those two; M7's review found this said more.)

**The text is a string on the wire, not JSON inside the reply.** The generator's
state is a 64-bit number, and a relay reading the reply as JavaScript would hold
it as a double: at one stop measured it was `-3869328946740255321`, which comes
back from `JSON.parse` as another number, and so as another game. The relay keeps
the text as it came and gives it back as it came. `tests/engine-live.test.js`
holds the text's digits against what `JSON.parse` makes of them.

`restore` refuses in words, and holds what the process had as it was: into a
process that holds a game already ("This engine already holds a game; a kept
game is taken back by a fresh one.", unless `replace`); a text that is not JSON
("That snapshot could not be read: …"); one that is not a game this process
kept; one of another shape (`version`, bumped when the shape changes: "That game
was kept in the shape of version 2, and this engine reads version 1."); a game
whose players or seats do not add up; and a profile this engine does not have.
Measured over two runs of `scripts/engine-restore.mjs` (PLAN.md, M7): a snapshot
takes 6 ms at the median (12–13 for Commander), its first in a process 171–186 ms;
it is 130 kB at the median for sixty cards and 320 kB for Commander, 7.6 and 33 kB
gzipped; a restore into a loaded process takes 18–19 ms at the median, its first
407–450 ms. An engine at 8 refuses both as unknown ops, so a relay reading 8 keeps
no game and says so when it comes back.

A request that fails in a way this process did not foresee — anything thrown but
its own refusals — is answered `{ "ok": false, "error": "<the class thrown>: <its
message>" }` (`Server.kt`, the request loop), as it has been since M1. The room
passes such a reason on after its own words with the class name's capital kept
("…could not keep it: IllegalStateException: …"), where it lowers the first
letter of a sentence (M7's review, `clause` in `scripts/relay-engine.mjs`).

`waiting` is `"action"` with `actions`, `"decision"` with `decision`,
`"engine"` on a paced table that has stopped after one of the engine's own
plays (nothing on offer, nothing to decide, and `actor` the seat that made
it), or null when the game is over or nobody is to act. `autoPassed` is how
many priority windows the server passed on the human's behalf since the last
stop, because nothing meaningful was affordable there (FRICTION.md Law 1,
asked with the engine's own `MeaningfulActionFilter`). `decided` lists the
decisions the engine's responder answered for a human seat because they were
not put to it, so the table can say so: since protocol 5, splitting cards into
piles, choosing a word to replace, a budget of modes, and anything a client did
not say it can show.

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

Until M4 the attack, the block and every play the engine aimed were no stops
at all. The engine's choice comes back filled in — its attackers, its
blockers, its targets — and was matched to the bare offer by equality, which
it never is. Over eight paced games of the goblin deck (2026-09-24) every one
of the engine's stops fell in a main phase. Matched by what it is instead —
the same card cast, the same ability of the same source, and a declaration
that declares something (`worthWatching` in `Server.kt`) — the same eight
games stop 49 times more for its attacks, 10 for its blocks and 17 in main
phases, one for each Volcanic Hammer and Lava Axe it cast. A block is made in
the attacker's turn, so the engine's blocks are the one stop of its own that
falls in a turn of yours. A spell has resolved by the time its stop is seen:
Argentum's `GameEnvironment.step` passes for every player while the stack
holds anything, so no view is ever sent with a spell waiting on it — which also
means nobody at this table is given priority with a spell on the stack (below,
"What is deliberately not here").

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

**Levels, and `clock`.** An engine seat plays at one of three levels, each one of
Argentum's own named AI profiles (`ai/…/engine/AiProfile.kt`), mapped in
`LEVELS` in `Server.kt` and listed by `hello`: **easy** is `v0` (`LEGACY_V0`, the
greedy one-move look Argentum keeps frozen as the reference for all its arena
numbers, and the very player every engine before protocol 4 fielded, as
`CURRENT`); **intermediate** is `production-raceclock` (card knowledge, the card
advisors, and a race scored by how soon it ends, still one move deep and as
quick as easy); **hard** is `production-candidate-expiring` (what Argentum's own
game server plays people with at the pin: each option played out two turns
ahead, three in combat or near lethal, on a four-tier budget; the cards it
cannot see shuffled among themselves before it searches rather than read; and
every evaluation fix promoted so far). Why these three, and what they measured against each
other through this process, is in `docs/table-rebuild/PLAN.md`, "M3".

A player in `new` asks for one with `level`; `ai` may also be the level's word
(`"ai":"hard"`), read the same way. The reply's seat says the `level` it took
and the `profile` it plays with. A level this engine does not know is not a
reason to refuse a game: the seat plays as heuristic seats always have
(`current`) and says `level: null`, so a relay can say so rather than name one.
`profile`, naming an Argentum profile by its id, is for measurement
(`scripts/engine-levels.mjs`), and an id the process does not list is refused,
so a measurement never quietly plays a different agent. The relay sends only a
level. A person's seat has no level: the decisions it is not put, and a play
it asks the engine to choose for it, are answered with `current`'s responder,
as before.

A seat's `level` and `profile` are this process's echo of what was asked, so
`tests/engine-live.test.js` holds the levels to what they play as well: from
one seed, each against easy, the three play three different games, and easy
plays exactly the game of a seat asked for no level.

Hard's search is budgeted in work, not time. Argentum's `TieredBudgetPolicy`
names 0, 200, 2,000 and 5,000 ms for its four tiers (a window with nothing to
choose, a routine one on the other player's turn, a main phase or a response,
and combat or either side within reach of lethal), but those milliseconds are
converted once into counts — 16 rollouts at the 2 s tier, 40 at 5 s, none below
2 s — and the clock is only a safety stop a healthy decision never reaches.
That is what keeps a seeded game the same game at hard, which
`tests/engine-live.test.js` checks; it is also why a slow machine makes hard
slower rather than weaker. What it costs in wall-clock time is measured, not
taken from those names: PLAN.md, "M3".

`clock` is how that was measured: every choice an engine seat made since the
last `clock` (every priority window it was given and every decision it answered
for itself), how long the choosing alone took, and whether there was anything
to choose between. The relay never asks for it.

Neither levels nor `clock` exist before protocol 4. An engine at 3 ignores
`level`, as it ignores every key it does not know, and plays its one way, so a
relay reading 3 must not ask for one and must not say the engine plays at one.
What a person chooses came with protocol 5, above.

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
app's reading of it. It takes about 25 s, needs a built engine at protocol 6,
and keeps the first capture's `shots` unless asked for `--shots`, because the
adapter's older tests hold those to exact life totals and card ids. Since M4
(2026-09-24, seed 20260941) the run starts at the deal and holds, within 30
stops: the opening hand's three offers, one mulligan taken; the engine's turn
mid-flight, its attack a stop of its own; the offer to block; a stop made for
Volcanic Hammer alone; Sparkmage Apprentice's arrival asking the person for its
target, a real `ChooseTargets` decision; and blockers the engine declared, on
the board. Its header says how each is reached, and a run that misses any of
them says so on the way out rather than reporting success with the gap in. The
mark for a stop where blockers may be declared is `blockable`; `blocks` is
blockers actually on the board, which no view carried until the engine's
blocks became a stop of a paced table (above).

## What is deliberately not here

- **Several games in one process.** One process per room keeps a crash to
  one table and the code to a page.
- **Persistence of its own.** The process writes nothing to disk. It answers
  `snapshot` with the game as text and takes one back with `restore`; keeping
  the text, and deciding when to ask, is the relay's (above, "Keeping a game").
- **A warm engine.** Each room starts its own process and waits out the 15 s
  load. Keeping one loaded and ready is a question for hosting (M8), once the
  cost of an idle JVM is measured against the wait.
- **Priority with a spell on the stack.** Not a choice made here but a fact
  found at M4 (2026-09-24): `GameEnvironment.step`, through Argentum's
  `GameSimulator`, passes for every player while the stack holds anything, so a
  spell resolves inside the step that cast it. A person holding Shocks, stopped
  26 times in a game where the engine cast Shocks too, never had anything on
  the stack at a stop: nobody here can respond to a spell, where the top of
  the stack resolves only once all players pass in succession (117.4,
  `docs/TURN_STRUCTURE.md`). Driving
  the table with Argentum's `stepExactlyOne`, which runs no automatic
  resolution, is where a fix would start; it is not in any milestone yet.
