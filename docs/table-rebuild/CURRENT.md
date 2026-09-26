# The Table as it stands

Everything below is in `rporter33/mtg-companion` on `main`, working and
deployed at https://rporter33.github.io/mtg-companion/ under the **Table** tab.

## Two engines, on purpose

The single most important structural fact about this codebase:

| | `src/lib/table/` | `src/lib/board/` |
| --- | --- | --- |
| **What** | Rules-*enforced* teaching engine | Rules-*free* table |
| **Cards** | 19, hand-written | Any card Scryfall has ever printed |
| **Knows** | What those 19 cards do | Only where every card *is* |
| **Used by** | Learn / Practice | Table |
| **Size** | 1,374 lines | 2,298 lines |

`board/` never inspects a card to decide whether something is allowed. That is
what lets it work with a card printed tomorrow, and it is the reason the Table
cannot today do the things Moxgate does. A new engine slots in beside these
two, or replaces `table/` by growing it — see `ENGINE.md`.

## `engine/` — the rules-enforced table's engine, on the wire

Not a third engine: Argentum (`ENGINE.md`), wrapped. `engine/` is a Kotlin
module built into a checkout of it by `scripts/engine-build.sh`; the process
speaks JSON lines (`engine/README.md`) and `scripts/engine-bridge.mjs` talks
to it from Node. `scripts/relay-engine.mjs` puts a room around it and
`src/lib/engine/board.js` lays its state onto the board model, so the Table
tab plays it through the same screens as the other two tables ("Play the
engine" in the lobby, `#/game/engine/<code>`). See `PLAN.md`, "The engine on
screen".

Added at M1 (2026-09-21), the deck the engine is given:

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/deck.js` | 134 | `seatDeck`: a deck as the engine takes it, one function for the lobby's check and the sit, with printings, the sideboard and a count of cards not yet loaded; `verdictOf`, `leaveOut`, `nameList`. Pure. |
| `src/features/game/useEngineCheck.js` | 109 | What the relay's engine says about each deck on the shelf, asked one deck at a time before anyone sits. |
| `tests/engine-deck.test.js` | 116 | The deck module's tests. |

Added at M2 (2026-09-22), watching the engine's turn arrive:

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/stream.js` | 83 | `nothingHeld`, `receiveView`: the per-seat view numbering, and the rule that a delta is taken only where `seq` follows, that a gap asks for the table whole, and that the ask is made again if enough deltas go by unanswered for it to look lost. Out of the hook so the rule can be tested without a browser. Pure. |
| `src/lib/engine/board.js` | 334 | Grew `applyDelta(view, delta, { log })` — Argentum's `StateDelta` in JavaScript, returning `null` for anything it will not guess at, and naming the two fields that DTO has no way to carry — and `THINKING` / `thinkingAt`, so the plate's words and the condition for them are one thing. |
| `scripts/engine-capture.mjs` | 275 | Plays a paced game through a real engine and writes `tests/fixtures/engine-views.json`: at every stop the delta since the one before it and the whole state beside it, then the window holding the most of what M2 asked for. Kept, not thrown away this time. |
| `tests/engine-delta.test.js` | 305 | The captured run walked delta by delta and held against the engine's own full views; the DTO's terms one at a time; the deltas `applyDelta` must refuse; the whole stream, gap and all. |
| `tests/engine-room.test.jsx` | 223 | `useEngineRoom` driven through a socket the test holds both ends of, fed the captured run as the relay really sends it. |

The fixture is 292 kB: a real game's real deltas — 20 views, the first whole
and every later one a delta against the one before it, with the engine's own
whole state kept beside four of them so the deltas can be held against it.
`--views` is the dial if it grows again.

*Re-captured at M4 (2026-09-24):* the capture script is 326 lines and the
fixture 500 kB on disk — 30 views from the deal, ten of them whole, seed
20260941 — because the window now also holds the opening hand, blockers
declared on the board and a targets decision (PLAN.md, M4's second half).

Added at M1b (2026-09-24), what the engine offers drawn on the cards, and a
preview that keeps clear of the next press:

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/glow.js` | 110 | `glowsAt`: which cards (and seats) glow at the engine's table and the words each glow adds to a spoken label — the hand cards with a meaningful, affordable offer, a permanent's non-mana ability, the legal targets of a targets decision, the creatures that may attack or block and the ones chosen. `unaimed`: the offers held back because they need a target the table cannot send. `GLOW_SAYS`. Pure; reads an older engine's status without throwing. |
| `src/features/game/peekPlace.js` | 98 | `placePeek`: where the card preview goes — never over the prompt or the rail, never over the card, never off the screen; the nearest place that keeps all three, in the order the preview always had; smaller, then not at all, as last resorts. Pure. |
| `tests/engine-glow.test.js` | 177 | The glow held against every stop of the captured run, with the board each belongs to rebuilt from its deltas; a targets decision in `Server.kt`'s shape; the torn and the old. |
| `tests/peek-place.test.js` | 120 | The placement's cases, and a sweep of card positions over four layouts that it never covers what it keeps clear of. |

Changed with them: `Peek.jsx` places the preview with `placePeek` after every
render of the table, from rectangles read at that moment, and measures the
card again when it settles; `BoardCard.jsx` and `Field.jsx` carry a `glow`;
`Table.jsx` computes the glows, lights the plates of seats that are targets,
names the source of a targets decision and offers seats by name, passes on
Space, and names Scryfall and Argentum in its credit line.

Added at M3 (2026-09-24), how strongly the engine plays:

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/levels.js` | 72 | `LEVELS` (easy, intermediate, hard), `DEFAULT_LEVEL` (intermediate, the owner's choice), `levelOf` and `chosenLevel` (a level read forgivingly from storage or the wire), `LEVEL_NAMES`, `LEVEL_LINES` and `LEVELS_MEASURED` (the app's own words and the measured sentence), and `levelLine`, the log's one line about the level in each way a room can answer. Shared by the relay and the app. Pure. |
| `scripts/engine-levels.mjs` | 275 | Plays the levels against each other through the process, a seed each way round, and summarises by pairs with a 95% interval; the per-choice times from `clock`; `--watch` for what a person's seat waits on a paced table; `--from` to put saved runs together. PLAN.md's M3 numbers are its output. |
| `tests/engine-levels.test.js` | 60 | The words, the default, the forgiving read, and the log's line in every case. |
| `tests/browser/levels.spec.mjs` | 183 | The choice in the lobby against the stand-in engine, so it runs everywhere: three levels, the default, the words, axe at two widths, kept across a reload, carried to the engine and named back; and a slow answer, refused twice and shown as thinking. |

Changed with them: `Server.kt` is protocol 4 — `level` (and `profile`, for
measuring) on a player in `new`, the level and profile each seat took in the
reply, `hello.levels`, and `clock`; the room (`relay-engine.mjs`) holds the level
as a setting, asks only an engine at 4 for it, says what was taken, and takes
one move at a time; `relay.js` opens a room with a level; `Seats.jsx` offers the
choice beside the engine's seat and says the level of a table already dealt;
`useEngineRoom.js` sits with the level, notes it once, holds a second press
while the first is answered and calls an answer slow after `SLOW_MS`; `Table.jsx`
names the level in the seat list and says the engine is thinking through a slow
answer, with the prompt stepped aside; the stand-in engine
(`tests/fixtures/fake-engine.mjs`) has levels and a slow `act`.

Added in M3's review (2026-09-24), thirteen faults fixed (PLAN.md, "M3", "What
the review found"):

| File | Lines | What it holds |
| --- | --- | --- |
| `tests/engine-prompt.test.jsx` | 173 | The prompt panel rendered against the captured run's stop for Volcanic Hammer alone, and `stopLine` and the targets sentence against statuses in `Server.kt`'s shape: a permanent's ability beside a card in hand, a flashback in the graveyard, a cost with a choice in it, targets in a pile or on the stack; `placeWords`. |

Changed with it: `Server.kt` sends an offer's `additionalCost`,
`additionalCostText` and `requiresForage`; `glow.js` (now 169 lines) gains
`heldBack`, `unpaid` and `offeredElsewhere`, and glows nothing whose cost needs
a choice; `Table.jsx` exports `EnginePrompt`, `stopLine` and `placeWords`,
refuses such a tap in words, names plays from a pile and where targets are,
marks a pile's tile that holds either, reads the stack from every seat at the
engine's table without the by-hand resolve buttons there, and notes how a
control came by its focus so Space after a mouse press passes;
`ZoneBrowser.jsx` draws the engine's glow on a card in a pile, with its words;
`table.css` gives a glowing card a two-tone focus ring outside its glow;
`useEngineRoom.js` ends the wait when the wire drops, takes "still answering"
down at the next status, and says the level only at a heuristic table;
`relay-engine.mjs` marks that refusal `answering`, says the kind of engine
player in `seated`, and reports `dealt`; `levels.js` (95 lines) gains
`roomLevel`, which `Seats.jsx` uses to say a table is still dealing; the
stand-in engine holds an act, or its first hello, until released, in place of
the slow `act`.

Added at M4, its first half (2026-09-24), what a person chooses (PLAN.md, "M4,
the first half: the decisions"):

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/choose.js` | 294 | What a seat may choose (`choicesFrom`, `NO_CHOICES`), the decisions this build can show (`ANSWERS`, sent with the sit), what holds an offer back at a seat (`heldBackBy`), and a choice made a step at a time — X, what a cost takes, the targets, a division of damage; a trigger's targets, cards to select, lands to pay with — to the `act` or `decide` it becomes (`beginPlay`, `beginDecision`, `toggle`, `advance`, `answerOf` and the rest). Pure; reads the wire forgivingly. |
| `src/features/game/EnginePrompt.jsx` | 553 | The prompt panel at the engine's table, out of `Table.jsx`: the stop, the attack and the block, a play or a decision being chosen on the table, and a prompt for each decision answered in the prompt itself — an order, a division, combat damage, a number, a colour, modes, one answer for several — each with "Let the engine choose". `stopLine` and `placeWords` came with it; `Table.jsx` re-exports all three. |
| `scripts/engine-decisions.mjs` | 111 | Plays each game twice from a seed, a person's seat told nothing and one that can show every decision, and tallies what was answered for the person, what they were asked, whether it was the same game, and the stops where a play needed something chosen. PLAN.md's M4 table is its output. |
| `tests/engine-choose.test.js` | 224 | `choose.js` against the offers and decisions the built engine sent at protocol 5: Volcanic Hammer, Arc Lightning's division, Blaze's X, Tormenting Voice's discard, a cleanup discard, a scry, mana to pay with. |
| `tests/engine-choosing.test.jsx` | 232 | The prompt rendered and pressed for every kind: what each says, and the `act` or `decide` each button sends. |
| `tests/browser/decisions.spec.mjs` | 350 | Eleven decisions put to a seat by the stand-in engine, one after another: each in the engine's words, axe clean, reached with Tab and answered with Enter or Space, and the answer read back off the stand-in. Runs everywhere. |

Changed with them: `Server.kt` is protocol 5 — `act` takes `targets`, `x`,
`damage`, `cost` and `auto`; an offer says `targetRequirements`, `x`, `divide`
and `costChoice`; a person's player may carry `answers`, and the decisions
among them are described in full and answered in `decide`; `hello.choices`.
`relay-engine.mjs` passes `answers` to the deal, tells each seat its `choices`,
and keeps a decision's hidden cards to the seat it asks. `glow.js` (214 lines)
holds back only what the seat cannot send, glows a choice in progress, and
gains `pileHolding`. `useEngineRoom.js` sits with `answers` and returns `can`.
`Table.jsx` (1,670 lines, from 1,786 before M4) begins, picks and sends a
choice and keeps Space from passing while a play is chosen. The stand-in engine
speaks protocol 5, keeps the last act and decide it was sent, and asks
decisions on request, one after another.

Changed at M4, its second half (2026-09-24), the opening hand and the fixture
M2 was left short on (PLAN.md, "M4, the second half"). No file is new; these
grew:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 1,514 | Protocol 6: `new` takes `mulligans`, and `drive` runs Argentum's mulligan phase beside the priority loop (`mulliganing`, `waitingOn`), offering `KeepHand`, `TakeMulligan` and `BottomCards` with Argentum's own numbers, and deciding the engine's seat by `EngineAiPlayerController`. The log says a mulligan once and a card bottomed to its owner. `worthWatching` matches the engine's filled-in choice to its offer, so its attacks, blocks and aimed plays are stops of a paced table. |
| `scripts/relay-engine.mjs` | 567 | Keeps whether a seat's client can show a mulligan until the deal, asks for the phase where every person can and the engine is at 6, and reports `mulligans`. |
| `src/lib/engine/choose.js` | 320 | `beginBottom`: the cards put on the bottom as a step of their own, picked on the table and sent as the offer's `cards`. |
| `src/lib/engine/glow.js` | 217 | Says a card that can go on the bottom, and one chosen for it. |
| `src/lib/engine/board.js` | 344 | Draws declared blockers, an arrow from each blocker to what it blocks. |
| `src/features/game/EnginePrompt.jsx` | 619 | `OpeningHandPrompt` (keep or mulligan, the engine's numbers, 103.5 and 103.8a cited) and the bottoming as a choosing prompt that counts down. |
| `src/features/game/Table.jsx` | 1,682 | Begins the bottoming from the stop, sends it as an act, says "Opening hand" on the plate, and says why a card cannot be played before the game begins. |
| `src/features/game/useEngineRoom.js` | 337 | Sits with `mulligans: true`. |
| `scripts/engine-capture.mjs` | 326 | Protocol 6, a deck with Sparkmage Apprentice for its targets decision, one mulligan taken, targets chosen plainly, and a window that must hold every mark the tests read. |
| `tests/fixtures/fake-engine.mjs` | 378 | Protocol 6: a deal asked for mulligans opens with the first seat's hand to keep, in Server.kt's shapes. |

`src/components/table/table.css` lost an opacity on the log's trail of passed
steps, which axe found below contrast the first time a sweep met it.

Changed in M4's review (PLAN.md, M4's second half, "Reviewed afterwards, and
fixed"). No file is new:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 1,564 | `bottomChosen` refuses a card named twice and a count other than the one owed; `targetsOf` walks the offer's own requirements and refuses one it has not got; a `ReorderLibrary` says `placement` and `library`, read off Argentum's continuation (`orderGoing`). |
| `src/lib/engine/choose.js` | 329 | `pickable` leaves out only a spell's own card from its cost; an ability's source is taken where Argentum lists it. |
| `src/features/game/Table.jsx` | 1,706 | `answerTap`: a tap, or a card dragged from hand, while something is chosen; a tap on the source lets the play go only where the step cannot take it. `keeping` for the words said before the hand is kept. |
| `src/features/game/EnginePrompt.jsx` | 656 | The 103.8a line at two players only; an order says which end of whose library (`libraryOrder`); "Let the engine choose" on a play says it makes every choice; mana "sources"; the steppers' counted labels. |
| `scripts/engine-capture.mjs` | 335 | Stamps the local day, or `--date`. |
| `tests/fixtures/fake-engine.mjs` | 380 | Refuses a bottom as Server.kt now does. |

`tests/engine-live.test.js` (1,091 lines) gains three tests — a card named
twice for the bottom, the process's own refusals of `cost`, Prophetic Bolt's
order to the bottom — and holds the combat split, the pacing count and the
wrong-order targets (Boulder Dash) tighter.

Added at M5 (2026-09-25), the engine's own deck (PLAN.md, "M5: the engine's own
deck"):

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/opponent.js` | 178 | What the engine's seat plays, as the lobby offers it and the table says it: `OPPONENT_KINDS` (mirror, deck, own), `DEFAULT_OPPONENT` (a copy, built from your sets when its own), `chosenOpponent` (read forgivingly from preferences), `setsOf` (the sets a deck's main-deck printings come from, basic lands left out), `formatWord` and `buildsFor`, and the words: `colourWords`, `seatWords`, `engineDeckLine` (the log's one line, every fallback with its reason), `insteadLine`. Shared by the lobby and the table's seat. Pure. |
| `tests/engine-opponent.test.js` | 168 | `opponent.js`: forgiving reads, the sets of a deck, the colours in words, every seat line and log line, and every reason a deck chosen for the engine was not sent. |
| `tests/browser/engine-deck.spec.mjs` | 244 | The lobby's choice against the stand-in engine: the three, the default, the switch and its words, a deck the engine does not know not pickable, a Commander table, the keyboard, a reload, axe at two widths; and each choice to the engine and back into the log and the seat list, a fallback included. Runs everywhere. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 1,845 | Protocol 7: `deckFor` gives an engine's seat a list of names, a copy (`"mirror"`) or a deck of its own (`"own"`) from Argentum's `ConstructedDeckGenerator`, seeded from the game, falling back to the whole format and then the copy, each said (`Built.fellBack`); `coloursOf`; every card stamped with its legalities (`LegalityData`), timed in `hello`; a `BoosterGenerator` of every set; `decks` in `hello`, `deck` on the engine's seat in the reply to `new`, and `decklist`. |
| `scripts/relay-engine.mjs` | 677 | Keeps a sit's `engineDeck` until the deal (`engineDeckOf`), sends a copy or another deck as names and "own" only to an engine at 7, and says what was dealt in every `seated` after the deal and in `describe()` (`reportOf`), never a card. |
| `src/features/game/Seats.jsx` | 337 | `EngineDeckChoice`: the three as radios, the shelf's decks in a `<select>`, the pool's switch; the engine's seat named by what it plays; a fallback said beside it. |
| `src/features/game/Lobby.jsx` | 580 | Holds the choice (`engineOpponent` in preferences), records with the table what the sit is to send (`engineDeckRecord`), and waits for the engine's chosen deck's check as for the player's. |
| `src/features/game/useEngineCheck.js` | 125 | Each answer carries the names it asked about (`seat`) and the deck's sets (`sets`). |
| `src/features/game/useEngineRoom.js` | 411 | `chooseEngineDeck`; the sit carries `engineDeck` (`engineDeckFor`); the log says once what the room reports was dealt, and why a deck chosen could not be sent. |
| `src/features/game/Table.jsx` | 1,710 | Passes the kept choice to the seat. |
| `tests/fixtures/fake-engine.mjs` | 418 | Protocol 7: a deck of its own in Server.kt's shape, by a rule of its own, and a refusal of a deck that is not a list from an engine at 6. |

`tests/relay-server.test.js` (1,504 lines) gains the three shapes, the
fallbacks, an older engine, the ask kept until the deal and one it cannot read;
`tests/engine-room.test.jsx` (508) what the sit carries and the log says;
`tests/engine-live.test.js` (1,214) six tests of a deck of the engine's own,
each held to the app's `validateDeck`.

Added at M6 (2026-09-25), Commander at the engine's table (PLAN.md, "M6:
Commander"):

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/commander.js` | 152 | Which game a deck asks the engine for (`gameOf`, `COMMANDER_GAME`; `leaderlessFamily` for the rest of the Commander family), and every word said about it, each rule by its number: the game dealt and why (`formatLine`), the lobby's line (`COMMANDER_TABLE`, `leaderlessLine`), the tax (`taxWords`, 903.8), the rule behind the question of the command zone (`commanderZoneRule`, 903.9a and 903.9b), commander damage read off a player and said (`commanderDamageOf`, `damageWords`, 903.10a), and why a Commander deck cannot be led against the engine (`leaderProblem`, `leaderWords`, 903.3). Pure; reads the wire forgivingly. |
| `scripts/engine-commander.mjs` | 154 | Measures a hundred-card Commander game against the engine beside two sixty-card ones: the deal, each paced step, the engine's turns, and the size of a whole view and a delta. PLAN.md's M6 numbers are its output. |
| `tests/engine-commander.test.js` | 228 | The deck as a Commander sit sends it, the lobby's verdict and leaving an unknown commander out, the words, the glow and the stop's line for a commander in the command zone, and the board laid from a view with a command zone and commander damage. |
| `tests/browser/engine-commander.spec.mjs` | 264 | Commander on screen against the stand-in engine: the lobby's lines, an unknown commander's gate and the ordinary game dealt instead, a Commander game — 40 life, the command zone glowing and cast from by the keyboard, the commander on the battlefield said to be one, commander damage on the plate, the 903.9a question with its rule, the tax said on the next cast, the zone opened by a right-click — and axe at two widths. Runs everywhere. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 2,035 | Protocol 8: `format` on `new` (`GAME_FORMATS`, Argentum's `Format.Commander`), a `commander` for every player dealt into the command zone, refused in words where missing or unknown; a Commander deck of the engine's own by `CommanderDeckGenerator` (`generateCommander`), a copy's commander copied (`Brought`); `from` and `commanderTax` on a cast from the command zone (`taxOf`); `commanderZone` on the 903.9a yes or no (`commanderGoing`); a Commander deck named by its commander's colours; `format`, `commander` and `formats` on the wire; `commander` and `identity` in `decklist`. |
| `scripts/relay-engine.mjs` | 755 | Keeps a sit's `format` and `commander` until the deal (`formatOf`, `commanderOf`), asks for a Commander game only of an engine at 8 with every person's commander, gives the engine's seat the copy's or another deck's, and says the game dealt in every `seated` after the deal and in `describe()`. |
| `src/lib/engine/deck.js` | 327 | `seatDeck` sends a Commander deck's commander apart from its library and counts it; `checkedDeck` asks the engine about it with the library; `verdictOf` names an unknown commander first; `leaveOut` leaves it out. |
| `src/lib/engine/glow.js` | 225 | A commander in the command zone glows as castable, and its zone says so (`pileHolding`'s `cast`). |
| `src/lib/engine/board.js` | 354 | `board.engine.commanderDamage`, and a commander card marked as one. |
| `src/lib/engine/opponent.js` | 190 | The engine's commander named beside its deck; a Commander deck of its own offered. |
| `src/features/game/Table.jsx` | 1,741 | The command zone at the engine's table: the engine's commander on its tile, named, cast by a tap (a right-click opens it), looked through on the engine's side; commander damage on the plates. |
| `src/features/game/EnginePrompt.jsx` | 673 | The stop's line for a commander in the command zone, with its tax; the 903.9a question with its rule. |
| `src/features/game/Lobby.jsx`, `Seats.jsx` | 608, 345 | A Commander deck's commander checked and said on its tile; the gate for one the engine cannot lead, with the ordinary game offered; the lobby's lines for Commander and the rest of its family; a Commander deck chosen for the engine goes with its commander. |
| `src/features/game/useEngineRoom.js`, `useEngineCheck.js` | 443, 126 | The sit asks for Commander and brings the commander; the log says once which game was dealt. The check asks about the commander too. |
| `src/components/table/BoardCard.jsx`, `ZoneBrowser.jsx` | 313, 119 | A commander is said to be one, on the table and in a pile. |
| `tests/fixtures/fake-engine.mjs` | 560 | Protocol 8: a Commander table of its own making over the captured views, and `commanderTo` and `commanderDamage` for tests. |

`tests/engine-live.test.js` (1,385 lines) gains six tests of a Commander game
against the built engine; `tests/relay-server.test.js` (1,665) ten of the room's;
`tests/engine-room.test.jsx` (584) seven of the seat's; `tests/engine-choosing.test.jsx`
(392) two of the 903.9a prompt; `tests/browser/game-engine.spec.mjs` (1,300) a
Commander section against the real engine — the four example decks checked, and
a commander cast from the command zone; `tests/browser/engine-deck.spec.mjs`
(256) the Commander tab's switch and the Brawl tab's words.

Added and changed by M6's review (2026-09-25, PLAN.md, M6, "What the review
found"):

| File | Lines | What it holds, or what changed |
| --- | --- | --- |
| `src/components/table/useHold.js` | 79 | New. A finger's hold on a control that is not a card, at `useDrag`'s own wait and travel (`HOLD_MS`, `THRESHOLD`, now exported), swallowing the click and the contextmenu around its lift until the next press. The command zone's tile uses it. |
| `tests/use-hold.test.jsx` | 101 | New. The hold on a fake clock: the wait, a finger that lifts or moves first, a mouse left to its right-click, and what it swallows. |
| `src/lib/engine/opponent.js` | 277 | `engineDeckRecord` (what the sit sends, moved from `Lobby.jsx`), `plannedWords` (the seat line before the deal, from it) and `dealingWords` (while the engine deals); `engineDeckLine` reads the game dealt, for a Commander deck of its own not built at the ordinary game. |
| `src/lib/engine/commander.js` | 188 | The 903.9a line without "instead"; `damageWords` says whose each commander is where names are shared; `damageRule` replaces the unused `DAMAGE_RULE`; the Oathbreaker line names its signature spell. |
| `src/lib/engine/deck.js` | 334 | `withArticle`: "a Brawl", "an Oathbreaker". |
| `src/features/game/Table.jsx` | 1,770 | The command zone's tile opened by a hold, a right-click or Shift+Enter while a tap casts, each in its label, with no `aria-expanded` then; the plate's commander damage told apart by whose, with the rule beside it. |
| `src/features/game/Seats.jsx`, `Lobby.jsx` | 353, 594 | The seat line from what the sit will send; the lobby records through `engineDeckRecord`. |
| `src/features/game/useEngineRoom.js` | 448 | Every sit names its game (`gameOf`); the log's deck line reads the game dealt. |
| `scripts/relay-engine.mjs` | 761 | The game asked for kept with each seat's deck, not from the last sit to name one; `describe()` says the format a deck of its own is asked to. |
| `tests/fixtures/fake-engine.mjs` | 576 | `FAKE_DECK_REPORT=noisy`, an engine that says more of its deck than a client may be told. |

`tests/relay-server.test.js` gains four (a Brawl deck of its own, the noisy
report, the gate's path with "own", a sit again with a sixty-card deck);
`tests/engine-live.test.js` one (a deck named by its basics) and two rewritten
(the same Commander deck from a seed, no clock); `tests/engine-opponent.test.js`
four, `tests/engine-commander.test.js` one, `tests/engine-room.test.jsx` one;
`engine-commander.spec.mjs` seven checks and `engine-deck.spec.mjs` three.

Added at M7 (2026-09-25), a room that survives the relay (PLAN.md, "M7: a room
that survives the relay"):

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/restart.js` | 52 | Every word said when a game comes back: `restoringLine` (the table's banner while it does, the relay's or the engine's), `restoredLines` (the log's line once it has, and to the person whose move or answer was lost, what became of it), `restartOf`. Pure; reads the wire forgivingly. |
| `scripts/engine-restore.mjs` | 217 | Measures keeping a game: a snapshot at every stop of paced games, sixty-card and Commander — its size as text, gzipped and as the room's file holds it, and its time — and one stop a game taken back by a second process, which then plays on beside the first, every status on the way held to the game not taken back, and every seat's view at the stop kept and at the end. PLAN.md's M7 numbers are its output. |
| `tests/engine-restart.test.js` | 55 | `restart.js`: each line for the relay and the engine, a table behind, a lost move and a lost answer, and a relay of any age read forgivingly. |
| `tests/browser/engine-restart.spec.mjs` | 303 | Against the real engine through the built app: sit, keep, a land; the relay stopped and started again on the same rooms — the page says it lost the table, then that the game is coming back, offering nothing, axe clean at 1280 and 390 and still under reduced motion — and the table back as it was, the log saying so, the game going on; then the engine killed mid-game, the same. Prints how long each took and the room's file size. Skips where there is no engine. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 2,265 | Protocol 9: `snapshot` (`Table.snapshot`: `GameState` with Argentum's own persistence settings, `snapshotJson`, and the seats, logs, step and paced pause beside it, as text) and `restore` (`restoreTable`, refusing in words; `Table.settle` finds the stop's offers again without moving the game on; `replace` for measuring); `deckReport`, so a seat taken back says its deck as it was said. |
| `scripts/relay-engine.mjs` | 1,167 | Keeps the engine's snapshot after every stop (`keep`), with a move in flight marked until its stop is kept; `record` and `savedRoomOf` (forgiving); `comeBack` and `resume` take a game back after a relay restart or an engine that stopped (`died`: once, and again only after the game has gone on), telling every seat `restoring` and each person `restored`; the one-move guard down before the snapshot; `gone` in `describe()`. |
| `scripts/relay-server.mjs` | 635 | Writes enforced rooms, their game gzipped (`packed`), reads them back (`unpacked`) and starts an engine for each; waits `KEEP_GRACE_MS` for a snapshot being taken when going down, and writes nothing after (`down`); sweeps an idle one's file with its engine. |
| `src/features/game/useEngineRoom.js` | 494 | `restoring` and `restored`: the status let go of while a game comes back, and what came back said under the table it came back to (`cameBack`). |
| `src/features/game/Table.jsx`, `Seats.jsx` | 1,776, 367 | The banner while a game comes back; the lobby's lines for a table coming back and one whose game has gone, with the reason, and a table that has gone kept for a week through a restart of its relay. |
| `tests/fixtures/fake-engine.mjs` | 636 | Protocol 9: `snapshot` with a 64-bit number in it written as digits, `restore` refusing one whose number came back as another, `holdSnapshot` and `lastRestore` for tests. |

`tests/relay-server.test.js` (2,231 lines) gains twenty tests of a room that
survives the relay — written, back, coming back, mid-turn, a move lost, a stop
behind, the next move taken while a stop is kept, the hand to keep, a question,
an engine stopped once and again, a relay restart not counted, a second restart
while loading, every reason a game cannot come back, other seats, a room never
dealt, a relay with no engine, the sweep, and records that make no sense — and the mid-turn
death test is kept for an engine at 8; `tests/engine-live.test.js` (1,547) six of
a game kept and taken back by a second process; `tests/engine-room.test.jsx` (687)
four of the seat's.

Added at M7's second review (2026-09-25; PLAN.md, M7, "What the second review
found"):

| File | Lines | What it holds |
| --- | --- | --- |
| `tests/restart-screens.test.jsx` | 133 | The lobby's lines for a table the engine holds, against a relay that is the test's own `fetch`: coming back (the relay's, the engine's, as a status), gone with the room's reason, gone from a relay with an engine, not open on a relay without one, a game that ended said as under way; and the actions panel saying the game is coming back rather than whose stop it is not. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `scripts/relay-engine.mjs` | 1,292 | `record` writes `over` and, for a game the room ended for good, `gone` (`final`); `savedRoomOf` reads both; `comeBack` skips either, and a sit takes an ended game back; `lost` writes; a game that could not be taken back says `TRIED_AGAIN`; `publish` and a move in flight write at once (`onChange({ now })`); `keep` forgives the crash count only past `restoredAt`, and takes the in-flight mark down in the same write; `restored` carries `at`, and what a seat is told is kept until the socket told speaks (`untold.to`); `clause` keeps a name's capital, exported. |
| `scripts/relay-server.mjs` | 675 | `save` (write later, clock untouched) apart from `touch` (a person: clock and write); `flush` writes beside the file and renames over it, and `loadRooms` clears what is left beside; an enforced room's `now` writes at once; `flushMs` and `keepGraceMs` options. |
| `src/lib/engine/restart.js` | 74 | The lost move and answer worded by which restarted (`LOST`): the engine's says the same move again may end the game. |
| `src/features/game/useEngineRoom.js` | 512 | Any status ends `restoring`; a `restored` with an `at` already said is said once (`heardBack`). |
| `src/features/game/Table.jsx`, `Seats.jsx` | 1,784, 376 | A tap on a card does nothing while the game comes back; `EngineActions` (now exported) and the Pass button say it is coming back; the lobby says a relay with no engine has none, rather than that the table has gone. |
| `tests/fixtures/fake-engine.mjs` | 656 | `fragile` (the view after a `continue` ends the process, kept in the snapshot) and `failSnapshot`. |
| `tests/browser/engine-restart.spec.mjs` | 383 | The table held by name in both halves; a tap and the actions panel while it comes back; a reload mid-way; the lobby of a table whose kept game could not be read back. |

`tests/relay-server.test.js` (2,629 lines) gains thirteen: the clock kept through
restarts and the week kept, a person moving it, a game ended for good kept ended, a
game that ended taken back only at a sit, a write that fails leaving the last
record, a stop and a move on disk before they are seen and a relay killed coming
back no further on, the kept game on disk unasked, the crash count forgiven only
past a stop kept, an engine killed mid-move and mid-turn, a `restored` said again
where it may not have been heard, the grace for a snapshot, and `clause`; the stop
behind now waits a small grace, not a second. `tests/engine-room.test.jsx` (741)
four, `tests/engine-restart.test.js` (69) one, and the live test that leaned on its
neighbours deals its own game.

Added for HANDOFF.md §3 item 19 (2026-09-25), a stand-in commander (PLAN.md, "§3
item 19: a stand-in commander"):

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/stand-in.js` | 204 | Which of a Commander deck's own cards may stand in for a commander the engine does not know (`standInsFor`: a legendary creature card, 903.3, the engine knows, its colour identity within the deck's and holding every card dealt, 903.4 and 903.5c, off Scryfall's `color_identity`; none where a card to be dealt has no colours to read); the seat led by the one chosen (`leadWith`: out of the library, sent as the commander with `standsFor`); the choice read back from a table's record, the rules asked again (`ledSeat`); `leadOf`, forgiving; and every word said of it — the gate's offer, the tile's line, the log's line, a stand-in let go of, `standInPhrase`. Pure. |
| `tests/engine-stand-in.test.js` | 283 | `stand-in.js` whole: what the rules allow and do not, the seat led, a choice read back and let go of, the words, the engine's copy said to be led by it, the stop's line, the board marking the card; and the app's Commodore Guff example deck, from the engine's own answers, led by Narset, Enlightened Master alone, the deck unchanged. |
| `tests/fixtures/example-guff.json` | 313 | The Commodore Guff example deck as the engine at the pin knows it, asked 2026-09-25 — the 55 names it does not know, and each of the 30 it knows as it describes them — and Scryfall's record of Commodore Guff. The live test holds it to the engine; the unit test and the engine spec read it. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `scripts/relay-engine.mjs` | 1,353 | `commanderOf` reads `standsFor`; `toEngine` sends the engine a commander without it; `standIn` on a person's seat — as brought until the deal, as dealt after — in `seats`, in their `seated` (`format.standIn`) and in the room's file; `engineDeck.standsFor` where the engine's seat is dealt the same card; `savedRoomOf` reads both back forgivingly. |
| `src/features/game/Lobby.jsx` | 632 | The gate offers the stand-ins as radios, none chosen, the rules cited, and a button naming the one chosen; the tile says one can lead the deck; the choice is recorded with the table. |
| `src/features/game/useEngineRoom.js`, `useEngineCheck.js` | 564, 132 | `agreeToLeaveOut` records the stand-in with the cards left out; the sit brings it (`ledSeat`), one that can no longer lead is let go of and said; the log says once that it leads the deck and the engine's copy; `leads`, and the board marks each stand-in by its owner. The check carries `standIns`. |
| `src/lib/engine/opponent.js`, `board.js`, `deck.js` | 300, 363, 334 | The engine's commander said as a stand-in where the room says it stands in (`standsFor`), and a deck of the engine's own said as depending on one before the sit; `boardFromView`'s `leaders` marks a stand-in card (`standsFor`); `stampedEngineName` exported. |
| `src/features/game/Table.jsx`, `EnginePrompt.jsx`, `Seats.jsx` | 1,797, 677, 381 | The command zones' labels and the word "stand-in" on their tiles; the stop's line for a stand-in commander; the table's and the lobby's seat lists. |
| `src/components/table/BoardCard.jsx`, `ZoneBrowser.jsx` | 314, 120 | A stand-in commander said to be "standing in for" the real one, on the table and in a pile. |
| `src/features/game/game.css` | 498 | `.ztile__standin`, no wider than the tile's face. |

`tests/relay-server.test.js` (2,754 lines) gains eight: a stand-in dealt as the
commander it is and never named to the engine, said to the person, of the copy and
in `GET /rooms`, and unchanged by a sit again; not said of another deck's commander,
a deck of the engine's own, or a game by the ordinary rules; `standsFor` read
forgivingly; kept through a restart; read back from a file forgivingly.
`tests/engine-room.test.jsx` (874) eight of the seat's; `tests/engine-live.test.js`
(1,631) one, the Guff example deck dealt and played against the built engine led by
Narset; `tests/browser/engine-commander.spec.mjs` (431) thirty-one checks against
the stand-in engine, a reload and a relay restart among them;
`tests/browser/game-engine.spec.mjs` (1,384) fourteen against the real engine.

Added for HANDOFF.md §3 item 20 (2026-09-25), Duel Commander and Brawl as Commander
games (PLAN.md, "§3 item 20: Duel Commander and Brawl as Commander games"). No new
file; these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `engine/src/main/kotlin/companion/Server.kt` | 2,340 | Protocol 10. `GAME_FORMATS` deals `duel` (20 life) and `brawl` (25) as `Format.Commander`, commander damage losing nobody (`NO_COMMANDER_DAMAGE_LOSS`), for two players (`TWO_PLAYER_GAMES`); `COMMANDER_BUILDS` builds a deck of the engine's own to the game's own format, Brawl's by `DeckFormat.BRAWL`, and none for Duel Commander; `rulesOf` says `rules` in the reply to `new` and `restore`. |
| `scripts/relay-engine.mjs` | 1,430 | `COMMANDER_GAMES`, `formatOf` reading `duel` and `brawl`; the game asked from the family's asks (`familyAsks`), dealt where the engine lists it at protocol 10, at a table of two, and nobody asked another; `fellBack` `engine`, `players`, `games` or `commander`; `rulesOf` passing the engine's numbers on, forgivingly, and `savedRoomOf` reading them back. |
| `src/lib/engine/commander.js` | 290 | `COMMANDER_GAMES`, `isCommanderGame`, `GAMES` (each number with its citation), `gameName`, `tableLine`, `BRAWL_MULLIGAN`, `damageLoses`; `formatLine` and `leaderWords` in each game's words; `leaderlessLine` for Oathbreaker. |
| `src/lib/engine/stand-in.js`, `opponent.js`, `deck.js` | 215, 319, 337 | A stand-in for a Duel Commander or Brawl deck, said in its game's words; `buildsFor` Brawl, `noOwnLine` with why for Duel Commander, the engine's deck lines for a Brawl game not dealt; `seatDeck` sends either deck's commander apart. |
| `src/features/game/useEngineRoom.js`, `Table.jsx`, `Seats.jsx`, `Lobby.jsx` | 567, 1,802, 381, 635 | The sit asks for Duel Commander or Brawl with its commander; the log's lines; the plates keep no tally where commander damage loses nobody; the seats panel's line for each game; the gate and tile in each game's words; the lobby's line under the title says a hundred cards for Brawl and Duel Commander. |
| `tests/fixtures/fake-engine.mjs` | 690 | Protocol 10 by default: `duel` and `brawl` at 20 and 25 life, the tally's threshold past reach, `rules` in its reply, a Brawl deck of its own and the copy at Duel Commander; FAKE_PROTOCOL=9 refuses both. |
| `scripts/engine-commander.mjs` | 167 | `--kinds brawl,duel`, and the life each game was dealt at. |

`tests/relay-server.test.js` (2,891 lines) gains nine and changes seven: each game
asked for with its commanders and dealt at its numbers, the tally passed through; the
engine's own Brawl deck, and the copy at Duel Commander with why; an engine at 9 asked
for neither and still asked for Commander; a table of three, and one of two different
games, dealt the ordinary game and why; a stand-in at a Brawl game; the room's file
read back forgivingly. `tests/engine-commander.test.js` (317) four,
`tests/engine-stand-in.test.js` (302) one, `tests/engine-opponent.test.js` (255) one,
`tests/engine-room.test.jsx` (946) five; `tests/engine-live.test.js` (1,818) eight
against the built engine — each game dealt at its life total, a Duel Commander game
played and its tally past reach, a 6/1 commander's 24 damage ending a Commander game
and not a Brawl one, a Brawl deck of the engine's own legal by the app's validator and
played, the copy at Duel Commander, a Brawl deck led by a legendary planeswalker, three
players refused; `tests/browser/engine-commander.spec.mjs` (519) twenty-four checks
against the stand-in engine — a Brawl game at 25 whose plate keeps no tally, and a Duel
Commander deck led by a stand-in at 20; `tests/browser/engine-deck.spec.mjs` (289)
seven for the Brawl, Duel Commander and Oathbreaker lobbies in place of three; and
`tests/browser/game-engine.spec.mjs` (1,478) twenty-three against the real engine, a
Brawl game with a Brawl deck of the engine's own and a Duel Commander game with the copy.

Added by the review of items 19 and 20 (2026-09-25; PLAN.md, "What the review of
items 19 and 20 found, and what was done"). `Server.kt` unchanged, the engine not
rebuilt.

| File | Lines | What it holds |
| --- | --- | --- |
| `src/lib/engine/names.js` | 21 | `sameCard(sent, named)`: whether the engine's name for a card is the one the table sent, a card of two faces sent as "Front // Back" and named back by its front (Server.kt, `resolveName`). Shared by the relay and the app. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `scripts/relay-engine.mjs` | 1,482 | The copy the engine deals for a deck of its own it builds none of — at Duel Commander always — says the stand-in that leads it (`engineDeck.standsFor`); the engine's commander matched to the one sent by `sameCard`; in a game dealt by the ordinary rules a person's stand-in put back in the library sent, theirs and the copy's (`withStandIn`), and said as `format.inLibrary`, written with the room and read back forgivingly; `commanderOf` and `toEngine` exported for the live suite. |
| `src/lib/engine/commander.js` | 308 | `GAMES` gains each game's rules for a commander — `hasRule`, `leaderRule`, `identityRule` — Duel Commander's its committee's (402.1b; 403.1a and 103.4b, which defer to 903); `gameRules`; `leaderWords` and `formatLine` cite them. |
| `src/lib/engine/stand-in.js`, `opponent.js`, `board.js` | 232, 323, 364 | `standInOffer` and `standInLine` in each game's own citations; `unledLine`, where a stand-in went in a game dealt by the ordinary rules; the copy's stand-in said in every line that says the copy; `boardFromView` matches by `sameCard`. |
| `src/features/game/useEngineRoom.js` | 574 | The engine's copy's stand-in read off its commander by `sameCard`; the log says where a stand-in sent went in a game dealt by the ordinary rules. |
| `tests/fixtures/fake-engine.mjs` | 708 | FAKE_FORMATS, the games its hello lists and it deals, whatever its protocol; a commander of two faces named back by its front, as Server.kt names it. |

`tests/relay-server.test.js` (3,000 lines) gains five and changes three: the copy at
Duel Commander said to be led by the stand-in; a stand-in of two faces; the stand-in
put back in the library of the ordinary game, and a real commander not; each half of
the room's check of `hello.formats` on its own; `inLibrary` through a restart and read
back forgivingly. `tests/engine-commander.test.js` (331) one and two changed,
`tests/engine-stand-in.test.js` (346) four, `tests/engine-room.test.jsx` (971) two and
one changed; `tests/engine-live.test.js` (1,884) one — a Brawl game kept and taken
back at 25 life, its commander damage past 21 losing nobody in either process — and
the stand-in test sends its commander through the relay's own `commanderOf` and
`toEngine`; `tests/browser/engine-commander.spec.mjs` (547) two checks — a pile's
words for a stand-in, and the pile closed with nothing cast — and four changed: the
Brawl tally read off the wire before the plate's silence about it is believed, and
three for Duel Commander's citations.

Added at M9 (2026-09-25), the engine built in CI (PLAN.md, "M9: CI builds the
engine"). `Server.kt` unchanged, the engine not rebuilt.

| File | Lines | What it holds |
| --- | --- | --- |
| `scripts/browser-suite.mjs` | 131 | The browser suite as `npm run test:browser` runs it, read from `package.json`'s chain and run spec by spec, stopping at the first that fails, with each spec's time said and a table of them in the GitHub job's summary; fails a spec whose last line is not its tally, and, where `ENGINE_REQUIRED` is set, one that ended skipped. `specsOf`, `tallyOf`, `faultOf`, `summaryOf` exported. CI runs the suite through this. |
| `tests/browser-suite.test.js` | 72 | The runner: the chain read whole and in order, and refused where it holds anything but a spec; a spec's last line read; a skip let off only where no engine is required; the table. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | 157 | Before any suite: Temurin 21; the pin; the engine's install in `../argentum`, spelled from the root because the cache action cannot save a path with `..` in it, restored from the cache, keyed on the pin and a hash of `engine/build.gradle.kts`, `engine/src/` and the build script; on a miss, Gradle's cache, `npm run engine:build` and the install saved at once; `findEngine` asked where the engine is. `ENGINE_REQUIRED` for the whole job. The unit suite with the live suite apart, then the live suite in a step of its own, verbose; the browser suite through `scripts/browser-suite.mjs`. Times as notices and in the job's summary. |
| `scripts/engine-build.sh` | 76 | `--rev`: says the commit it would build, for CI's cache key, and nothing else. |
| `scripts/engine-bridge.mjs` | 151 | `engineRequired(env)`: `ENGINE_REQUIRED` set to anything but nothing, 0, false or no. |
| `tests/engine-live.test.js` | 1,898 | Where `ENGINE_REQUIRED` is set and there is no engine, a failing test in place of the skip. The goblin game seeded (20260925): unseeded it failed one run in fifty. |
| `tests/browser/game-engine.spec.mjs`, `engine-restart.spec.mjs` | 1,485, 389 | Where `ENGINE_REQUIRED` is set and there is no engine, `0 passed, 1 failed` and exit 1, in place of the skip. |

`tests/engine-bridge.test.js` (154 lines) gains one, `engineRequired`'s readings.
`engine/README.md` says how CI builds and caches the engine.

Added for §3 item 12 (2026-09-25), the pin offered weekly (PLAN.md, "§3 item 12:
the pin offered weekly"). `Server.kt` unchanged, the engine not rebuilt.

| File | Lines | What it holds |
| --- | --- | --- |
| `.github/workflows/engine-pin.yml` | 306 | Mondays at 05:17 UTC and by hand (`again`: offer a commit whose pull request was closed). `look` (reads the repository and its pull requests): the pin and where upstream is from the build script, upstream `main`'s head by `git ls-remote`, GitHub's comparison where it answers, and a stop, said, where upstream is the pin or not ahead of it, a pull request from an `engine-pin/` branch is open, or this commit's was closed unmerged. `try` (reads, keeps no credentials, saves no cache): the pin's engine restored from `deploy.yml`'s cache or built, asked `hello`; upstream built at its head and asked `hello`; the live suite and both engine specs against it, each whatever the other did; the run's summary and its files kept as an artifact. `offer` (writes; runs nothing of upstream's): the body, refused unless every test passed; the pin moved on `engine-pin/<commit>` and nothing else; the branch pushed, and the pull request opened, or the setting it needs named. One run at a time. |
| `scripts/engine-pin.mjs` | 431 | `specs` (the engine's browser specs, `ENGINE_SPECS`), `hello` (an engine's answer kept with its commit, date and build time), `body` (the pull request's body, or the run's summary; `--offer` writes none unless every test passed) and `move` (ENGINE_REV moved in the build script, on its one line and only from the commit measured against). `setsSince`, `liveOf`, `browserOf`, `verdictOf`, `bodyOf`, `moved`, `mentionsOf`, `md`, `code` exported; everything read back read forgivingly. |
| `tests/engine-pin.test.js` | 219 | The sets new, gone and whose mark changed; the reports read forgivingly; the verdict, where anything unrun is a reason; upstream's words kept from Markdown; the body, the summary, and one from nothing; the pin moved on its one line and refused otherwise; the files still naming the old pin. |

And these grew:

| File | Lines | What changed |
| --- | --- | --- |
| `scripts/browser-suite.mjs` | 214 | Its own two arguments: `--only=` runs the named specs of the chain alone, in its order, a name that is no one spec of it refused; `--record=` writes what each did as JSON, with the checks it said failed (`failuresOf`). `optionsOf`, `pick`, `recordOf` and `failuresOf` exported. |
| `scripts/engine-build.sh` | 83 | `--repo`: says where it fetches Argentum from, and nothing else. |
| `tests/browser/game-engine.spec.mjs` | 1,498 | What the engine knows of each example deck asked of the engine through the relay's `POST /engine/check`, as the lobby asks it, instead of written down: the numbers move with the pin, and the weekly offer runs this spec against upstream. |

`tests/browser-suite.test.js` (112 lines) gains four: the runner's own arguments, the
specs picked, a check's failure read, and the record. `engine/README.md` says how the
pin is offered, and `--repo`.

Changed by §3 item 12's second review (2026-09-25; PLAN.md, "§3 item 12: the pin
offered weekly", "What the second review found"). `Server.kt` unchanged, the engine
not rebuilt.

| File | Lines | What changed |
| --- | --- | --- |
| `.github/workflows/engine-pin.yml` | 447 | An offer takes two runs, so that upstream's code runs on a branch whose cache no run on `main` restores. From `main`: `look` as before, counting only the workflow's own pull requests (`engine-pin.mjs offers`), and doing nothing when run from any other branch; `hand-off` (writes a branch, starts a run) deletes any throwaway branch a cancelled run left, makes `engine-pin-try/<commit>-<run>` at `main`'s commit and starts the workflow on it with the commit as `next`. On that branch: `look` takes the commit handed, and checks by GitHub's comparison that the branch is `main` as it was; `try` as before; `offer` checks out `main` itself, refuses where `main` no longer pins what was tried against, and says in its summary why nothing was offered where a step failed; `clean` deletes the branch however the run went. |
| `scripts/engine-pin.mjs` | 467 | `offersOf` (exported) and `offers`: of `gh pr list`'s answer, the pull requests from this repository's `engine-pin/` branches (or the one named) opened by GitHub Actions, as `#1, #2`; a fork's is none, and so is an entry that does not say. The run's summary says every test passed and that the `offer` job opens the pull request, not that it was opened. |
| `scripts/browser-suite.mjs` | 215 | Its comment on `process.exitCode`: a pipe is written asynchronously on POSIX, where CI runs, and synchronously on Windows. |
| `tests/browser/game-engine.spec.mjs`, `engine-restart.spec.mjs` | 1,521, 403 | The page opened with service workers blocked, so the routed pixel answers Scryfall's images; what it answered counted, and a check that it answered the engine's card images with no service worker controlling the page. In `game-engine.spec.mjs` the example decks' check asks the engine whether it knows each commander too, and expects the tile's line about the Commander game only where it does not. |
| `tests/browser/decisions.spec.mjs`, `engine-commander.spec.mjs`, `engine-deck.spec.mjs`, `levels.spec.mjs` | 445, 550, 292, 214 | The page opened with service workers blocked, for the stand-in's card images, which are Scryfall's links too. |

`tests/engine-pin.test.js` (248 lines) gains one, the workflow's own pull requests
told from a fork's and a person's, and its summary check says the verdict and claims
no pull request; `tests/browser-suite.test.js` (131) gains one, every spec of the chain
that routes `*.scryfall.io` opening its pages with service workers blocked.
`engine/README.md` and HANDOFF.md §3 item 12 say what the workflow ensures and what it
cannot; HANDOFF.md §5 gains two traps and says more in two others, and §6 the rest.

## `src/lib/board/` — the rules-free table

| File | Lines | What it holds |
| --- | --- | --- |
| `reducer.js` | 530 | `apply(board, action)` → `{ok:false, reason}` or `{ok:true, board, events}`. Pure. Every move goes through it. |
| `net.js` | 274 | The replication protocol for two devices — action ordering, joining, resync. |
| `model.js` | 251 | `createBoard`, zones, `upgrade()` for old saves, invariants that report rather than throw. |
| `geometry.js` | 186 | Positions as fractions of a **square** battlefield; `tidy`, `freeSpot`, `cardAt`, and `fan()` for the hand. |
| `webrtc.js` | 164 | The transport under `net.js`. |
| `log.js` | 162 | `readLog(events, board)` → English, grouped by turn, consecutive steps collapsed. |
| `coach.js` | 147 | The quiet coach — observations, never instructions. |
| `sound.js` | 119 | Table sounds. |
| `art.js` | 114 | Printings, treatments, foils, all from Scryfall fields. **Also used by Cards and Decks — see the boundary note in `PLAN.md`.** |
| `placement.js` | 112 | Which lane a card belongs in, what may sit on the battlefield. |
| `mana.js` | 96 | `untappedSources`, `producedBy`, `withinReach` — arithmetic on Scryfall data, deliberately weaker than a rules engine and labelled as such. |
| `runner.js` | 81 | `newRun`, `act`, `undo`, `snapshot`, `restore`. Saves the board, **not** the event log. |
| `deck.js` | 62 | Opening hands, mulligans, printing swaps. |

**Zones**: `library`, `hand`, `battlefield`, `stack`, `graveyard`, `exile`,
`command`. **Storage**: `SCHEMA_VERSION = 4`.

## `src/features/table/` — the UI

> **Retired, 2026-09-20.** `TableView.jsx` is gone: the Table tab opens the
> rebuilt table. Everything below except `TableView.jsx` now lives in
> `src/components/table/`, shared by both tables; `HandCost.jsx` (the cost
> floating above a card in hand) was lifted there too. The rebuilt table is
> `src/features/game/` — `GameView.jsx`, `Lobby.jsx`, `Table.jsx`, `game.css`.

| File | Lines | What it is |
| --- | --- | --- |
| `TableView.jsx` | 995 | The whole table screen. Too big; a rebuild should split it. |
| `table.css` | 849 | Everything visual, including the fan and the printed-face card. |
| `BoardCard.jsx` | 207 | A card on the table: printed face when there is a picture, drawn tile when there is not. |
| `Field.jsx` | 181 | The battlefield, lanes, arrows, drag targets. |
| `TokenMaker.jsx` | 136 | Tokens and blank cards. |
| `GameLog.jsx` | 120 | What has happened, newest first. |
| `PlayerCounters.jsx` | 118 | Poison, energy, experience, storm, ticket, speed, custom. |
| `ZoneBrowser.jsx` | 107 | Searching a pile — `t:`, `o:`, `name:`, Scryfall's own prefixes. |
| `TurnTracker.jsx` | 88 | The turn, taught from `docs/TURN_STRUCTURE.md`, cited by rule number. |
| `useDrag.js` | 78 | Pointer dragging. |
| `Coach.jsx` | 55 | The coach's notes. |
| `Pool.jsx` | 35 | "Untapped", never "available". |

## Tests

**Unit** — 1,191 across 58 files. Table-related:

| File | Tests | File | Tests |
| --- | --- | --- | --- |
| `board-model.test.js` | 98 | `table-mana.test.js` | 29 |
| `board-mana.test.js` | 18 | `table-combat.test.js` | 14 |
| `board-net.test.js` | 14 | `board-log.test.js` | 13 |
| `board-restore.test.js` | 10 | `board-placement.test.js` | 9 |
| `table-game.test.js` | 9 | `board-art.test.js` | 7 |
| `board-sound.test.js` | 7 | `table-evidence.test.js` | 6 |
| `table-motion.test.js` | 6 | `board-webrtc.test.js` | 4 |

**Browser** — 26 specs run headless in CI. The Table's own:
`table.spec.mjs` (149 checks), `table-old-save.spec.mjs` (12),
`together.spec.mjs` (two devices, 9), plus `a11y.spec.mjs` (an axe-core sweep
that covers the table's states).

Run them: `npm test`, and
`CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:browser`.

## What the Table can do today

Deal a deck, draw, mulligan, play cards to a lane-ruled playmat, drag them
anywhere, tap and untap, counters on cards and on players, tokens and blank
cards, arrows, dice, notes, printings and foils, the stack as a zone, a turn
tracker, a searchable browser over every pile, a game log, undo, persistence
across reloads, and two devices sharing one table over WebRTC.

## What it cannot do, and why

It enforces nothing. No castability, no legal-play checking, no automatic
triggers, no combat resolution, no priority, no AI. Not from lack of effort —
`board/` **never reads what a card does**, by design, which is the same choice
that lets it work with every card in existence.

That trade is the subject of `ENGINE.md`.

## Known rough edges to fix in a rebuild

- `TableView.jsx` at 995 lines is doing far too much.
- `snapshot()` saves the board but not the event log, so the game log is empty
  after a reload. Deliberate — an unenforced table emits thousands of events —
  but a real engine would want a replayable log instead.
- The hand's cost badges crowd each other above roughly ten cards on a phone.
  That is the width of the screen, not the layout, but a rebuild could stagger
  them.
- No seats. Two-device play exists at the protocol level (`net.js`,
  `webrtc.js`, `together.spec.mjs`) but the UI is still one player's view.
