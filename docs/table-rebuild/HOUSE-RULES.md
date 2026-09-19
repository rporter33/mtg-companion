# The conventions this repository is held to

`../../CLAUDE.md` is the authority and is short — read it. This file is the
part a Table rebuild will trip over, with the reasoning attached.

## Nothing is invented

Card names, prices, popularity and legality come from **Scryfall**. Lore and
design come from `docs/`. Rules of play come from **`docs/TURN_STRUCTURE.md`,
cited by rule number** — never asserted from memory. It is transcribed into
`src/data/turn-structure.js` and checked by `tests/turn-structure.test.js`; if
those two disagree, **the document is right**.

**Anything the app works out for itself says so on screen.** This is the rule
that shapes the Table more than any other. `Pool.jsx` is labelled "Untapped",
not "available", and its tooltip says it counts one per card and cannot read
conditions. `mana.js` returns `null` rather than guess. A rebuilt engine
inherits this: where it is certain, it may say so; where it is approximating,
it says that too.

## IP boundaries

The app **draws its own mana symbols and card faces**, and shows Scryfall's
card *images* under the Fan Content Policy. It never reproduces card frames,
set symbols, logos or symbol art. `docs/MTG_UNIVERSE_AND_DESIGN_REFERENCE.md`
governs this. A rebuild must not start rendering its own approximations of
Wizards' frame furniture.

## Storage is read forgivingly

Anything read back from a user's device was written by an older build and has
whatever shape it had then. **Fill in what is missing, drop what cannot be
made sense of, and never let it reach a screen as a thrown error.**

Adding a field, a zone or a step is a **migration, not an edit**. The pattern
is `upgrade()` in `src/lib/board/model.js`; the shape of its test is
`tests/board-restore.test.js`. This rule exists because ignoring it once put a
crash in production — `undefined is not an object (evaluating 'e.zones[a]')` —
for everyone with a saved table.

A new engine means a new schema. **Plan the migration before the schema.**

## Every change runs both suites

```
npm test                                              # 1191 unit tests, 58 files
npm run build
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:browser   # 26 specs
npm run tokens:check                                  # after docs/ or tokens.css
```

CI gates the deploy on both. Two things that will waste an afternoon:

- **A new browser spec must be added to the `test:browser` `&&` chain in
  `package.json`** or it never runs and you will believe it passed.
- **Never rebuild while the browser suite is running.** Asset hashes change
  and the run dies with `ERR_HTTP_RESPONSE_CODE_FAILURE`.

## Comments explain *why*, never *what*

The codebase reads as prose. A comment that restates the line below it is
noise; a comment that says why the line is that way is the point. Docstrings
carry the reasoning, including the reasoning for things that look wrong and
are not. British English in UI prose.

## Screenshot the thing

Assertions pass while the screen is broken. Two real bugs in this feature were
found only by looking: mana pips sheared in half by an `overflow-x` scroller,
and a card image failing to fill its box by two pixels. The browser fixtures
also had no `image_uris` at all for a while, so the suite never exercised the
photo path it was supposedly testing.

**Take a picture and look at it before believing a green run.**

## Accessibility is checked, not assumed

`a11y.spec.mjs` runs axe-core over the app's states. Things that have already
bitten here: a scrollable region that cannot be focused needs `tabIndex={0}`
and an `aria-label`; a card rotated to show it is tapped says nothing to
anyone who cannot see it, so `BoardCard` puts "tapped" in its spoken label.
Touch targets matter — a fanned card shows only a sliver, and that sliver is
the hit area.

## Branch and attribution

mtg-companion work goes to **`main`**. Commits end with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: <the session url>
```

No model identifier anywhere else — not in code comments, commit subjects, PR
bodies or any pushed artifact. Do not open a pull request unless asked.
