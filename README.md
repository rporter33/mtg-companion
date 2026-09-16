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
npm test             # 259 tests
npm run test:browser   # drives the zoom viewer in a real browser
npm run validate:live  # checks our assumptions against the live Scryfall API
npm run build
npm run preview
```

Node 22 or newer.

The build uses a relative base, so it runs at any path — GitHub Pages under a
subdirectory, a domain root, anywhere — with no configuration. Set `VITE_BASE`
only if a host needs an absolute one.

## Things worth knowing

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
