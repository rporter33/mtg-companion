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

### M1b: the glows, and a preview that never covers Pass — 2026-09-24

**Built against the code M2 left, not the code the brief was written for.**
The brief dates from before M2 found that a targeted spell cannot be cast at
this table, and before the thinking plate and the silent prompt; where the two
disagree the code won, and each place is said below. Nothing on the wire
changed and `Server.kt` was not touched.

**What glows.** At the engine's table only, and read off what the engine is
offering or asking this seat at that moment (`src/lib/engine/glow.js`):

- *Playable* — a card in hand with a meaningful, affordable offer, and a
  permanent with an affordable ability that is not a mana ability: the two
  things one tap on a card does here. `bcard--playable`.
- *A target* — every legal id of a targets decision, across all its
  requirements. A seat that is a legal target lights its plate
  (`plate--target`) and is offered in the prompt by name ("Aim at the engine",
  "Aim at yourself"), because a plate is not a card to tap. The creatures that
  may attack while attackers are declared, and the ones that may block while
  blockers are. `bcard--target`.
- *Chosen* — an attacker gathered into the attack, or a blocker placed, stays
  lit, more heavily and still, and says it is attacking or blocking.
  `bcard--chosen` beside `bcard--target`.

Every glow says the same thing in words: `playable now`, `a legal target`,
`can attack`, `attacking` and so on end the card's spoken label, the plate's
label says `a legal target`, and the prompt says what the glow is for ("The 3
cards you can play glow. Tap one, or pass."; "Tap what Sparkmage Apprentice is
aimed at: the legal targets glow."). The colour is the accent, so the season's
theme turns it cyan; the engine spec puts the season's shell on by hand to
check that rather than waiting for a date. The two glows differ by weight, not
colour, and never show together, since a stop is either a play or a question.
Each ring has a thin band of ink outside it, found necessary by looking: the
accent is gold outside the season, and gold on the parchment mat all but
vanished. The light breathes slowly and stands still under the system's
reduced-motion setting and under the app's own, which the stylesheet could not
read until now: the table's root wears `game--still` when it is on.

**The preview never covers Pass.** `Peek.jsx` now places the face with
`placePeek` (`src/features/game/peekPlace.js`): never over the prompt panel or
the rail (the rail carries its own Pass, and at the table played by hand End
turn), never over the card itself, never off the screen; among the places that
keep all three, the nearest the card, with the old order breaking ties — above
a low card, then right, left, below. So above a card in hand becomes beside it
where the prompt is in the way, or above the prompt where beside would cover it
too. The rectangles are read when the preview is placed, which is after every
render of the table, so a prompt that appears while a card is being read moves
the preview rather than being covered by it; and the card is measured again
once it has lifted out of the fan. Where nothing at full size fits, a smaller
preview is tried, and where nothing fits at all none is shown and the card is
still one press from "Read it": the table chooses the press over the picture.

*Measured.* At the engine's first stop, 1280 by 900, every one of the seven
cards in hand read in turn with Z held: four previews placed to the right,
two above the prompt, one to the left, and none over the prompt, its Pass,
the rail or the pointer. At 430 by 1100, the table played by hand with the
opening-hand prompt across the foot of the battlefield: all seven clear of the
prompt and the rail — two to the right, two to the left, where an end card
leaves room, and three above the prompt, where nothing beside fits. A sweep of card
positions over four layouts in `tests/peek-place.test.js` holds the three
rules for every place it takes.

*Floating, not an inspector.* The brief asked for the pack's alternative to be
weighed: the preview parked at the top of the side column
(`inbox/grok-pack-2026-09-20/shots/table-play.jpg`) against Moxgate's own
floating one. The floating preview stays. It is Moxgate's ("Hold Z to zoom the
card you are hovering. Card zoom also auto-zooms on hover", `frames/v2_09`),
and the owner's standing preference is Moxgate's look for the table
(`SOURCES.md`). The side column here is not empty the way the pack's is: it
holds the seats, the log, the turn and whatever panel is open, and a card
parked at its top would push the log down or cover it at every hover. Below
900 px there is no column beside the field at all, so the floating preview
would be needed anyway. And a preview beside the card is read without the eye
crossing the screen. The pack gets its guarantee by giving the preview a band
nothing else uses; `placePeek` gives the same one without the band. The
recordings are of an iPad, where a zoom has no pointer to follow, so what was
weighed on Moxgate's side is its own description of the zoom rather than a
frame of it.

**Space passes.** When a pass is on offer: not in a field, where Space is a
letter; not in a dialog; and not on a control the keyboard is on, where Space
presses that control, as every button does. A control last pressed with the
pointer has focus without showing it, and there Space passes. A held key's
repeats are not further passes. Z stays the zoom. The prompt's Pass says "or
press Space" (hidden on a screen with no keyboard), and both buttons that pass
carry `aria-keyshortcuts`.

**The credit line** gains "Card data and imagery from Scryfall." everywhere,
and at the engine's table "Rules-enforced play is powered by Argentum, an
independent open-source rules engine, used under the MIT licence."

**Where it departs from the brief's letter, and why.**

1. *A spell or ability needing a target does not glow as playable.* The brief
   glows any affordable, meaningful offer, but `act` still sends no targets
   and Argentum refuses such a cast before it would ask (M2, above). A glow
   there would be the table promising a play it cannot make. So the stop the
   engine made for one names it instead ("Volcanic Hammer needs a target,
   which this table cannot choose yet. Pass to go on."); a tap on the card says
   the same rather than sending an act the engine answers with "no valid
   targets", which is not true; and the actions panel lists it, not pressable,
   with a line saying why. The captured run holds a stop made for Volcanic
   Hammer alone, and the unit tests read it. `HANDOFF.md` M4 now names the
   three places to lift when targets are sent.
2. *"The aiming banner names the source."* At the engine's table the question
   is asked in the prompt panel, which is where the aiming happens; its line
   now names the source. A banner as well would say it twice.
3. *Targets are watched through a triggered ability.* A targets decision
   reaches this table only from a trigger today. The engine spec plays a third
   table with a deck of Mountains, Sparkmage Apprentices and Raging Goblins,
   tried against the engine directly first: dealt from the spec's seed and
   played by the engine's own list, turn 5 casts a Sparkmage Apprentice whose
   arrival asks for any target, with three creatures on each side of the table
   and both players legal.
4. *Beyond the letter:* the seats glow and are offered by name; valid blockers
   glow and placed ones stay lit. No attacker glows as blockable: the offer
   does not say which attacker a given blocker could legally block, and the
   table does not guess.
5. *The preview keeps clear of the rail too*, and takes the nearest clear
   place rather than only "beside when above overlaps".
6. *Space* is kept from a keyboard-focused control as well as from a field.

**The run in a browser.** Through the built app and the real relay and engine.
The engine spec holds each glow to the engine's own offers, read off the socket
as the page received them, rather than to the spec's idea of what should be
playable: exactly the three Mountains glowed at the first stop, and neither
Volcanic Hammer; exactly the engine's valid attackers glowed in the declaration,
and the one tapped stayed lit and said it was attacking; exactly the eight
legal targets of the Sparkmage Apprentice's trigger glowed, six creatures
across both sides and the two plates; "Aim at the engine" answered it, the
engine lost the one life and every glow went out. And at the first stop of the
player's with Volcanic Hammer affordable in hand, it did not glow; a tap on it
said "Volcanic Hammer needs a target, and this table cannot choose one for it
yet." and sent nothing (the same stop, the card still in hand); the actions
panel listed it, not pressable, with the line saying why. axe found nothing on the
table while cards glowed, nor while the trigger asked. A field with focus kept
Space as a letter; elsewhere Space passed. Screenshots looked at: the playable
glow in both the core and the season's colours, the preview beside a card in
hand clear of the prompt, the attack, the targets, and at the table played by
hand the preview above the prompt at a phone's width. The pictures are
`engine-playable.png`, `engine-playable-season.png`,
`engine-peek-prompt.png`, `engine-attack.png` and `engine-targets.png`, and
`game-peek-prompt.png` and `game-peek.png`, all in the system's temporary folder.

**Found by looking, and fixed.** The accent ring alone, gold on parchment,
was hard to see on the battlefield: the ink band came from that. The first run
of the preview checks measured nothing — at 1280 by 900 the hand is below the
fold, a point off the screen hits nothing, and the check that every card got a
preview failed and said so; the hand is now scrolled into view first. The
attack screenshot showed a half-faded log: changing the emulated motion setting
restarts the log's own fade-in, and the picture was taken inside it.

**Gone over afterwards, and what the reading found.** The actions panel still
offered a targeted spell as a live button, which the engine would refuse: now
listed, not pressable, with a line saying why. A preview slid sideways off the
card's column read as a neighbour's: above and below now stay centred on the
card, and sideways is what "beside" is for. The preview measured a hand card
before it lifted out of the fan: it is measured again when the card settles.
`game.spec.mjs`'s "not under the pointer" only looked sideways, so a preview
placed above would have failed it while being right, and one covering the
pointer from above would have passed: it is now a point in a box.

**Not done, and where it goes.** Targets for a spell or an ability — M4, with
the three places named in `HANDOFF.md`. A decision with more than one target,
or more than one requirement, is still answered with one target, as it was;
M4's decision prompts. At 1280 by 900 the hand at the engine's table sits below
the fold, which is the layout and not this milestone, but a player on a
laptop scrolls to see their hand. The engine spec routes `cards.scryfall.io` to
a pixel, and the built app's service worker fetches those images itself, which
`page.route` cannot see: on a machine that reaches Scryfall the spec loads real
card faces. Found by looking at the screenshots; nothing depends on it, and it
was so before this milestone.

The bar at the end: 1,770 unit tests across 88 files, 23 of them new; 34
browser specs, 1,291 checks, none failed, in 788 s on the final build; the
engine's own spec 109 checks of those against the real engine through the real
relay, and 110 in a run of its own afterwards with a check added for the
plate's motion — 42 more than M2 left it, seven runs in all, every one after
the first without a failure; `game.spec.mjs` 98, five more; the live engine suite 15 of
15; the token check clean. No JVM and no preview left running.

### M3: easy, intermediate, hard — 2026-09-24

**The owner's answer first.** A first game is played at intermediate, with easy
and hard a choice away in the lobby (`HANDOFF.md` §3, item 13). The choice is
kept with the player's other table preferences (`prefs.engineLevel`), read
forgivingly: anything but one of the three words is intermediate.

**What Argentum's profiles are, read at the pin rather than taken from the
brief.** `ai/…/engine/AiProfile.kt` at `70d525c` holds 44 named
profiles. The brief's table named three candidates, and two of them had moved
on. `LEGACY_V0` is the greedy one-move look Argentum freezes as the reference
every arena number is quoted against, and `CURRENT` is the same player under
another id (what `AIPlayer.create(registry, id)` builds, so what this table
played until now). `PRODUCTION` is that look plus card knowledge (`CardIntent`)
and the card advisors — which exist for two sets, Bloomburrow and Onslaught.
`PRODUCTION_CANDIDATE_TUNED` was what Argentum's own game server played
people with from 2026-08-07; at the pin its `EngineAiPlayerController` plays
`PRODUCTION_CANDIDATE_EXPIRING`, which is that plus the nine promotions made
since, each with its arena and puzzle numbers in its KDoc. Argentum's own arena
(Bloomburrow sealed) had already said the thing that decided intermediate:
card knowledge alone is arena-neutral against `v0` (50.9%, 1,000 games), the
Bloomburrow advisors alone likewise (50.0%), and the one evaluator fix it
measured as a gain on its own, without rollouts, is the discounted race clock
(`PRODUCTION` 43.7% against `PRODUCTION_RACECLOCK`, 300 games).

**The mapping, and why** (`LEVELS` in `Server.kt`; `hello` lists it):

| Level | Argentum profile | Why |
| --- | --- | --- |
| easy | `v0` (`LEGACY_V0`) | The player this table has always fielded, so easy changes nothing for anyone; frozen upstream, so it stays the same player whatever the pin. |
| intermediate | `production-raceclock` | One move deep and as quick as easy, with card knowledge, the advisors, and a race judged by how soon it would end. The brief's `PRODUCTION` measured no stronger than easy here (below). |
| hard | `production-candidate-expiring` | What Argentum plays its own players with at the pin: each bigger choice played out two turns ahead (three in combat or within reach of lethal) on the four-tier budget, the cards it cannot see shuffled among themselves before it searches, every promoted fix. |

**Hard's budget, in milliseconds.** `TieredBudgetPolicy` names 0, 200, 2,000
and 5,000 ms for its four tiers — nothing to choose; a routine window on the
other player's turn; a main phase or a response; combat or either side within
reach of lethal. They are not stopwatches. Each is turned once into counts
(`SearchAllowances.forMillis`): no rollouts below 2 s, 16 at 2 s, 40 at 5 s,
with the combat searches and target refinement scaled the same way, and the
milliseconds kept only as a hard stop a healthy decision never meets. That is
why a seed replays the same game at hard (checked below) and why a slower
machine makes hard slower, not weaker. What it costs was measured.

**How it was measured.** `scripts/engine-levels.mjs`, kept. Both seats the
engine's own, the whole game played inside one `new`; every game played twice
from one seed with the players' seats swapped, and the pair — 1, ½ or 0 — is
what is counted, as Argentum's arena counts; a 95% interval over pairs. Two
mirror decks: Portal goblins, the deck every measurement here has used, and a
sixty-card Boros deck of Bloomburrow cards put together by this app for the
purpose (one- and two-drops, tricks, removal that needs a target; Bloomburrow
because Argentum's arena and its advisors are Bloomburrow's). After every game
the process's new `clock` op says how long each seat took over each choice.
Seeds from 20260924; 3,200 games on six processes, then 1,200 more on fresh
seeds for the two pairings whose intervals touched an even split; 60 on one
process for the times; and 60 of a person's seat against each level, on a
paced table, for what a person waits.

*Strength* — the share of games won by the second level named:

| Pairing | Portal goblins | Bloomburrow Boros |
| --- | --- | --- |
| easy v intermediate | **58.8%** [55.5, 62.0], 400 games | **53.9%** [51.8, 56.0], 1,000 games |
| intermediate v hard | **53.4%** [51.3, 55.5], 1,000 games | **54.3%** [51.2, 57.3], 400 games |
| easy v hard | **62.5%** [59.3, 65.7], 400 games | **58.5%** [55.0, 62.0], 400 games |
| easy v `production`, the brief's intermediate | 50.0% [50.0, 50.0], 400 games — every pair split | 47.5% [44.6, 50.4], 400 games |

Every level beat the one below it on both decks, each interval clear of an
even split, and hard beat easy by the most. The gaps are small, and the lobby
says how small rather than implying more: most pairs split one each, which is
the deal deciding and not the level (easy v hard with goblins: 53 pairs to
hard, 144 split, 3 to easy). `production` plays exactly as easy does with
goblins — no Portal card has an advisor, and card knowledge changed no
decision in 400 games — and a shade worse with the Bloomburrow deck, so it
could not be intermediate. The first 200 pairs of the two widened cells read
52.5% and 53.0%, intervals touching 50%; the next 300 of each, on fresh seeds,
read 54.8% and 53.7%.

*Time to choose*, one process, nothing else running, 20 games a level a deck,
over the choices with something to choose between (an affordable play the
engine calls worth making, or a decision), median / p90 / slowest:

| Level | Portal goblins | Bloomburrow Boros |
| --- | --- | --- |
| easy | 1.1 / 8.8 / 66 ms | 1.0 / 7.4 / 156 ms |
| intermediate | 1.4 / 9.7 / 52 ms | 1.3 / 9.6 / 201 ms |
| hard | 52 / 114 / 176 ms | 3.7 / 170 / 1,505 ms |

A routine window on the other player's turn gets no rollouts, and a deck of
instants has many of them, which is the likeliest reading of hard's low
Bloomburrow median; the clock does not record the tier, so that is a reading
and not a measurement. Hard's whole game of thinking came to 4.5 s at the
median and 9.1 s at p90 with that deck, against a fifth of a second for easy.

*What a person waits*, measured at the wire from a person's seat played by the
plainest player (the first worthwhile play needing no target, else a pass),
10 paced games a level a deck, request to reply. A `continue` is one of the
engine's plays while the plate says it is thinking, with the room's pace on
top; an `act` is the player's move and everything the engine does before the
table next stops:

| Level, deck | each `continue`: median / p90 / slowest | each `act` |
| --- | --- | --- |
| easy, goblins | 7 / 42 / 156 ms | 3 / 18 / 87 ms |
| intermediate, goblins | 5 / 22 / 132 ms | 2 / 9 / 146 ms |
| hard, goblins | 11 / 116 / 276 ms | 1 / 159 / 1,561 ms |
| easy, Boros | 3 / 17 / 105 ms | 1 / 10 / 218 ms |
| intermediate, Boros | 2 / 13 / 87 ms | 1 / 9 / 139 ms |
| hard, Boros | 39 / 568 / 8,177 ms | 1 / 699 / 9,713 ms |

Hard's p90 stays under the brief's two seconds on both decks, so the pace does
not need to hide it. Its slowest does not: against a deck full of instants, a
move that hands hard a string of windows to answer in can take ten seconds.
That is what the two changes below the next heading are for.

*The same game from the same seed.* The 72 games that more than one run
played from the same seed and the same way round — one process against six,
hard included — came out the same, winner and turn. `engine-live.test.js`
plays hard against easy twice from one seed and holds the two to each other.

**What was built.** In the process (`Server.kt`): `PROTOCOL` 4; `level` on a
player in `new` (and the level's word as `ai`, the shape the brief sketched);
each seat in the reply names the `level` it took and the Argentum `profile` it
plays with; `hello.levels`; `profile` by id for a measurement, refused when the
process does not list it; and `clock`. A person's seat keeps `current`'s
responder for the decisions this protocol cannot ask yet, as before; an
unknown level plays `current` and says `level: null`. In the room
(`relay-engine.mjs`, `relay-server.mjs`): the level is a room setting —
`POST /rooms { level }`, changed by a sit that names one until the deal —
asked of the engine only at protocol 4 and only for a heuristic seat, and
believed only as the engine's reply confirms it; `seated` after the deal says
`level` (null where the engine took none), the engine's `seats` entry says it,
and `GET /rooms/<code>` reports `level`, `played` and `profile`. A room nobody
asked a level of asks for none, so a tab from before levels keeps the engine it
had. In the app: `src/lib/engine/levels.js` (the words, the default, the
forgiving read, the lines, the measured sentence, the log's line); the choice
in the engine's lobby beside its seat, as three radios with a line each, and
under them "These descriptions are this app's own." and the measured sentence;
"Play the engine" opening the room at the remembered level; the sit carrying
it; the log saying once "The engine is playing at the hard level." — or, where
it is not, that this relay's engine is older than the levels, or that this
relay is; the seat list saying "The engine · Hard"; and a lobby for a table
already dealt saying its level rather than offering one.

**Found by measuring, and fixed.** Two, both about a slow answer, which no
level was slow enough to show until hard.

1. *A second press reached the engine and landed on the next stop.* The stop a
   press answers does not move until the engine answers it, so a second press
   in the meantime passed the relay's stale check, was queued behind the
   first, and was applied to whatever the engine offered next — a play nobody
   chose. It predates M3 and needed a long answer to be likely; hard makes it
   likely. The room now takes one move at a time and refuses the next, "The
   engine is still answering your last move."; the client does not send it in
   the first place and says the same. A test of the room's with the stand-in
   engine held to a slow `act` (`slowActs`, new) failed before and passes
   after.
2. *Nothing on screen said a slow answer was coming.* The table stood as it
   was, prompt and all, for up to ten seconds. Now an answer not back within
   400 ms is the engine thinking: the plate says "The engine is thinking…" and
   the prompt steps aside, exactly as at one of the engine's own paced stops.
   400 ms because no easy or intermediate answer took longer than 218 ms: said
   at once, it would flash up on every press.

**Found by measuring, and not fixed: a cost with a choice in it.** Flamecache
Gecko's "{1}{R}, Discard a card: Draw a card" is offered as affordable and
worth making, glows as playable (M1b), and `act` has no way to say which card
to discard, so Argentum refuses it: "Must choose 1 card(s) to discard". The
table shows that refusal as it stands. It is the targets gap M2 found, for
costs, and M4's ground: `HANDOFF.md` M4 now names it. The watch run's plainest
player was refused 1,876 times, took the next offer each time as the capture
script does, and every one of those refusals was this ability: the run was
played again from its seeds and the refusals tallied, and the replay came to
the same 1,876. Since the review the offer says so and the table holds it back
rather than glow it (below, "What the review found", 1); asking which card is
still M4's.

**Where it departs from the brief's letter, and why.**

1. *Intermediate is `production-raceclock`, not `PRODUCTION`*, and *hard is
   `production-candidate-expiring`, not `PRODUCTION_CANDIDATE_TUNED`* — the
   first measured no stronger than easy, and the second is what Argentum
   itself fields now. Easy is `LEGACY_V0` rather than `CURRENT`, the same
   player, for its promise never to change.
2. *`level` is a key of its own on the player*, beside `ai`, which still names
   the kind of player. A random seat has no level, and a separate key lets an
   older engine ignore it and a relay see from the reply whether it was taken.
   `ai: "hard"` is read as well.
3. *The lines say what each level does and how long it takes, not "sensibly"*:
   "sensibly" is not something the measurement shows. The strength is in one
   sentence with its date, as ranges from one deck to the other.
4. *The log's line is "The engine is playing at the hard level."*, not "The
   engine plays hard."
5. *The choice is in the engine's own lobby*, beside its seat, where the table
   it applies to is; "Play the engine" in the solo lobby opens the room at the
   remembered level, and the sit settles it.
6. *More measured than asked*: 4,400 games between levels rather than ten, and
   what a person waits as well as what a choice costs; and `clock`, which the
   brief did not name, is how the second was measured.

**The run in a browser.** `levels.spec.mjs` (new, the stand-in engine, so it
runs everywhere): the three levels, intermediate chosen, the lines and the
sentence, axe clean at 1280 wide and at 390, no sideways scroll, arrow keys,
the choice kept across a reload, the room opened at it, the sit carrying hard
to the engine for its own seat and not the person's, the log and the seat list
naming it, the lobby of the dealt table saying it; then a slow answer — a
second press refused in words, the plate thinking and the prompt aside, one
press sent. `game-engine.spec.mjs` against the real engine: three offered,
intermediate chosen, the room opened at it, easy chosen, the engine playing
`v0` and the log and seat list saying so. Easy is chosen there because every
seeded claim after it was written against that player. Screenshots looked at:
the lobby's choice, the table naming the level, the table thinking through a
slow answer (`levels-lobby.png`, `levels-table.png`, `levels-slow.png` in the
system's temporary folder).

**What the review found, and what was done.** The same day, a review of this
milestone and of M1b's glows found thirteen faults, each confirmed by a second
reading before anything was touched. All thirteen are fixed, each with a test
that fails without its fix where a test could be written; the four in
`useEngineRoom.js` were checked that way, by taking each fix out and watching
its test fail.

1. *A cost with a choice in it glowed, and M3's own note said the wire could
   not tell.* It could: Argentum's `LegalAction` carries `additionalCostInfo`
   and `requiresForage`, and `Server.kt` never sent them. It now sends
   `additionalCost`, `additionalCostText` and `requiresForage`
   (`engine/README.md`), and the table holds such an offer back where it holds
   back one needing a target: no glow; the prompt names it ("Flamecache Gecko
   needs a choice made for its cost, which this table cannot make yet. Pass to
   go on."); a tap says why, with the cost in Argentum's words; the actions
   panel lists it, not pressable, with the reason. Sacrificing the source and
   paying life need nothing chosen (Argentum's `CostHandler`) and still glow.
   Against the built engine, from seed 1, a deck of Mountains and Geckos
   reaches a stop made for the Gecko's ability alone, its offer says
   `DiscardCard`, and sending it bare is refused (`engine-live.test.js`).
2. *A stop made only for a flashback said "Nothing to do here but pass."* The
   prompt dropped every offer whose card was neither in hand nor on the
   battlefield. It now names each with where it is ("You can play Think Twice
   from your graveyard: find it under Actions, or pass."), and the pile's tile
   wears the playable edge and says in its label that it holds one. The shape
   was read off the live engine first: a `CastWithFlashback` offer, its card in
   the graveyard, and stops in upkeep made for nothing else.
3. *"The legal targets glow" was said over a table where none did*, for a
   trigger aimed at a card in a graveyard (Gravedigger's). The zone browser
   now draws the target edge on such a card and writes "a legal target" beside
   its name, and a tap there answers the decision; so does a spell on the stack
   that is a legal target; a pile holding one wears the edge on its tile and
   says so in its label; and the prompt says where the targets are ("…the legal
   targets are in your graveyard — open it to tap one."). At the engine's
   table the stack is now read from every seat, since the engine files the one
   stack under one seat's id, and its "Resolve" and "It was countered" buttons
   are gone from there: the engine resolves the stack, and they were only ever
   refused.
4. *A permanent's ability was counted as "a card you can play".* The prompt
   now says "The permanent with an ability you can use glows.", and names both
   where both glow; `docs/TURN_STRUCTURE.md` keeps the three kinds of play
   apart (117.4, 305.2, 505.6a–b).
5. *Space after a mouse press pressed the control again.* Chromium marks the
   focused control as focus-visible as soon as a key goes down, before any
   listener runs, so the check made in the keydown always said "keyboard". A
   probe on the pinned Chromium showed it: false at the click, true in the
   keydown, and true at focus only after Tab. The table now notes how each
   control came by its focus as it comes by it. The engine spec taps the
   refused Hammer, presses Space with nothing blurred first, and the stop moves
   on; then reaches a card in hand with Tab, presses Space, and the card is
   played rather than the stop passed.
6. *Keyboard focus on a glowing card all but vanished*: the accent ring 2 to 4
   px out, drawn over a glow of the same colour reaching 5 px. A glowing card's
   ring now stands 6 px out, in two tones — ink inside, light outside — so it
   shows on the parchment mat and on the dark chrome alike. The engine spec
   reaches a chosen attacker with the keyboard and reads the ring off it:
   solid ink at 6 px and the light band beyond, neither the accent, none of it
   there unfocused. Looked at in `engine-attack-focus.png`.
7. *"The engine is thinking…" stayed on the plate for good after the wire
   dropped under a press.* An enforced room does not outlive its relay, so that
   answer never comes; the wire leaving now ends the wait.
8. *"The engine is still answering your last move" stood through the engine's
   paced turn after the answer came.* The refusal is now marked as the guard's
   (`answering: true`, from the room as well as from the client) and taken down
   at the next status, whoever's stop it is. Every other refusal still stands
   through the engine's turn.
9. *The lobby said a table's game was under way, one way only, while its engine
   was still loading the corpus.* The room now reports `dealt` beside
   `started`, and the lobby says "The engine is dealing this table's game,
   asked to play at the easy level." until it has (`roomLevel` in `levels.js`,
   which reads a room from before this as well). `levels.spec.mjs` holds the
   stand-in's first answer back and looks at the lobby meanwhile.
10. *The log said the engine was "older than the levels" at a table where it
    plays at random, or plays nobody.* `seated` now says which kind of player
    the engine fields (`ai`), and only a heuristic table has its level said; a
    room from before that is read from the seats it sent first.
11. *The live level tests only read back the process's own label.* Nothing
    showed that a level reached the player. `engine-live.test.js` now plays one
    seed four ways, each against easy: easy, intermediate and hard play three
    different games, and easy plays exactly the game of a seat asked for no
    level. Were the profile dropped on its way to `AIPlayer`, all four would be
    the same game. Seeds 20260924 and 1 to 5 were tried first; every one parted
    the three levels, and in every one "no level" played easy's game.
12. *The prompt's sentence for a stop made for a targeted spell had one check,
    and it was skipped without failing* whenever the stop offered other plays
    too. A jsdom test (`tests/engine-prompt.test.jsx`, new) renders the prompt
    against the captured run's stop for Volcanic Hammer alone, and the engine
    spec now plays what else is offered until such a stop comes, rather than
    noting on the console that it had not.
13. *The relay's "one move at a time" test leaned on real time*: a 400 ms
    busy-wait in the stand-in and a 50 ms sleep. The stand-in now holds an act
    unanswered until the test releases it (`holdActs`, `release`), with every
    later line waiting behind it as the real process makes them wait, and
    `levels.spec.mjs`'s slow answer is held the same way rather than timed.
    With the room's guard taken out the test fails, as it did before; what
    changed is that with the guard in it can no longer fail because a loaded
    machine answered the first press before the second one arrived, which
    would have been refused as stale instead.

What the review's fixes did not reach: the pile's tile marks, the sentences
for a flashback and for targets in a pile are held by unit tests and not seen
in a browser, because no seeded game here reaches a flashback or a trigger
aimed into a graveyard; the focus ring was looked at
(`engine-attack-focus.png`: the gold glow, then the ink ring, then the light
one, clear on the parchment).

The bar after the review: 1,824 unit tests across 90 files, 29 of them new; 35
browser specs, 1,339 checks, none failed, in 766 s on the final build, the
engine's own spec 122 of them against the real engine (seven new) and
`levels.spec.mjs` 35 (five new); the live engine suite 23 of 23, two new; the
token check clean. No JVM and no preview left running.

**Not done, and where it goes.** No level is chosen per table once dealt: a new
table takes a new choice. The measurement is two mirror decks; the engine's own
deck (M5) will make other matchups, and the script takes any deck in its
`DECKS`. A cost with a choice in it is held back, not asked — M4, above. A spell
with an X in its cost is sent with whatever X the engine enumerated; nothing
here has looked at that yet, and M4's decisions are where it belongs. Argentum
moves its live profile often; each move of the pin should run
`scripts/engine-levels.mjs` again and say here whether hard still is what
Argentum fields.

The bar at the end: 1,795 unit tests across 89 files, 25 of them new; 35
browser specs, 1,327 checks, none failed, in 823 s on the final build, the new
`levels.spec.mjs` 30 of them and the engine's own spec 115 against the real
engine through the real relay; the live engine suite 21 of 21, six of them new,
one short game at each level among them; the token check clean. The test of
the room's that proves one move at a time failed before the fix and passes
after. No JVM and no preview left running.

### M4, the first half: the decisions — 2026-09-24

**The half, and not the other.** M4's brief is mulligans and the decisions the
client could not answer. This is the second of those: a spell or an ability
aimed on the table, and the decisions the engine's responder used to answer on
the player's behalf, asked of the player instead. Mulligans are untouched and
are the milestone's other half.

**How Argentum's own client does it, read before anything was built.** Its web
client sends a cast whole: a `CastSpell` or `ActivateAbility` with its targets,
its X, its division of damage and its cost's payment already in it, gathered in
that order — X, then what the cost takes, then the targets requirement by
requirement, then the division (`web-client/…/pipelinePhases.ts`,
`computePhases` and `mergeResult`). The targets go as one flat list, and
Argentum's `TargetValidator` reads it by position. The cost's choice goes in
`additionalCostPayment` (a spell) or `costPayment` (an ability), in the field
for its kind — `discardedCards`, `sacrificedPermanents` and the rest — which is
also how Argentum's own AI fills it (`Strategist.withAutomaticPayments`). A
`CastSpell` sent without an X is cast at nought (`CastSpellHandler`); an
ability sent without one is asked it as a `ChooseNumberDecision`. And a
division of damage among more than one target has to come with the cast, or it
is refused ("Damage distribution required …"). Each decision class in
`PendingDecision.kt` was read for its fields and its validator for the answer
it expects. One the brief named is gone: `AssignDamageDecision` is not raised
by anything at the pin. Argentum's combat now asks the whole damage step as one
`CombatResolutionDecision` (`CombatResolution.kt`): edges from each creature to
what it may damage, the engine's own split already in each, and a validator
that accepts any split legal under some damage-assignment order (510.1c).

**What was built.**

In the process (`Server.kt`), protocol 5. `act` takes `targets` (the shape
`decide` already took, `{"0": [ids]}`, flattened in requirement order and each
id made the kind of target its object is by Argentum's own
`entityIdToChosenTarget`), `x`, `damage` and `cost`, or `auto` to have the
person's own responder fill all of them in. An offer says what it needs:
`targetRequirements` (every requirement, one described the same way as
several), `x`, `divide` and `costChoice` (the candidates and how many, for the
nine kinds of cost `act` can pay with chosen ids). A person's player in `new`
may carry `answers`, the decisions its client can show, and those are asked
rather than answered: `SelectCards`, `OrderObjects`, `ReorderLibrary`,
`Distribute`, `CombatResolution`, `SelectManaSources`, `ChooseNumber`,
`ChooseColor`, `ChooseMode` and `BatchYesNo`, each described in full and
answered in `decide` with the response its validator expects; the reply's seat
says `asked`. `hello` says all of it as `choices`. Targets that Argentum would
read in the wrong order — a requirement given fewer than it could take, with
targets for a later one — are refused in words rather than sent.

In the room (`relay-engine.mjs`). A sit's `answers` are kept to the deal and
passed for that seat alone, only to an engine at 5. Every `seated` after the
deal tells a person's seat its `choices`: what its `act` may carry and which
decisions it will be asked. A decision's `cards` — the faces of cards only the
deciding seat may see, a library's top being looked at — are left out of every
other seat's copy of the status, which goes to every seat.

In the client. `src/lib/engine/choose.js` (new): what a seat may choose
(`choicesFrom`), what holds an offer back at that seat (`heldBackBy`), and a
choice made a step at a time — begun by the tap on a play (`beginPlay`) or by
a decision picked on the table (`beginDecision`: a trigger's targets, cards to
select, lands to pay with) — to the `act` or `decide` it becomes. `glow.js`
holds back only what the seat cannot send, and while something is chosen glows
what the step may take and lights, more heavily, what it took, each in words
("a legal target", "can pay the cost", "can be chosen", "chosen as a target").
The prompt panel moved out of `Table.jsx` into `EnginePrompt.jsx`: the choosing
prompt (the play or the question, what the step is for, seats by name, cards
the table cannot show by name, X and a division set with steppers, Done where
more than one tap is needed, "Let the engine choose", and for a play "Never
mind"), and a prompt for each decision answered in the prompt itself — an
order with a button up and down for each, a division, combat damage from the
engine's own split, a number, a colour, one mode or several, one answer for
several questions at once — every one keeping "Let the engine choose".
`useEngineRoom.js` sits with `answers` and reads `can` from the seated.
`Table.jsx` begins a choice where a tap used to send, picks with the next taps,
lets the play go when the card being cast is tapped again, and does not pass
on Space while a play is being chosen.

**M1b's and M3's measures, lifted exactly where a choice reaches the engine.**
The glow, the tap's refusal and the actions panel held back an offer needing a
target (M1b) or a choice in its cost (M3). They now hold it back only where
the room said this seat's `act` cannot carry it: a relay or an engine older
than protocol 5 says nothing, and there everything is as it was. A cost whose
kind `act` cannot pay with a choice — a sum of mana values, a forage — is still
held back, and says so, at every seat.

**Measured.** `scripts/engine-decisions.mjs` (kept) plays each game twice from
one seed against intermediate: once with a person's seat whose client said
nothing, as every client before protocol 5, and once with one that can show
every decision. The person is the plainest player — the first worthwhile play,
targets and all chosen by the engine for them, else a pass — and answers every
question with the engine's own choice, so the two games should be one game,
and the script checks that they are. Twenty seeds a deck from 20260924, on the
owner's machine:

| Deck | Answered for a person told nothing | Asked of a person who can be | Still answered for them | Same game both ways | Stops where a play worth making needed a target or a chosen cost |
| --- | --- | --- | --- | --- | --- |
| Portal goblins | none | none | none | 20 of 20 | 94 |
| Burn (Magma Jet, Arc Lightning, Blaze, Tormenting Voice, Hill Giants) | 27 × cards to select | 27 × cards to select | none | 20 of 20 | 127 |
| Green (Colossal Dreadmaw, Crash of Rhinos, Giant Growth) | 10 × combat damage, 1 × cards to select | the same | none | 20 of 20 | 51 |

So in those sixty games nothing the table can show was answered for the person
any longer, the combat damage board reached a person ten times in the twenty
games with tramplers in them, and asking changed no game. The last column is the size of
the gap M1b and M3 held open: 272 stops over sixty games where a play worth
making needed something chosen that the table could not send before this, which
it can now. The goblins deck raises no decision a person is not already asked;
it is the deck every earlier measurement used, and it is here to say so.

**The run in a browser.** `game-engine.spec.mjs` against the real engine
through the real relay, the spec's own seed: the room said the seat may choose
targets and which decisions it will be asked; at a stop of the player's with
Volcanic Hammer affordable in hand, the Hammer glowed; a tap began aiming it —
the prompt "Cast Volcanic Hammer", "Tap what Volcanic Hammer is aimed at: the
legal targets glow."; exactly the offer's legal targets glowed, each saying so,
with the seats among them lit on their plates and offered as "Aim at yourself"
and "Aim at the engine"; nothing had gone to the engine; Space did not pass; axe
found nothing; "Never mind" let it go and it glowed again; the actions panel
listed it as a play it would press and pressing it there began the same aiming;
"Aim at the engine" cast it, and when it resolved the engine's life fell from
19 to 16, and the log said "You cast Volcanic Hammer targeting opponent" and
"Opponent lost 3 life". Sparkmage Apprentice's trigger, M1b's check of a targets
decision, is answered the same way through the new choosing. The check that
Space after a pointer press passes rather than pressing again, which used the
refused Hammer, now uses a card in hand the engine offers nothing for.

`decisions.spec.mjs` (new, the stand-in engine, so it runs everywhere) has the
stand-in put eleven decisions to the seat one after another, in the shapes the
built engine sent: a discard at cleanup (514.1), a scry's bottom and its order,
a division, a Hill Giant's damage between two blockers, mana to pay with, a
number, a colour, one mode, one answer for three at once, and a split into
piles, which this table cannot show. For each: the prompt in the engine's own
words, axe clean, every control reached with Tab from the prompt and pressed
with Enter or Space, and the `decide` the room passed on read back off the
stand-in — the card chosen, the order, the division, each edge's damage, "Let
the engine pay", the number, `GREEN`, the mode, `all: true`, and for the piles
only "Let the engine choose". Screenshots looked at: `engine-aim.png` and
`engine-aimed.png` (the Hammer being aimed, and the engine at 16),
`decisions-order.png` and `decisions-combat.png`, in the system's temporary
folder.

**Where it departs from the brief's letter, and why.**

1. *Combat damage is `CombatResolutionDecision`, not `AssignDamageDecision`*:
   the second is not raised at the pin. Its steppers are per edge, starting
   from the engine's own split, rather than "per target summing to the total",
   because the board's validator — not a sum — is what says a split is legal.
2. *The live test's damage assignment is a double block, not first strike.*
   Argentum raises the board only where there is a real division: trample,
   more power than the blockers need, or banding (`CombatDamageManager`), and
   first strike alone is none of them. A Hill Giant blocked by two Raging Goblins is.
3. *The client says which decisions it can show; the process does not ask
   every client everything.* A tab left open across a deploy is kept alive
   here on purpose (M2), and one from before protocol 5 would have been put
   questions it can only answer with "Let the engine choose". It now keeps the
   engine answering for it, and says so, as before.
4. *X, a division of damage and a cost's choice came with targets*, beyond the
   three places M1b named: Blaze cast bare is cast at X = 0, Arc Lightning at
   two targets is refused without its division, and M3's note put the costs
   here. The division is the brief's "Fireball-style distribute": at the pin a
   cast's division goes with the cast, and `DistributeDecision` is raised only
   at resolution where none was given — by an ability or a trigger. It is asked,
   and the decisions spec answers one through the stand-in; no seeded game here
   raised one from the real engine.
5. *"Let the engine choose" is on a play too* (`act` with `auto`), which the
   brief asked only of decisions: so a play is never stuck either.
6. *Paying mana begins from the engine's own choice of lands* (Argentum's
   `autoPaySuggestion`), with "Let the engine pay" and, where the cost may be
   declined, "Do not pay". No seeded game here raised one from the real engine.
7. *Beyond the letter:* a trigger that takes several targets, or has several
   requirements, is answered with all of them now (M1b's "not done"); a
   decision's hidden cards are kept from the other seats; a tap on something a
   step cannot take says why ("Mountain is not a legal target for Volcanic
   Hammer.") rather than falling through to a play.

**Gone over afterwards, and what the reading found.** Three things, fixed
before the last run. A pile holding a card that could pay a cost, or be
selected, said on its tile that it "holds a legal target": `pileHolding` in
`glow.js` now tells a target from anything else being chosen, with a test. The
process read a malformed number or id in the new fields strictly and answered
with a Kotlin exception's name; it reads them forgivingly now, as the rest of
the wire is read. And the prompt panel had grown `Table.jsx` from 1,786 lines
to 2,202, most of it the prompt; it is a module of its own, and `Table.jsx`
(1,670) still exports what its tests imported from it. One fault of process
too, said because it cost a run: the app was rebuilt while the browser suite
was running, the thing this document warns against; that run was stopped, its
leftover browser and spec ended, and the suite run again from the start on the
final build.

**Not done, and where it goes.** Mulligans: the other half of M4. Still
answered for the player, and said: splitting cards into piles, choosing a word
to replace, a budget of modes (`SplitPiles`, `ChooseReplacement`,
`BudgetModal`). A spell with modes chosen as it is cast (Spree, "choose one or
more") is offered as the engine lists it and not looked at here: Argentum's
client sends `chosenModes` with such a cast, and `act` does not. Convoke,
delve, improvise and paying mana by hand at cast are the engine's, as they
always were (`PaymentStrategy.AutoPay`). "It will say what it chose" under
"Let the engine choose" is true of what happens next in the log, not of the
choice itself; saying the choice in words is left, since the status goes to
every seat and a choice can name hidden cards. A screen reader is not told
when aiming begins: focus stays on the card tapped, and the prompt says it
where it is, as it did for a trigger since M1b. No seeded game against the real
engine here raises `Distribute`, `SelectManaSources`, `ChooseNumber`,
`ChooseColor`, `ChooseMode` or `BatchYesNo`; each is held by unit tests and by
the stand-in's run in a browser, not by a live game.

The bar at the end: 1,877 unit tests across 92 files, 53 of them new; 36
browser specs, 1,410 checks, none failed, in 838 s — the engine's own spec 133
of them against the real engine through the real relay, and the new
`decisions.spec.mjs` 60 — and those two run again, 133 and 60, on a build made
after the last two edits, both to comments; the live engine suite 32 of 32, nine new;
the token check clean. No JVM and no preview left running.

### M4, the second half: mulligans, and the fixture M2 was short of — 2026-09-24

**The half, and the item beside it.** M4's other half is the opening hand:
the London mulligan as the engine implements it, reachable by keyboard, said
in words, axe-clean, and working with the engine's own decision rather than a
second rule set in the client. Beside it, the item M2 was left short on: a
captured run whose window holds declared blockers and a decision as well as
the engine's turn mid-flight. The second turned out to be a fault, not a gap.

**How Argentum does a mulligan, read before anything was built.** The brief
asked whether its actions arrive through `legalActions()` or as a
`PendingDecision`. Neither. `LegalActionEnumerator` knows nothing of the phase:
the initialiser holds the game at turn 1, `BEGINNING`, `UNTAP` with priority on
the starting player, and asked there it offers what a player could do in an
untap step. No decision is raised either; `MulliganHandler` has builders for
two (`createMulliganDecision`, `createBottomCardsDecision`) that nothing at the
pin calls. Argentum's game server drives the phase beside its priority loop,
with messages of its own, putting `TakeMulligan`, `KeepHand` and `BottomCards`
through the action processor and asking `EngineAiPlayerController` for its own
seats' keep and bottom. The rule as it implements it: a hand sent back goes to
the bottom of the library, the library is shuffled and seven drawn, always
seven; once kept, as many on the bottom as mulligans taken
(`MulliganStateComponent.cardsToBottom`), exactly that many, from the hand; a
mulligan may be taken while keeping would still leave a card; then any
opening-hand choice of CR 103.6 (a Leyline) as a yes or no; then turn 1.

**What was built.**

In the process (`Server.kt`), protocol 6. `new` takes `mulligans: true` and the
game is dealt with Argentum's phase; unasked, every hand is kept as before. The
process drives the phase as the game server does (`mulliganing`, in
`MulliganHandler`'s own order: each hand kept or sent back in turn order, then
the cards to bottom), naming the seat it waits on (`waitingOn`) and offering
Argentum's own actions in the offer shape: `KeepHand` and `TakeMulligan`, with
`mulligans` taken, `bottom` owed on keeping (and, on a mulligan, owed on keeping
the next hand) and `draws`; then `BottomCards` with its `candidates`. Every
number is read off `MulliganStateComponent`. `act` takes `cards` for the bottom,
or `auto` for Argentum's responder's choice. The engine's seat decides at once
by `EngineAiPlayerController`, alike at every level, and is not a stop. The log
says "You took a mulligan" (or "Opponent took a mulligan") where Argentum says
each card of the hand going into the library, and "You put … on the bottom of
your library" to the card's owner alone.

In the room (`relay-engine.mjs`). A sit says `mulligans: true` where its build
can show a mulligan; the room keeps it to the deal, and asks for the phase only
where every person at the table said so and the engine speaks 6, because a seat
that cannot would hold the game up for good. `GET /rooms/<code>` says
`mulligans` once dealt.

In the client. `useEngineRoom.js` sits with `mulligans: true`. The prompt
(`EnginePrompt.jsx`, `OpeningHandPrompt`) says the hand's size, the mulligans
taken and what keeping costs, who plays first ("You play first, so you skip
your first draw (103.8a)", from `docs/TURN_STRUCTURE.md`), and what a mulligan
does, "the London mulligan (103.5)" — each number the engine's own — with
Mulligan and Keep this hand. The cards to bottom are a choosing step of their
own (`beginBottom` in `choose.js`): begun by the stop, the hand glowing and
saying "can go on the bottom", the prompt counting down, one owed sent at the
tap that picks it and several at "Put them on the bottom", with "Let the engine
choose". The plate says "Opening hand"; a tap on a card says it cannot be played
before the game begins. The stand-in engine speaks 6 and deals the phase when
asked, so `decisions.spec.mjs` takes a mulligan everywhere, CI included.

**The item M2 was short of, and the fault under it.** A first capture on the
new protocol, 21 seeds, found declared blockers at no stop of any game; the same
seeds, once blocks could be seen, show the engine blocking in twelve of the
first thirteen. The engine's attacks and blocks were no
stops at all: `drive()` asked whether the engine's choice was worth watching
by finding it among the offers by equality, and its choice comes back filled in
— attackers, blockers, targets — so never equals the bare offer. Over eight
paced goblin games every one of the engine's stops fell in a main phase. Its
choice is now matched to its offer by what it is (`worthWatching`: the same card
cast, the same ability of the same source, and a declaration that declares
something), and the same eight games stop 49 times more for its attacks, 10 for
its blocks and 17 more in main phases — one for each of the 12 Volcanic Hammers
and 5 Lava Axes it cast, which it aims. The view at its block carries the
blockers, and `board.js` now draws each as an arrow from blocker to attacker,
the shape the table already drew for a block being chosen; the log says each in
words. That is the `blocks` M2 could not reach. The decision M2 expected from
casting Volcanic Hammer no longer comes, since a spell's targets go with its
cast; the capture's deck now holds Sparkmage Apprentice (four, for two Goblin
Bullies and two Hulking Goblins), whose arrival asks its controller for a target,
the same card the engine's spec aims.

The capture (`scripts/engine-capture.mjs`) is protocol 6: it sits the person as
this app's client does, takes one mulligan and keeps, aims plainly (the engine
first), attacks with everything, and keeps the earliest window that holds every
mark the tests read — the engine mid-flight, a combat, the offer to block,
blocks on the board, a decision, windows passed, a stop for a spell that needs
a target alone — and then as many of the opening hand's as it can. Seed
20260941 holds all of them and both of the opening hand's in 27 stops from the
deal, the shortest of 37 seeds tried by six; the fixture keeps 30 views, ten of
them whole, and the first capture's `seats` and `shots` as they were. It is 500
kB on disk where it was 292: half as many views again, and a whole state beside
the first of each of the new marks.

**Measured.**

| | median | slowest |
| --- | --- | --- |
| `new` with every hand kept, to the first stop | 6.4 ms | 10.4 ms |
| `new` with the hands to keep, to the person's first choice | 3.2 ms | 6.9 ms |
| the same, with the engine first, deciding inside `new` | 5.8 ms | 9.5 ms |
| take a mulligan | 0.7 ms | 2.7 ms |
| keep | 3.6 ms | 21.4 ms |
| put one on the bottom, to the first stop of the game | 3.6 ms | 6.6 ms |

Twenty seeds of the goblin deck at intermediate, after a warm-up, on the owner's
machine: nothing in the phase is anything a person waits on. The engine's own
mulligans, over 60 deals of the goblin deck with it deciding first: 3, the three
hands of no land or one; every hand of two to five lands kept, as its responder
says it keeps them. With the person first, over 24 deals of the goblin and
Sparks decks: none. And keeping changes nothing: seed 1 played with and
without the phase, both keeping, is the same game stop for stop and the same
winner (`tests/engine-live.test.js`), because keeping draws and shuffles
nothing — which is why the engine's browser spec, keeping at its first stop,
plays the very game it was written against.

**The run in a browser.** `game-engine.spec.mjs` against the real engine
through the real relay. Its first table now opens with the hand to keep, the
rule named, and the room saying it dealt the phase; keeping it, the seeded game
went on exactly as before, every earlier check passing. A fourth table, the
goblins again, by the keyboard: seven cards, "You play first, so you skip your
first draw (103.8a)", the plate saying "Opening hand", axe clean; Enter on
Mulligan drew seven again and the prompt said "7 cards, after 1 mulligan:
keeping them puts 1 on the bottom of your library"; the log said "You took a
mulligan" once; Space on Keep brought "Put 1 card on the bottom of your
library", all seven cards glowing and each saying it can go on the bottom, "1
more to choose", axe clean; Enter on a card left six in hand without it, 28 in
the library, "You put … on the bottom of your library" in the log, and the
first stop of the game. Pictures looked at: `engine-mulligan.png`,
`engine-bottom.png`, `engine-six.png` in the system's temporary folder. The
stand-in's run (`decisions.spec.mjs`) takes a mulligan, keeps and bottoms by
Tab, Enter and Space, reads each act back, and is axe clean at both prompts.

**Found by the runs, and fixed.** Two, beside the fault above. The log's trail
of passed steps was drawn in the faint tier and then dimmed again with an
opacity, which took it under 4.5:1 (the tier alone clears it, `tokens.css`);
axe found it the first time a sweep met the trail as a log's last line, a table
at its opening hand. And going over the change, the opening-hand prompt called
any seat that plays first "the engine", untrue at a table of several people
(M11); it names the seat now. The first is held by the sweep that found it,
which failed until it was fixed; the second by a test naming another seat. And
one of the new relay tests failed in three of four runs of the whole suite,
never alone: the room sends a move's status before its view and keeps its one-move
guard (M3) up until the view is out, and the test sent its next move on the
status, which beside a JVM landed inside the guard and was refused. The real
client waits for the answer and never did this; the tests now wait for the view
as well (`moved`), and so does the first half's test of the same shape, which
could have met the same.

**Found, and not fixed: nobody can respond to a spell.** Looking for why an aimed
spell was never on the stack at the engine's stop: Argentum's
`GameEnvironment.step`, which `drive()` uses, passes for every player while the
stack holds anything, so a spell resolves inside the step that cast it. A
person holding Shocks, stopped 26 times in a game where the engine cast Shocks
too, never once had anything on the stack. That is a gap in priority (117.4,
`docs/TURN_STRUCTURE.md`) at this table since it first played, not something
M4 did; driving the table with Argentum's `stepExactlyOne` is where a fix would
start. It is written in `engine/README.md` and is no milestone's yet.

**Where it departs from the brief's letter, and why.**

1. *The offers are made by the process, not found among the legal actions:*
   there are none to find (above). They are Argentum's own actions, in the
   shape every offer has, as its game server makes its own messages of them.
2. *The engine's table has a prompt of its own, not the hand-played table's
   `OpeningHand`,* which works out what is owed itself
   (`Math.min(mulligans + 1, 7)`): a second rule set, and one that would be wrong
   for a free first mulligan in a game of several. The new one reads every
   number off the engine and looks the same.
3. *Mulligans are dealt only where every person's client can show one.* A tab
   left open across a deploy is kept alive on purpose (M2), and one from before
   this would be offered a phase it has no prompt for; it is dealt every hand
   kept instead.
4. *Keeping or taking a mulligan has no "Let the engine choose"*: it is a choice
   of two, and nobody is stuck at it. Putting cards on the bottom has one.
5. *The capture is a different game from M2's:* a deck with Sparkmage
   Apprentice, a mulligan taken, the engine's attacks now stops. The first
   capture's `seats` and `shots` are kept, as the script always kept them.
6. *Beyond the letter:* the pacing fault, the block arrows and the contrast
   fault, above.

**What the new capture moved in the tests that read it.** No exact value in any
of them changed: the stop made for Volcanic Hammer alone
(`engine-glow.test.js`, `engine-prompt.test.jsx`) is still that, word for word.
One test changed its shape: `engine-room.test.jsx`'s "said under the view it
belongs to" took the run's first stop with windows passed and sent it as the
second view, true only while that stop was the run's second; it is its fourth
now, behind the opening hand, so the views between are sent first. Beside them,
the protocol's own numbers moved where tests name them: 6 in the stand-in's
`hello` (`engine-bridge.test.js`) and the real one's (`engine-live.test.js`),
and `cards` in `choices.act` (those two and `relay-server.test.js`). New tests
read what the capture now holds: the opening hand laid on the board, the
bottom's candidates, the engine's blocks drawn (`engine-board.test.js`); the
run's own statement of what it holds (`engine-delta.test.js`); the real targets
decision's glow (`engine-glow.test.js`); and the prompt at each
(`engine-prompt.test.jsx`).

**Not done, and where it goes.** Priority with a spell on the stack, above. The
log files the mulligan's lines under "Your untap", since Argentum holds the game
at turn 1's untap step while hands are kept; said, not changed. The stand-in's
opening hand is its first shot's five cards and does not shrink when one is
bottomed; the real engine's spec counts the six. A free first mulligan in a
game of several (Argentum's `freeMulligan`, over two players) is Argentum's and
untested here, as all of M11 is. A Leyline's yes or no after the phase is asked
as any yes or no is, and no seeded game here deals one. From the first half,
still: piles, a word to replace and a budget of modes answered for the player;
modes chosen at cast; convoke, delve and improvise paid by the engine.

The bar at the end: 1,909 unit tests across 92 files, 32 of them new, the whole
suite run three times over after the last change; 36 browser specs, 1,443
checks, none failed, in 891 s; the engine's own spec 150 checks
against the real engine through the real relay, 17 of them new, and
`decisions.spec.mjs` 76, 16 new; the live engine suite 37 of 37, five new; the
token check clean. The pacing test was held against the code it guards —
reverted, it fails; restored, it passes. No JVM and no preview left running.

**Reviewed afterwards, and fixed.** A reading of both halves, each finding
confirmed by a second reader, came to eighteen; three were the same fault
found twice (the opening hand's 103.8a line, "Let the engine choose" on a
play, a drag while bottoming), so fifteen faults. All fifteen are fixed, each
with a test. Four of the tests — the bottom, the combat split, the pacing
count, the drag — were held against the code they guard: with the fix taken
out, each failed. The rest assert, by reading, what the old code did not do or
say.

In the process (`Server.kt`, rebuilt):

1. *A card named twice for the bottom was taken.* Argentum counts the cards and
   checks each is in hand, and no more: two owed and one card named twice
   passed its count, moved once, and settled the mulligan with a card still
   owed kept in hand. Each card once, and exactly as many as owed, are refused
   here now, in this process's words (`bottomChosen`); a card not in hand is
   still Argentum's to refuse. A live test takes two mulligans and names one
   card twice; with the check taken out, it failed.
2. *A requirement left out of `targets` altogether was not seen.* The order
   check walked the keys sent, so `{"1": [...]}` for an offer whose first
   requirement may take none went to Argentum flat and was read as the first's.
   The offer's own requirements are walked now, one left out counts as given
   none, and a key naming no requirement the offer has is refused by its name.
   The live test is Boulder Dash, two requirements, whose lone "1" the old
   check would have sent on.
3. *Every order of cards going to a library said "the top of your library".*
   Argentum asks `ReorderLibrary` for cards going to the bottom as well
   (Prophetic Bolt's rest, `MoveCollectionExecutor`), and into another's
   library, and the decision says neither. Its suspended continuation holds
   both, and the process reads them there: `placement` ("top" or "bottom") and
   `library`, the owner. The prompt says "The first is the top of your
   library.", "The last is the bottom of the engine's library." and, from an
   engine without them, "The first ends up highest in the library.", which is
   true either way. Live: Magma Jet's order says top, Prophetic Bolt's bottom.
   Added without a new protocol number, as M3's review added fields to offers.
4. *Two comments were wrong:* `describe`'s said `act` carries no payment, a
   protocol after it began to; the order's said the top.

In the client:

5. *An ability's own source could neither pay its cost nor be picked as its
   target.* `pickable` left the source out of every cost of its own play, and a
   tap on the source let the play go before asking whether the step could take
   it. Argentum leaves the source out of an ability's candidates itself where
   the card says "another" (`excludeSelf`), and lists the whole hand for a
   spell's discard. So only a spell's own card is left out of its cost now,
   and a tap on the source lets the play go only where the step cannot take it
   (`answerTap`). Tested with a Bloodthrone Vampire sacrificing itself and a
   Prodigal Pyromancer aimed at itself, in the shapes the process sends.
6. *"Let the engine choose" on a play said "It chooses the rest for you"*, and
   the engine makes the whole play again: `auto` reads nothing sent beside it.
   It says "It makes every choice for this play" now, and ", redoing yours"
   once something has been chosen. Keeping what was chosen would need
   Argentum's Strategist to choose part of a play, which it does not do, and a
   division it chose for its own targets would not fit the person's; said in
   `engine/README.md` and in `act`.
7. *The opening hand said the first player skips their first draw at tables of
   three or more.* `docs/TURN_STRUCTURE.md` gives 103.8a for a two-player game
   alone, and Argentum skips the draw only at two (`DrawPhaseManager`). It is
   said at two now; at more, or where the seats are not known, only who plays
   first.
8. *A card dragged from hand while bottoming said "Keep this hand or take a
   mulligan first"*, of a hand already kept, and was not chosen. A drag while
   anything is being chosen now goes where a tap goes; the keep-or-mulligan
   words are kept for before the hand is kept. The decisions spec drags a card
   onto the table and checks it chosen; with the change taken out, it failed.
9. *Paying mana spoke of lands*, and Argentum offers any untapped permanent with
   a mana ability: "the sources chosen to pay with", "It picks what pays".
10. *A division's steppers read "2 share to Raging Goblin" and "Less share to
    the engine"* to a screen reader, which hears nothing else: they read "2 to
    Raging Goblin", "One more to …" and "One fewer to …". "At least 0 each",
    Argentum's own default, is left unsaid.
11. *`choose.js` said every decision it lists has a prompt in `Table.jsx`
    (`DecisionPrompt`)*; they are in `EnginePrompt.jsx`, two of them picked on
    the table.
12. *The capture stamped the UTC day*, a day after the evening it was taken:
    it stamps the local day, or `--date`, and the fixture says 2026-09-24.

In the tests:

13. *The combat damage test passed whatever split was sent*: the engine's own
    split killed both goblins too. It sends 3 and 0, and exactly the second
    goblin lives; answered with `auto` instead, it failed.
14. *The pacing test's count of aimed stops passed without them*: the last cast
    before a stop was still the Hammer at the attack that followed it. A stop
    counts now only where the Hammer's lines end it — it resolved, and nothing
    the engine did came after. With the `CastSpell` line of `sameOffer` taken
    out it failed, where the old count did not.
15. *The engine spec's "the log says it was cast" matched the opening draw's
    line.* It counts "You cast Volcanic Hammer targeting" and "Opponent lost 3
    life" before the press and wants one more of each after. And the
    Tormenting Voice test's second half, behind an `if`, tested Argentum's
    refusal while its comment spoke of the process's: it checks Argentum's in
    Argentum's words, unguarded, and the process's two refusals of `cost` have
    a test of their own (Volcanic Hammer, which has no cost to choose for, and
    Fire Bowman's `SacrificeSelf`, which `act` cannot pay). The refusals a tap
    says while choosing and before keeping had no test: the engine spec taps a
    Mountain while aiming the Hammer ("Mountain is not a legal target for
    Volcanic Hammer.", the stop unchanged), and the decisions spec taps a card
    before keeping.

**Found by the runs, and not fixed: the choosing prompt covers the lands.** At
the engine spec's 1280 by 900, the prompt floats over the bottom of the
battlefield, which is its row of lands, so the Mountain the spec meant to tap
was under it (the spec taps the Mountain in hand). A choice that is made by
tapping a land — mana to pay with, a cost that taps a permanent — would meet
the same; "Let the engine pay" and the prompt's own buttons are not covered.
Where the prompt sits is M1b's (TARGET.md §8), and moving it is layout work of
its own, not a fix to any of the above.

The bar at the end: 1,916 unit tests across 92 files, 7 of them new, three of
those in the live engine suite, 40 of 40; 36 browser specs, 1,450 checks, none
failed, in 932 s — the engine's own spec 152 of them against the real engine
through the real relay, two new, and `decisions.spec.mjs` 81, five new. One
change came after that run, the words for a library whose owner the table has
no name for ("their"); the unit suite, `decisions.spec.mjs` (81) and the axe
sweep (25) were run again on a build with it. The token check clean. No JVM
and no preview left running.

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
