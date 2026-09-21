# 02 — Frontend prototype (Grok sandbox)

This describes the **isolated prototype**, not the GitHub repo. Use it as a UX + type reference.

Stack of the prototype (do **not** require this in the real repo):

- TanStack Start, file routes, Tailwind v4 `@theme`
- Zustand game store with an `applyUntilHuman` AI loop
- Scryfall via a gated fetch (~80ms; **too fast** for `/cards/search` — you must use 500ms)
- localStorage key `mtg-companion.v1`

## Routes

| Path | Job |
| --- | --- |
| `/` | FRA hero, Hexhaven colleges, featured cards, companion grid |
| `/cards?q=` | Scryfall search. Default query `set:fra` |
| `/decks` | Saved decks |
| `/decks/$id` | Deck editor |
| `/start` | First-deck wizard (format → colours → commander → role skeleton) |
| `/learn` | Lesson tracks with wrong-answer buttons |
| `/practice` | Small table / drills |
| `/life` | Life pad, poison, commander-damage matrix |
| `/setup` | Pick format, starter, solo vs hotseat |
| `/play` | Reserved-zone table |

Mobile: bottom nav with cyan top edge, `pb-16` on bleed pages so content isn’t hidden.

## Visual identity (Reality Fracture)

Tokens from `src/styles.css`:

```
ink        #07090e
ink-2      #0e141c
ink-3      #151d28
cream      #e8eef6
muted      #9aa7b8
accent     #5ec8e8   /* fracture cyan — primary CTA, playable glow */
accent-2   #3aa7c4
gold       #9ad7e8   /* remapped: old Moxgate gold is now cool silver-cyan */
felt       #0a1218   /* table, not green felt */
danger     #ef6b6b
ok         #5dcc9a
mana-w     #f2ead8
mana-u     #5ec8e8
mana-b     #7a7588
mana-r     #e07a5f
mana-g     #6fbf8a
```

Fonts: **Sora** (UI), **Cormorant Garamond** (display), **IBM Plex Mono** (mono).

Motif: split light/dark, Hexhaven tower geometry, shattered-mirror texture. Mark is a split-circle SVG (`SplitMark`), not a Moxgate logo.

## Table UX (copy this even if the engine is different)

CSS grid with **reserved tracks**. Nothing overlays Pass.

```
┌─────────────────────────────────────────────┬──────────┐
│ opponent rail (life, library, grave, exile) │          │
├─────────────────────────────────────────────┤ inspector│
│ battlefield (theirs / yours)                │  rail    │
├─────────────────────────────────────────────┤  (never  │
│ action bar (phase, Pass, log)               │  covers  │
├─────────────────────────────────────────────┤  Pass)   │
│ hand dock                                   │          │
└─────────────────────────────────────────────┴──────────┘
```

- Playable cards **glow cyan**, not gold.
- Inspector lives in the reserved column; zoom/sheet must not cover the action bar.
- Hand is a dock, not cards dumped on the battlefield.
- Starters reflavored: **Stingerquill Drill** (R), **Konstrari Stomp** (G), **Theorix Cadet** (U).

## Surfaces Claude should keep feeding

- **Cards** — accept Scryfall query syntax; legality + oracle + printings + prices
- **Decks** — format size/copies, commander eligibility, named cards (not only IDs)
- **Learn** — authored beats, not engine traces
- **Life** — 20 / 25 / 40, poison, commander damage keyed by opponent id
- **Table** — serialisable `Action` list (see `03-CONTRACT.md`)

## Prototype issues you should not inherit

- Scryfall gate at 80ms is **below** the 500ms hard cap on search/named/collection
- Missing `User-Agent` header (Scryfall will eventually block)
- History on `LifeSession` was typed as `LifeSession[]` (wrong; should be a log of deltas)
- Starter lists mix classic cards with FRA flavour names — GitHub should keep example decks **by name** and resolve via Scryfall
- Auth/PGlite scaffolding in the sandbox is **app-builder noise**. The real companion has no accounts.

## Screenshots to look at

See `screenshots/README.md`. Minimum set:

1. `moxgate-home.png` — what “good table chrome” looks like on the live product
2. `home-hero.png` — FRA skin on Companion home
3. `cards-fra.png` — FRA catalog
4. `table-play.png` — Mountain played, inspector open, Pass still visible
5. `life-pad.png` — 40/40 commander pad
