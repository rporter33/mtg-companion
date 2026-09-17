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

**Your first deck** — Never built one? Four short steps on the Decks tab, also
reachable from Learn. A dial walks the five colours in wheel order and names
the pair between any two, with a page for each colour: what it cares about,
how it wins, what it is bad at, three cards that sum it up. Four questions
about how you like to play lean the dial one way, and you can drag it back.
Commanders in your colours come two ways: a short recommended list chosen for
this app because the plan fits on one line and the deck is cheap, marked as a
recommendation, and the most played list live from Scryfall. Choosing one
makes the deck. Then a starting list by role, lands, ramp, draw, removal and
"does your thing", each with a target, a progress bar, and popular cards in
your colours under a price cap that defaults to four dollars, with a button to
fill the rest and open the deck in the editor. A plan (tokens, mill, blink and
so on, two or three per colour choice, written by this app) steers the "does
your thing" role, every listed card says why it is there from the evidence
that put it there, and a purchase budget for the cards you do not own is
checked against quantities, with unpriced cards counted apart. The flow
remembers where you were: each step has an address, and an unfinished deck is
offered back from the Decks screen.

**Decks** — Build for Standard, Pioneer, Modern, Legacy, Vintage, Pauper,
Commander, Duel Commander, Brawl, or Oathbreaker. The deck is validated against
the format's real construction rules as you build, with specific messages rather
than a pass/fail — *"Commander decks must be exactly 100 cards. This deck has 99
— 1 short"*, *"Counterspell is outside your commander's colour identity (U)"*.
Analysis covers the mana curve, colour requirements against the sources that
are actually online by the turn each spell asks for them (a rock counts from
the turn after it is cast, a ritual never does, a double-pip spell asks for
more), a land recommendation, hypergeometric draw odds drawn from the library
the commander is not in, and price, with every approximation named on the
screen. An Archidekt, Moxfield
or Arena export pastes in as it is: the set and collector number pick the exact
printing, and a section you named on the other site is a section here. Read
the deck as a list, a grid of card art, or as text: the whole deck on one
screen, sections flowing into columns, with the card under the pointer shown
large beside it. A bar pinned above the list finds a card as you type, by
name or type line with accents ignored, or narrows the deck to what you still
need to buy; a miss offers to search every card instead. Under it, one button
per section: tap Lands and only the lands show, tap again and the deck is
back, remembered per deck. Each button carries a dot for a legality problem
and a count of cards still to buy, so a folded section never hides either.

**Play** — A life counter for games with physical cards. One to six players,
per-format starting life, commander damage tracked per source, poison, energy,
experience and rad counters, a turn and phase tracker, dice, and full undo.
Works entirely offline and keeps the screen awake.

## Running it

```bash
npm install
npm run dev
npm run test:browser   # drives the real UI in a real browser, axe-core included
npm test               # 819 unit tests
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

**Deck history stores lists, not cards.** A version is ids and quantities with
a label and a time — a few kilobytes — so a deck carries thirty without
troubling the storage cap. Names resolve at display time from the cache.

Versions are taken when you ask, and automatically before the two edits that
rewrite a list at once: applying an import, and restoring an older version. Not
on every change; a history of "+1, −1, +1" is noise, and those edits are already
reversible by editing back. Automatic checkpoints are the first to be pruned.

Restore is its own undo. It captures the list it is leaving first, so the
version you just left is one restore away. There is no separate undo to get
wrong.

**A refused save is rescued before it is reported.** When the browser refuses a
write, the app drops automatic version checkpoints — the only thing in the store
it made on its own — one at a time, trying the write after each, until it lands
or nothing droppable is left. The write itself is the only oracle for "does it
fit", because the browser does not say how much it would have accepted. If it
lands, a banner says how many checkpoints went; if it does not, a banner says
the save failed and how to keep the data. Labelled versions are never dropped.

**A backup is one file, and the app asks for one when it should.** "Your data"
on the Decks screen downloads the whole store, restores one with an explicit
merge-or-replace choice, shows what the space is spent on, and offers back any
saved file the app could not read rather than writing over it. The nudge to
back up appears when decks exist and none was ever taken, or when several have
changed since — not on every edit.

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

**The look comes from two written references, and the app can prove it.**
`docs/` holds a universe and design reference and a Reality Fracture set
reference, written for this app, with the art direction and token files that
came with them and a provenance note on every asset. The shell is the
references' core theme: neutral charcoal and parchment with restrained antique
gold, the five colours as the accent system, self-hosted open fonts (Cinzel,
Source Serif 4, Source Sans 3, IBM Plex Mono, Cormorant Garamond) under the
SIL Open Font License in the roles the references give them. The references'
tokens sit in `tokens.css` verbatim under their own names and the app's
semantic tokens map onto them, so `npm run tokens:check` can diff the documents
against the stylesheet. Original artwork, colour and school emblems, and the
decorative vectors are the pack's own interface designs, never official
glyphs, and every emblem is shown with a text label beside it. `CLAUDE.md` at
the root points every future session at the same rules.

**A set someone designed for gets a curated theme; every other set gets a
derived one.** `src/data/set-themes.js` is the one place a theme is written by
hand: an accent, a display face, and the lore hooks the rest of the app can
show, dated and marked provisional like the mechanics. While that set is the
season's focus it takes precedence over the derived accent and applies to the
whole app, not just the banner; when the season moves on to a set with no
entry, the derived accent returns on its own. Reality Fracture is written in
from its reference: an indigo and silver shell with cyan as the one accent,
Cormorant Garamond for headings, the set's own illustration and tagline on the
banner, and Hexhaven's five schools, which are the five allied colour pairs,
beside the colours in the first-deck flow with their disciplines, virtues and
horrors. The banner says the colours and lore are the app's reading of public
previews, not official, and the alias "Shattered Reality" is accepted as input
and never shown. A browser spec drives both shells: with the set as focus and
with another set, on a desktop and a phone.

**The set banner is derived, not hardcoded.** Which set is next, when it lands
and its official icon all come from Scryfall at runtime, so it stays correct for
sets that do not exist yet. The accent is computed from the set code rather than
hand-picked, because the app cannot know a set's art direction and should not
pretend to.

**Each deck is a document of its own.** The first store was one blob under
one key, rewritten whole on every quantity tap. Now a root document holds the
small whole-app things (schema version, collection, games, guide progress,
preferences) and each deck sits under its own key with its own `updatedAt`. A
save writes the one deck that changed; a corrupt root no longer takes the decks
down with it, and a corrupt deck is set aside on its own; and the layout is
what a sync backend needs to reconcile, which is why it was done before any
backend exists. The old blob is split into documents the first time it is
read, and only rewritten once every deck has landed, so a refused write leaves
the old layout intact. The backup file's shape is unchanged: decks inline, as
before. Another tab writing the same storage is noticed through the browser's
`storage` event, which clears this tab's copy and announces the change.

**Where you are is in the address bar.** `#/decks/<id>/analysis` is a deck's
analysis tab, `#/cards?q=t:instant` is a search, and `?card=<id>` on any of
them is the card sheet. A reload keeps the screen, a deck has a link you can
paste, the back button retraces real steps, and back closes a card sheet
because opening one pushed a history entry. Tabs inside a deck and the search
text replace the current entry rather than pushing, so back does not retrace
every query. Hash routes rather than paths because GitHub Pages serves one
file and there is no server to rewrite a path. Pressing the tab you are on
returns to its own screen, as tab bars do on a phone.

**The app knows which build it is, and says when a newer one exists.** Every
build carries its commit and publish time, baked into the code and written
beside it as `version.json`. The Your-data screen names the running build, and
shortly after load, and again whenever the tab comes back into view, the app
fetches the version file past every cache and offers a reload if a newer build
has been published. The comparison is by time, not difference, so a stale copy
of the file can never nag anyone into reloading backwards. GitHub Pages sends
the page with a ten-minute cache, and the service worker used to honour it, so
a reload straight after a deploy brought back the previous build with nothing
on screen to say so; navigations now revalidate, and each fresh page replaces
the offline copy.

**Offline is a first-class case, not a fallback.** Cards a deck references are
pinned in IndexedDB and never evicted, so a deck built at home opens on a phone
with no signal. Card faces are drawn in CSS from card data as well as shown as
Scryfall images — the CSS version is a fully readable card, not a placeholder.
The guide and life counter need no network at any point.

**A decklist's trailing markers are peeled in any order, and kept.** Every
site appends something after a card name: Arena writes `(SET) 123`, Moxfield
adds `*F*` for a foil, Archidekt writes `(set) 123 [Category]` with the
category last. The first parser took the printing only when it sat at the very
end of the line, so every Archidekt name kept its set code, all ninety-nine
missed the bulk lookup, and each then went through Scryfall's fuzzy match one
request at a time under a message that said "checking the last few names". The
markers are now removed from the end until none is left, and each one is used:
the printing goes to Scryfall as a set and collector number, which is exact and
returns the card the person actually owns, so their prices are quoted on it; a
category that is not one of Archidekt's type defaults becomes a section; the
`[Commander{top}]` marker sets the commander. A printing Scryfall does not know
falls back to the name, still in bulk. The slow path still exists for names
nothing else can place, and it now says which name it is on.

**Add cards shows the value of a pick before it is added.** Results sort by
how played each card is unless asked otherwise, because "what do people run
in these colours" is the question a builder is asking; Scryfall carries that
rank on every card. Price in the deck's market, mana value, name and release
date are a select away, with a direction button, and the choice is
remembered. Every row carries its price and type, whether it is already in
the deck, and how many you own, and the results line totals what is shown.
Quick chips for type and price write into the query the box shows, so nothing
hidden is filtering; "Not in deck" and "Owned" are applied to what came back,
since Scryfall does not know your deck, and the line says how many they hid.
A strip above the box says where the deck stands by role, in the coach's own
counts, and pressing a role searches for it in the coach's own wording, so a
chip and the coach never disagree.

**The first-deck flow invents nothing.** The colour writing is the app's own
and says so on screen. The recommended commanders are a list written for this
app with a reason each, and `npm run firstdeck:verify` checks every name and
every signature card against Scryfall, since a wrong name would simply not
appear; the list beside it is Scryfall's popularity rank for exactly the
chosen colours. Staples come from Scryfall searches in the deck's colour
identity, legal in Commander, under the price cap, by the same oracle tags
the coach's classifiers were scored against, with a plainer fallback query
per role in case a tag slug changes. "Fill the rest" takes the most played
cards in each role up to its target, never a duplicate, never the commander,
then a few nonbasic lands and basics split across the colours. The result is
a deck the coach would call sensible, not a deck anyone would call optimised,
and the screen says the numbers are a guide, not a rule.

**A deck is recognised by a painting, so one stands for it.** Scryfall carries
an "art crop" of every card: the painting alone, no frame, about 40 KB. The
card whose painting stands for a deck follows a fixed order, one the person
chose, else the commander, else the costliest card in the list, else the
first, skipping anything without art at each step. It sits behind the deck's
name on the Decks screen and behind the title in the editor, and each list row
carries its own card's painting on the right at low opacity, fading out
before it reaches the name, so contrast is unchanged; a grid tile carries
its painting blurred and faint across the whole tile, under the card image,
so the price row and controls sit on a wash of the card's own colours and the accessibility
sweep scans the rows with art present. The paintings are image elements
rather than CSS backgrounds: they lazy-load, so a hundred rows fetch only
what is on screen, and a painting that cannot be fetched leaves a plain row
rather than a broken frame. They are decoration, hidden from assistive
technology; the name is right there in text. An Art switch on the list and the grid turns
these paintings off, and the images-off preference from card search turns
all of it off. The editor records its automatic answer on the deck, so the
Decks screen, which cannot load a hundred cards per deck, shows the same
painting from one cache read; a deck never opened in this browser shows none
until it is. Under the four-times CPU throttle the harness uses, a 100-card
list opens in 438 ms with art behind every row against 430 ms without; the
grid, whose tiles blur their painting, opens in 327 ms against 302; a
list-to-grid toggle costs 253 ms against 219. Run-to-run noise on the same
build is about 70 ms, so the row art is free and the blurred tile art costs
a little paint, which is what lazy loading and a 40 KB asset were meant to
buy.

**The text view follows the pointer, and the keyboard, and is honest about
phones.** Every line is a quantity, a name and a cost, and sections flow into
CSS columns so a Commander deck fits one screen. On a wide screen with a
pointer, the card under the pointer is pinned beside the columns with its
image and prices, and it stays on the last card touched rather than emptying
when the pointer leaves. Focusing a name with the keyboard shows the same
card, and the panel is a live region, so a screen reader hears each name as
focus moves. On a phone nothing hovers, so the panel is not shown at all and
a tap opens the card sheet as everywhere else; the quantity buttons, quiet
until pointed at on a desktop, are always visible there because there is no
hover to reveal them with.

**The browser suite gates the deploy.** Eighteen specs drive the built app
in a real Chromium, and they have caught every real regression so far; they
used to run only by hand, so a bug in routing or storage could deploy green.
The workflow now installs Chromium, serves the build, and runs the suite
before the deploy job is allowed to start.

**One skeleton, read by the coach and the first-deck flow.** Both describe the
same sensible deck: so many lands, so much ramp, draw and removal, the rest
doing what the deck does. They used to be two lists that agreed because one
person wrote both in the same week. `src/lib/skeleton.js` holds the targets
per format and the one reading of what role a card fills; the coach's checks,
the first-deck roles and the Add cards strip all read it, and a test asserts
they agree so they cannot drift apart without a test saying so.

**Layout has names, not numbers.** The deck screens said their spacing inline,
165 `style` props across the app, so three views looked related by effort
rather than by system. A stepper, a section header and a chip are shared
components now, used by every row, list and filter strip, so the labels a
screen reader hears and the buttons a test presses are the same everywhere;
and the two rhythms the app has, the stack and the row, carry named modifiers
in the base stylesheet. What is left inline is data, such as a colour swatch
or a bar's height, which belongs there.

**The rarer deck screens load on demand.** The Decks chunk had grown to
121 KB and all of it loaded to open the deck list. The first-deck flow, the
data screen, the playtest, history and import tabs are their own chunks now,
prefetched on idle the same way the views are so the offline guarantee holds;
the Decks chunk is 64 KB. The editor itself was split into a folder of view
components with one row contract, from a 726-line file to a 240-line editor
and eight small files, with no behaviour change and the deck specs unchanged.

**A 100-card deck is the unit of performance, and it is measured, not
assumed.** `npm run perf:measure` (needs a built preview) seeds a hundred
distinct cards with real images, twenty-five saved versions and a collection,
throttles the CPU four times to stand in for a mid-range phone, and times every
screen a deck can be on: the list, the grid, five list-to-grid toggles, five
quantity taps, Analysis, Coach, a sample hand, History and a full hundred-card
diff. Long tasks (over 50 ms on the main thread) are counted separately, since
those are what a person feels as a hitch. The interesting result was the
version-label box: each keystroke re-rendered the whole history, at 41 ms a
character under throttle. The form now owns its text, list rows are memoised
with handlers that do not change identity, and each row's section picker is a
button until tapped rather than a hundred live `<select>`s. Under the same
throttle:

| | before | after |
| --- | ---: | ---: |
| open a 100-card list | 446 ms, 2185 nodes, 327 ms in long tasks | 430 ms, 1393 nodes, 279 ms |
| list to grid, per toggle | 265 ms | 219 ms |
| typing in the version label, per character | 41 ms | 18 ms |
| a quantity tap | 145 ms, no long tasks | 136 ms, no long tasks |

With the CSS card face standing in for a missing image, the grid is heavier
(4,195 nodes for a hundred tiles) and a toggle costs 371 ms rather than 454 ms
before. The quantity tap barely moved, and honestly so: a quantity change
rebuilds the deck's sections, so memoised rows re-render anyway, and most of
that figure is the test driver's own click cost. Nothing on any screen is a
long task except the first paint of a hundred rows, which is the browser laying
them out.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the reasoning and the standing
trade-offs.

## Known limits

Honest edges, stated rather than discovered.

- **Tab isolation.** Another tab's write is noticed on the next read and
  announced, but a screen already open does not redraw itself until you
  navigate. The plumbing is there; the screens do not listen yet.
- **Saved data and browser storage.** Everything lives in `localStorage`, which
  browsers cap at a few megabytes and never say exactly how many. The Your-data
  screen shows use against the common limit; a browser with more room simply
  fails later than it predicts, which is the safe direction to be wrong in.
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
