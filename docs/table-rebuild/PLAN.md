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
pace presets (§5); the common-card bundle; hover zoom for a card in hand.

**The drag collision order is in** (2026-09-20): `src/lib/board/drop.js`
decides where a released card goes in the creator's priority — the card
under the pointer (attach; the smallest when they pile), then a zone tile,
then the hand strip, then the battlefield at that point — as a pure
function over rectangles with its own tests, and the table gathers the
rectangles once at release. Dragging a card onto a permanent puts it on it;
onto the graveyard tile sends it there; back onto the hand brings it to
hand. Hand reordering is deliberately not a drop target: the board keeps no
hand order, and inventing one for a drag would be a second model.

**Render discipline, measured rather than assumed** (2026-09-20): the
creator's `React.memo` and stable-array work exists because their board got
slow at scale. Ours was measured before copying it — a solo table with 30,
80 and 130 permanents already on the battlefield, twenty taps each, timed
from the click to the tapped class appearing in the DOM (a MutationObserver,
not a frame wait, which had put a 33 ms floor under the first attempt):

| Permanents | Median | p90 | Worst |
| --- | --- | --- | --- |
| 30 | 2.3 ms | 4.5 ms | 6.3 ms |
| 80 | 2.9 ms | 5.3 ms | 7.4 ms |
| 130 | 3.4 ms | 4.9 ms | 9.7 ms |

All inside one 16 ms frame with no memoisation at all, so none is added.
The number to watch is the worst case at 130; if the table ever grows a
feature that re-renders every tile per action (a hover glow on castable
cards, say), measure again before and after.

### The client first — 2026-09-20

The owner's call: no multiplayer until the client is as polished and as deep
as Moxgate's. The relay and its screens stay built, tested and unadvertised;
the seats panel only offers a room once somebody types a relay address.
Four milestones, each shipping something felt: motion and touch; the systems
that go deep (the log, the step wording, mana pips, the untested parts of the
old table); clarity everywhere (dialogs, empty and loading states, the tile
at every size); then the switch of the Table tab and the engine.

**Milestone 1, motion and touch — done.** A card travels: FLIP between hand
and field on the element itself, a cloned ghost shrinking into the pile it
went to, a card growing out of the pile it came from (`useTravel.js`), off
entirely under reduced motion. A press answers before the table does.
Resting the pointer on a card shows its printed face beside it, above a card
in hand so its neighbours stay visible, at once with Z, and never right
after a press (`Peek.jsx`). A finger resting on a card for half a second
picks it up without playing or tapping it, the touch equivalent of the
right-click (`useDrag.js`). Each has a check in `game.spec.mjs`, and the
frames were looked at.

**Milestone 2, the systems that go deep — in progress.** The log now has
§9 in full: a divider for the step something happened in, with the steps
passed through to reach it listed faintly beneath; your own turn headed
with the green dot; and hidden information visibly hidden — another seat's
draw, or a card they moved between hand and library, is greyed with no
thumbnail and never named, even though the board holds the name. The
rule-citing turn tracker sits under the log, which is the §8 wording done
our way: it says where you are and what the rule is, and never stops you
to ask. And the old table's systems are now proven on the new one in
`tests/browser/game-parity.spec.mjs`, run through the one-tap screens: an
instant refused the battlefield and sent to the stack, arrows and pointing,
counters and face-down, dice, choosing a printing that the deck then keeps,
foils with their sheen on the tile, real tokens and blank cards, the pile
browser with its `t:` search, the coach and its silence, the untapped
count. Along the way a made token stopped landing on whatever already sat
at the row's centre: it takes the next free place, as a played card does.

**Milestone 3, clarity everywhere — in progress.** The confirm-dialog house
style is a component, `src/components/Confirm.jsx`: the title is the
situation, the body the consequence, and every button says what pressing
it does, never OK or Cancel. It asks before a deck is deleted, before a
saved version is deleted, before dealing again and before a mid-game
mulligan; the browser's own `confirm()` is gone from the app. The §3 "no
opponent seated" dialog itself is not built: with no engine there is no
opponent to seat, so the seats panel says so and a dialog with one real
choice would be noise. The table's loading state is the table's own shape,
faintly, with the one line that says what is being waited for, in place of
a spinner. The tile was looked at on a phone upright, a phone sideways and a
desktop, and holds at all three.

**Milestone 4, the switch — done 2026-09-20.** The Table tab opens the
rebuilt table; `#/table` and `#/table/<deck>` still answer, as `#/game`. A
game left at the first table is offered for carrying over, in the house
style, the next time its deck is opened; continuing brings it as it stood
and lets the old slot go. `src/features/table/` is deleted with its two
specs; the shared parts in `src/components/table/` stay, and the new
suite is the only regression net. What the first table had that this one
does not offer: "tidy up", whose geometry assumed a square field of whole
cards and would need redoing for tiles. Everything else crossed over.

**The common-card bundle waits on network**: Scryfall is not reachable from
the build environment this was written in, so a bundle generated blind
could not be checked. The script and loader are a small job once it is.

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

### Where Phase 2 stands — 2026-09-20

**The relay is built and tested**, with no UI on it yet:

- `scripts/relay-server.mjs`: rooms of 2–6 seats, one table per room held
  server-side by the same `host()` the old table used, so the snapshot a
  late joiner gets is always current and always passes the board's
  invariants. Turn authority: only the active player may pass, and the
  server names the next seat with somebody in it, ignoring whatever the
  client sent. Heartbeat every 30 s, `1012` on SIGTERM, rooms as JSON on
  disk, a week's idle expiry, and the built app served from the same
  process when asked. `npm run relay`.
- `src/lib/board/relay.js`: the browser's wire — the same `{ send,
  onMessage, close }` shape as the loopback and the WebRTC peer — with
  exponential-backoff reconnect, a status callback for the screen, and
  `onOpen` where the guest says hello again and gets its seat back.
- `net.js`'s host gained a seatless mode, seat reclaim on reconnect, and the
  turn rule; every earlier protocol test still passes unchanged.
- Proven by `tests/relay-server.test.js` over real sockets and
  `tests/browser/relay.spec.mjs` with two real browsers through a cut
  socket and a server restart.

**Improvement on Moxgate, stated once**: their server relays whatever a
client last uploaded; ours holds the table itself and verifies it. Same
zero rules, one more guarantee.

**And the screens on it, the same day.** The lobby's seats panel opens a
room of 2–6 seats and hands out the link (`#/game/room/<code>`); a friend
opening it lands in the same lobby, sees who is seated, picks a deck and
sits. The table at a shared room shows the seat opposite as a real person:
their plate with THEIR TURN / WAITING / AWAY, their hand as card backs, their
zone tiles (graveyard and exile openable, hand and library not), and their
permanents mirrored so their lands are at the far edge. Somebody else's card
offers only "read it" and "point at it"; a tap on it is refused by the relay
and the screen says so. Only the active player can end the turn. Undo is not
offered at a shared table, and says why. A cut socket shows a banner and
comes back; a reload lands in the same seat with the same table. Proven by
`tests/browser/game-room.spec.mjs` with two browser contexts, which are two
devices as far as the app can tell.

The relay's address comes from `VITE_RELAY_URL` at build time or from a
field in the seats panel, saved as a preference — because there is no hosted
relay yet. Next: host one, point the GitHub Pages build at it, and lay pods
of three to six out properly (today each extra seat stacks another strip
above the table, which works and is not the layout).

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

### Where Phase 3 stands — 2026-09-20

**Step 3 is built: the engine is on the wire.** `engine/` is a Gradle module
dropped into a checkout of Argentum by `scripts/engine-build.sh` (JDK 21,
about five minutes the first time, seconds after). It is one process, one
game, JSON lines on stdin and stdout, and `scripts/engine-bridge.mjs` is the
whole of what Node knows about it. The protocol is in `engine/README.md`.

Three things are decided in that process, all from `FRICTION.md`:

- **Law 1 is server-side and uses the engine's own test.** A seat with
  `autoPass` is passed for at every priority window where nothing
  *meaningful* is affordable — `MeaningfulActionFilter.isMeaningful`, which
  already knows that tapping a land for mana is a cost and not a play, and
  that a declare-attackers with nothing to declare is not a stop. The first
  cut asked "any affordable non-pass action?" and stopped the player at
  every upkeep to offer them a land to tap: the difference between the two
  questions was 34 stops against 31 for the same game, but the wrong 34.
  The reply says how many windows were passed (`autoPassed`).
- **The seat opposite can be the engine's player** (`ai: "heuristic"` or
  `"random"`), so solo-versus-AI needs no second client. That was the
  owner's first mode.
- **A decision the client cannot yet answer is answered and said.** Targets,
  yes/no and option choices go to the client; ordering, damage assignment
  and mana sources are answered by the engine's responder and listed under
  `decided`, so the table can show what was done on the player's behalf.

Measured, one game of Portal goblins against the heuristic AI, driven by the
plainest possible player (`npm run engine:play`):

| | |
| --- | --- |
| Game to a natural end | 14 turns, **31 stops** for the human, 1.3 s wall clock |
| Windows passed for the human (Law 1) | **110** |
| Full `ClientGameState` for one viewer | 7.8 KB |
| `StateDelta` after an action, median | 2.8 KB |

`tests/engine-live.test.js` drives a game over the wire — hidden hand
arriving as a count with no ids, every stop meaningful, deltas smaller than
the full state, a refused card named — and skips with a message where the
engine is not built, since `npm test` may not demand a JVM.
`tests/engine-bridge.test.js` covers the framing against a fake process.

### The engine on screen — 2026-09-21

**Steps 3 and 4 are built, through the existing board model** — the owner's
call, and the right one: the tiles, the fan, the plates, the log and the
drag are one component with three authorities behind it (`Table.jsx`:
alone, the relay, the engine).

- `src/lib/engine/board.js` lays a `ClientGameState` onto the board model.
  Positions are the table's, not the engine's: a card keeps the spot it had
  and a new arrival takes the first free spot along its lane. What the seat
  may not see is drawn as a back. A card is its Scryfall printing, read off
  the engine's image link, so art crops, printings and rulings arrive the
  ordinary way. Tested on views captured from a real game.
- `scripts/relay-engine.mjs` is the relay's other authority: one engine
  process per enforced room, started when every human seat has sat down
  with a deck, the same socket and the same room codes as an unenforced
  room. A stale offer is refused by `stop` number rather than landing on a
  different action with the same index. The engine's own seat plays a copy
  of the human's deck until the lobby lets a deck be chosen for it. An
  enforced room is not written to disk: a relay restart ends it, and says so.
- On screen: from the lobby, **Play the engine** opens the room and the deck
  is chosen as for any table. One tap plays a card through the offer the
  engine made for it; a creature tapped in the declare-attackers window is
  gathered into the attack and drawn as the arrow it will become; the
  prompt panel of TARGET.md §8 asks what the engine asks (targets by tapping,
  yes/no, options) and offers **Pass**. The log carries the engine's lines
  in its own words, and says how many windows were passed for you and what
  was decided on your behalf. Undo, the step buttons, life, tokens and dice
  are the engine's, and the panels say so.

`tests/browser/game-engine.spec.mjs` drives it all through the built app
against the real engine, and skips with a message where none is built;
`tests/relay-server.test.js` drives the room against a scripted stand-in
engine that answers from the captured views, so CI covers the relay's part.

**What the first real game on screen taught:** the engine's seat had no
deck and lost at its first draw — a mirror of the human's deck is the
interim answer. The engine's AI blocks, so an attack is not a promise of
damage. And a table the engine holds skips whole turns in the log when
nothing happened for the viewer on them, which is honest but terse.

**Not yet:** a deck of the engine's own; the opponent's turn shown as it
happens rather than when it hands back; deltas instead of full views;
persistence of an enforced room across a relay restart; the whole card
corpus (Portal alone is registered, a longer first build and a list of sets
in `Server.kt`); and the hosted relay with a JVM beside it.

### The engine on Windows, and the same game on every run — 2026-09-21

**Built and played on the owner's Windows machine**, in Git Bash, at
Argentum `70d525c`. The first compile took 280 s and an incremental one 7 to
15 s. A whole game of Portal goblins against the heuristic AI took 1.65 s
over 28 stops, with 112 windows passed for the human (Law 1), a full view of
7.7 KB and a median delta of 2.9 KB. Beside the cloud's figures (31 stops,
110 passed, 1.3 s, 7.8 KB and 2.8 KB) that is another deal, not another
engine. What Windows took is in `HANDOFF.md`'s Windows section: LF line
endings, the `.bat` launcher, and a JDK when `JAVA_HOME` names a runtime.

**Any game can be played again.** `new` takes a `seed` and always answers
with the one it used (`engine/README.md`). The same seed plays the same game,
the heuristic AI's choices included, and `tests/engine-live.test.js` holds it
to that. The engine's browser spec now plays seed 1. Left to shuffle, three
deals in eight broke one of its claims (a stop after the first land, an
attack within a few turns), which on a first Windows run looked like
flakiness and was not.

**Reality Fracture is not in the engine.** At the pinned commit the corpus
has no FRA or FRC set; the newest is The Hobbit (HOB, 2026-08-14). Until
upstream adds it, the engine will refuse a deck built from the season's own
set, so M1's deck gate has to name those cards rather than refuse quietly,
and a pin that carries the set is worth looking for once it releases on
2026-10-02.

**Found by looking, not by a check.** The More panel at the engine's table
carried the by-hand table's "Nothing here checks whether a play is legal",
directly beneath the engine's own note saying the opposite. It now shows only
at a table played by hand, and the engine spec has a check for it that
failed before the fix.

### M1: the whole corpus, and a deck the engine can enforce — 2026-09-21

**What the engine knows.** Every set in Argentum's `MtgSetCatalog.all`: 179
sets, 137 of them marked incomplete upstream, and 13,242 names a deck may
hold (no tokens, back faces or meld results, which the engine knows but a
deck cannot). The other eras compiled in 153 s on the owner's machine. The
first answer takes 15.4 to 15.9 s while the corpus loads, and the process then
holds 110 MB; the printing registry adds about 2.5 s and 6 MB of that. In the
browser, the lobby's first answer about a deck came 14 s after pressing "Play
the engine" (the checker loading), and sitting down reached the first prompt
in 16 s (the room's own process loading). Until M8 keeps an engine warm, one
process per room and one for checking decks is the cost of that.

**What was built**, per the brief: the corpus; `check` on the wire and `POST
/engine/check` on the relay; the lobby asking about each deck before anyone
sits, and a deck the engine does not wholly know offering both ways on (the
owner's answer, `HANDOFF.md` §3 item 10); printings sent by Scryfall's set and
collector number and dealt as chosen; the sideboard as Argentum's
`Deck.sideboard`; the engine pinned at `70d525c`. The wire is in
`engine/README.md`.

**An adversarial review found twelve things, all fixed:** an engine left
running after a failed start; a UTF-8 character split across two chunks of a
request body; shutdown flushing tables after closing engines, and `quit` not
bounded by the grace period; an unreadable answer from the relay read as "the
engine knows every card"; Sit hanging with no relay address; a deck's cards
from another tab left stale; the 502 message prefixed twice; a Wildcard press
not cancelled when another deck was chosen; meld results offered as cards a
deck may hold; printings without tests; a comment that said more than the code
did; and the wire appendix out of date.

**The run in a browser.** A Standard deck typed into the app's own editor
(Delver of Secrets, Monastery Swiftspear, Lightning Bolt, Heartfire Immolator,
Déjà Vu, Islands and Mountains; 60 cards), against the real engine through
the relay and the built app. The lobby said the engine knows all 60, the
engine dealt, a land was played and the turn passed to the engine and back.
Swiftspear and Déjà Vu wore exactly the printings the deck names. Lightning
Bolt (Marvel Super Heroes Commander, MSC 806) and the basics (Star Trek, TRK
319 and 323, a set not out until 2026-11-13) are printings the engine has not
got, so they showed the engine's own art and the log said so once, as the
owner chose. The importer took Scryfall's newest printing of each; whether a
deck typed in by name should default to a released one is a question for the
importer, not the engine.

**Found by the run, and fixed**, each now held by a test that failed before:

1. *The log was mute.* Argentum's log lines compute their words as a default,
   and the process encoded with `encodeDefaults = false`, so almost none
   reached the table: a land played, a spell cast, the engine's whole turn,
   all unsaid since the engine first went on screen. Every line now carries
   its `description` (`tests/engine-live.test.js`).
2. *And once it spoke, it named the opponent's hand.* Argentum phrases every
   zone change by the card's name whoever is looking, so the log read the
   engine's opening hand out card by card. The names were on the wire before
   this, just without words. The process now leaves a move between another
   seat's hidden zones out of your log, says a draw or a discard once, and
   leaves out taps, untaps and mana as Argentum's own game server does.
3. *Lines were filed where the view stopped, not where they happened.* A view
   arrives only at a stop, so the engine's turn read as the start of yours and
   its draw sat in its upkeep. The process stamps each line with its step, and
   the table turns the engine's own "--- Turn 2 ---" marks into its turn
   headers. The engine's turn now reads as its own: its draw in its draw step,
   its land in its main phase.

The notes that name cards ("the engine does not have your printing of …")
now end their lists with "and".

**Not done, and where it goes.** The "passed N priority windows" note arrives
with the status, before the view, so it sits above the land played before
those windows; M2 reorders it (`HANDOFF.md`, M2 step 3). A warm engine, so
nobody waits 16 s to sit, is M8; the engine in CI is M9; a wish's choice is
M4. Reality Fracture is still not in the engine; when upstream adds FRA and
FRC, moving the pin is a deliberate commit with the compile and the game
measured again.

The bar at the end: 1,313 unit tests; 29 browser specs, 910 checks, none
failed, the engine's own spec 49 of them against the real engine; the live
engine suite 12 of 12; no JVM left running after either.

### M2: watching the engine's turn, and deltas on the wire — 2026-09-22

**What a paced turn costs.** A room's pace is 600 ms by default — the wait
between one play of the engine's and the next — set per room and clamped to
10 s, because a pace is a wait between plays and not a timeout. A stop costs
each seat two messages, a `status` and the `view` it belongs to, and the room
one `continue` to the process. On the Portal goblin deck the engine takes
about two stops in a turn of its own (the captured run: two in each of turns
2, 4 and 6, one in turn 8), so watching a turn costs a seat about four
messages where the whole turn used to arrive in two. It stops for a land, a
spell, an ability or a real attack or block and for nothing else — 16 stops
over 23 turns on seed 20260922, against 53 in six turns had it stopped after
every action its AI takes, most of those the engine passing priority in a turn
of *yours* with nothing to see.

**What a delta saves.** Measured over the captured run (20 views, 4 of them
whole): a whole view and its log is 23.7 kB at the median and 31.1 kB at the
largest; a delta and the lines added since is 3.4 kB at the median and 9.1 kB
at the largest. A delta is 14% of a whole view, median for median, and the
run as it goes over the wire — one whole view and then nineteen deltas — is
88 kB against about 464 kB had every view gone whole: a fifth. (The fixture
on disk is larger than either, because it keeps the engine's own whole state
beside four of the deltas so they can be held against it.) The saving is the
point of sending them, but the `seq` beside them is the part that matters: a
client that misses one asks for the table whole rather than drawing a board
built on a guess.

**What was built**, per the brief. In the process (`Server.kt`): `PROTOCOL` 3;
`pace` on `new`; `drive()` stopping after each play of the engine's worth
watching, with `waiting: "engine"` and `actor`; `{"op":"continue"}`, refused in
plain words on a table that was never paced and when nothing is waiting on the
engine; and a per-seat count of log lines sent, so a reply carrying a delta
carries only the lines added since. In the room (`relay-engine.mjs`,
`relay-server.mjs`): the pace loop, one only, woken rather than waited out when
the room closes or the last socket goes; views numbered per seat, whole first
and deltas after; `resync`; `createRelay({ pace })` and `POST /rooms { pace }`.
In the client: `applyDelta` and `thinkingAt`/`THINKING` in
`src/lib/engine/board.js`, the numbering and the gap rule in a module of its
own (`src/lib/engine/stream.js`), the hook sitting with `deltas: true` and
asking for a resync on a gap, the plate saying "The engine is thinking…" while
the prompt panel says nothing, and the "passed N priority windows" note held
until the view it belongs to has landed. And `scripts/engine-capture.mjs`,
kept this time, which wrote the run in `tests/fixtures/engine-views.json`.

**Deviations from the brief, each written down where it was taken.** The
process stops only for the engine's *meaningful* plays, by its own
`MeaningfulActionFilter`, not after every AI action as the brief's wording
said — the measurement above is why. The engine takes `pace` as a number but
never sleeps on it: one process serving one table over one line must not hold
up every other request, so all pacing in wall-clock time is the room's. Deltas
are opt-in per client (`deltas: true` on the sit) rather than sent to
everyone after the first full view, because a tab still running an older build
after a deploy is a thing this project keeps alive deliberately, and a delta
sent to a client that cannot apply it draws exactly the wrong board the `seq`
exists to prevent. The fixture was extended rather than replaced: the first
capture's `seats` and `shots` are pinned by `tests/engine-board.test.js` to
exact life totals and card ids, and the new `run` sits beside them.

**The run in a browser.** The engine's table at a 120 ms pace, through the
built app and the real relay, on the spec's own seed. The engine's turn
arrives a play at a time: the plate opposite says "The engine is thinking…",
in words and in its own `aria-label` and under a class of its own so nothing
rests on the colour; its Goblin Bully appears on *its* side of the table while
the turn is still its, not after it; the log fills in as it goes — the engine's
turn, its draw in its draw step, its cast, the permanent entering, the spell
resolving; the prompt panel says nothing throughout, as Moxgate's does; and
the turn ends back at the player's stop. axe found nothing on the table while
it thought, and no console error came through a paced turn.

**Found by the run, and measured rather than assumed.** A stop is two messages
and the status is sent first, so at the first render of a stop the plate
already says the engine is thinking while the board still shows the turn as
yours. Measured: the board was at most 151 ms behind the plate, and caught up
at the very next render, every time. That is the relay asking the engine for
the view, not a fault, and the spec now holds it under a second — a view that
stopped following would leave the table saying the turn was still yours
through the whole of the engine's, which is the fault M2 exists to end.
Earlier in the milestone the run found two real faults, both fixed: the
log-order check was asserting the wrong note, and the opponent's closed zone
tiles were bare `<span aria-label=…>` — a role that may not be named, which
axe reports as serious `aria-prohibited-attr` and which threw the label away.
That one was pre-existing; the new sweep of the thinking state surfaced it.

**Gone over afterwards, and what the reading found.** A dozen things, each now
tested where it could be. In the room: a view the engine answered but the room
never sent used to be dropped in silence, and because the process advances what
it holds for a seat as it builds the reply, the next delta was against a view
nobody had while the numbers stayed consecutive — a card gone from the board
for the rest of the game, with nothing to notice it. A lost view now marks the
seat as holding nothing whole, so the next one is asked for whole and the log
comes with it. A step the engine refused used to end the turn for good, leaving
the plate saying it was thinking about a turn nobody was taking; the loop now
recovers, and gives up after three in a row and says why. The room watches the
engine's exit rather than hearing of it only from whatever it asked next, and
says it once however it is found out. And the pace runs for a seat being held,
not for a socket being open: a sit refused for want of a seat used to keep the
turn going for a room nobody could be sent a view in. In the client: a refusal
stood for one pace and no longer, because a paced room publishes a status for
each of the engine's plays and every one of them cleared the banner — it now
stands until the table is the player's again. A seat whose ask for a whole
view went missing dropped every delta after it for good and drew a frozen
board saying nothing; the ask is now made again after a few. On screen: the
thinking pill's reduced-motion rule never applied — a selector list of two
classes against a media query's one — so the border breathed through every
engine turn for somebody who had asked for stillness; the animation is on a
rule of its own now, and the spec reads the computed style in both states. And
`applyDelta` carries `voidActive` and `activeYields` over from the last whole
view because `StateDelta` has no way to send them, which is what Argentum's
own client does; neither is read here, and the header says so rather than
claiming the DTO's contract entire. Four of the tests were the finding: the
drive-guard test never reached the guard (an act mid-turn is refused before
it), the pace default was asserted against itself, the browser spec's "a play
at a time" counted moments across the whole game, and its log-order check
searched the whole log from the land rather than one turn's block. All four
are narrowed, and the fixture's own marks now name the offer to block
`blockable` rather than claiming declared blockers.

**One thing beside the milestone**, reported by the owner from a test run of a
Commander game and fixed in `6c265a4`: the card preview showed the top corner
of a card instead of the card. The face inside it was styled as `.peek__face`
while it is drawn as `.facepeek__face`, so nothing sized it and Scryfall's own
488 by 680 image drew at its own size inside a 280 by 391 box that clipped it
— cutting away the text box, which is the part somebody opens a preview to
read. The box is 280 by 391, the card's own 63:88, and the face now fills it —
`contain` rather than `cover`, since the whole card is the point of a preview
and a printing with other proportions should be shown whole rather than
trimmed. The spec had measured the preview's box but never the face inside it,
so it passed throughout; `game.spec.mjs` now measures both. The box alone is
still not enough — `object-fit` makes the element box the container's whatever
is in it, so the art crop would measure as well as the card — so the image
itself is measured too: that it loaded, and that it has a card's proportions
rather than a crop's. And the picture the run leaves is of a card-shaped face
instead of the one grey pixel the spec served for everything, because a
picture that could not show the fault is no answer to somebody who saw it.

**Not done, and where it goes.** Nothing on screen chooses a pace yet: it is
`createRelay({ pace })` or `POST /rooms { pace }`, which is the hook the
playback-speed preset (`TARGET.md` §5, `MOXGATE_STUDY.md`) is meant to land
on. No view a client can be sent ever carries declared blockers, so the
capture holds an attack and the offer to block it but no blocks declared; if
M3's harder AI or an instant in the deck makes a stop land inside combat,
re-capture and the window will hold one. A targeted spell cannot be cast at
the engine's table by anyone — `Table.act` fills in `attackers` and `blockers`
but not `targets`, so Argentum refuses the cast before any `ChooseTargets`
decision is raised — which means the prompt panel's target-picking is
unreachable and untested on screen; it is one `when` branch beside the two
that already exist, and it is M4's ground but live now. A paced room with
nobody connected does not advance the engine's turn and takes it up again at
the next sit, which is deliberate and tested but worth knowing if a headless
or spectator mode ever wants the game to run on.

The bar at the end: 1,567 unit tests across 78 files; 32 browser specs, 1,089
checks, none failed, the engine's own spec 67 of them against the real engine
through the real relay; the live engine suite 15 of 15; axe clean, including
over the table while the engine is thinking. The whole browser suite was run
a second time with every page's clock moved on a month, to 2026-10-24, so
that nothing written for this milestone leans on the real date. No JVM and no
preview left running after any of it.

The bar after the going-over: 1,574 unit tests across 78 files; 32 browser
specs, 1,091 checks, none failed, the engine's own spec 68 of them against the
real engine through the real relay, run three times over for the two checks
that were rewritten; the live engine suite 15 of 15; the token check clean. Six
of the fixes were held against the code they fix — reverted, the test fails;
restored, it passes — and the reduced-motion one was read off the built
stylesheet both ways round before and after. One thing the re-running found on
its own and fixed beside the rest: the check that the board catches up with the
plate was asserting it happens at the very next render, and a status that
renders twice before its view is the same one message of lag rather than two
faults, so it now measures to the next moment the board has caught up and
leaves the bound to say whether that was quick enough. No JVM and no preview
left running after any of it.

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
