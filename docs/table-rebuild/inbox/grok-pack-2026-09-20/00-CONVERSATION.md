# 00 — Conversation log (what the owner said)

Chronological. Paraphrased for Claude. Nothing here is a license to change the GitHub repo unless the owner tells *you* to.

---

## 1. Start on Moxgate UX, then marry it to Companion

> From the moxgate UI/UX. Let’s focus on making the front end user experience even better. I have Claude working on the back end code. Check git. But let’s focus on the front end.

Implication:

- **Claude = backend.** Grok = frontend / UX.
- Look at git (the companion repo), but don’t fight Claude’s engine work.
- Moxgate is the UX reference, not the product.

## 2. The product and the theme

> https://github.com/rporter33/mtg-companion
>
> This is my repo and I want to take improvements to moxgates Ui and marry it to MTG companion. I’d like the UI to match wizards current set - let’s make it for reality fracture.

Implication:

- Target repo: **https://github.com/rporter33/mtg-companion**
- UX source: Moxgate table (reserved zones, hand dock, inspector that never covers Pass)
- Visual identity: **Reality Fracture** (Wizards’ current set as of 2026-09-20)
- Set codes: **FRA** (main, Standard-legal), **FRC** (Commander)
- Release: **2026-10-02**. Prerelease: **2026-09-25**.

## 3. Hard stop on the repo

> Before changes. Don’t affect my repo

Implication (still in force for Grok; Claude may edit the repo because that is the owner’s other thread):

- Grok’s work stayed in an isolated sandbox.
- This zip is **context**, not a merge.
- If you copy types or UX notes, re-implement against *their* tree (`ARCHITECTURE.md`, `CLAUDE.md`).

## 4. Where is Moxgate’s repo?

Grok’s answer (verified):

- **There is no public Moxgate repository.**
- Product: https://www.moxgate.com
- Terms: https://www.moxgate.com/terms
- Optional rules-enforced mode = **Forge**, GPL-3.0, **server-side only**, never shipped to the browser.
- Forge source: https://github.com/Card-Forge/forge
- Contact on their terms: legal@moxgate.com

Do not treat Moxgate as open source. Do not scrape it as an API.

## 5. “Provide all useful links to build the backend.”

Grok produced the link pack now in `01-BACKEND.md`:

- Owner’s docs (`CLAUDE.md`, `ARCHITECTURE.md`, turn structure, FRA set reference, Moxgate study, signal/relay)
- Scryfall API + rate limits + bulk
- MTGJSON
- Forge + XMage
- Official CR + FRA mechanics / release notes
- Cockatrice decklist format
- WebRTC / existing P2P scripts
- Fan Content Policy + GPL warning

## 6. “Produce a markdown file including this all.”

Written as `BACKEND.md` in the sandbox (copied here as `01-BACKEND.md`). Not committed to GitHub.

## 7. This ask

> can you bundle everything learned and in the conversation in a zip that claude can easily read

This zip.

---

## Owner’s existing companion (from their README / ARCHITECTURE)

Already true on GitHub before Grok’s sandbox:

- Local-first. No accounts, no analytics. Decks in the browser, JSON export.
- React + Vite (their tree). Node 22+.
- Scryfall for names, prices, legality, images.
- IndexedDB card cache. localStorage for decks / games / guide.
- Learn: scripted first game + lesson modules. **Not** a rules engine.
- Practice table (`#/practice`): small deterministic model over a listed pool (~19 G/R cards). Pure function `(state, action) → next | refusal`.
- Optional WebRTC signal + relay scripts.
- MIT on application code. Wizards IP remains Wizards.

CLAUDE.md tells you to:

- Cite turn-structure **rule numbers** from `docs/TURN_STRUCTURE.md`
- Keep `src/data/turn-structure.js` in sync
- Treat `src/data/set-mechanics.js` and `set-themes.js` as provisional until official freeze
- Migrate old storage forgivingly (`src/lib/board/model.js`)
- Run `npm test` and `npm run test:browser`; `npm run tokens:check` if docs/tokens change

---

## What Grok actually built (sandbox only)

A TanStack Start / Vite prototype, Reality Fracture skinned:

- Home (Hexhaven hero, colleges, featured FRA cards)
- Cards (Scryfall search, default `set:fra`)
- Decks + first-deck wizard
- Learn tracks
- Practice
- Life pad (commander damage matrix)
- Setup → table (reserved-zone grid, inspector rail, hand dock, Pass never covered)

**Do not merge that tree blindly.** Their GitHub app is a different SPA (`src/App.jsx`, `src/lib/*.js`). Port contracts and UX, don’t replace their architecture.

---

## Decisions already made (don’t reopen unless asked)

| Decision | Choice |
| --- | --- |
| Theme | Reality Fracture / Hexhaven / cyan on midnight ink |
| Table layout | Moxgate reserved zones (opponent rail, battlefield, inspector column, action bar, hand dock) |
| Card data | Scryfall live + MTGJSON bulk. Not Moxfield/Archidekt APIs |
| Full rules | Forge or XMage, server-side. Not a homegrown CR |
| Casual play | Existing P2P + hotseat. Serialisable actions, seeded shuffle |
| Moxgate source | Unavailable. UI study only |
| GitHub from Grok | Untouched |
