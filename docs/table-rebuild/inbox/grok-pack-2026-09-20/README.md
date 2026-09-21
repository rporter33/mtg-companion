# Claude handoff — MTG Companion (Reality Fracture)

**Read this file first.** Then read the numbered docs in order.

This zip is a conversation dump from Grok (frontend / UX) to **Claude (backend)** for [rporter33/mtg-companion](https://github.com/rporter33/mtg-companion).

Date of pack: **2026-09-20**.

Owner: **Oberon** (`robporter343`). Repo: **do not push from the Grok sandbox.** Claude works on the GitHub repo; this zip is context only.

---

## What you are

You are implementing / extending the **backend and game logic** of MTG Companion. Another agent (Grok) built a Reality Fracture–themed frontend prototype inspired by Moxgate’s table UX. The owner’s GitHub repo is the source of truth for the real app.

## Hard constraints (do not violate)

1. **Do not affect the GitHub repo from this pack.** This zip is not a PR. Copy ideas, not the Grok sandbox tree.
2. **Moxgate has no public source.** Do not clone, scrape, or reimplement moxgate.com. Study UI only. Rules-enforced Moxgate games use **Forge**, server-side.
3. **Do not write a general Magic rules engine.** Use Forge or XMage if you need enforcement. The companion’s own table is a small deterministic model.
4. **Stay local-first** unless the owner asks otherwise: no accounts required, decks in the browser, JSON export.
5. **Scryfall rate limits are real.** `/cards/search|named|collection` = **2/sec**. Bulk for catalogs. `User-Agent` + `Accept` on every call.
6. **Fan Content Policy.** Free, no paywall on card data, no cropping copyright off images, no implying Wizards/Scryfall endorsement.
7. **GPL trap.** If you ship Forge *in the client*, the client inherits GPL-3.0. Keep Forge server-side to stay MIT on companion code.

---

## Read in this order

| # | File | Why |
| --- | --- | --- |
| 0 | [00-CONVERSATION.md](00-CONVERSATION.md) | What the owner asked, in order |
| 1 | [01-BACKEND.md](01-BACKEND.md) | Every useful URL to build against |
| 2 | [02-FRONTEND.md](02-FRONTEND.md) | What the Grok prototype actually shipped |
| 3 | [03-CONTRACT.md](03-CONTRACT.md) | Types, storage keys, actions — match these |
| 4 | [04-REALITY-FRACTURE.md](04-REALITY-FRACTURE.md) | Set identity, colleges, mechanics, FRA/FRC |
| 5 | [05-MOXGATE-UX.md](05-MOXGATE-UX.md) | Table UX to preserve (reserved zones) |
| — | [screenshots/README.md](screenshots/README.md) | Captioned stills of Moxgate + the prototype |

Then open the owner’s repo and **their** `CLAUDE.md`, `ARCHITECTURE.md`, `docs/TURN_STRUCTURE.md`. Those override this pack if they conflict.

---

## One-paragraph product

MTG Companion is a **local-first Magic companion**: card search (Scryfall syntax), format-aware decks, first-deck wizard, learn tracks, a small practice table, a life pad, and (optional) P2P/hotseat play. Theme it for **Reality Fracture** (set code `fra`, Commander `frc`, release 2026-10-02): midnight ink, cyan fracture `#5ec8e8`, Hexhaven colleges, Jace / The Theorist. Table UX should feel like Moxgate: reserved zones so the hand dock and inspector **never** cover Pass.

## Split of labor

| Surface | Owner |
| --- | --- |
| Catalog, search, legality, prices, bulk ingest | You (Claude) + Scryfall/MTGJSON |
| Deck validation, import/export, storage migrations | You |
| Learn / practice table (small model) | You — `docs/TURN_STRUCTURE.md` + `src/lib/board/` |
| Rules-enforced table | You — host **Forge** or **XMage**, network protocol, not in-browser |
| Casual P2P | You — existing `scripts/signal-server.mjs` + `relay-server.mjs` |
| Visual identity, reserved-zone table chrome, FRA theming | Grok prototype (this zip) — port the *ideas*, not the Vite/TanStack tree unless asked |

## Screenshots at a glance

- `screenshots/moxgate-*` — live Moxgate (source of table UX)
- `screenshots/home-hero.png`, `cards-fra.png`, `life-pad.png`, `learn-tracks.png` — prototype surfaces
- `screenshots/table-play.png`, `table-land.png` — reserved-zone table with inspector open
