# Architecture

Why this is built the way it is, and when to revisit each decision.

## Shape

A React + Vite single-page app with no backend. Four features sit on a shared
logic layer and a shared data layer:

```
src/
  lib/          pure logic + I/O, no React
    mana.js         mana symbol parsing, pip counting
    formats.js      format definitions, copy limits, commander eligibility
    deck.js         deck model and per-format validation
    probability.js  hypergeometric maths
    analysis.js     curve, colour consistency, land advice, price
    game.js         play companion state as an event log
    scryfall.js     API client: rate limiting, retries, error shaping
    cache.js        IndexedDB card cache with pinning and eviction
    storage.js      localStorage for decks, games, guide progress
  data/         authored content (glossary, lessons, tutorial script + cards)
  components/   card rendering, mana symbols, sheet, glossary term
  features/     cards, decks, play, guide
```

Everything in `lib/` except `scryfall.js` and `cache.js` is pure and
synchronous, which is why 153 tests run in six seconds with no mocking beyond
`fetch`.

## Decisions

### Ban lists are read from Scryfall, not stored

Banned and restricted status comes from each card's `legalities` object at
validation time. Ban lists change on a rolling announcement schedule; a
hardcoded copy would be wrong within weeks, and wrong *silently* — the app
would confidently pass an illegal deck.

What is encoded in `formats.js` is only the structural stuff that effectively
never changes: deck sizes, copy limits, singleton, commander requirements,
sideboard sizes, starting life.

*Revisit if:* Scryfall changes its legality keys, or a format the app supports
stops being covered. Validation already reports `unknown` rather than passing
silently when a key is missing, so the failure mode is visible.

### The land recommender is calibrated, not derived from first principles

The obvious objective is "never miss a land drop". It is measurably wrong:

| Deck | Lands | Makes the drop |
|---|---|---|
| 60-card | 17 | 49.9% by turn 3 |
| 60-card | 24 | 78.9% by turn 3 |
| 100-card | 37 | 54.5% by turn 4 |

No real deck builds toward that target, and a recommender aimed at it asks for
27 lands in a 60-card deck. Solving instead for *at least two mana sources in
the opening seven* at an 85% threshold reproduces the accepted ratios — 24 for
60 cards, 16 for 40, 40 for 100 — and those three numbers are pinned as tests.
A curve adjustment of `2 × (avgMV − 2.75)`, clamped to ±4, moves the baseline.

Colour-source advice is solved the same way, from the deck's actual size, rather
than quoted from a published table. The answers land close to the community
tables; where they differ, deck size is usually why.

*Revisit if:* the app adds formats with very different deck sizes, or if a user
reports the recommendation disagreeing with a deck that demonstrably works.

### Mana sources, not land count

Every permanent that can produce mana counts toward the mana base, read from
Scryfall's `produced_mana`. Judging a Commander deck on land count alone always
reads as "you are short on lands", because such decks deliberately run rocks and
dorks instead.

### The play companion is an event log

Life is not stored; it is derived by folding a log of events. Undo is dropping
the last entry, history is free, and "how did I get to 3 life" is answerable.
Commander damage is one entry that both reduces life and credits the source,
because those two numbers drifting apart is the classic paper miscount.

*Revisit if:* a very long game makes the fold slow. It is O(entries) per render
on a list that realistically stays under a few hundred, so this is not close to
mattering.

### The tutorial is scripted, not simulated

Every beat declares its exact board state. The tutorial cannot desync, cannot
present an illegal board, and needs no network. The player genuinely plays —
clicking their own land, choosing their own block — but the outcomes are
authored.

The alternative is a rules engine. Covering even ten cards correctly is a much
larger project (see Forge and XMage for how much larger), and it would not teach
better. What it *would* enable is free play against an opponent, which this
deliberately does not offer.

Continuity is enforced by tests rather than by review: graveyards never shrink,
life totals never rise, no more than one land per turn, every click target
exists in the zone the beat names. The graveyard and life invariants each caught
a real authoring slip.

*Revisit if:* the guide grows past one scripted game. A second or third scenario
is cheap; a branching scenario is where this model starts to strain.

### Card faces are drawn in CSS as well as fetched

`CardFace` renders a readable card from data alone. This is not a placeholder —
it is the tutorial's primary renderer, the offline fallback everywhere else, and
a text-first view that is easier for a new player to read than a 200px scan.

Cards measure themselves with container queries and shed detail as they narrow,
rather than taking a size prop and guessing. Below ~104px the oracle text is
unreadable and only squeezes the name, so it goes; below ~70px the type line
goes too.

### Offline is a case, not a fallback

- Cards referenced by a saved deck are **pinned** in IndexedDB and never
  evicted, so a deck built at home opens on a phone with no signal.
- Every cache read is best-effort: private mode, disabled storage or a quota
  error degrades to a cache miss, never to a broken app.
- The service worker caches the app shell and card images but deliberately does
  **not** touch `api.scryfall.com` — the app's own cache layer understands
  pinning and staleness in a way a blind HTTP cache cannot.
- The guide and the life counter never need the network at any point.

### Scryfall is treated as a guest, not a resource

Scryfall is free and volunteer-funded and asks clients to be gentle. Every
request goes through one serial queue enforcing 100ms spacing regardless of how
many components fetch at once. 429 and 5xx retry with exponential backoff; 4xx
does not, because it is a real answer. A search matching nothing returns 404 and
is surfaced as zero results rather than an error.

One thing we cannot honour: Scryfall asks for a descriptive `User-Agent`, and
browsers forbid scripts from setting that header. The rate limiting and caching
are the parts a browser client *can* comply with, and does.

### localStorage for app state, IndexedDB for cards

App state — decks, games, guide progress — is small, benefits from synchronous
reads at first paint, and above all needs to be trivially exportable. It lives
under one versioned key so "download all data" is one JSON file the user owns,
which is what makes the no-accounts promise real rather than a limitation.

Card data is much larger and needs indexed lookup and eviction, so it lives in
IndexedDB.

*Revisit if:* someone builds enough decks to approach the ~5MB localStorage
limit. Decks store ids and quantities only, so this is thousands of decks away.

## Known trade-offs

| Trade-off | Why | When to revisit |
|---|---|---|
| No card recommendations or synergy data | Doing it well means EDHREC-quality data, which has no public API. Scryfall-search heuristics would look authoritative while being mediocre. | If a usable public recommendation API appears. |
| No deck sync across devices | No accounts means no server, no data to lose, no hosting cost. Export/import covers the real need. | If multi-device editing becomes a genuine complaint rather than a hypothetical. |
| Tutorial covers one matchup | A single well-taught green-versus-red game teaches the fundamentals. More scenarios are additive content, not architecture. | After watching real beginners get through it and seeing where they stall. |
| Prices are Scryfall's daily aggregate | Live market pricing needs a commercial data source. Daily is right for "is this deck expensive". | If the app ever needs to support actual purchasing, which it should not. |
| No rules engine | Covering the real rules is a multi-year project. | Never, realistically. Forge and XMage exist and are better at this. |
| Brawl's deck size and starting life are the likeliest data to drift | Encoded as plain data in `formats.js` and trivially editable, unlike ban lists which are fetched. | When Wizards next revises the format. |

## Testing

153 tests, all in `tests/`, no mocking framework beyond stubbing `fetch`.

The tests worth pointing at are the ones that encode judgement rather than
behaviour:

- `probability.test.js` pins the calibration — if a future change makes the
  model look more principled but stops reproducing 24 / 16 / 40, it fails.
- `tutorial.test.js` enforces narrative continuity as invariants.
- `deck.test.js` covers the rules that are easy to get subtly wrong: the
  four-copy limit spanning main and sideboard, "any number" cards staying legal
  in singleton, colour identity, Vintage restriction, commanders counting toward
  the 100.
- `scryfall.test.js` covers the failure paths — retry, no-retry, offline,
  chunking at 75 identifiers, and that one rejected request does not stall the
  queue behind it.

The full 27-beat tutorial is also walked end to end in a real browser, which is
how the base-path, sticky-coach and card-truncation bugs were found. None of
them would have failed a unit test.
