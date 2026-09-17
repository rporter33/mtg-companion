# Asset pack: provenance, licences, and what ships

The "Planes & Paradoxes" pack (2026-09-17) supplied the two reference
documents in this folder, original artwork, vector assets, fonts and tokens.
What ships under `public/mtg-assets/` is the subset the app uses; source PNGs,
the pack's preview catalogue, its tooling and its React examples stay out.

## Provenance

- **Artwork** (`assets/core/art`, `assets/reality-fracture/art`): four original
  illustrations generated for this project; prompts in `ART_DIRECTION.md`.
  WebP exports only, three sizes each. No lettering or interface is baked in.
- **Vectors** (`assets/shared`, `assets/core/decor`, `assets/reality-fracture/decor`,
  `assets/reality-fracture/schools`): original interface designs interpreting the
  two references. They are not official glyphs, guild marks, school marks,
  expansion symbols or mana symbols, and the app never presents them as such.
  Every emblem is shown with an adjacent text label.
- **Fonts** (`assets/shared/fonts`): Latin WOFF2 subsets of Cinzel, Source
  Sans 3, Source Serif 4, Cormorant Garamond and IBM Plex Mono, each under the
  SIL Open Font License with its licence file beside it and its source URL in
  `sources.json`. These are the references' open alternatives; Beleren and the
  other proprietary Magic typefaces are not bundled.
- **Colours**: implementation palettes inferred from public material by the
  references. Not official Wizards specifications, and the app says so where it
  shows them.

## What the app does with it

| Asset | Use |
| --- | --- |
| Reference tokens | Verbatim in `src/styles/tokens.css` under the documents' names; the app's semantic tokens map onto them. `npm run tokens:check` diffs the two. |
| Fonts | `public/mtg-assets/styles/fonts.css`, linked from `index.html` with a relative path, `font-display: swap`; cached by the service worker after first load. |
| Core shell | Charcoal, parchment, antique gold: the default theme. |
| Reality Fracture shell | `src/data/set-themes.js`; applied app-wide while the set is the season's focus, then retired by the season engine. |
| Hero art | Learn's top panel (core) and the season banner (Reality Fracture), wide on desktop, portrait on phones, with a CSS scrim and empty alt text because the text beside it carries the meaning. |
| School emblems | Beside the schools in the first-deck flow, always with the school's name. |
| Colour emblems | Beside each colour page in the first-deck flow, always with the colour's name. |
| Empty state, card back | The Decks screen's empty state and a deck card with no face art. |

## Size

About 2.5 MB on disk, of which the four illustrations at every size are 1.9 MB.
A first load fetches only the hero size the viewport needs and the fonts in
use; the rest is fetched on demand and then held by the service worker.
