# The engine's table, to completion — a brief for the next session

**Written 2026-09-21, for a session running on the owner's machine.** It
takes over from the cloud session that built Phases 1 and 2 and the first
two slices of Phase 3. Everything below is decided, measured or marked as
not. Where it says *verify*, the thing was not reachable from the cloud
container and must be checked before it is relied on.

Read, in this order, before touching anything: `README.md` here, then
`FRICTION.md` (the two laws), `HOUSE-RULES.md` and the repo's `CLAUDE.md`
(the bar every change clears), `ENGINE.md` and `SPIKE.md` (why Argentum, with
numbers), `PLAN.md` from "Phase 3" down (what was built and how), and
`engine/README.md` (the wire). Then this document is the plan.

---

## 0. The bar, and the shape of the work

Every milestone ends the same way, or it is not done:

```bash
npm test                                   # 1263 unit tests at handoff
npm run build && npm run test:browser      # 29 specs, 886 checks, against a built preview
npm run tokens:check                       # after any change to docs/ or src/styles/tokens.css
```

The house rules that bit most often in the last stretch, so they are said
again here:

- **Nothing is invented.** A number in a document was measured; a rule is
  cited by CR number from `docs/TURN_STRUCTURE.md`; a card comes from
  Scryfall; anything the app writes itself says so on screen.
- **Screenshot the thing.** A green spec is not proof a screen looks right.
  Every milestone below that touches a screen ends with a screenshot looked
  at, not only a check that passed.
- **Never rebuild while the browser suite runs.** Asset hashes change under
  it and the run dies with timeouts that look like bugs.
- **A new browser spec goes into the `test:browser` `&&` chain** in
  `package.json`, and it must print `N passed, M failed` on its last line.
- **Comments explain why. British English on screen.** The dialogs follow
  `src/components/Confirm.jsx`: title is the situation, body the consequence,
  every button says what pressing it does.
- **Commits carry the attribution lines** the session is given; never a
  model name in code, comments or pushed artifacts.

Work the milestones in order. Each is sized so that one session can finish
it and leave `main` green; each names the files it touches and the tests
that make it true. Do not start the next until the previous is pushed.

---

## 1. Where things stand

Two repositories, both on `main`, both green at handoff (`18431d2`):

| Repo | What |
| --- | --- |
| `rporter33/mtg-companion` | The app. React 18, Vite 6, PWA, GitHub Pages. |
| `rporter33/portfolio` | The write-up, `projects/mtg-companion.md`. Its "A table that plays by the rules" section predates the engine. |

The Table has **three authorities behind one component**, `src/features/game/Table.jsx`
(1,406 lines): alone (the board model in the browser), the relay (the same
board model on the server, `scripts/relay-server.mjs`), and the engine.

The engine path, top to bottom:

| Layer | File | Lines | Does |
| --- | --- | --- | --- |
| The rules | Argentum, a separate checkout | — | Comprehensive Rules, 12,979 distinct cards, an AI. MIT. `ENGINE.md`. |
| The process | `engine/src/main/kotlin/companion/Server.kt` | 686 | One game, JSON lines on stdin/stdout. The whole corpus, printings, the sideboard, `check`. Law 1 server-side. AI seats. Per-seat logs, masked for the seat and stamped with their step. |
| The bridge | `scripts/engine-bridge.mjs` | 121 | Spawns the process, promises per request, timeouts, exit handling. |
| The room | `scripts/relay-engine.mjs` | 198 | One process per enforced room on the relay. Seats, decks, `stop` numbers, views per seat. |
| The wire | `src/lib/board/relay.js` | — | `rooms(base).open({ enforced: true })`, `health()`. |
| The seat | `src/features/game/useEngineRoom.js` | 178 | Sits with the deck's names; status, views, refusals, `act`, `decide`, local moves. |
| The board | `src/lib/engine/board.js` | 224 | `ClientGameState` → the board model. Positions kept. Backs for hidden zones. Scryfall ids from image links. Events for the log, filed by the engine's turn marks and each line's step. |
| The screen | `Table.jsx`, `Seats.jsx`, `Lobby.jsx` | — | Play the engine; one-tap offers; attack by tapping; prompt panel; Pass on the rail. |

Measured, on the cloud container (a modest box):

| | |
| --- | --- |
| Argentum, first compile of `rules-engine`, `gym`, `ai`, one era | about 5 minutes |
| The **whole** card corpus, all nine eras, compiled after that | **130 s** |
| Rebuild of `engine/` after a change | seconds |
| One game of Portal goblins against the heuristic AI, over the wire | 31 stops, 110 windows passed, 1.3 s |
| Full `ClientGameState` for one viewer / median `StateDelta` | 7.8 KB / 2.8 KB |

The Argentum commit everything was built and measured against:

```
ENGINE_REV=70d525c69845c4a8c14516a5c7214444096e1018   # ronoccc/engine-choo-choo, main, 2026-09-20
```

**Things that are not in git.** The Argentum checkout lives beside the repo
(`../argentum`, or `ENGINE_HOME`), made by `scripts/engine-build.sh`. Tests
and the engine spec skip with a message when it is absent; they never fail
for its absence.

---

## 2. Setting up on the owner's machine

The cloud container could not reach Scryfall, GitHub's site or API, reddit,
moxgate or grok. A local machine can, which is why Milestone 0 exists.

```bash
# Tools
node --version        # 22.x (CI pins 22)
java -version         # JDK 21 (Temurin is fine); the engine needs it
git --version

# The app
npm ci
npx playwright install chromium          # the browser suite drives a real Chromium
npm test && npm run build
(npx vite preview --port 4173 --strictPort &) && npm run test:browser

# The engine, pinned to the commit above
npm run engine:build                      # fetches Argentum at the pinned commit (engine/README.md)
npm run engine:play                       # one game, from the command line
npx vitest run tests/engine-live.test.js  # a game over the wire

# The rules-enforced table, by hand
npm run relay                             # finds ../argentum/companion/build/install/companion/bin/companion
# then in the app: Table → seats panel → relay address http://localhost:8788 → Play the engine
```

**On Windows.** The commands above and `scripts/engine-build.sh` are
POSIX shell. Run the session inside **WSL2 (Ubuntu)**, where they work as
written, or inside **Git Bash**; plain PowerShell will fail on the `&`
backgrounding and on `sh`. Clone into a folder of your own (`~/code`, or
`Documents`), never into `C:\WINDOWS\system32`, and not as administrator.
If the session must run in PowerShell, its first task is to make
`engine-build.sh` and the preview step work there (a `.ps1` beside the
`.sh`, calling `gradlew.bat`), and to say so in this section.

**Done in Git Bash on the owner's machine, 2026-09-20 and 21**, and what it took:

- `.gitattributes` holds every text file to LF. With `core.autocrlf` on and
  no attributes, three unit suites failed to load with "SyntaxError: Invalid
  or unexpected token": a CRLF shebang in a `scripts/*.mjs` defeats Vite's
  blanking of it. CI never saw it, because CI checks out LF.
- `npm run engine:build` works from Git Bash, because npm hands Git Bash's
  `PATH`, `sh` included, to `cmd.exe`; from PowerShell `sh` is not found.
  The script fetches Argentum with `core.autocrlf` off, so `gradlew` keeps an
  LF shebang, and builds with the JDK on `PATH` when `JAVA_HOME` names a
  runtime, as it does on that machine (an Adoptium JRE 25 that something
  else installed; left alone).
- The bridge runs Gradle's `companion.bat` through a shell, and ends the
  whole process tree on a forced close, since ending the shell alone leaves
  the JVM running.
- The browser suite needs the Chromium revision Playwright asks for:
  `npx playwright install chromium`, or `CHROMIUM_PATH` pointing at one
  already under `%LOCALAPPDATA%\ms-playwright`.

Two habits from the last stretch that save an hour each: run the browser
suite in the background with its output in a file and poll the file, never
concurrently with another browser job; and never `pkill -f` by a string
that appears in your own shell's command line.

---

## 3. Decisions already taken by the owner (2026-09-21)

These are settled. Do not reopen them; build on them.

1. **Sixty-card first, then Commander.** Harden what works, then the app's
   centre.
2. **The engine's deck:** keep the mirror of the human's deck, then add "let
   the engine build its own" from Argentum's generators. Variety is the point.
3. **Three strengths: easy, intermediate, hard.** Mulligans on.
4. **CI builds the engine** on the runner, cached, so the engine spec and the
   live test stop skipping there.
5. **Hosting is prepared, not deployed,** by the session: Dockerfile, health
   checks, deploy notes. The owner deploys. Hosting itself was approved
   earlier ("pay for hosting too").
6. **A desktop client is in scope:** the app with the relay and the engine
   running beside it on the owner's machine, packaged.
7. **Multiplayer stays built and unadvertised** until the client is robust,
   as decided before Phase 2.
8. **The plan lives here,** one document, per-milestone briefs a session can
   take one at a time.
9. **Argentum stays upstream.** Contribute, do not fork (`PLAN.md`).
10. **Decided at M1, 2026-09-21.** A deck with cards the engine does not
    know offers both ways on: play the engine without them, the table then
    saying which were left out, or play the whole deck alone by hand. A
    sideboard card the engine does not know is left out and said, not a
    reason to refuse the game. A printing the engine has not got shows the
    engine's own art to every seat, with one line in the log saying so.
11. **Taken as defaults at M1, and the owner's to overturn:** a card in
    several printings is sent as a list of them; a wish's choice stays with
    the engine's responder until M4; the Wildcard at the engine's table
    draws from the decks it fully knows; a reversible card goes by its
    single name; the engine's heap ceiling is 2 GB, with one process per
    room and one for checking decks, until M8 sizes hosting from the
    measured 110 MB.
12. **Decided 2026-09-21, with released-first printings** (`PROJECT_BRIEF.md`
    §10): the engine moves to newer sets by a pull request the owner
    merges. Until M9 that is a deliberate commit moving `ENGINE_REV`; after
    M9, a scheduled workflow builds upstream Argentum, runs the live suite
    and the engine's browser spec, and opens the pull request with the new
    sets, the load time and the heap measured. The printing choice is never
    steered towards the sets the engine has; a printing it lacks keeps the
    settled fallback (item 10).
13. **Decided at M3, 2026-09-24.** A first game against the engine is played
    at intermediate, with easy and hard a choice away in the lobby. The
    choice is remembered with the player's other table preferences.
14. **Taken as defaults at M4, and the owner's to overturn:** a play is chosen
    in the order Argentum's own client asks it — X, then what its cost takes,
    then its targets, then the division of its damage; a step that takes one
    thing is finished by the tap that picks it, and one that takes several
    waits for Done; X starts at the most that can be paid, as Argentum's
    client starts it; paying mana starts from the engine's own choice of lands;
    every decision this table can show is asked, with no setting to have the
    engine answer them as it used to, and "Let the engine choose" on each.
15. **Taken as defaults at M4's second half, and the owner's to overturn:**
    mulligans are on at every engine table whose people's clients can show one,
    with no setting to turn them off; the order is Argentum's own — each hand
    kept or sent back in turn order, then the cards put on the bottom — and the
    engine's seat decides by the responder Argentum's game server uses, alike at
    every level; keeping or taking a mulligan is a choice of two with no "Let
    the engine choose", while putting cards on the bottom has one; one card owed
    goes on the bottom at the tap that picks it, as item 14's steps do, and
    several wait for the press. Not a default but a fix with a feel to it: the
    engine's attacks and blocks, and each spell it aims, are now stops of a
    paced table, so its turn plays a little slower and it pauses in yours when
    it blocks.

---

## 4. The milestones

### M0 — The inbox: what the cloud could not read

*Size: small. No app code changes unless a claim requires one.*

Three things were unreachable from the cloud and are the owner's to hand over
or the session's to fetch locally.

- **The Grok material.** The owner shared two grok.com links
  (a conversation share and a project with a conversations tab). Neither
  could be read from the cloud. The first was then pasted by the owner and
  is filed at `inbox/grok-2026-09-21-reality-fracture-preview.md`, read in
  `SOURCES.md` under "The Grok preview"; the paste ends mid-sentence, so
  ask for the rest. The second link, the project's conversations, is still
  to be exported into `inbox/` (one file per conversation, dated) and read
  the same way: a table of claims, each checked against the repo or a
  reachable source, with what changed because of it, appended to
  `SOURCES.md`. A claim that cannot be verified is written as unverified,
  not adopted; a claim about Moxgate is compared with `TARGET.md` and
  `CREATOR-POST.md`, which outrank it. **Update:** the owner then uploaded
  Grok's handoff zip, filed at `inbox/grok-pack-2026-09-20/` and read in
  `SOURCES.md` under "The Grok handoff pack". The owner confirmed on
  2026-09-21 that the zip is the whole of it; nothing more to ask for.
- **The season's first suggestion.** From the Grok preview: while a set is
  the focus, the Cards tab's "Try one of these" leads with that set's cards
  (`e:fra`), through `src/lib/season.js` rather than a hard-coded query,
  dated and provisional as the rest of the season is.
- **Scryfall's rate limits. Done, 2026-09-20.** The page was read from the
  owner's machine and the client's constants were right, digit for digit: 500 ms
  for those four, 100 ms for the rest. They now live in
  `src/lib/scryfall-limits.js`, with the `/cards/manifest` case (6,000 ms) the
  pack had missed, because six Node scripts under `scripts/` were spacing those
  same endpoints at 120 ms or 350 ms and had to be held to the published floor —
  the only real overage in the repo, and never in the browser client. A 429 now
  waits out Scryfall's thirty-second lockout instead of retrying inside it. In
  `SOURCES.md` the rate-limit row is no longer "unverified, adopted", and two
  verdicts that were wrong — the `User-Agent` row and the `jsonl.gz` row — are
  corrected, as is the client's own header comment, which cited a "50–100ms"
  that Scryfall's page does not say. Being slower than a limit costs nothing;
  being wrong in a document does, and this was wrong in those three places.
- **The common-card bundle.** `PLAN.md` ("A precomputed bundle of common
  cards") describes a static JSON of the cards most decks share, loaded at
  startup so a first table needs no network. It waited on Scryfall access.
  Build it with the existing `deck:fetch` tooling as the pattern, keep it
  under the `bundle.spec.mjs` budgets, and say on screen where a card came
  from as the house rule requires.

Done when: `SOURCES.md` has the new section, the constants match Scryfall's
own page, and the bundle ships or the document says why not.

### M1 — The whole corpus, and a deck the engine can enforce

*Size: medium. The single biggest step toward playing a real deck.*

**Done, 2026-09-21.** What was measured, what the review and the run in a
browser found, and what is left are in `PLAN.md`, "M1: the whole corpus".
The owner's answers are §3 item 10.

Today only Portal is registered (`registry()` in `Server.kt`), so any real
deck is refused with a list of names. The whole corpus compiled in **130 s**
on the cloud box after the base modules, so the cost that justified Portal
is gone.

Build:

1. `engine/build.gradle.kts`: depend on `project(":mtg-sets")` (the
   aggregator) instead of one era. `registry()`: register every set in
   `MtgSetCatalog.all` (`mtg-sets/src/main/kotlin/com/wingedsheep/mtg/sets/MtgSetCatalog.kt`,
   `val all: List<MtgSet>`, `byCode`). *Verify* each `MtgSet` exposes its
   cards and basic lands the way `PortalSet` does; register both. Report
   the set codes in `hello.sets` and the count in `hello.cards`.
2. A `check` op on the wire: `{"op":"check","deck":{name:n}}` →
   `{"known":k,"unknown":["…"]}`. The relay exposes it as
   `POST /engine/check` so the lobby can ask before a room exists.
3. **The gate in the lobby.** With an enforced room chosen, the deck shelf
   asks the relay and says on each deck "the engine knows 58 of 60 cards" and
   names the two. Sitting with an incomplete deck offers the unenforced table
   instead, in the house dialog style. Nothing is silently dropped.
4. **The printing survives.** `GameInitializer` takes an optional printing
   metadata registry so a deck entry pinned to a `PrintingRef` (set code and
   collector number) stamps *that* printing's image on the card
   (`GameInitializer.kt` lines 137–145, `Deck.kt` `CardEntry.printing`).
   The app knows each card's set and collector number from Scryfall. Send
   them with the deck names (`deck: {name: {count, set, number}}` as an
   extension the old shape still parses) so the engine's image link, and
   therefore `scryfallIdOf()`, is the printing the player chose. *Verify*
   the registry type and how printings are resolved before relying on it;
   if it needs the whole printing catalogue, keep the current behaviour and
   fetch the chosen printing's art client-side by name, which
   `getCardsByNames` already does.
5. **Sideboard** entries go through as `Deck.sideboard` (CR 100.4) so wish
   effects work; nothing else changes.
6. **Say what the engine lacks.** `hello.sets` says which sets are
   registered; the deck gate names the cards the engine does not know. For
   Reality Fracture in particular, check at the pinned commit whether FRA
   and FRC are in the corpus and record it in `PLAN.md`; the season's own
   cards missing from the engine would be the first thing a player notices.
7. **Pin the engine.** `scripts/engine-build.sh` takes `ENGINE_REV` and
   checks that commit out (`git fetch --depth 1 origin <rev>` then
   `checkout FETCH_HEAD`), recorded in `engine/README.md`. Moving the pin is
   a deliberate commit with the compile time and the game measured again.

Tests: `tests/engine-live.test.js` plays a game with a modern deck (any two
real names outside Portal) and checks `hello.cards` is above 12,000;
`tests/relay-server.test.js` covers `/engine/check` against the fake engine
(teach `tests/fixtures/fake-engine.mjs` the `check` op); a browser spec
section in `game-engine.spec.mjs` for the gate and the fallback dialog.

Done when: a deck built in the app's own editor plays against the engine,
with the player's printings on the tiles, and a deck the engine cannot take
says so and offers the other table.

### M1b — The glows, and a preview that never covers Pass

*Size: small. Two things Moxgate does that the Grok preview named and this
table does not yet do (`SOURCES.md`, "The Grok preview").*

**Done, 2026-09-24, against the code M2 left rather than the code this was
written for.** What was built, what was measured, where it departs from the
letter below and why, and what is left are in `PLAN.md`, "M1b: the glows, and
a preview that never covers Pass". In short: a spell or ability that needs a
target does not glow as playable, because this table still cannot send a
target (M2's finding; the tap now says so instead of drawing the engine's "no
valid targets"); targets glow wherever a targets decision is asked, which
today means a triggered ability's, and were watched live on a Sparkmage
Apprentice; the preview keeps clear of the rail as well as the prompt, and
stays a floating preview rather than an inspector column. No change to the
wire and none to `Server.kt`.

The rest of this section is the brief it was built to, kept as written.

- **Playable cards glow.** At the engine's table, a card in hand with an
  affordable, meaningful offer (`offerFor(id)` in `Table.jsx`) gets a
  `bcard--playable` edge glow; a permanent with a non-mana ability offered
  gets the same. The glow is the accent, which the season turns cyan.
  `TARGET.md` §11 is the reference.
- **Targets glow.** While a `ChooseTargets` decision is asked, every legal
  id gets `bcard--target`, and the aiming banner names the source. Also
  during declare-attackers: `validAttackers` glow, chosen ones stay lit.
- **The preview never covers Pass.** `Peek.jsx` places the printed face
  above a hand card, which is the bottom of the battlefield, which is where
  the prompt panel sits. Pass the prompt's rectangle in (an `avoid` rect from
  `.prompt`, read at show time) and place the preview beside the card when
  above would overlap it. Weigh the pack's alternative for wide screens,
  the preview parked at the top of the side column as an inspector
  (`inbox/grok-pack-2026-09-20/shots/table-play.jpg`), against Moxgate's own
  floating preview in `frames/`; pick one and screenshot both cases.
- **Space passes.** When a pass is on offer and focus is not in a field,
  Space acts it; Z stays the zoom. Say so once in the prompt's hint.
- **The credit line names its sources.** The table's Fan Content line gains
  "Card data and imagery from Scryfall", and at the engine's table
  "Rules-enforced play is powered by Argentum, an independent open-source
  rules engine, used under the MIT licence", the shape Moxgate's own footer
  uses for Forge (`SOURCES.md`, "The Grok handoff pack").

Tests: a section in `game-engine.spec.mjs` for each glow (class present on
the right cards and on no others), and one that hovers a hand card with the
prompt showing and asserts the preview's box does not intersect the
prompt's. Under reduced motion the glows are static, not animated.

### M2 — Watching the engine's turn, and deltas on the wire

*Size: medium. The biggest felt gap: the opponent's turn vanishes.*

**Done, 2026-09-22, with one item short.** What a paced turn costs, what the
run in a browser found, and what is left are in `PLAN.md`, "M2: watching the
engine's turn". The wire is in `engine/README.md` (the process) and the header
of `scripts/relay-engine.mjs` (the room); §7 below has both in short.

Item 4 below is met but for one thing: `scripts/engine-capture.mjs` is written
and kept, and its run holds the engine's turn mid-flight, a combat and the
offer to block it — but no decision, and no blockers declared. Neither is a
gap in the capture. A targeted spell cannot be cast at this table by anybody
(`Table.act` in `Server.kt` fills in `attackers` and `blockers` but not
`targets`, so Argentum refuses the cast with "No valid targets available"
before any `ChooseTargets` decision is raised), and combat resolves between
two stops, so no view a client is ever sent carries declared blockers. The
capture says so on every run rather than reporting success with the gap in,
and `run.held` names the offer to block `blockable`, not `blocks`. Closing the
first is a `when` branch in `act` beside the two that are there, and a
target-picking step in the client before the act: M4's ground, live now.

*Closed at M4 (2026-09-24).* Both are in the capture now (`PLAN.md`, "M4, the
second half"). The first was never combat resolving between two stops: the
engine's attacks and blocks were no stops at all, because `drive()` matched its
filled-in choice to the bare offer by equality, and a declaration with its
creatures in it never equals one without. Matched by what it is, the engine's
blocks are a stop, and the view there carries them. The second needed a trigger:
since protocol 5 a spell's targets go with its cast and raise no decision, so the
capture's deck holds Sparkmage Apprentice, whose arrival asks for its target.

The rest of this section is the brief it was built to, kept as written.

Today `drive()` in `Server.kt` runs every AI action synchronously until the
human's next stop, so the browser sees the engine's whole turn as one jump,
and the log skips it. Moxgate shows the opponent acting, at a pace, with a
"thinking" state.

Build:

1. **Pacing in the process.** `drive()` gains a budget: when an AI seat
   acts, return after each AI action (or after `paceMs`) with
   `waiting: "engine"` and `actor` the AI seat, and let the relay call
   `{"op":"continue"}` to take the next step. The relay publishes a view
   between steps at a pace (start at 600 ms; make it a room setting so the
   pace presets in `PLAN.md` §5 have somewhere to land). Decisions the AI
   answers for itself stay inside one step.
2. **Deltas.** The process already answers `view { delta: true }` with a
   `StateDelta`. Add `applyDelta(view, delta)` to `src/lib/engine/board.js`
   (the DTO's own contract: null means unchanged, `combatCleared`,
   `newLogEntries` appended, `players` always whole) with unit tests against
   captured pairs, then have the relay send deltas after the first full view
   and the hook apply them. Keep a `seq` on views so a missed delta triggers
   a full view request rather than a wrong board.
3. **The log during their turn.** With views arriving mid-turn,
   `eventsBetween` already emits `turnBegan` and `stepped` for the engine's
   turn. Since M1 every log line carries its words and the step it happened
   in, and the engine's turn marks become turn headers, so the engine's turn
   is already said after the fact, in the right turn and step; what M2 adds
   is watching it arrive. Add "The engine is thinking…" as the plate status
   while `waiting: "engine"`, and the prompt panel says nothing, as Moxgate's
   does. Put the "passed N priority windows" note after the view it belongs
   to: today `status` arrives first, so the note lands above the land played
   before those windows.
4. **Capture new fixtures** (`tests/fixtures/engine-views.json`) from a game
   that includes the engine's turn mid-flight, blocks, and a decision, so the
   adapter tests cover them. The capture script that made the first fixture
   is in `PLAN.md`'s history; write it as `scripts/engine-capture.mjs` this
   time and keep it.

Tests: adapter unit tests for `applyDelta`; relay tests for `continue` and
pacing with the fake engine (it needs a `continue` op that advances one
shot); the engine spec watches the opponent play a land during its turn.

Done when: you can watch the engine play its turn, one action at a time,
with the log filling in as it goes, and the wire carries deltas.

### M3 — Easy, intermediate, hard

*Size: small to medium. Mostly measurement.*

**Done, 2026-09-24.** The owner's answer is §3 item 13: a first game is
intermediate. What the profiles are at the pin, which three the levels are and
why, what 4,400 games between them measured, what a person waits at each, what
the measuring found and fixed, and where it departs from the letter below are
in `PLAN.md`, "M3: easy, intermediate, hard". In short: easy is `v0` (the
engine this table always had), intermediate `production-raceclock`, hard
`production-candidate-expiring` (what Argentum fields itself); each beat the one
below it on both decks measured, by 53–59%, and hard beat easy by 58–63%. The
brief's `PRODUCTION` measured no stronger than easy, so is not intermediate.
The level is a room setting, protocol 4 on the process's side; §7 has the wire.
Hard can take ten seconds over a move against a deck of instants, which found a
second press landing on the next stop (fixed in the room and the client) and a
table saying nothing while it waited (it now says the engine is thinking once
an answer is slow).

**Reviewed the same day.** Thirteen faults were found in what M3 and M1b left,
and all thirteen are fixed; `PLAN.md`, "M3", under "What the review found", has
each with its test. The largest: an ability whose cost needs a choice now says
so on the wire and is held back like a spell that needs a target (M4's note
below is corrected); a stop made for a flashback, or for such an ability, now
says so; Space after a mouse press passes as it was meant to; and the levels
are held to what they play, not only to their names.

The rest of this section is the brief it was built to, kept as written.

Argentum's AI is a set of named profiles in
`ai/src/main/kotlin/com/wingedsheep/ai/engine/AiProfile.kt`:

| Profile | What it carries | Candidate for |
| --- | --- | --- |
| `LEGACY_V0` / `CURRENT` | The heuristic strategist alone | Easy |
| `PRODUCTION` | Card advisors and card intent | Intermediate |
| `PRODUCTION_CANDIDATE_TUNED` | Meaningful-action filter, tiered budget, rollouts (`RolloutSettings.DEFAULT`), hidden-information determinisation, tuned evaluation weights | Hard |

`RandomActionSelector` (what `ai: "random"` uses today) is not "easy"; it is
a test opponent and should stay that.

Build: `new` takes `ai: "easy" | "intermediate" | "hard"`; the process maps
them to profiles via `AIPlayer.create(registry, id, profile)`; the lobby's
seats panel offers the three with one line each saying what they are
(easy: plays sensibly and fast; hard: looks ahead and takes a moment). The
`sit` message carries the choice; the room describes it; the log names it
once at the start ("The engine plays hard.").

Measure before choosing the defaults: per-move wall clock for each profile
over ten games with the goblin deck and one real deck (median and p90).
Hard's rollouts have a budget policy (`TieredBudgetPolicy`); *verify* what
that means in milliseconds and put the numbers in `PLAN.md`. If hard's p90
is over about two seconds, the pacing from M2 hides some of it, and the
plate says "thinking".

Tests: the live test runs one short game at each level; the relay test
passes the level through; a browser check that the seats panel offers three
and the log names the one chosen.

### M4 — Mulligans, and the decisions the client cannot yet answer

*Size: medium.*

**Done, 2026-09-24: the decisions, and then the mulligans.** What was built,
what was measured, where it departs from the letter below and why, and what is
left are in `PLAN.md`, "M4, the first half: the decisions" and "M4, the second
half: mulligans, and the fixture M2 was short of". The owner's defaults taken
along the way are §3 item 14 and 15. Its review found fifteen faults, all
fixed, listed at the end of the second half's section: among them a card named
twice for the bottom taken as one, an ability's own source that could neither
pay its cost nor be its target, and an order of cards going to the bottom of
a library said to be the top (a `ReorderLibrary` now says `placement` and
`library`, engine/README.md).

The second half, in short: protocol 6. Argentum's mulligan phase is neither a
legal action nor a decision — `legalActions()` knows nothing of it, and its
game server drives it beside the priority loop — so the process does the same:
the game opens, where the room asks, with the hand to keep; the prompt offers
Mulligan and Keep with the engine's own numbers and the rule cited (103.5), and
after keeping with mulligans taken, the hand glows and a tap puts a card on the
bottom, the prompt counting down. The engine's seat mulligans by Argentum's own
responder. Keeping is the same game the seed dealt before. And the item M2 was
short of is closed: the capture now holds declared blockers and a real targets
decision, because the engine's attacks and blocks were never stops of a paced
table — its filled-in choice was matched to the bare offer by equality — which
is fixed.

The first half, in short: protocol 5.
A spell or an ability that needs a target is chosen on the table — it glows, a
tap begins aiming it, the legal targets glow, the seats are offered by name —
and `act` carries the targets, and with them an X, a division of damage and
what a cost takes (discarding, sacrificing and the other kinds Argentum's own
client pays with a chosen card). M1b's three measures and M3's for costs are
lifted exactly where the room says the seat's `act` can carry the choice
(`seated.choices`); a seat told nothing keeps them. The client says in its sit
which decisions it can show (`answers`), and those are asked instead of
answered: cards to select, an order, a division, the combat damage step, mana
sources, a number, a colour, modes, and one yes or no for several. Every one
keeps "Let the engine choose". The brief's `AssignDamageDecision` is not raised
by Argentum at the pin; its combat asks the whole step as a
`CombatResolutionDecision`, and that is what is asked. Still answered for the
player, and said: piles, a word to replace, a budget of modes.

The rest of this section is the brief, kept as written.

Today `new` sets `skipMulligans: true`, and the process answers ordering,
damage assignment, mana-source and card-selection decisions with the
engine's own responder and reports them under `decided`. Both are honest
stand-ins, and both are Moxgate-visible gaps.

Mulligans (the London rule, CR 103.5): with `skipMulligans: false` the game
opens in a mulligan phase in which the legal actions are `TakeMulligan`,
`KeepHand` and, after keeping with mulligans taken, `BottomCards(cardIds)`
(`GameAction.kt` lines 622–659). *Verify* they arrive through
`legalActions()` and not as a `PendingDecision`. The table's `OpeningHand`
prompt already says Mulligan / Keep; in engine mode its buttons act those
offers, and "put N on the bottom" becomes a tap-to-choose on the hand with
the prompt counting down, then `act` with the ids. The AI seat mulligans by
its own responder inside `drive()`.

The other decisions, each a small prompt in `EnginePrompt` and a `decide`
shape in `Server.kt`:

| Decision | Ask by | Answer |
| --- | --- | --- |
| `SelectCardsDecision` | tap cards in the named zone until min/max | `CardsSelectedResponse` |
| `OrderObjectsDecision` | a list with up/down, or tap in order | `OrderedResponse` |
| `DistributeDecision` / `AssignDamageDecision` | steppers per target summing to the total | `DistributionResponse` / `DamageAssignmentResponse` |
| `SelectManaSourcesDecision` | tap lands, or "let the engine pay" | `ManaSourcesSelectedResponse` |
| `ChooseNumberDecision`, `ChooseColorDecision`, `ChooseModeDecision` | small pickers | their responses |
| `BatchYesNoDecision` | yes/no plus "for all of them" | `BatchYesNoResponse` |

Read each class in `rules-engine/…/core/PendingDecision.kt` for its fields
before designing the prompt; the file is the contract. Keep "Let the engine
choose" on every one, so a player is never stuck. `decided` shrinks to what
still cannot be asked, and the README table says what that is.

Tests: the live test forces at least one of each with a deck that raises
it (a burn spell for targets is already there; add a Fireball-style
distribute, a discard-and-select, a first-strike damage assignment);
adapter tests for any new event shapes; the engine spec exercises mulligan
and one decision on screen.

*Added at M1b (2026-09-24).* Three places hold back an offer that needs a
target, each saying so, until a spell's or an ability's targets can be sent
with `act`: `glowsAt` and `unaimed` in `src/lib/engine/glow.js` (no playable
glow; the prompt names the card instead), `cannotAim` in `Table.jsx` (the tap
says the table cannot choose one), and `EngineActions` (listed, not
pressable). The target-picking step this milestone adds can reuse the target
glow as it stands: `bcard--target` on every legal id, the plates for seats, and
the prompt's "Aim at …" buttons.

*Added at M3 (2026-09-24), corrected in its review the same day.* The same gap
for costs. An ability whose cost has a choice in it — Flamecache Gecko's
"{1}{R}, Discard a card: Draw a card" — is offered as affordable and worth
making, and is refused by Argentum when sent bare ("Must choose 1 card(s) to
discard"), because `act` has no way to say which card. Found by M3's
measurement with a Bloomburrow deck (`scripts/engine-levels.mjs --watch`).
M3's note here said the offer does not say its cost needs a choice; that was
wrong. Argentum's `LegalAction` carries `additionalCostInfo` (its `costType`,
its `description`, and the candidates for each kind: `validDiscardTargets`,
`validSacrificeTargets` and the rest), and `requiresForage`;
`Server.kt`'s `describe()` simply did not send them. It now sends
`additionalCost`, `additionalCostText` and `requiresForage` (engine/README.md),
and the table holds such an offer back in the same places as one needing a
target: `heldBack`, `unpaid` and `glowsAt` in `glow.js` (no glow; the prompt
names it), `cannotPay` in `Table.jsx` (the tap says the table cannot make the
choice), and `EngineActions` (listed, not pressable, with the reason). A cost
of sacrificing the source itself, or of life, needs nothing chosen and is not
held back. What is left for this milestone is asking: the candidates are in
`additionalCostInfo`, and the answer goes in the action's `costPayment`
(`discardedCards` and its siblings), which `act` would have to fill as it fills
`attackers`.

*Done at M4 (2026-09-24).* The places both notes name hold an offer back now
only where the room says this seat's `act` cannot carry the choice — `heldBack`
and `glowsAt` take what the seat may choose (`can`, `src/lib/engine/choose.js`),
`cannotAim` and `cannotPay` are said only then, and `EngineActions` presses such
an offer where it can be chosen. A cost's candidates are the offer's
`costChoice`, and `act` fills `additionalCostPayment` or `costPayment` with them
as Argentum's own client does.

### M5 — The engine's own deck

*Size: small.*

`ConstructedDeckGenerator` (`ai/src/main/kotlin/com/wingedsheep/ai/engine/deck/`)
has `generate(setCodes: List<String>, format: DeckFormat): Map<String, Int>`
and `generate(format)`, with `DeckFormat.STANDARD … COMMANDER` in
`mtg-sdk/…/core/DeckFormat.kt`. That is exactly the wire's deck shape.

Build: `new` takes, for an AI seat, `deck: "mirror" | "own" | {names}`;
"own" calls the generator with the human deck's format and, when the owner
wants a fair fight, its set codes. The lobby offers: mirror your deck, one
of your decks (the shelf, again), or let the engine build one. The seats
panel names what it chose ("The engine, with a deck of its own: red-green
from Bloomburrow"); the log names the deck's colours once. Seeded per game
so two games differ.

Tests: relay test for the three shapes against the fake engine; live test
that "own" produces a legal deck of the format's size (the app's own
`src/lib/deck.js` validator can check it from the names).

### M6 — Commander

*Size: medium to large. The app's centre; second by the owner's order.*

Argentum has `Format.Commander` (`mtg-sdk/…/core/Format.kt`: 21 commander
damage, 100 cards, 40 life, `alwaysDivertToCommand` off so the owner
answers the CR 903.9a yes/no) and `PlayerConfig.commanderCardName`
(single commander; partners are marked Phase 4 territory upstream).

Build:

1. `new` takes `format: "standard" | "commander"` and, per player,
   `commander: name`; the process builds `Deck.of(..., commander = …)` and
   `GameConfig(format = Format.Commander())`. Sixty-card stays the default.
2. The adapter maps the engine's Command zone onto the board's `command`
   zone (already a zone id; check the engine's `Zone` name for it and add it
   to `ZONE_IDS`), and the commander's tile in the lobby's seat panel and
   the command tile on the table come from it, as they do today from the
   deck's `commanders`.
3. Casting from the command zone is an offer with `card` set to the
   commander's id; the tile's tap finds it like any other. Commander tax
   shows in the offer's `manaCost`.
4. `ClientPlayer` carries per-commander damage (the field after
   `activeEffects` in `ClientDTO.kt`); the plate shows it under life when
   any is above zero.
5. The 903.9a question arrives as a `YesNoDecision`, already askable.
6. The engine's "own" deck for Commander: `DeckFormat.COMMANDER` through
   the generator, *verify* it names a commander.

Tests: the live test plays a short Commander game; adapter tests for the
command zone and commander damage on a captured view; the engine spec sits
down with the app's example Commander deck.

Done when: the app's example Commander decks play against the engine,
commander in the command zone, cast from it, tax paid, damage tallied.

### M7 — A room that survives the relay

*Size: medium.*

An enforced room dies with the relay today, and says so. Argentum has
`gym/src/main/kotlin/com/wingedsheep/gym/service/SnapshotCodec.kt` and
`GameEnvironment.restore(state, playerIds, stepCount)`, so the game state
can be written and read back.

Build: a `snapshot` op that returns the encoded state, and a `restore` op
that takes it before any `new`; the relay writes an enforced room's
snapshot beside its seats and decks after every stop (the same debounced
`flush` the board rooms use) and, on start-up, re-spawns the engine for
each saved room and restores it. A crashed engine process restarts from the
last snapshot with one line in the log ("The engine restarted; the table is
as it was at your last stop."). The RNG state must travel with the
snapshot or replays will differ; *verify* what `SnapshotCodec` covers.

Tests: relay tests for write, restart and restore against the fake engine
(teach it `snapshot`/`restore`); a live test that snapshots mid-game,
restores into a fresh process and continues to the same next stop.

### M8 — Hosting, prepared

*Size: small to medium. The owner deploys.*

Build in the repo, not on a provider:

- `deploy/Dockerfile`: multi-stage. Stage one clones Argentum at
  `ENGINE_REV` and runs `engine-build.sh` with a JDK; stage two is
  `eclipse-temurin:21-jre` plus Node 22, copying `companion/build/install`
  and the app's `dist`. `CMD node scripts/relay-server.mjs` with
  `ENGINE_CMD`, `STATIC_DIR=dist`, `ROOMS_DIR=/data/rooms` on a volume,
  `PORT`. Health at `/health` reports `engine: true`.
- `deploy/HOSTING.md`: what the service needs (one process, a persistent
  volume, WebSockets, a 60 s proxy idle timeout is fine because of the 30 s
  heartbeat), and notes for Fly.io, Railway and Render, *each verified
  against their current docs on the owner's machine*, with the memory the
  JVM wants (measure the process under a game; set `-Xmx` in the launcher's
  `JAVA_OPTS`). No prices in the document unless read that day and dated.
- `VITE_RELAY_URL` at build time so the deployed app knows its relay
  without the address form; the form stays for running one's own.
- The engine's image links point at `cards.scryfall.io`; nothing to host.

Done when: `docker build` and `docker run` on the owner's machine serve the
app, the relay and a game against the engine at one address, and the notes
are enough for the owner to deploy without the session.

### M9 — CI builds the engine

*Size: small.*

`.github/workflows/deploy.yml` runs the unit and browser suites on
`ubuntu-latest`. Add, in the same `test` job before the browser suite:
`actions/setup-java@v4` (Temurin 21), `gradle/actions/setup-gradle@v3` for
the Gradle cache, a clone of Argentum at `ENGINE_REV` into `../argentum`,
and `npm run engine:build`. Cache `../argentum/companion/build/install`
keyed on `ENGINE_REV` plus a hash of `engine/`, so a cache hit skips the
compile. Then `tests/engine-live.test.js` and `game-engine.spec.mjs` run
for real. Budget: the first cold run is the five-minute compile plus 130 s;
a warm one is seconds. Print the times in the job so the budget is watched.

Done when: a pull request shows the engine spec's checks in CI, and the
skip message never appears there.

### M10 — The desktop client

*Size: large. A spike first, then the real thing.*

What it is: the app, the relay and the engine running on the owner's
machine, packaged as one application, so the rules-enforced table works
offline and without a hosted relay. `PLAN.md` Phase 5 and `ENGINE.md`'s
open question ("bundle size with a jlink-trimmed JRE").

The spike (one day, decides the rest):

1. **Electron or Tauri.** Electron brings Node, which the relay is written
   in, so the relay runs in the main process with no second runtime; Tauri
   needs a Rust toolchain and would run the relay as a sidecar binary. Start
   with Electron for that reason; write down why in the spike's note.
2. **The JRE.** Produce a trimmed runtime with `jlink` from the modules the
   companion launcher needs (`jdeps` on the install's jars lists them) and
   measure it; the Gradle `application` plugin's install plus a jlink image
   is the shape. Record the size against the "runs smoothly" requirement.
3. **Lifecycle.** Main process starts the relay on a free port with
   `ENGINE_CMD` pointing into the bundle and `STATIC_DIR` at the packaged
   `dist`, waits for `/health`, opens the window at that address, and on
   quit closes the relay (which closes sockets with 1012 and the engine
   with `quit`). A crashed relay restarts once with a banner.
4. **Card images and data** come from Scryfall as they do on the web; the
   IndexedDB cache makes the second game offline.

Then the application: menu, auto-start of the relay, a settings page for
the relay address (so a desktop client can also join a hosted room), signed
builds for the owner's platform, and a smoke spec that launches the built
app and plays one land. Auto-update is out of scope.

Done when: the owner double-clicks one application and plays the engine
with no server anywhere.

### M11 — Multiplayer with the engine, unadvertised

*Size: small.*

`relay-engine.mjs` seats N humans plus one engine seat already
(`POST /rooms { seats: 3, enforced: true }`). Drive it with two browser
contexts in a spec section (the pattern is `game-room.spec.mjs`), fix what
breaks (turn order in `drive()`, the second human's views, the log's
names), and leave it out of the lobby's copy, per the owner's rule.

### M12 — The write-up, and the paper trail

*Size: small, and after every milestone, not only at the end.*

- `PLAN.md` gets a dated status paragraph per milestone, with the numbers
  measured; `CURRENT.md` its one line per new file.
- The portfolio's `projects/mtg-companion.md`, section "A table that plays
  by the rules", gets the engine chapter: the decision (`ENGINE.md`), the
  spike's numbers, the wire, Law 1 measured (31 stops, 110 passed), the
  first game's three lessons (no deck for the AI; the AI blocks; the log
  skips a turn), and screenshots of the prompt panel and an attack. Written
  the way the rest of that file is: what was decided and why, what it cost,
  what it found.

---

## 5. Traps already found, so they are not found again

- **Hooks before the early return.** `Table.jsx` returns a loading skeleton
  when there is no run; every hook must be above that return or React
  throws error 310 in the built app only.
- **An effect keyed on an object rebuilt each render** reconnects the
  socket in a loop. `useEngineRoom` keys on a JSON string of the deck names.
- **Law 1 asks the engine's question, not ours.** "Any affordable non-pass
  action?" stopped the player at every upkeep to offer a land to tap.
  `MeaningfulActionFilter.isMeaningful` is the list of what counts.
- **A declare-attackers or blockers window with nothing to declare has no
  pass action.** The empty declaration is the pass; `drive()` handles it.
- **The engine's AI blocks.** An attack is not a promise of damage; test
  the declaration.
- **The engine's seat needs a deck** or it loses at its first draw.
- **`cards.scryfall.io` is where the engine's image links point**, not the
  API host; specs route it to a pixel, and offline the drawn face stands in.
- **A fanned hand covers the centre of a card** once past seven cards; hit-test
  for an uncovered point before clicking (the spec helpers do).
- **`vitest` runs most files under jsdom**, where `import.meta.url` is not a
  file URL; a Node-only test says `// @vitest-environment node` on its first
  line, and a jsdom test resolves fixtures from `process.cwd()`.
- **An engine given as a `.mjs` path** is run by Node from the bridge; that
  is how the fake engine works in CI.
- **A relay's ping and a proxy's idle timeout**: 30 s against 60 s; keep it.
- **Never rebuild during the browser suite; never run two browser jobs at
  once.** Both produce timeouts that look like real failures.

---

## 6. Open questions for the owner, to ask when each is reached

- M1: answered on 2026-09-21. Both: the lobby offers the engine without
  those cards, and the table alone (§3, item 10).
- M3: answered on 2026-09-24. Intermediate, with easy and hard a choice
  away in the lobby (§3, item 13).
- M8: which provider, once `HOSTING.md` has verified notes for three.
- M10: which desktop platform first (the owner's own), and whether a
  signed build matters yet.

---

## 7. Appendix — the wire, in one place

Between the browser and the relay, over the room's socket, all
`{ t: "engine", op }`: `sit { name, deck, sideboard?, seat?, deltas?, level?, answers?, mulligans? }`,
`act { stop, index, attackers?, blockers?, targets?, x?, damage?, cost?, auto?, cards? }`, `decide { stop, … }`, `turn`,
`resync`; back: `seated { seat, engineSeat, sideboardLeftOut, unknownPrintings, level?, ai?, choices? }`,
`seats`, `status`, `view { you, seq, state | delta, log }`, `refused { error, stale?, answering? }`, `gone`.
Over HTTP, before any room: `POST /engine/check`.

M4's second half added the opening hand (protocol 6 on the process's side). A
sit says `mulligans: true` where that build can show a mulligan; the room keeps
it until the deal, and asks the engine for a mulligan phase only where every
person at the table said so and the engine speaks 6. The first statuses then
offer `KeepHand` and `TakeMulligan`, and after keeping with mulligans taken,
`BottomCards`, each with the engine's own numbers (`mulligans`, `bottom`,
`draws`, `candidates`); `act` carries the cards put on the bottom as `cards`,
passed through untouched. `GET /rooms/<code>` says `mulligans` once dealt. A room
that asked for none, or an engine at 5, deals every hand kept, as before.
M4's review added, without a new number, `placement` and `library` on a
`ReorderLibrary` decision: which end of a library the cards go to, and whose;
a client reading an engine without them says only that the first ends up
highest.

M4 added choosing (protocol 5 on the process's side). A sit says `answers`,
the decisions that build can show; the room keeps them until the deal and
passes them for that seat alone, and only to an engine at protocol 5. Every
`seated` after the deal to a person's seat then says `choices: { act, costs,
decisions }` — what that seat's `act` may carry, the costs it can pay with a
choice, and the decisions it will be asked, all in the engine's words. A
`seated` without `choices` — an older relay, or an engine at 4 — means the seat
may choose nothing, and the client holds back what it cannot send, as before.
`act` passes `targets`, `x`, `damage`, `cost` and `auto` through, and `decide`
its new shapes, untouched. The status still goes to every seat, but a
decision's `cards` — the faces of cards only the deciding seat may see, a
library's top looked at — are left out of every other seat's copy.

M3's review added three small things, each read forgivingly where it is
missing. `seated` after the deal says `ai`, the kind of player the engine
fields there (heuristic, random, or null for none), because only a heuristic
one has levels and a null `level` means "plays one way" only where it could
have had one. A refusal of the room's one-move guard says `answering: true`,
and a client takes it down at the next status, since the answer on its way
makes it untrue. And `GET /rooms/<code>` says `dealt` beside `started`: an
engine is started some seconds before it deals, while the corpus loads.

M3 added the level. It is a setting of the room: `POST /rooms { …, level }`,
and a `sit` naming one changes it until the deal. The room asks the engine for
it for its own seat only where the engine speaks protocol 4, and every
`seated` after the deal (the one carrying an `engineSeat`) says `level`: the
level the engine took, or null where it plays its one way. A `seated` from a
relay older than levels has no `level` key at all, and the table says so rather
than name the level chosen. The engine's entry in `seats` carries `level` too,
and `GET /rooms/<code>` reports `level` (asked) and, once dealt, `played` and
Argentum's `profile`. A room nobody asked a level of asks the engine for none,
which is how a tab from before levels keeps the engine it had.

M2 added `resync`, `deltas` on the sit, and the shape of a view. `deltas: true` on
the sit asks for them; without it every view comes whole, which is what an
older build in an open tab still gets. `seq` counts per seat from 1 and never
resets. A view carrying `state` is the table whole and its `log` is that
seat's whole log — *replace* both. A view carrying `delta` is Argentum's
`StateDelta` against the view before it and its `log` is only the lines added
since — *apply* and *append*. A delta is taken only where `seq` follows; on
any gap the client sends `resync` and is answered whole with the next number,
and asks again if enough deltas go by unanswered for the ask itself to look
lost — `resync` is answered the same way however often it arrives. A room
that fails to send a seat a view asks for that seat's next one whole, because
the process has already moved that seat on by building the reply.
`status` may now say `waiting: "engine"` with `actor` the engine's seat and no
`actions` and no `decision`: that is a stop of the engine's own, one per play
of its, arriving mid-turn. A room's pace is `POST /rooms { …, pace }` (`false`
or `0` restores the one-jump turn, anything else is clamped to 10 s) or
`createRelay({ pace })`, default 600 ms; `GET /rooms/<code>` reports `pace`
and `paced`.

Between the relay and the process, JSON lines: `hello`, `cards`, `new`,
`turn`, `act`, `decide`, `view`, `quit`; M1 added `check`, M2 `continue` and
`pace` on `new`, M3 `level` on a player in `new` (and `profile`, for
measurement), `levels` in `hello` and `clock`; M4 `answers` on a player in
`new` and `asked` on its seat in the reply, `choices` in `hello`, `targets`,
`x`, `damage`, `cost` and `auto` on `act`, and a `decide` shape for each
decision it can ask; M4's second half `mulligans` on `new` and in its reply,
and `cards` on `act`; M7 will add `snapshot` and `restore`. `engine/README.md`
is the contract and is updated with every op added. `PROTOCOL` is 6 since M4's
second half; an engine at 5 ignores `mulligans`, so a relay reading 5 asks for
none. An engine at 4 ignores every key choosing travels in, so a relay reading 4
sends no `answers` and tells no seat it may choose. An engine at 3 has no
levels and ignores the key, so a relay reading 3 asks for none and says the
engine plays its one way.

`pace` on `new` is `true` or a number of milliseconds, and the reply says
`paced: true` only where the engine took it. A paced table stops as soon as
its own seat has made a play worth watching and answers `waiting: "engine"`;
`{"op":"continue"}` takes the next step. The engine never sleeps: every wait in
wall-clock time is the relay's. The pace came with protocol 3, and an engine at
2 has neither a pace nor a `continue`, so a relay reading 2 must ask for neither.

The status shape, and what `meaningful`, `card`, `mana`, `additionalCost`,
`targetRequirements`, `x`, `divide`, `costChoice`, `autoPassed` and `decided`
mean, and how each decision is described and answered, is in `engine/README.md`. The board the screen draws is the
one in `src/lib/board/model.js`, unchanged by any of this; `board.engine`
carries what the model has no word for (priority, phase, over, winner).
