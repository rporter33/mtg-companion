# The plan

**Phase 0 is not optional and is not code.** Settle `ENGINE.md` with the owner
first.

**Phases 1, 2 and 5 do not depend on that decision at all** — they are the
client, they are the majority of what makes Moxgate feel like Moxgate, and
they can start today. Phase 3 is the one that changes: under the revised
recommendation it is **integration with an existing MIT-licensed engine**
(XMage or Argentum), not writing one. The original "write the rules core"
version of Phase 3 is kept below as **3-alt**, because it is still what
happens if the owner wants the engine to be ours.

> Phase 3 was rewritten on 2026-09-19. The first draft assumed the mature
> engines were all copyleft. They are not — see the correction at the top of
> `ENGINE.md`.

---

## How to build this without breaking the app

The owner's constraint, in their words: *"I don't want to mess the rest up."*

**Cards**, **Decks**, **Learn** and **Play** are finished work in daily use.
Only `src/App.jsx` imports `src/features/table/`, so the Table's UI is safely
isolated.

**`src/lib/board/` is not.** There is exactly one cross-boundary dependency,
and it is load-bearing:

```
src/lib/board/art.js
  ← src/components/Printings.jsx
      ← src/features/cards/CardDetail.jsx      (Cards tab)
      ← src/features/decks/DeckList.jsx, DeckHistory.jsx, …
```

`art.js` — printings, treatments, foils, `artUrl` — is **shared
infrastructure that happens to live under `board/`**. Moving, renaming or
deleting `src/lib/board/` breaks the Cards and Decks tabs.

So: treat `src/lib/board/art.js` as public API. If the rebuild wants it
elsewhere, move it to `src/lib/` in a commit of its own, with the whole suite
green, *before* anything else starts. Nothing else under `board/` is reachable
from outside the Table.

The isolation strategy:

1. **New code goes in new folders.** `src/lib/engine/` for the rules core,
   `src/features/game/` for the new client. Do not edit `src/lib/board/` or
   `src/features/table/` except to fix bugs.

   **Done 2026-09-20, and one refinement.** The parts of the old table that
   are not about the old table — the card, the field, the drag, the log, the
   pool, the counters, the zone browser, the token maker, the turn tracker,
   the coach, and their stylesheet — were lifted to `src/components/table/`
   in a pure move: same files, import paths only, every spec green. Both
   tables now render the same parts from the same place, so a fix lands in
   both and the switchover is a deletion rather than a reconciliation. That
   is the `art.js` pattern from above applied to the UI, and it is what
   "carry over" in Phase 1 turned out to mean.
2. **A new route**, e.g. `#/table2/<deckId>`, alongside the existing
   `#/table/<deckId>`. Both work. Nobody is migrated.
3. **A new storage key and schema.** Never write the new engine's state
   through the existing `SCHEMA_VERSION = 4` blob. An old build must be able
   to read storage a new build wrote — see the migration rule in
   `HOUSE-RULES.md`.
4. **A flag decides which the Table tab opens**, defaulting to the old one
   until the new one is at parity.
5. **The old browser specs keep passing, untouched, the whole way.**
   `table.spec.mjs`, `table-old-save.spec.mjs` and `together.spec.mjs` are the
   regression net for "the rest still works". If one goes red, stop.
6. **Lazy-load the engine.** It will be the largest module in the app and it
   must not land in the bundle for someone who opened the Cards tab.
   `bundle.spec.mjs` already guards budgets.

Only when the new table is better on every axis does the flag flip, and the
old one comes out in a commit of its own.

---

## Scope, and the order it ships in

All four modes are in scope — **solo vs AI**, **1v1 with a friend**,
**Commander pods (3–6)**, **draft and sealed**. The owner's instruction is to
**build solo vs AI first and then plan the rest**, so:

- **Everything before Phase 5 targets one human against one AI.** That is the
  core loop, it is what both candidate engines ship an AI for, and it is the
  easiest thing to demo.
- **Design for more seats, build for two.** Phase 2 exists so the state model
  is per-player from the start; a two-seat assumption baked into the client is
  the thing that makes pods a rewrite later rather than a feature.
- **Once solo vs AI works end to end, stop and plan the rest** before
  continuing. Commander pods are the most valuable of the three, because
  Moxgate's own lobby apologises for having them paused.

## Phase 1 — The shell, no engine

Everything in `TARGET.md` §1–§7 and §9 that needs no rules knowledge. This is
the bulk of what makes Moxgate feel like Moxgate, and almost none of it is
blocked.

- **The lobby** (§2): format tabs, deck search, the three filter dropdowns
  with **counts on every chip**, random/import/guide tiles, the deck shelf with
  archetype, colour pips, bracket and count. The deck data and the archetype
  vocabulary already exist in this repo.
- **The seats panel** (§2 right rail): `TABLE · n / m`, named seats, the line
  that changes with occupancy.
- **The confirm-dialog house style** (§3) as a shared component, then applied
  everywhere the app currently says "Are you sure?".
- **Buttons that name their object** — `Start game vs Sythis →`.
- **The table layout** (§7): both life plates with the phase pill and the ring
  on the active seat, the mirrored playmat, corner zone tiles with counts, the
  actions rail, the opening-hand prompt floating rather than modal, and the
  **cropped landscape battlefield tile** — with a tapped treatment that reads
  at a glance, since rotation alone will not carry it on a wide tile.
- **The log** (§9) in full, including **hidden information visibly hidden** —
  greyed, no thumbnail — and step dividers with passed steps nested faintly
  beneath them. `src/lib/board/log.js` is most of the way there.
- **The pace presets** (§5) over whatever options the table ends up having,
  with the `Advanced` disclosure that shows what each preset actually sets.

Carry over from the current table: the fanned hand, the printed-face card,
treatments and foils, the zone browser, player counters, tokens, arrows, dice.

Three things from `CREATOR-POST.md` to build in from the start rather than
retrofit:

- **A precomputed bundle of common cards** as static JSON, loaded at startup
  ahead of the IndexedDB cache and the API, so the lobby's deck shelf never
  waits on the network for a Sol Ring.
- **The drag collision order** — attachments first, then hand reordering,
  then zone drops, then nearest centre — as the priority `placement.js` and
  `useDrag.js` apply.
- **The client store is the engine's own view held flat**: Argentum's
  `ClientGameState` is already `cards: Map<id, card>` plus zones as id lists,
  which is Moxgate's shape too. One model, memoised selectors, no second copy
  to keep in step.

**Done when**: the new route looks like `TARGET.md` with cards moved by hand.

### Where Phase 1 stands — 2026-09-20

Shipped, at `#/game`, reached by address only:

- **The lobby** (§2): format tabs with counts, search, the colours filter
  with counts on every facet, random / import / guide tiles, the shelf with
  art, commander, colour pips, and the seats panel with its honest
  "Solitaire" line. Not yet: the bracket and archetype chips on the shelf.
- **The table** (§7): both plates with the phase pill and the ring on the
  active seat (the seat opposite open and saying so), the battlefield of
  **cropped landscape tiles** with the tapped treatment — turned a little,
  dimmed, a glyph, and "tapped" spoken — the ACTIONS / COMBAT / END TURN /
  UNDO rail, the fanned hand with costs floating above it, the four zone
  tiles with counts that open their zones beside the log, and the opening
  hand as a prompt floating on the field. Under its own storage slot
  (`game.saved`), so it never overwrites a game left at `#/table`.
- **Law 2 is in**: one tap plays a card from hand, one tap taps a permanent,
  no confirming tap; the rarer actions are a long-press or right-click away,
  and undo is always on the rail. Tested in `tests/browser/game.spec.mjs`.
- **Law 1 is deliberately not simulated.** With no engine the table never
  stops the player at a step; the step pill is a tracker. The §8 prompt
  panel exists only for the opening hand until the engine can say
  truthfully that there is nothing to respond with.
- The mirrored playmat is one seat deep. The layout is built for two; the
  second seat's field arrives with the seat, in Phase 2.

Still to do in Phase 1: the confirm-dialog house style (§3) as a component;
the log's hidden-information greying and nested step dividers (§9); the
pace presets (§5); the common-card bundle; the drag collision order; hover
zoom for a card in hand.

## Phase 2 — Seats, over a relay

Seats done properly, which the current table has at the protocol level and
not in the UI. **Rewritten after `CREATOR-POST.md`**: the transport is a relay
server, not WebRTC peer-to-peer. Hosting is approved, the relay *is* the
signalling that was deferred, and it gives four things peer-to-peer cannot —
server-held snapshots for late joiners, rooms persisted to disk across a
restart, turn authority in one place, and reconnect with a known close code.

What carries over: the client half of `net.js` — apply locally, send, apply a
remote action without re-broadcasting — is already this design. What is
added is the server, and these are requirements from the first commit, each
one a lesson the creator paid for:

- Zero game logic in the relay, **except turn passing**, which the server
  owns so two clients can never both believe it is their turn.
- A snapshot per room held server-side, and rooms persisted as JSON on disk.
- Ping every 30 s, drop what does not pong, so proxies with a 60 s idle
  timeout never leave a client silently hung.
- On SIGTERM, close every socket with **1012 Service Restart** before exiting,
  and exponential-backoff reconnect on the client.

Then: hidden hands, a room panel, hot seat on one device — and, because the
board model has no two-seat assumption and a relay does not care how many
clients it fans out to, **the degraded mode can seat a four-player pod in this
phase**, which is the thing Moxgate's own lobby has paused.

This phase still comes before the engine, because it forces the state model
to be per-player rather than "mine and the rest", which an engine assumes.

## Phase 3 — The engine underneath

Integration, not authorship. The work, in order:

1. **The engine is Argentum** — settled, see the VERIFIED section of
   `ENGINE.md`. Two questions remain open there: bundle size with a trimmed
   JRE, and whether `rules-engine` survives a Kotlin/JS port. Neither blocks
   starting.
2. **The spike is done — read `SPIKE.md` before anything else.** Argentum was
   built and run: 20 games end to end at 809 ms each, `legalActions()` at a
   260 µs median, a `StateDelta` at 2.65 KB against a 16.7 KB full state, and
   hidden information already enforced per viewer. `spike/` reproduces it in
   about six minutes.

   The biggest thing it changed: **we do not need their `game-server`.** The
   whole client protocol — `ClientStateTransformer`, `StateDiffCalculator`,
   `StateDelta`, `ClientDTO`, `Visibility` — lives in `rules-engine/…/view/`,
   not in their Spring Boot app. So we write a thin server of our own around
   `rules-engine` + `gym` + `view/`, and skip Keycloak, Redis, matchmaking and
   their lobby, which `TARGET.md` replaces anyway.

   **We therefore own the wire format**, which means Law 1 and Law 2 are
   designed into the protocol rather than worked around in the client.
3. **A transport boundary in our code**: one module that speaks to the engine
   and nothing else in the app knows what is behind it. It should be
   swappable for the unenforced table — same questions asked, different
   authority answering. `src/lib/board/net.js` is the precedent: the table
   already knows how to take actions from somewhere else. Per
   `CREATOR-POST.md`, this is **one thin server with two authorities**: a
   relay for the degraded mode, the engine for the enforced one — the same
   two layers Moxgate runs, in one process.
4. **State mapping**: the engine's game state onto what the client renders.
   Expect this to be most of the work, and expect the engine's model to be
   richer than ours — it knows about things the current board has no word for.
5. **Desktop packaging**: Tauri or Electron, bundled JRE, engine on localhost,
   lifecycle handled (start, health-check, shut down cleanly, survive a
   crash). Under MIT this is a packaging job, not a licensing negotiation.
6. **Web**: a hosted instance behind the same transport boundary — the owner
   has approved hosting, so the browser build is rules-enforced too. The
   unenforced table is then not the web *plan* but the **degraded mode**: what
   runs when the engine is unreachable, on a train or during an outage. Say so
   on screen when it happens, per the house rule that the app admits what it
   does not know.

**Do not fork the engine.** Contribute upstream if something is missing. A
fork is a maintenance burden that outlives the enthusiasm that created it.

## Phase 3-alt — Writing the rules core ourselves

Only if the owner wants the engine to be ours. `src/lib/engine/`, TypeScript,
pure, no React, no DOM, exhaustively tested. Build in this order — each stage
is useless without the one before it:

1. **Objects and zones**, with real object identity across zone changes.
2. **Turn, phases, steps, priority**, from `docs/TURN_STRUCTURE.md`, cited.
3. **The stack** — put on, respond, resolve, fizzle on illegal targets.
4. **Mana**: pools, costs, paying, tapping for mana, mana abilities not using
   the stack.
5. **State-based actions**, checked at every priority.
6. **Triggered abilities**: detection, APNAP ordering, intervening-if.
7. **Combat**: attackers, blockers, restrictions, requirements, damage
   assignment order, first/double strike, trample.
8. **The layer system (613)**. Leave it until last and budget properly for it.
   It is the hardest part of Magic and the part that tells you whether an
   engine is real.
9. **Replacement and prevention effects**.

Then **a card-scripting layer**, so a card is data and the pool grows by
writing scripts rather than features. Start the pool from the owner's own
decks; `listDecks()` in storage says which those are.

**Test discipline**: every rule implemented cites its number from
`docs/TURN_STRUCTURE.md` or the comprehensive rules, and has a test named for
the situation it protects. This is the portfolio piece — it should read like
one.

## Phase 4 — The engine on screen

The short list from the end of `TARGET.md`. Under Phase 3 these stop being
things to *build* and become things to *surface* — the engine already knows
all of them, and the work is asking it the right question:

- The castability glow (§11), now truthful.
- `AVAILABLE MANA` as a real number.
- The prompt panel (§8) with both halves: the rules claim *and* the teaching
  line. Keep the wording shifts — "nothing to flash in" at end step. **But
  obey `FRICTION.md` Law 1**: if the panel's sentence would be "nothing to
  respond with", it should not be on screen at all. The panel appears when the
  player can act; otherwise the game moves on and the log records the step.
- **One tap acts** (`FRICTION.md` Law 2), with preview on hover and
  long-press, undo for anything reversible, and a named-consequence dialog
  only where a choice genuinely cannot be taken back.
- `Available Actions` (§10) listing **legal** actions, two panes, preview then
  confirm.
- Automatic triggers, legal attack and block declaration.
- **The fallback**: a card outside the pool is still playable by hand on the
  same board, clearly marked. This is what stops an unimplemented card ending
  a demo, and the app already knows how to label what it does not know.

## Phase 5 — Desktop, and polish

- **Desktop**: Tauri (small, Rust) or Electron (familiar, large). Under an
  MIT engine this is a packaging job — bundled JRE, engine on localhost,
  native menus, window state and a real offline cache. Under Phase 3-alt there
  is no JVM at all and it is smaller still.
- Performance with a hundred permanents and real card images.
- An accessibility sweep of everything new — see `HOUSE-RULES.md`.
- The portfolio write-up in `rporter33/portfolio`.

---

## What "smoothly" will actually cost

The owner asked for smooth on web and desktop. The things that decide that,
none of which are the engine:

- **Images.** A hundred permanents at `normal` size is megabytes. The current
  card already uses `srcSet` with `small` at 146px and `normal` at 488px —
  keep that discipline and make the cache explicit.
- **Re-render scope.** A pure reducer that returns a new board every action
  will re-render everything unless the component tree is cut carefully. The
  current `TableView.jsx` at 995 lines is the warning.
- **Engine work off the main thread.** A layer recalculation over a big board
  should not stutter a drag. A web worker boundary is much easier to design in
  at the start than to retrofit.
- **Bundle.** Lazy-load the engine and the card scripts. `bundle.spec.mjs`
  already guards the budgets.

---

## An honest estimate

Under Option D, with one person:

| Phase | Rough size |
| --- | --- |
| 1 — shell | Weeks. Mostly known work, much of it already built. |
| 2 — seats | Weeks. |
| 3 — engine integration | **Weeks**, dominated by state mapping and the protocol spike. |
| 3-alt — writing it ourselves | **Months.** Layers alone can take weeks. |
| 4 — on screen | Weeks, once 3 exists. |
| 5 — desktop and polish | Weeks. |

The difference between `3` and `3-alt` is the whole difference between this
being a season of work and being a year of it. That is why `ENGINE.md` is
Phase 0.

Phases 1 and 2 are worth doing first either way: they are the visible majority
of "like Moxgate", they are not blocked on the engine decision, and they make
the thing demonstrable long before any engine is wired in.
