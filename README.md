# MTG Companion

A local-first Magic: The Gathering companion — card reference, format-aware deck
builder, play companion, and an interactive guide that teaches the game by
playing it.

No accounts, no server, no analytics. Your decks live in your browser and export
as a JSON file you own.

## What it does

**Learn** — Three ways in, all of which work with no connection.

- A guided first game: 27 beats against a scripted opponent, with a coach
  explaining each step. You make the plays — play the land, choose the block,
  cast the combat trick. It teaches the stack, summoning sickness, why blocked
  means blocked, and why attacking is a question rather than an answer.
- Twelve lesson modules across four tracks — never played a card game, Arena
  player new to paper, coming from another TCG, or returning after years away —
  each ending in a question with a genuinely wrong answer and an explanation of
  why it is wrong.
- A 44-term glossary, wired through the whole app. Any jargon anywhere is
  tappable.

**Zoom** — Any card opens full screen: pinch, scroll, double-tap or the keyboard,
up to 4x, with drag to pan. Zoom fetches a higher-resolution image rather than
magnifying a thumbnail. In the tutorial each card carries a magnifier button, so
a beginner can study a card without playing it.

**Cards** — Search with Scryfall's own query syntax (`t:creature f:modern
cmc<=3`, `c:r usd<5`). Full oracle text, official rulings, legality across every
supported format, every printing, and prices.

**Change alerts** — Ban lists move, and nobody tells you the change hit your
deck. The app snapshots each deck's legality when you edit it, and on launch
reports only what actually moved: *"Lightning Bolt has been banned in Modern"*,
with the deck it is in. Told once, worst news first, silent when nothing changed.

**Decks** — Build for Standard, Pioneer, Modern, Legacy, Vintage, Pauper,
Commander, Duel Commander, Brawl, or Oathbreaker. The deck is validated against
the format's real construction rules as you build, with specific messages rather
than a pass/fail — *"Commander decks must be exactly 100 cards. This deck has 99
— 1 short"*, *"Counterspell is outside your commander's colour identity (U)"*.
Analysis covers the mana curve, colour requirements against actual sources, a
land recommendation, hypergeometric draw odds, and price.

**Play** — A life counter for games with physical cards. One to six players,
per-format starting life, commander damage tracked per source, poison, energy,
experience and rad counters, a turn and phase tracker, dice, and full undo.
Works entirely offline and keeps the screen awake.

## Running it

```bash
npm install
npm run dev
npm run test:browser   # drives the real UI in a real browser, axe-core included
npm test               # 651 unit tests
npm run validate:live  # checks our assumptions against the live Scryfall API
npm run deck:fetch     # turns a deck you own into a shippable example
npm run examples:verify  # checks every shipped example against Scryfall
npm run coach:measure  # scores the coach's card classifiers against real cards
npm run build
npm run preview
```

Node 22 or newer.

The build uses a relative base, so it runs at any path — GitHub Pages under a
subdirectory, a domain root, anywhere — with no configuration. Set `VITE_BASE`
only if a host needs an absolute one.

## Things worth knowing

**Example decks come from a person, not a scraper.** The app cannot read
Moxfield, Deckstats, TappedOut or MTGGoldfish from a browser: they send no CORS
headers permitting it, which is their decision, and there is no honest
client-side way around it. So the importer recognises those links and tells you
which Export button to press instead of failing silently.

Examples that ship with the app are curated by hand with `npm run deck:fetch`,
which runs on a maintainer's machine rather than in anyone's browser:

```bash
# from a plain text export — always works, no network needed for the deck itself
npm run deck:fetch -- deck.txt --credit "Your name" --note "why it's worth a look" --append

# from a link, where the site allows it
npm run deck:fetch -- https://archidekt.com/decks/123456
```

Every card name is checked against Scryfall before an entry is emitted, because
examples resolve by name at runtime and a typo would be a broken deck for
everyone. The script refuses to write an entry containing a name Scryfall does
not know.

A list with no quantity column — the way some pages present a singleton deck —
is read as one of each. That fallback only fires when the normal pass found
nothing at all, so no list that parses today can change meaning because of it.

Preconstructed decks make the best examples here: they are what a new player
actually buys, they need no curator's opinion attached, and they line up with
the commanders browser in Learn.

`npm run examples:verify` checks every name in every shipped example against
Scryfall in one pass, and also reports anything banned in the deck's own format
or outside its commander's colour identity. Add `--fix` and it applies what it
finds — renaming a card that gained a subtitle, rewriting a back face to its
full `Front // Back` name, deleting a token the export swept up — rather than
printing instructions for a human to retype.

A supplied list can also carry a name that is no card at all. Those stay in the
deck and are listed in its `unverified` field: deleting them loses information,
and pretending they resolve is worse. The importer already shows unresolved
lines with alternatives, so a reader sees the truth either way. Unit tests cannot catch a wrong card
name — it is only wrong relative to a database that is not in this repo — so
that check lives in a script and has to be run deliberately.

**Accessibility is checked in the browser, not asserted.** `tests/browser/a11y.spec.mjs`
runs axe-core over every view and over the states that only exist after
interaction — an open card, the zoom viewer, a deck being edited. A scan that
cannot reach its target fails rather than passing quietly: the first version of
that file skipped three states whose selectors found nothing and still reported
a clean run, which is how the one critical finding stayed hidden.

axe finds a specific subset of problems, and finding nothing is not the same as
being accessible. It is a floor, not a ceiling.

**The views are code-split, and the prefetch is what makes that safe.** Opening
on Learn does not download the deck builder, card search and life counter: the
document declares one entry chunk plus React, and each view arrives on demand.

But the service worker caches same-origin responses as they are fetched, so a
chunk nobody navigated to would simply not be there offline — and working
offline is this app's claim, not a bonus. So once the first view is up and the
browser is idle, the rest are pulled in anyway. Smaller first paint, same cache.
`tests/browser/bundle.spec.mjs` checks both halves, because losing the prefetch
would leave the app working online and broken offline, which is the worst way
for it to fail.

React is its own chunk, so shipping an app fix does not re-download the
framework.

**The deck coach's classifiers are the one place this app guesses.** Everything
else it does is arithmetic — count the lands, compare against a number from a
hypergeometric distribution. But whether a card *is* removal, ramp or card draw
is three regexes over oracle text, written from memory and checked only against
cards that happened to occur to whoever wrote them.

That was worth measuring, and the measurement found eight defects. `Farseek`,
`Cultivate` and `Nature's Lore` — among the most played ramp in Commander —
counted as nothing, because the pattern demanded the exact words "a basic land".
`Arcane Signet` counted as nothing, because it says "Add one mana of any color"
and the pattern wanted a mana symbol. `Whenever you draw a card` counted as card
draw, so a deck full of draw *payoffs* was told it had draw.

`tests/coach-classifiers.test.js` pins all of it offline.
`npm run coach:measure` scores the same functions against a few hundred real
cards using Scryfall's community tags as ground truth — independent of these
regexes, which is the point, since measuring oracle-text patterns against
oracle-text patterns proves nothing. Those tags are volunteer-maintained and
incomplete, so precision from that run is a lower bound and recall is the
sturdier number.

**Prices are three markets, and only three.** Scryfall supplies US dollars from
TCGplayer, euros from Cardmarket, and tickets from Cardhoarder. Other
deckbuilding sites show a fourth vendor; this one cannot, because that data is
not in the API it uses, and a column labelled with a shop that did not supply
the number would be a lie that looks like a feature.

Every figure is a daily aggregate, not a live quote. A printing with no price is
common, and absence renders as dashes — never as zero, because `Number(null)` is
0 and that is how a two-hundred-dollar foil once read as free. A deck total says
how many cards it could not price instead of quietly leaving them out.

**Deck sections are derived until you change them.** A deck nobody has
organised reads as Creatures / Instants / Lands, because those follow from the
cards. Rename a section, move a card, and that choice is stored on the card
instead — derived is a default, not a limitation.

Renaming a derived section is the interesting case. Nothing says "Creatures"
anywhere; those cards simply *are* creatures. So renaming one writes the new
name onto the cards currently in it. Without that the rename silently does
nothing, which is how a feature comes to feel broken rather than missing.

**Stored data is versioned and migrated.** There are no accounts, so a deck
exists in exactly one place: that browser. A migration that loses one loses it
for good. Steps are additive, run in order, and only bump the version once they
have run. State written by a *newer* build is left alone rather than forced
backwards — a stale service worker can serve an old bundle against new data, and
downgrading it would discard fields the newer build is still using.

**Sample hands shuffle ninety-nine, not a hundred.** The commander begins in the
command zone, so it is not in the library — an off-by-one that would skew every
number the Playtest tab produces, and one that is invisible once made.

Mulligans are London: a fresh seven every time, and the cards go to the bottom
only when the hand is kept. Which cards to bottom is the decision being
practised, so the app refuses a wrong count rather than choosing for you.

The shuffle is seeded. Not to fake randomness, but because a test that cannot
fix the shuffle cannot check the mulligan arithmetic.

**Ownership is per card, not per printing.** Owning a Sol Ring is owning a Sol
Ring, whichever set it came from — keying on printing would tell a player with a
Commander 2021 copy to buy the Battlebond one, which makes the whole feature
useless. The cost of that choice is stated rather than hidden: this cannot value
a collection, because it does not know which printings they are. It answers
"what do I still need", which is the question people ask while building.

Counts are not allocated across decks either. One Sol Ring covers a Sol Ring in
every deck, because you own a Sol Ring. Splitting a collection between decks is
a different question — "can I sleeve all of these at once" — and answering it
with this data would overstate what you are missing.

**Ban lists are not in this repo.** Banned and restricted status is read from
Scryfall's per-card `legalities` object at validation time. Ban lists change on a
rolling announcement schedule, and a hardcoded copy would be wrong within weeks
and wrong silently. What *is* encoded is the structural stuff that does not
move: deck sizes, copy limits, singleton, commander requirements, starting life.

**The land recommender is calibrated against real decks.** The intuitive
objective — never miss a land drop — is measurably wrong. A standard 24-land
60-card deck makes its turn-three land drop only 78.9% of the time, and a
37-land Commander deck makes its turn-four drop 54.5% of the time. Building
toward that target recommends 27 lands in 60, which nobody plays. The app solves
a different question — at least two mana sources in the opening seven, at 85% —
which reproduces the accepted ratios: 24 sources for 60 cards, 16 for 40, 40 for
100. Those three numbers are pinned as tests.

**The tutorial is scripted, not simulated.** Every beat declares its exact board
state, so it cannot desync, cannot present an illegal board, and needs no
network. A real rules engine covering even ten cards correctly is a much larger
project, and it would not teach any better.

**The set banner is derived, not hardcoded.** Which set is next, when it lands
and its official icon all come from Scryfall at runtime, so it stays correct for
sets that do not exist yet. The accent is computed from the set code rather than
hand-picked, because the app cannot know a set's art direction and should not
pretend to.

**Offline is a first-class case, not a fallback.** Cards a deck references are
pinned in IndexedDB and never evicted, so a deck built at home opens on a phone
with no signal. Card faces are drawn in CSS from card data as well as shown as
Scryfall images — the CSS version is a fully readable card, not a placeholder.
The guide and life counter need no network at any point.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning and the standing
trade-offs.

## Known limits

Honest edges, stated rather than discovered.

- **Tab isolation.** Ownership and settings sync within one tab. Another tab
  writing the same storage is not noticed until reload.
- **Saved data and browser storage.** Everything lives in `localStorage`, which
  browsers cap at a few megabytes. A save the browser refuses is announced in a
  banner and kept for the session; it is not retried. A file that cannot be
  parsed is set aside under a backup key rather than overwritten — but nothing
  yet offers to restore it. Both are the subject of the next data-safety pass.
- **Two `window.prompt` / `confirm` dialogs remain** (new section name, delete
  deck). They work, including in installed PWAs, but are not styled.
- **Deck total includes the sideboard; the card count does not.** The count
  answers "is this a legal deck", the total answers "what would all of this
  cost", and the two questions have different scopes.
- **A renamed section leaves its name on a sideboard card too**, where it is
  ignored. Harmless, and cleaned up the next time that card is moved.
- **Printings show the market chosen on a deck**, read once when the card sheet
  opens rather than live. Reopen the sheet after changing it.

## Data

Card data, images, rulings and prices come from [Scryfall](https://scryfall.com),
which is free and volunteer-funded. Every request goes through one serial queue
enforcing 100ms spacing, results are cached, and prices are a daily aggregate
rather than a live quote. If you find this useful, consider
[supporting them](https://scryfall.com/donate).

## Legal

Unofficial Fan Content permitted under the [Wizards of the Coast Fan Content
Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved or
endorsed by Wizards. Portions of the materials used are property of Wizards of
the Coast LLC. © Wizards of the Coast LLC.

This project is non-commercial and always will be. Card names, rules text, card
images and mana symbols are the property of Wizards of the Coast.

The application code is MIT licensed — see [LICENSE](LICENSE).
