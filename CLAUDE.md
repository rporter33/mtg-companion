# Working in this repository

Read `docs/` before touching lore, colour, typography or set-specific content.
The reference documents there are the source of truth; the table in
`docs/README.md` says where each section lands in the code and which test
checks it.

`docs/TURN_STRUCTURE.md` is the reference for how a turn works: the five
phases, their steps, priority, the stack and what may be done where. Read it
before writing anything about phases, steps, timing, the stack or when a card
may be played, and cite its rule numbers rather than asserting a rule. It is
transcribed in `src/data/turn-structure.js` and checked by
`tests/turn-structure.test.js`; if the two disagree, the document is right.
`docs/PROJECT_BRIEF.md` is the whole-project handoff.

Rules that hold in code:

- Nothing is invented. Card names, prices, popularity and legality come from
  Scryfall. Lore and design come from `docs/`. Rules of play come from
  `docs/TURN_STRUCTURE.md`, cited by number. Anything the app writes itself
  says so on screen.
- IP boundaries in the universe reference govern assets and treatments. The
  app draws its own mana symbols and card faces and shows Scryfall images
  under the Fan Content Policy; it never reproduces frames, logos or symbol art.
- Set-specific content is curated, dated and marked provisional until release
  (`src/data/set-mechanics.js`, `src/data/set-themes.js`). The season engine
  applies a curated theme only while that set is the focus.
- Every change runs `npm test` and the browser suite (`npm run test:browser`
  against a built preview); CI gates the deploy on both.
- `npm run tokens:check` after any change to `docs/` or `src/styles/tokens.css`.
