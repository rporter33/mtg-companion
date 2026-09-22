# mtg-companion — project brief

A complete handoff document: what this is, how it is built, what holds it
together, and what is left to do. Written to be read by someone (or
something) that has never seen the repository and needs to work on it.

- **Repository:** `github.com/rporter33/mtg-companion` (branch `main`)
- **Live:** https://rporter33.github.io/mtg-companion/
- **Licence:** MIT. Card data and images come from Scryfall under the Wizards
  of the Coast Fan Content Policy.
- **As of:** commit `cbb3713`, 83 commits, ~23,000 lines of JS/JSX in `src/`.

---

## 1. What it is

A local-first companion for *Magic: The Gathering*, running as a static
progressive web app. It does five things, one per tab:

| Tab | What it is |
| --- | --- |
| **Learn** | Three ways in for a new player: a scripted first game played on real cards, a glossary that explains any term in place, and lesson tracks. |
| **Cards** | Scryfall search with filters, sorting, paging, a card sheet with rulings, printings, prices and a plain-English explainer of the card's text. |
| **Decks** | A format-aware deck builder: list, grid and text views, sections, legality, mana and curve analysis, a coach, sample hands, version history, import/export, and a guided four-step first-deck flow. |
| **Table** | Your own deck dealt onto a table that enforces nothing — drag cards where you like, tap them, point at things, make tokens. |
| **Play** | A life counter for games with physical cards: 1–6 players, commander damage, poison/energy/experience, a turn tracker, dice, full undo. |

There is also a **Practice** screen at `#/practice`, reached by address, which
is the opposite of the Table: a rules-enforced teaching engine over a small
pool of cards.

**Local-first** is not a slogan here. There are no accounts and no server.
Everything a person makes lives in their browser's `localStorage`, card data
is cached in IndexedDB, and a service worker precaches every view so the
whole app works with no connection. A migration that loses a deck loses it
for good, which is why the storage code is written the way it is.

---

## 2. Running it

```bash
npm install
npm run dev        # vite dev server
npm run build      # -> dist/
npm run preview    # serve the build on :4173

npm test           # 1073 unit tests, 50 files, vitest + jsdom
npm run build && npx vite preview --port 4173 --strictPort &
npm run test:browser   # 24 Playwright specs against the built app
```

Node 22. React 18, Vite 6, Vitest 5, Playwright — no other runtime
dependencies. No TypeScript, no CSS framework, no state library, no router
library. That is deliberate: the app is small enough that each of those would
cost more than it gives.

Scripts that talk to the live Scryfall API (run by hand, never in CI):

| Script | What it checks |
| --- | --- |
| `npm run validate:live` | The Scryfall client against the real API. |
| `npm run firstdeck:verify` | Every card name and search the first-deck flow relies on. Adaptive rate-limit pacing; see §11. |
| `npm run tutorial:verify` | The bundled tutorial cards still match Scryfall. |
| `npm run examples:verify` | The example decks. |
| `npm run coach:measure` | How well the deck coach categorises cards. |
| `npm run perf:measure` | Editor performance at real deck scale. |
| `npm run tokens:check` | The CSS tokens against the design documents. Run after any change to `docs/` or `src/styles/tokens.css`. |

---

## 3. The rules that hold

These are enforced by review and, where possible, by tests. They are the
reason the app reads the way it does.

1. **Nothing is invented.** Card names, prices, popularity and legality come
   from Scryfall. Anything the app worked out itself says so on screen and
   says what it assumed.
2. **The app draws its own card faces and mana symbols.** It shows Scryfall's
   images under the Fan Content Policy but never reproduces card frames,
   set symbols or logo art.
3. **Observations, never verdicts.** The coach, the analysis and the table's
   notes describe what is true and let the player decide. Approximations are
   labelled as approximations, next to the number.
4. **Every change runs `npm test` and `npm run test:browser`.** CI gates the
   deploy on both.
5. **Accessibility is a test, not an intention.** `tests/browser/a11y.spec.mjs`
   sweeps every view and ~20 states that only exist after interaction with
   axe-core; critical, serious and moderate violations all fail the build.
   Anything communicated by colour, rotation or motion is also communicated
   in words.
6. **Nothing animates without a reduced-motion path.**
7. **Offline is a guarantee.** A view that is code-split must also be
   prefetched, or it will not be in the cache when the connection goes; the
   `bundle` spec checks this.

---

## 4. Architecture

Three layers, strictly separated:

```
src/lib/        pure logic — no React, no DOM, heavily unit-tested
src/components/ shared presentational components
src/features/   one directory per tab; views, screens, feature CSS
```

`src/lib` is where the thinking lives. A rule of thumb that has held: if a
function needs a browser to be tested, it is in the wrong file.

### Directory map

```
src/
  App.jsx              the shell: tabs, lazy views, card sheet, banners, theming
  main.jsx             mount + service worker registration
  lib/
    scryfall.js        the API client: serial queue, retry, IndexedDB cache
    cache.js           the IndexedDB card/query cache, with pinning
    storage.js         everything a person owns; schema, migrations, per-deck docs
    storage-backend.js localStorage with a memory fallback and quota detection
    router.js          hash routes, parse/build/patch, useRoute
    deck.js            the deck shape and every operation on it
    formats.js         the ten supported formats and their rules
    analysis.js        curve, colours, mana sources, sample-hand odds
    probability.js     hypergeometric maths
    coach.js           the deck coach
    classifiers.js     what a card *does*, from its text
    first-deck.js      the guided first-deck flow's logic
    goldfish.js        seeded shuffling and sample hands
    collection.js      what the player owns, keyed by oracle id
    versions.js        deck history and diffs
    prices.js, query.js, explain.js, mana.js, categories.js, folds.js, …
    table/             the RULES-ENFORCED practice engine (see §6)
    board/             the RULES-FREE table (see §6)
  data/                curated content: lessons, glossary, tutorial, colours,
                       strategies, practice cards and decks, set themes
  features/
    cards/ decks/ guide/ play/ practice/ table/
```

### Conventions

- **Comments explain *why*, never *what*.** Every non-obvious file opens with
  a paragraph on the decision it embodies. This is the single most important
  convention in the repository — a reviewer should be able to read the
  comments alone and understand the design. Do not write comments that
  restate the code.
- **Prose in the UI is written, not templated.** No "Item added
  successfully!". Sentences, in British English, that say the true thing.
- **CSS is plain CSS with custom properties**, one stylesheet per feature,
  design tokens in `src/styles/tokens.css`. **Every view's CSS ends up in one
  document**, so class names must be namespaced per feature — this has bitten
  us (§11).
- **State is `useState` and the URL.** There is no store.

---

## 5. Data

### Scryfall client (`src/lib/scryfall.js`)

- One serial request queue with a minimum gap between calls, honouring
  `Retry-After` on 429. It has two lanes: a request marked `background` goes
  only when no foreground request is queued, and is asked once (no retries;
  a 429 is still waited out before the line moves on), so a refresh never
  holds up a search. A background request that fails pauses the background
  lane (until the lockout ends after a 429, five minutes after a 5xx or an
  unreachable Scryfall); background requests made meanwhile are refused
  unsent, foreground ones go as ever.
- Every response is cached in IndexedDB (`cache.js`); deck cards are *pinned*
  so they survive eviction, which is what makes a deck built at home open on
  a phone with no signal.
- **Saved cards are refreshed** (2026-09-21). `refreshDue` in
  `card-refresh.js` says when a cached record is due: older than a week;
  fetched before its card's release day began (UTC) once that day has come;
  or, in the week after release, older than a day, the app's own choice,
  since when Scryfall gives a new set its legalities after release is not
  known. `getCardsByIds(ids, { refresh })` (and `getCardRecordsByIds`, which
  also gives each record's `fetchedAt`) and `refreshCards` fetch due records
  again by id, 75 at a time, in the background lane, filling a last batch
  with room in it with records a day old or more, oldest first, so a deck's
  records fall due together. A cached id Scryfall lists as `not_found` keeps
  its copy, with `checkedAt` noted on it (`markCardsChecked`), and is asked
  about again a week on; an id never saved is remembered for a day
  (`notfound:<id>` in the query store). An open deck shows the cache at once
  and redraws if anything came back (`useDeckCards`); the launch legality
  watch fetches each deck's missing cards, then refreshes every deck's cards
  in one pass, stops asking after a failure, and gives the date of the
  oldest data it compared.
- `searchCards`, `getCardById`, `getCardByName`, `getCardsByIds` (chunked to
  75 per call), `getCardsByNames`, `getPrintings` (`oracleid:` +
  `unique=prints`), `getRulings`, `getSets`, `randomCard`.
- Errors are typed: `ScryfallError`, `OfflineError`. Partial results are
  returned rather than thrown — a deck with two unresolved cards still opens
  and says which two.
- **Released first** (2026-09-21). `resolvePrintings` is the one way a card
  named in text becomes a printing, and `getCardsByNames` is its name-keyed
  form. A printing someone typed (set and number, or set alone) is kept,
  released or not. For a bare name, Scryfall's pick stands if it is out on
  paper; if it is not out yet or digital-only, the newest released paper
  printing of the same card is taken instead (`oracleid:` batches of fifteen,
  `date<=now game:paper lang:en prefer:newest`), and the import review says
  so. Whether a printing is out is worked out from Scryfall's `released_at`
  and today's date each time it is shown (`src/lib/release.js`), never
  stored; the "Not out until …" chip (`NotOutChip`) and the legality wording
  (`legalityStatus` in `formats.js`) clear themselves on release day.

### Storage (`src/lib/storage.js`)

`SCHEMA_VERSION = 4`. The root blob lives at `mtg-companion:v1`; **each deck
is its own document** at `mtg-companion:v1:deck:<id>`, so saving one deck does
not rewrite all of them.

```js
{
  version: 4,
  collection: {},                 // oracleId -> count owned
  decks: [ /* assembled from the per-deck documents */ ],
  games: [],                      // saved life-counter games
  guide: { completedLessons: [], tutorialState: null, seenGlossary: [] },
  practice: { runs: {}, paper: {}, evidence: {} },
  table: { saved: null },         // one saved board, whichever deck was last played
  prefs: {
    // defaulted in EMPTY
    market: 'usd', currency: 'usd', showCardImages: true,
    lastFormat: 'commander', sortId: 'name', sortDir: null,
    tableCoach: true, tableSound: false,
    // written by setPref when the person chooses, absent until then:
    // deckView, reduceMotion, lastExportedAt, …
  },
}
```

Rules that matter:

- **Migrations are additive and run in order**, and the version only moves
  once its step has run. State written by a *newer* build is left alone
  rather than forced backwards — a stale service worker can serve an old
  bundle against new data.
- Unparseable JSON is set aside under `<key>:corrupt` rather than
  overwritten.
- A refused write (quota) fires `PERSIST_FAILED_EVENT`; the app shows a
  banner that stays until reload, because until then nothing on screen is
  known to be durable. Quota pressure first tries dropping the oldest
  automatic version checkpoints and says so (`ROOM_MADE_EVENT`).
- `exportAll` / `importAll` are the backup path; import merges rather than
  overwrites, and keeps both copies on an id collision.

### The deck shape (`src/lib/deck.js`)

```js
{
  id: 'deck_xxx', name, formatId,
  commanders: [cardId],           // Scryfall PRINTING ids, not oracle ids
  signatureSpell: null,           // Oathbreaker
  main:      [{ cardId, quantity, category? }],
  sideboard: [{ cardId, quantity }],
  categoryOrder: [], versions: [],
  artCardId?, faceCardId?,        // chosen and derived deck art
  createdAt, updatedAt,
}
```

`cardId` is a *printing* id throughout, which is what makes choosing art
possible. `swapPrinting(deck, fromId, toId)` swaps one for another and merges
entries if the deck already held the target.

Ten formats in `src/lib/formats.js`: Standard, Pioneer, Modern, Legacy,
Vintage, Pauper, Commander, Duel Commander, Brawl, Oathbreaker — each with
deck size, singleton rules, commander rules and a Scryfall legality key.

### Routing (`src/lib/router.js`)

Hash routes, because GitHub Pages serves one file:

```
#/guide  #/guide/game  #/guide/glossary  #/guide/track/<id>  #/guide/track/<id>/<lesson>  #/guide/lesson/<id>
#/cards?q=<search>
#/decks  #/decks/new  #/decks/new/<step>  #/decks/data  #/decks/<id>  #/decks/<id>/<tab>
#/play
#/practice  #/practice/<scenario>
#/table  #/table/<deckId>
```

plus `?card=<id>` on any route for the card sheet, which is an *overlay*
rather than a place: opening it pushes a history entry so Back closes it.
`parseRoute` / `buildHash` / `withPatch` are pure and tested; only
`useRoute`/`navigate` touch the window.

---

## 6. The two table engines

This is the central design idea of the project, and the thing most worth
understanding before changing anything.

### `src/lib/table/` — the practice table (rules enforced)

A small deterministic model over a **fixed pool of 19 cards**
(`src/data/practice-cards.js`, each with a hand-written `rules` block). It is
not a rules engine; it is a teaching engine that knows a few cards
completely.

- `applyAction(state, action)` → `{ok: false, reason: {code, message}}` or
  `{ok: true, state, events}`.
- Zones, instances with identity, a mana pool, the stack, priority, combat
  steps, state-based actions, cleanup.
- **What it does not model is listed by name** in `mechanics.js` and refused
  by name — the honest alternative to silently mis-resolving a card.
- Lessons are exercises whose goals are judged from consequences, each asking
  for a prediction *before* the moment it is about. Evidence is kept as
  `viewed` / `practiced` / `demonstrated`, where demonstrated means two
  distinct scenarios completed with zero hints.
- The saved run is the **action log**, which replays to the same state, so a
  reload resumes and a replay shows the table as it was.
- `motion.js` derives animation from the model's events (`narrate()`,
  `cuesFrom()`), so motion can be reduced without changing what the screen
  says.
- Free play is a whole game from the same model: 30-card practice decks, a
  London mulligan, solo against a policy whose rules are printed on screen,
  or two people passing one device.

### `src/lib/board/` — the free table (rules *not* enforced)

The opposite, deliberately. It holds **where every card is and what has been
done to it, and never what a card does**. That single restriction is what
lets *any* card on Scryfall be played the moment it is fetched, including
cards nothing here could parse. The player enforces the rules, exactly as at
a kitchen table.

```
geometry.js  positions as fractions of the field; hit tests, free spots, tidying
model.js     zones, instances, invariants
reducer.js   pure apply(board, action) -> { board, events }
coach.js     the only thing here that mentions a rule, and it only ever speaks
runner.js    event log, bounded undo (40), snapshot save
deck.js      a stored deck becomes one `seat` action
art.js       what a printing is, from Scryfall's own fields
sound.js     synthesised card sounds
```

**The board's state:**

```js
{
  version: 1, players: ['you'], seed, turn, active, step,
  life: {you: 20}, counters: {you: {}},
  cards: { [instanceId]: {
    id, cardId, owner, controller, zone,
    x, y,            // fractions of the battlefield
    tapped, faceDown, flipped, counters: {}, note,
    token, custom,   // custom = a blank card: { name, typeLine, power, toughness }
    attachedTo,      // an aura on a creature: position, not rules
    finish,          // 'normal' | 'foil' | 'etched'
    enteredOnTurn, z,
  }},
  zones: { you: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] } },
  revealed: [], arrows: [], dice: [], notes: '',
  nextZ, nextId, seq, events,
}
```

**Actions** (all physical, none consult a rule): `seat, draw, move, tap,
untapAll, flip, counter, finish, reprint, life, playerCounter, shuffle,
fromTop, reveal, makeToken, attach, detach, arrow, clearArrows, roll, tidy,
step, setGuided, setTurn, nextTurn, note`.

**The playmat.** `src/lib/board/placement.js` reads a Scryfall type line and
answers which row a card belongs in — `siege` (planeswalkers and battles),
`creatures`, `other` (artifacts and enchantments), `lands` — or `null` for a
card that never stays on the battlefield at all. The board carries the answer
as `lane` on each instance, stamped when the card is dealt and carried *in the
seat action*, so the reducer still knows nothing about what a card is and a
replay on another device reaches the same table. With `guided: true` a card
snaps to its row's y (x stays free) and a card with `lane: null` is refused
the battlefield; with `guided: false` none of that applies and the table is
the bare one it started as.

**The stack** is a zone like any other. Dragging a non-permanent out of hand
puts it there rather than on the battlefield, and resolving it sends it to the
battlefield or the graveyard depending on what it is.

**The turn** is walked, not enforced: `src/data/turn-structure.js` holds the
five phases and thirteen steps transcribed from `docs/TURN_STRUCTURE.md`, and
the `step` action moves through them, skipping the first-strike damage step
unless the caller says something in combat has it (510.4).

**The only refusals are physical impossibilities**: `emptyLibrary`,
`noSuchCard`, `noSuchZone`, `notOnBattlefield`, `cannotShuffle`, `noSuchEnd`,
`sameEnd`, `wouldLoop`, `notAttached`, `needsACard`, `noSuchFinish`,
`noSuchPlayer`.

Design decisions worth keeping:

- **A token that leaves the battlefield ceases to exist** and says so, as it
  would in paper — it is not filed in a graveyard.
- **Leaving the battlefield forgets everything that only meant something
  there**: tapped, position, counters, attachments.
- **Positions are fractions of a *square* field.** Square because only then
  does a position mean the same thing across and down — which is what makes a
  board arranged on a phone open arranged the same way on a desktop, and
  survive a rotation. The leftover width on a wide screen goes to the piles,
  not to a stretched table.
- **Ids come off a counter on the board, not a module global**, and the only
  randomness is a seeded shuffle. Two devices replaying the same actions
  reach the same table — this is the groundwork for networked play.
- **`invariants(board)` is checked after every action in tests.** A failure
  is a reducer bug, never something the player did, because the player cannot
  do anything wrong on this table.
- **The coach** reads only Scryfall's own fields — is it a land, what does it
  produce, what does it cost, did it arrive this turn — so its notes work for
  a whole deck rather than for cards something has been taught. At most three
  notes at once, warnings first. Every note has a cross on it and one switch
  silences the lot.

The interface lives in `src/features/table/`: `TableView` (screen, piles, the
turn), `Field` (the battlefield and the arrow overlay), `BoardCard` (a card as
it sits on the table, with foil and treatment), `useDrag` (pointer dragging),
`Coach`, `TokenMaker`, and the shared `components/Printings.jsx`.

---

## 7. Testing

| Kind | Where | Count |
| --- | --- | --- |
| Unit | `tests/*.test.js`, vitest + jsdom + fake-indexeddb | 1073 in 50 files |
| Browser | `tests/browser/*.spec.mjs`, Playwright against a built preview | 24 specs |
| Accessibility | `tests/browser/a11y.spec.mjs` | axe-core over every view + ~20 interaction states |
| Bundle | `tests/browser/bundle.spec.mjs` | code splitting, the offline prefetch, the build stamp |
| Live | `scripts/*.mjs` | run by hand against the real Scryfall API |

The browser specs are plain Node scripts, not a test framework: each one
launches Chromium, routes `**/api.scryfall.com/**` to fixtures, seeds
`localStorage`, drives the UI and prints `PASS`/`FAIL` lines. They are chained
with `&&` in the `test:browser` script — **a new spec must be added to that
chain or it never runs.**

Things the browser specs have caught that unit tests could not: a routing
regression, a storage probe that served an empty store to a full browser, a
CSS class collision that rendered a whole view as a narrow column, a stale
line of copy, and a save debounce that never fired during real play.

---

## 8. Build and deploy

- `vite.config.js` uses a **relative base** (`./`), so the same build runs at
  any path — GitHub Pages under a subdirectory, a root domain, or `file://` —
  with no config change.
- Every build carries its commit and time as `__BUILD__` and writes the same
  stamp to `version.json` beside it. The running app checks for a newer build
  on load and when the tab comes back into view, and offers a reload. The
  question "did my change deploy?" is answered on screen.
- Views are code-split per tab and **prefetched on idle**, because a chunk
  the visitor never navigated to would not be in the service worker's cache
  when they go offline.
- React is its own chunk so shipping an app fix does not re-download the
  framework.
- `.github/workflows/deploy.yml`: on push to `main`, run `npm test`, build,
  install Chromium, run the browser suite against the built preview, then
  deploy to GitHub Pages. A red suite does not deploy.

Approximate gzipped sizes: entry 39 kB, React 46 kB, Decks 24 kB, Practice
30 kB, Learn 20 kB, Table 16 kB, Play 4 kB.

---

## 9. What is built

Condensed history; each line was a commit with its own tests.

**Foundations** — Vite PWA scaffold, the logic layer, the Scryfall client and
cache, card reference, deck builder, life counter, the three-layer guide.

**Depth** — live validation harness, legality snapshots and change detection,
set-aware theming, card zoom with pinch and pan, search filters and paging, a
plain-English card-text explainer, the deck coach, URL-aware deck import,
commanders browser and example decks, an accessibility audit, bundle
splitting, custom deck categories with a migration, deck grid and text views,
sample hands and goldfishing, the collection and wants list, deck version
history with diffs, data-safety work (quota, backup, corrupt-state rescue),
performance at real deck scale, import of Archidekt and Moxfield exports,
build-version awareness, hash routing, per-deck documents, deck art.

**First deck (M1–M6)** — a guided four-step flow: a colour dial with pair
names, play-style toggles, curated first commanders verified by script,
staples by role under a budget, a strategy step with named plans per colour
pair and a reason printed next to every card, resumable across reloads, and a
60-card path for the non-Commander formats.

**Learn (M0–M5)** — the rules-enforced practice table: the mana lesson,
motion derived from events, coaching and paper prompts, combat and responses,
the practice home with evidence kept apart, the colour explorer, and free
play — a whole game solo against a policy or two players at one screen.

**Table (T0–T4a)** — the free table: the board model, the solo table with any
deck, physicality (arrows, attachments, counters, face-down, dice, sound) and
the quiet coach, art (printings, treatments, foils with tilt, tokens and blank
cards), and the marked playmat with the stack and the turn tracker. The
printing picker is in the deck editor too.

---

## 10. What is next

### Released-first printings (slice 1 built, 2026-09-21)

The problem: a card added by name alone took Scryfall's pick, which during
every preview season can be a set that is not out (on 2026-09-21 a bare
"Island" became Star Trek's, due 13 November), and nothing checked release
dates. The owner chose, on 2026-09-21: when the app must pick, the newest
released paper printing, with no style filters; copied decklists carry set
and collector number; nothing in a deck is rewritten behind the player's
back; a card that is not out is labelled, never hidden or blocked; a newly
released set stays the season's focus until the next one is nearer in days;
the rules engine moves to new sets by a pull request the owner merges, once
CI builds the engine.

**Built (slice 1):** the rule in `resolvePrintings` (typed printings kept,
`{name, set}` for a set without a number, two printings of one card kept as
two lines, a released-first pass for the app's own picks, failures that
never block an import and never swap a typed printing); the import review
saying how each printing was chosen; the "Not out until …" chip on search
tiles, card detail, the printings picker, deck rows, Add cards and missing
prices; printings ordered released first; deck face art preferring cards
that are out; legality that never promises what Scryfall has not said
(`pending`, and `future_legal` from Scryfall's Future Standard; Standard's
search takes `legal:future` in); a verdict that says "N cards not out yet"
rather than "Legal"; copy limits counted per card across printings;
exported decklists carrying `(SET) NUM`, with The List and lettered Secret
Lair numbers now parsed. Checked by `tests/release.test.js`,
`tests/scryfall-names.test.js`, `tests/printing-choice.test.js`,
`tests/not-out-legality.test.js`, `tests/decklist-export.test.js` and the
browser spec `unreleased.spec.mjs`, which fixes the page's clock on
2026-09-21 and 2026-11-13.

**Built (slice 2, card refresh):** saved cards are fetched again when due
(see §5, "Saved cards are refreshed"), so a Reality Fracture card saved
before 2 October reads Scryfall's word after it. In the week after a card's
release a `not_legal` from a record that lists the card in no paper format
(not legal, banned or restricted in Vintage, Legacy or Commander, as
Scryfall lists every new card before release; `listedInPaper`) is
`catching_up` in `legalityStatus`. A record that lists it somewhere is
Scryfall's word since release, so a Commander product's card in Modern or a
rare in Pauper is `not_legal` at once; so are a reprint outside Standard and
Future Standard's `not_legal` in Standard. `catching_up` is a warning saying
only what the data on this device shows, with no "yet" and no promise:
"Not known here" on the Legality tab, a "legality not known" chip in Add to
deck, and "N cards with legality not known" on the verdict; after the week
it is an error again. The legality watch does not announce `not_legal` to
`legal` for a snapshot entry read from a record that listed the card
nowhere (`listedNowhere`, so a snapshot saved again after release from a
stale record, offline or on a failed refresh, still counts), nor, for an
unmarked entry, from a snapshot taken before the end of the card's release
week; it re-reads each deck before saving its snapshot so an edit made
while it ran is kept. Checked by `tests/card-refresh.test.js`,
`tests/legality-watch.test.jsx`, `tests/deck-cards.test.jsx`,
`tests/snapshot.test.js`, `tests/not-out-legality.test.js` and the browser
spec `refresh.spec.mjs`, which saves a Modern deck on 2026-09-21 and opens
it at 00:30 UTC on 2026-10-02 (the weekly rule), then a Standard deck saved
at 20:00 UTC on 2026-10-01 and opened at 10:00 UTC on 2026-10-02 (the
release-day rule alone: the Mountain is not asked about) twice, once with
Scryfall listing the new card as legal and once still as before release.

**Built (slice 2, season and curation):** `findSeason` returns the
`focus` by the owner's rule: the latest released set stays the focus until
the next set is nearer in days, and on a tie the released set stays
(Reality Fracture from its preview season through 23 October 2026, Star
Trek from 24 October). While a released set is the focus the banner shows
its "Latest set" view, "Browse the set" and the set that follows it, and the
Commanders guide opens on it. Whether curated content is provisional is
worked out from the focus set's release date in Scryfall's set list
(`src/lib/curation.js`), never from a date in code; the entries' own
`provisional` flags are kept and read only when that date is unknown. After
release the banner and "What's new" say "Written on … from previews, before
release on …; not yet checked against the released cards" until the owner
adds `checkedAt` to the entry, which makes it "checked against the released
cards on …" from that day on (a date still to come is not a check yet). The
banner gives its dates in one form ("2 Oct 2026") and, having said
"Released …", leaves the date out of the note. `LORE_SET` is gone: the
first-deck flow shows a set's schools only while the shell wears that set's
theme (`useThemeSet`, which App sets from the season engine through
`themeSetFor`), so Hexhaven is not presented as current once the focus
moves on; App publishes the set's release date beside it
(`data-theme-set-released`, `useThemeRelease`), and a note under the
schools says they are the app's reading, when they were written and how
current they are, as the banner does. Checked by `tests/season.test.js`,
`tests/curation.test.js`, `tests/set-themes.test.js`,
`tests/set-mechanics.test.js`, `tests/first-deck-lore.test.jsx` and the
browser spec `theme.spec.mjs`, which holds the page's clock on 2026-09-21,
2026-10-02, 2026-10-22 and 2026-10-24.

**Built (slice 2, Standard's pool and the engine's reasons):** the coach's
suggestion searches and the first deck's commander and staple searches
build their format term with `poolQuery`, so in Standard they take in the
cards Scryfall's Future Standard names, as the deck search does. At the
engine's table, `POST /engine/check` also returns `engineSets`, the sets the
checking engine's hello lists (codes as the engine gives them, and whether
it marks each incomplete; its own release dates are not passed on), and
`verdictOf` gives each card the engine does not know a reason from the set
of the printing the deck holds, codes compared without regard to case: "The
rules engine has no Reality Fracture cards yet" for a set it does not list,
"… has Star Trek Commander only in part, and not this card yet" for one it
marks incomplete, "… does not know this card" for one it has. The engine
knows cards by name from any set, so a reprint (a Secret Lair or The List
printing) in a set it does not list is "… does not know this card", not
that set's fault. With no set
list or no record the card is "Not known", as before, and nothing estimates
when a set will reach the engine. The tile and the deck gate list the cards
under their reasons, one line per reason. Checked by `tests/coach.test.js`,
`tests/first-deck.test.js`, `tests/engine-deck.test.js`,
`tests/relay-server.test.js` (the fake engine's hello lists Portal, Star
Trek Commander marked incomplete, and The Hobbit, as the built engine's did
on 2026-09-21) and the browser spec `game-engine.spec.mjs` where an engine is
built.

**Next (slice 2, the rest), before 2 October if it can be:** an optional
"Find released printings" for decks imported before this; stamping names on
deck entries so a preview id Scryfall later merges or deletes stays
readable, with `/cards/migrations` followed on a 404; the Archidekt URL
fetch keeping printings; printings past the first 175.

### T4b-1 — the replication protocol and transport (built)

`src/lib/board/net.js` is host-authoritative replication over the board's
action log: `hello / welcome / intent / action / refused / resync / seat / bye`,
every applied action numbered, a gap triggering a resync rather than a guess,
and one ownership rule (you may move what you control). `loopback()` in the
same file is a wire in memory, which is how the whole protocol is tested
without a browser or a network.

`src/lib/board/webrtc.js` is the same `{ send, onMessage, close }` shape over a
WebRTC data channel, plus the signalling client. `scripts/signal-server.mjs`
is the service: `POST /rooms`, `POST /rooms/<code>/from/<who>`,
`GET /rooms/<code>/to/<who>?since=<n>`, with held requests instead of polling
loops. `tests/browser/together.spec.mjs` connects two real browsers through it
and asserts that nothing about the game was relayed.

### T4b-2 — seats and the shared table (specified, not built)

The model and the protocol are multi-seat already; the interface is not. What
is left: two battlefields on screen rather than one (each player's own square
field, the opponent's mirrored so their lands are nearest them), hands that
only their owner can see, the room panel for hosting and joining, and hot seat
— one device passed around, which needs no transport at all and is the
cheapest way to prove the multi-seat UI.

### T4 — two devices (specified, not built)

The user's decision, already made: **one tiny signalling service, then
peer-to-peer.** Both "a table plus everyone's phones" and "two players over
the internet" ride the same transport.

The groundwork is already in place and is the reason the board is written the
way it is: every action is small, serialisable, free of any clock, and the
only randomness is a seeded shuffle, so **two devices applying the same
action log reach the same board**.

What has to be built:

1. **A signalling service** — the smallest possible: hand out a room code,
   relay WebRTC offers/answers/ICE between the peers in that room, forget
   everything when they connect. No game state ever passes through it. A
   single serverless function is enough. *The user has deferred deploying
   this; build and test it locally first.*
2. **A transport** (`src/lib/board/net.js` or similar) with one interface and
   two implementations: a loopback for tests, and WebRTC data channels.
3. **Action replication.** One peer is the table; others send *intents* and
   apply the actions that come back, so there is one order of events.
   Reconnection replays from the last snapshot plus the actions since.
4. **Two modes over the same transport:**
   - *Table plus phones*: one shared board on a big screen, each phone
     showing its own hand and holding its own private zones.
   - *Two players over the internet*: two seats, each with hidden information
     the other cannot read. Note the board is currently single-seat in the
     UI; `players` and per-player zones already exist in the model.
5. **Hot seat** — one device passed around — needs no transport at all and is
   the cheapest way to prove the multi-seat UI.

Open questions worth deciding before writing code: what happens when a peer
drops mid-turn; whether the table's host is authoritative or whether actions
are commutative enough not to need one; how much of the log to keep for a
reconnect.

### T5 — hardening

Performance with a 100-card deck and real images on a mid-range phone; an
accessibility sweep of everything T2–T4 added; offline behaviour for the
table; an observation script for watching a real person use it; and the
portfolio write-up.

### Backlog

- The practice table has never been watched being used by a novice.
  `docs/LEARN_EVALUATION.md` is the script for doing that;
  `LEARN_PROGRESS.md` records that nothing has been observed yet. Every claim
  about whether it teaches is unverified until then.
- Integrating Practice into the Learn tab is a separate decision — it is
  reachable by address only.
- The colour explorer has a fluid treatment waiting on a prototype's source.

---

## 11. Traps

Things that have actually gone wrong here. Worth reading before changing
anything in the same area.

- **Every view's CSS lands in one document.** `.board` already belonged to the
  life counter; the free table's use of the same name rendered it as a narrow
  column. Namespace per feature (`tabletop__`, `deck-row__`, …).
- **A plain debounce never fires during real use.** The table's save was
  debounced at 700 ms while a board being played changes every few hundred
  milliseconds, so it never wrote. It now also has a deadline: settle
  briefly, but write anyway once a couple of seconds have passed.
- **Playwright gives precedence to the route registered *last*.** A catch-all
  `**/api.scryfall.com/**` must be registered *first* or it swallows every
  specific mock below it.
- **The page itself does not scroll** — `.app__main` does. `window.scrollTo`
  is a no-op; use `scrollIntoView`.
- **Scryfall rate limits are not a fixed number.** The first-deck verifier
  now paces adaptively: it honours `Retry-After`, and doubles its own gap on
  every 429 up to five seconds.
- **`flex-basis` sizes the main axis.** A square element inside a column flex
  container takes its *height* from a basis, and its aspect ratio then
  derives the width from that — which collapsed the battlefield to a strip.
- **A card dropped with no position of its own must not land on the last
  one.** A free spot has to mean genuinely free; a pile is made on purpose,
  by dropping onto a card.
- **Rows in the deck editor are memoised** and the deck can be 100 cards. Any
  new per-row handler must be stable (`useCallback` with no deps), or a tap
  re-renders every row. This was measured at 145 ms a tap on a throttled
  phone before it was fixed.
- **A commander is not one of the ninety-nine.** Shuffling 100 instead of 99
  is off by one in every number the app produces, and it is the mistake every
  hand-rolled playtester makes first.
- **A name alone is Scryfall's pick, and Scryfall lists sets before they are
  out.** Its collection endpoint answers a name with its own choice of
  printing, which is not always the newest and can be a preview: a bare
  "Island" became a Star Trek printing two months before release. Go through
  `resolvePrintings`, never `getCardByName` or a raw `{name}` identifier, when
  a card enters a deck. And a test must never lean on today's date: every
  release check takes `now`, and a browser spec fixes the page's clock, or
  the suite changes its answer the day a set comes out.

---

## 12. Glossary for non-players

Enough to read the code.

- **Card / printing / oracle id** — the same card can be printed many times.
  Scryfall gives each *printing* an `id` and every printing of the same card
  the same `oracle_id`. This app stores printing ids, so a deck knows which
  physical card it means.
- **Zones** — library (deck), hand, battlefield (in play), graveyard, exile,
  command zone (where a commander starts).
- **Tapped** — turned sideways to show it has been used. Cards untap at the
  start of your turn.
- **Mana** — the resource. Five colours (W U B R G) plus colourless; lands
  produce it. A card's cost is written as symbols, e.g. `{2}{G}`.
- **Commander / EDH** — a format: a 100-card singleton deck led by one
  legendary creature that starts in the command zone and can be recast.
- **Summoning sickness** — a creature cannot attack or use an ability with
  `{T}` in its cost the turn it arrives, unless it has *haste*.
- **Mulligan** — redrawing your opening hand; under the London rule you draw
  seven again and put one card on the bottom per mulligan taken.
- **Foil / showcase / borderless / extended art** — treatments; different
  physical versions of the same card. Scryfall describes all of them in
  fields (`finishes`, `frame_effects`, `border_color`, `full_art`).
- **Token** — a card-shaped object created during a game that is not in
  anyone's deck, and ceases to exist when it leaves the battlefield.
