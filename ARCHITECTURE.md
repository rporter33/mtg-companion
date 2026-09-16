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

### Legality is snapshotted, and the diff is the product

A deck stores card ids and used to re-derive legality live. That meant a ban
announcement silently made a deck you had built and registered illegal, with no
record it had ever been legal — the same class of bug as a repriced catalog
rewriting a bid already sitting with a customer, and it takes the same fix.

Every edit now captures the verdict for every card with a timestamp. The
snapshot travels with an export, so history cannot mutate underneath the user.

The diff is the interesting half. Ban lists move on a rolling schedule and
nobody tells you the change touched *your* deck, so on launch the app compares
the stored verdict against today's and reports only what moved, worst news
first. Deliberate restraint throughout: a card that merely failed to load says
nothing (offline is not a rules change), a data gap says nothing, a deck moved
between formats reports that rather than mass illegality, and each change is
announced exactly once. An app that speaks on every launch is one you learn to
dismiss unread.

*Revisit if:* users want a history of changes rather than a one-shot alert. The
log is not kept today — only the current baseline.

### The set theme is derived, never hardcoded

Magic releases a set every few months. Hardcoding the current one's name and
palette would rot exactly like a hardcoded ban list, so the banner is derived
from Scryfall's set list at runtime: which paper set is next, how far away, and
its official icon. It works for sets nobody has announced yet.

What genuinely cannot be derived is a set's art direction. Rather than invent a
palette and present it as the set's, the accent hue is computed deterministically
from the set code — stable per set, spread across the wheel by golden-angle
stepping so consecutive sets look distinct — with saturation and lightness fixed
so no set can render illegibly on the dark base.

*Revisit if:* Scryfall ever exposes set colour metadata, which would beat a hash.

### The card explainer reads templating, not a card list

Magic's rules text is templated far more regularly than beginners realise, and
that regularity is the teachable thing:

    A line beginning When, Whenever or At is a triggered ability.
    A line shaped "cost: effect" is an activated ability.
    Anything else on a permanent is simply true while it is there.

`lib/explain.js` reads those patterns, so it explains every card in Magic
including ones printed next week — no card list to maintain and nothing to go
stale. It reports what kind of ability each line is, what sets it off, and
whether the player gets a choice.

Two cases are worth the extra code. **Ability words** (landfall, raid,
delirium) have no rules meaning at all; the card behaves identically with the
word deleted, and saying so out loud heads off a common misunderstanding.
**Reflexive triggers** — "you may sacrifice a creature. When you do, draw two
cards" — sit in the *second sentence* of a line whose first sentence reads like
an ordinary instruction, so they are detected independently of how the line as
a whole classifies. The first implementation missed them entirely for exactly
that reason.

**Deliberate limit:** it explains structure, never strategy or interactions. It
will say a line is a mandatory trigger and what fires it. It will not say
whether the card is good or how it behaves alongside another card, because
being subtly wrong about that is worse than saying nothing — the same reasoning
that keeps a synergy engine out of the app.

*Revisit if:* Wizards changes templating conventions, which happens rarely and
visibly. The parser degrades to "static ability" rather than to nonsense.

### Set mechanics are the one hand-written exception

Everything else in this app is fetched, because it changes: legality, prices,
set names, release dates, colour profiles. New set mechanics cannot be. Scryfall
publishes reminder text on individual cards, but nothing that says "here is what
is new this set and why it matters if you have never played".

So `data/set-mechanics.js` is curated by hand — and the UI says so. Every entry
carries a curation date, its sources, and a provisional flag for content written
during spoiler season, and the sheet renders all three. An entry that has gone
stale is visibly stale rather than quietly wrong, which is the same reasoning
that keeps ban lists out of the repository, applied to content that genuinely
cannot be fetched.

Tests enforce that each entry is dated and sourced, that cross-references
resolve, and that a set mechanic never shadows a glossary term — two
explanations of the same word diverging silently is exactly the failure this
structure exists to prevent.

*Revisit if:* an API appears that publishes set mechanics, or if maintaining
entries per set becomes a chore rather than a few minutes per release.

### Art treatments apply only to sets whose art direction we know

Reality Fracture's signature treatment is Shattered Mirror: the Echoverse
version of a subject centred inside broken mirror fragments showing the
original. The banner picks that up as a chipped edge, hairline fractures and a
raking facet highlight.

A set with no curated entry gets the plain banner. The app does not invent an
aesthetic for a set it knows nothing about, for the same reason it does not
invent a palette — and the treatment is deliberately restrained, because it sits
directly above "Play your first game" and a novelty that competes with the
tutorial entry point is a novelty that costs more than it earns.

### Card faces are drawn in CSS as well as fetched

`CardFace` renders a readable card from data alone. This is not a placeholder —
it is the tutorial's primary renderer, the offline fallback everywhere else, and
a text-first view that is easier for a new player to read than a 200px scan.

Cards measure themselves with container queries and shed detail as they narrow,
rather than taking a size prop and guessing. Below ~104px the oracle text is
unreadable and only squeezes the name, so it goes; below ~70px the type line
goes too.

### Zoom upgrades the image rather than magnifying it

Cards are browsed at Scryfall's `normal` (488px wide). Past about 1.4x that is
just bigger pixels, so the viewer swaps the source for `large` and then `png` as
you zoom, instead of scaling a thumbnail.

Pan limits are bounded by the *card*, not the viewport. Bounding by the frame —
the obvious first implementation — let a card that still fitted entirely on
screen be dragged halfway out of view. The overhang is how far the scaled card
sticks out past the frame; when it does not stick out, it does not move.

The CSS-rendered `CardFace` is the fallback when there is no image, and it is
the *better* zoom: live text stays perfectly crisp at 4x where a raster image
does not. The tutorial, which needs zoom most because its cards render at 82px
to players who cannot yet read them, renders from CardFace and so gets the
sharpest result for free.

In the tutorial, tapping a card plays it, so inspection needed its own
affordance. That is a visible magnifier button rather than a long-press: a
beginner will never discover a hidden gesture, long-press collides with the OS
context menu, and adding tap disambiguation would have put a delay on every
play in a tutorial whose whole pitch is "you make the plays".

*Revisit if:* zoom is wanted directly in the search grid. Tapping there already
opens the detail view, so tap is effectively the zoom today.

### The filter controls and the search box are one query

Filters do not sit alongside the search box; they write into it. Toggling
"green" rewrites the query to `c>=g`, and typing `c<=ur` by hand lights up the
blue and red pips. One source of truth means the controls can never claim a
filter the search did not actually use.

**Anything the controls do not model is preserved verbatim.** Type
`o:"draw a card" is:commander`, toggle a colour, and both survive untouched.
A filter UI that silently drops the parts it does not understand is worse than
no filter UI, because the loss is invisible — so negations, unmodelled
operators and parenthesised groups all round-trip, and there are tests for
each. Operators are *written* explicitly (`c>=rg`, never the ambiguous `c:rg`)
and *parsed* permissively, so the query on screen means exactly one thing.

Bare `id:` parses as "at most", not "includes", because the Commander question
is what a deck may legally contain.

### Sorting is a server round-trip, not a client-side reorder

Scryfall pages at 175 cards. Sorting the loaded page would put "cheapest" at the
top of page one while a cheaper card sat on page three — confidently wrong in a
way the user cannot see. Sorting therefore re-queries with `order` and `dir`.
Results are cached, so flipping back is free.

*Revisit if:* a result set is small enough to hold entirely. Not worth the
branch today, since the cache already makes repeat sorts instant.

### Deck search starts scoped to the commander

A commander fixes what a deck may contain, so searching inside one applies its
colour identity automatically — with a visible, removable chip. An invisible
filter is one the user blames the search for.

Scoping is passed into the search function rather than read from state: a
handler that calls `setScoped(false)` and then searches would otherwise run the
previous callback and send the setting the user just turned off. That bug
already existed on the format-scope checkbox and is fixed with the same change.

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
| Set accents derive from the set's real colour distribution, falling back to a code hash | Five `total_cards` queries give genuine information; the hash is a stable identity for sets with no card data yet. Neither claims to know the set's art direction. | If Scryfall exposes set colour metadata. |
| Set mechanics are hand-written, dated and sourced | They cannot be fetched from anywhere. The alternative is not explaining new mechanics at all, which fails the new players this app is built for. | If a mechanics API appears. |
| Legality change history is not kept — only the latest baseline | A one-shot alert covers the actual need ("act on this"), and keeping a log means unbounded growth in localStorage. | If users ask what changed three months ago. |

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
- `snapshot.test.js` pins the restraint as much as the detection: offline says
  nothing, a data gap says nothing, a format change is its own event.
- `season.test.js` asserts the theming engine excludes digital-only and
  supplemental products, and that no set code can produce an illegible accent.

The full 27-beat tutorial is also walked end to end in a real browser, which is
how the base-path, sticky-coach and card-truncation bugs were found. None of
them would have failed a unit test. The ban-detection flow is verified the same
way: a deck and a newly-banned card are seeded into real IndexedDB and
localStorage, and the run asserts both that the alert fires and that a second
launch stays silent.

`npm run test:browser` drives the zoom viewer in a real browser: pinch via
synthetic pointer pairs, wheel, double-tap, drag-to-clamp, keyboard, and focus
return. Every bug that feature had was invisible to unit tests and obvious
there — text selected while panning, a pointer lost to a thrown
`setPointerCapture`, and pan bounds measured against the viewport instead of
the card.

`npm run validate:live` is the one thing the suite cannot do — it checks this
app's *assumptions about Scryfall* against the live API, which mocks written
from those same assumptions never can.
