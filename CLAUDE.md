# Working in this repository

Read `docs/` before touching lore, colour, typography or set-specific content.
The two reference documents there are the source of truth for the universe
and for the current set; the table in `docs/README.md` says where each
section lands in the code and which test checks it.

Rules that hold in code:

- Nothing is invented. Card names, prices, popularity and legality come from
  Scryfall. Lore and design come from `docs/`. Anything the app writes itself
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
