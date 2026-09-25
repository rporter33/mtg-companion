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
