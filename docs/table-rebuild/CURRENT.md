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
to it from Node. It plays a whole game against the engine's own AI today
(`npm run engine:play`); nothing on screen uses it yet — see `PLAN.md`,
"Where Phase 3 stands".

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
