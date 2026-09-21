# 04 — Reality Fracture

Current Wizards set as of this pack (2026-09-20). Theme the companion around it.

## Facts

| | |
| --- | --- |
| Name | Reality Fracture |
| Set code | **FRA** (main) |
| Commander set | **FRC** |
| Prerelease | 2026-09-25 |
| Release | 2026-10-02 |
| Legality | FRA → Standard, Pioneer, Modern, Commander, etc. FRC → Commander / Legacy / Vintage |
| Plane | Hexhaven (and the Echoverse) |
| Face | Jace Beleren / **The Theorist** |

Scryfall:

- https://api.scryfall.com/sets/fra
- https://api.scryfall.com/cards/search?q=e:fra
- https://scryfall.com/sets/fra
- FRC: https://api.scryfall.com/sets/frc

## Official pages (mechanics you must not guess)

- Mechanics: https://magic.wizards.com/en/news/feature/reality-fracture-mechanics
- Release notes: https://magic.wizards.com/en/news/feature/reality-fracture-release-notes
- Prerelease guide: https://magic.wizards.com/en/news/feature/reality-fracture-prerelease-guide
- Product: https://magic.wizards.com/en/products/reality-fracture
- Comprehensive Rules hub: https://magic.wizards.com/en/rules
- CR PDF (2026-06-19; a newer FRA-dated CR may exist — check the hub): https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf

In-repo: https://github.com/rporter33/mtg-companion/blob/main/docs/REALITY_FRACTURE_SET_REFERENCE.md

## Mechanics (from Wizards, condensed)

### Empower Jace

Keyword **action**. When instructed to empower Jace:

1. If you already control a Jace planeswalker token, the effect typically grows / uses that token (see the official notes — do not invent the +loyalty numbers).
2. Otherwise you create a Jace planeswalker token.

Story frame: Jace pulling versions of himself onto the battlefield. Token copies of a Jace planeswalker also count.

### Heartwood tokens

New predefined token: **Heartwood**. Red and green artifact with `{T}: Add {R} or {G}`. Mid/late mana battery. Example name in preview: Aerid Konstrari.

### Prepare

A creature can be **prepared**. Related to exiling a copy; the **current controller** of the prepared creature is who may cast the copy — if it changes control, the new controller gets the cast. Exact reminder text is in the release notes. Do not approximate in rules-enforced mode.

## Colleges of Hexhaven (companion flavour)

Used on the home page as colour-pair on-ramps, not as official guilds.

| College | School | Pair | Line |
| --- | --- | --- | --- |
| Fatehold | Future History | WU | Predict the path, then force the present to match it. |
| Theorix | Esoteric Mathematics | UB | Bend the proof until reality is the remainder. |
| Stingerquill | Painful Words | BR | A sentence that cannot be unanswered. |
| Konstrari | Constructive Arts | RG | Sculptors of towers, puppets, and war machines. |
| Vigorbloom | Invasive Healing | GW | Growth that does not ask permission. |

## Look

Not gold-and-purple Moxgate. Not green felt.

- Midnight ink `#07090e`
- Fracture cyan `#5ec8e8`
- Cool silver instead of gold
- Split light/dark, cracked tower, shattered mirror
- Playable glow = cyan

Starter flavour names in the prototype (lists themselves are still classic cards until FRA legality is ingested):

- Stingerquill Drill (red aggro)
- Konstrari Stomp (green stompy)
- Theorix Cadet (blue)

## What backend should do for FRA

1. Ingest `e:fra` and `e:frc` via bulk or set search (rate-limited).
2. Keep Oracle, legalities, rulings from Scryfall — don’t hardcode card text.
3. Put Empower Jace / Heartwood / Prepare in `src/data/set-mechanics.js` as **provisional** until the CR freeze, with a source URL on each entry.
4. Learn modules can teach those three mechanics with authored boards. A full engine implementation belongs in Forge/XMage, not in the practice reducer.
5. Default empty search / featured row = FRA until the next set.
