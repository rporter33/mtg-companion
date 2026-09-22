# Reference documents

`TURN_STRUCTURE.md` is the reference for how a turn works — phases, steps,
priority and the stack — and is read before writing anything about timing.

`PROJECT_BRIEF.md` is the whole-project handoff: what this is, how it is
built, what holds it together and what is left to do. Read that first if you
are new to the repository.

Two references live here, written for this app and read by every session
that works on it, with the art direction and token files that came with them
and `ASSET_PACK.md` on provenance and licences:

- `MTG_UNIVERSE_AND_DESIGN_REFERENCE.md` — cosmology, planes, chronology, colour
  philosophy, gameplay concepts, characters, visual language, typography, CSS
  tokens, accessibility, IP boundaries, implementation rules.
- `REALITY_FRACTURE_SET_REFERENCE.md` — the Echoverse, the Theorist, Hexhaven's
  five schools, mechanics, card treatments, inferred theme colours, typography,
  layouts, motion, copy style, CSS tokens, QA guidance.

## Where each section lands

| Section | Home in the code | Check |
| --- | --- | --- |
| Colour philosophy | `src/data/colors.js` (`COLOR_PAGES`); the on-screen note changes from "the app's own" to sourced | `tests/first-deck.test.js` |
| Hexhaven's schools | `src/data/set-themes.js` → `schools`, keyed by allied pair and shown with their emblems in the first-deck flow while the set is the season's focus | `tests/set-themes.test.js`, `tests/first-deck-lore.test.jsx`, browser `firstdeck` and `theme` specs |
| Inferred theme colours, typography | `src/data/set-themes.js` → `accent`, `accentDim`, `displayFont`; applied app-wide while the set is the season's focus | `tests/season.test.js` |
| Mechanics | `src/data/set-mechanics.js` (dated, provisional until the set's release date in Scryfall's set list, then marked unchecked until `checkedAt` is added; `src/lib/curation.js`) | `tests/set-mechanics.test.js`, `tests/curation.test.js` |
| Gameplay concepts, characters | `src/data/glossary.js`, `src/data/lessons.js` | `tests/glossary.test.js`, browser `explain` spec |
| Card treatments | `src/components/CardFace.jsx` frame variants | browser `zoom` spec |
| CSS tokens | `src/styles/tokens.css`; `npm run tokens:check` diffs the documents against it | script |
| Accessibility rules | `tests/browser/a11y.spec.mjs` | sweep |
| Motion | `src/styles/base.css` reduced-motion rule; nothing animates without a reduced path | sweep |
| Copy style | season banner, set lesson, coach wording | browser specs |
| IP boundaries | `CLAUDE.md` rules; reviewed before any asset or treatment is built | review |
| Original assets | `public/sets/<code>/`, self-hosted, size-budgeted, precached by the service worker | `bundle` spec |

## Intake, in order

1. Read both documents in full before placing anything.
2. IP boundaries first: anything that would mean reproducing a frame, logo, symbol art or flavour text is flagged before it is built.
3. `npm run tokens:check` against the documents' CSS blocks; reconcile names.
4. Fill `SET_THEMES.fra` from the set reference: accent, display face, schools. Fields left null are not applied.
5. Colour pages and glossary from the universe reference, additive.
6. Assets into `public/sets/fra/` with a licence line in this file.
7. Run the unit suite and the browser suite; the accessibility sweep and the bundle spec must stay clean.
