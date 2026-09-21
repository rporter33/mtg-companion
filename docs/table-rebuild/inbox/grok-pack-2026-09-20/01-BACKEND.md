# MTG Companion — Backend builder pack

Useful sources for building the **backend** of [rporter33/mtg-companion](https://github.com/rporter33/mtg-companion).

**Moxgate has no public repository.** [moxgate.com](https://www.moxgate.com) is a closed product. Rules-enforced games there are powered by **Forge**, run server-side. This pack is what you actually build against.

The companion repo is local-first: Scryfall + IndexedDB + optional P2P. A full rules engine is **not** in that design unless you add one on purpose.

---

## 1. Your repo (give these to Claude first)

| What | Link |
| --- | --- |
| Repo | https://github.com/rporter33/mtg-companion |
| Architecture | https://github.com/rporter33/mtg-companion/blob/main/ARCHITECTURE.md |
| Claude handoff | https://github.com/rporter33/mtg-companion/blob/main/CLAUDE.md |
| Project brief | https://github.com/rporter33/mtg-companion/blob/main/docs/PROJECT_BRIEF.md |
| Turn / stack / priority | https://github.com/rporter33/mtg-companion/blob/main/docs/TURN_STRUCTURE.md |
| Reality Fracture set notes | https://github.com/rporter33/mtg-companion/blob/main/docs/REALITY_FRACTURE_SET_REFERENCE.md |
| Moxgate UI study | https://github.com/rporter33/mtg-companion/blob/main/docs/MOXGATE_STUDY.md |
| Docs index | https://github.com/rporter33/mtg-companion/blob/main/docs/README.md |
| Art direction | https://github.com/rporter33/mtg-companion/blob/main/docs/ART_DIRECTION.md |
| Universe / design reference | https://github.com/rporter33/mtg-companion/blob/main/docs/MTG_UNIVERSE_AND_DESIGN_REFERENCE.md |
| Table rebuild notes | https://github.com/rporter33/mtg-companion/tree/main/docs/table-rebuild |
| Signal server | https://github.com/rporter33/mtg-companion/blob/main/scripts/signal-server.mjs |
| Relay server | https://github.com/rporter33/mtg-companion/blob/main/scripts/relay-server.mjs |
| Scryfall client | https://github.com/rporter33/mtg-companion/blob/main/src/lib/scryfall.js |

Also in `docs/` (UI / content, not engine):

- [LEARN_EVALUATION.md](https://github.com/rporter33/mtg-companion/blob/main/docs/LEARN_EVALUATION.md)
- [ASSET_PACK.md](https://github.com/rporter33/mtg-companion/blob/main/docs/ASSET_PACK.md)
- [artwork.json](https://github.com/rporter33/mtg-companion/blob/main/docs/artwork.json)
- [design-tokens.json](https://github.com/rporter33/mtg-companion/blob/main/docs/design-tokens.json)

---

## 2. Card data (the real data layer)

### Scryfall

Live search, images, legality, prices, rulings.

Required headers on every `api.scryfall.com` request:

- `User-Agent` — name of the app, e.g. `MTGCompanion/1.0` (do not let the HTTP library invent one)
- `Accept` — `application/json;q=0.9,*/*;q=0.8` is fine

Cache at least **24 hours**. Do not crawl card-by-card. Use **bulk** for catalogs.

| What | Link |
| --- | --- |
| API docs | https://scryfall.com/docs/api |
| Rate limits | https://scryfall.com/docs/api/rate-limits |
| Bulk files | https://scryfall.com/docs/api/bulk-data |
| Bulk index (JSON) | https://api.scryfall.com/bulk-data |
| Search syntax | https://scryfall.com/docs/syntax |
| Named lookup | https://scryfall.com/docs/api/cards/named |
| Collection (≤75 IDs) | https://scryfall.com/docs/api/cards/collection |
| Sets | https://scryfall.com/docs/api/sets |
| Rulings | https://scryfall.com/docs/api/rulings |
| Rulings by set/number | https://scryfall.com/docs/api/rulings/collector |
| Blocked / 429 FAQ | https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17 |

**Hard rate limits**

| Endpoint | Limit |
| --- | --- |
| `/cards/search` | 2/sec (500ms) |
| `/cards/named` | 2/sec |
| `/cards/random` | 2/sec |
| `/cards/collection` | 2/sec, max 75 identifiers |
| `/cards/manifest` | 10/min |
| Everything else | 10/sec (100ms) |
| `*.scryfall.io` images | no rate limit |

Your repo client already spaces requests (~100ms) in `src/lib/scryfall.js`. Collection/search/named need **500ms**.

**Reality Fracture on Scryfall**

| What | Link |
| --- | --- |
| FRA set object | https://api.scryfall.com/sets/fra |
| FRA cards | https://api.scryfall.com/cards/search?q=e:fra |
| FRA human page | https://scryfall.com/sets/fra |
| FRC (Commander cards) | https://api.scryfall.com/sets/frc |

Set codes: **FRA** (main, Standard-legal) · **FRC** (Commander). Release **2026-10-02**. Prerelease **2026-09-25**.

### MTGJSON

Offline snapshot, types, prices, identifiers. Better for a server catalog than hitting Scryfall per card.

| What | Link |
| --- | --- |
| Docs | https://mtgjson.com/ |
| FAQ | https://mtgjson.com/faq/ |
| API files | https://mtgjson.com/api/v5/ |
| AllPrintings | https://mtgjson.com/api/v5/AllPrintings.json |
| Checksum example | https://mtgjson.com/api/v5/AllPrintings.json.sha256 |
| TypeScript types | https://mtgjson.com/types/AllMTGJSONTypes.ts |
| CardAtomic type | https://mtgjson.com/types/CardAtomic.ts |
| CardSet type | https://mtgjson.com/types/CardSet.ts |
| Set type | https://mtgjson.com/types/Set.ts |
| Deck type | https://mtgjson.com/types/Deck.ts |
| Source | https://github.com/mtgjson/mtgjson |
| GraphQL (tokened) | `POST https://graphql.mtgjson.com/` |

Images: MTGJSON does not host art. Join on `scryfallId` and fetch from Scryfall / `*.scryfall.io`.

### Other card APIs

| What | Link | Note |
| --- | --- | --- |
| magicthegathering.io | https://api.magicthegathering.io/ | MTGJSON-backed REST. Issues: https://github.com/MagicTheGathering/mtg-api |

Moxfield, Archidekt, Deckstats, TappedOut, MTGGoldfish, EDHREC do **not** have a supported public API. Parse pasted lists. Do not scrape.

---

## 3. Rules engines (do not write Magic rules from scratch)

Moxgate’s enforced mode is **Forge, hosted by them**. You can run the same engine yourself.

| Engine | Link | Use |
| --- | --- | --- |
| **Forge** (what Moxgate uses) | https://github.com/Card-Forge/forge | Server-side rules + AI. GPL-3.0. Java. |
| Forge extras | https://github.com/Card-Forge/forge-extras | Decks / extra content |
| Forge site / user guide | https://card-forge.github.io/forge/ | Builds and guide |
| Forge wiki (User Guide) | https://github.com/Card-Forge/forge/wiki/User-Guide | |
| **XMage** | https://github.com/magefree/mage | Full online engine, ~9k tests, server + client |
| XMage wiki | https://github.com/magefree/mage/wiki | Hosting, formats, cards |
| XMage play | https://xmage.today/ | Public servers |
| LLM bridge on XMage | https://github.com/GregorStocks/mage-bench | MCP tools over the engine |

Moxgate terms (Forge is *not* Moxgate): https://www.moxgate.com/terms

Moxgate is explicit: the Forge engine is **never bundled in the browser**. The client talks to it over a network protocol. That is the license-safe shape if you use Forge (GPL-3.0).

---

## 4. Official rules (Reality Fracture)

| What | Link |
| --- | --- |
| Rules hub | https://magic.wizards.com/en/rules |
| Comprehensive Rules (Jun 19, 2026 PDF) | https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf |
| FRA mechanics | https://magic.wizards.com/en/news/feature/reality-fracture-mechanics |
| FRA release notes | https://magic.wizards.com/en/news/feature/reality-fracture-release-notes |
| FRA prerelease guide | https://magic.wizards.com/en/news/feature/reality-fracture-prerelease-guide |
| FRA product page | https://magic.wizards.com/en/products/reality-fracture |
| Ban / restricted | https://magic.wizards.com/en/banned-restricted-list |
| Formats | https://magic.wizards.com/en/formats |

**FRA mechanics to implement or teach**

- **Empower Jace** — keyword action; creates / upgrades a Jace planeswalker token
- **Heartwood tokens** — predefined RG artifact tokens (`{T}: Add {R} or {G}`)
- **Prepare** — exile a copy; the controller of the prepared creature casts it

In-repo source of truth for turn structure remains [docs/TURN_STRUCTURE.md](https://github.com/rporter33/mtg-companion/blob/main/docs/TURN_STRUCTURE.md), stored in `src/data/turn-structure.js` and checked by `tests/turn-structure.test.js`.

---

## 5. Deck interchange (import / export)

| What | Link |
| --- | --- |
| Cockatrice list format | https://github.com/Cockatrice/Cockatrice/wiki/Deck-List-Import-Formats |
| Cockatrice (app) | https://github.com/Cockatrice/Cockatrice |
| Cockatrice custom XML cards | https://github.com/Cockatrice/Cockatrice/wiki/Custom-Cards-&-Sets |

**Text list (Arena / MTGO / Cockatrice family)**

```
3 Island
2 Mountain
1 Sol Ring
Sideboard
1 Forest
2 Mountain
```

Also accepted: `3x Forest`, `SB: 1 Island`, `//` comments, blank lines ignored. Commander lists typically put the commander first or under a `Commander` header.

---

## 6. Multiplayer (your repo already started this)

You already have WebRTC signaling + a relay. That is the right shape for **casual** play (no full rules server).

| What | Link |
| --- | --- |
| Signal server | https://github.com/rporter33/mtg-companion/blob/main/scripts/signal-server.mjs (`npm run signal`) |
| Relay server | https://github.com/rporter33/mtg-companion/blob/main/scripts/relay-server.mjs (`npm run relay`) |
| WebRTC | https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection |

If you want **rules-enforced** multiplayer, do not extend that relay into a rules engine. Put **Forge or XMage** behind a network protocol — the same split Moxgate uses.

ARCHITECTURE.md: every table action is small, serialisable, clock-free; the only randomness is a seeded shuffle; which row a card belongs in travels *in* the action. Two devices applying the same actions in the same order reach the same table.

---

## 7. Legal (must follow)

| What | Link |
| --- | --- |
| Wizards Fan Content Policy | https://company.wizards.com/en/legal/fancontentpolicy |
| Scryfall data / image rules | https://scryfall.com/docs/api |
| Forge license | GPL-3.0 — https://github.com/Card-Forge/forge |
| Companion license | MIT — https://github.com/rporter33/mtg-companion/blob/main/LICENSE |

**Hard constraints**

- Fan content must be **free**. No paywall, survey, or account required to see card data.
- Do not imply Wizards or Scryfall endorsement.
- Do not crop, distort, watermark, or recolor card images. Keep artist credit and copyright visible. For `art_crop`, show artist + copyright somewhere on the same screen.
- Do not redistribute Oracle text / card images as a verbatim dump. The app has to add value.
- If you **ship Forge in the client**, the client inherits GPL-3.0. Keep Forge **server-side only** if you want to stay MIT on the companion code.

---

## 8. Practical split for Claude

1. **Catalog / search / decks / legality / prices**  
   Scryfall live + MTGJSON bulk. Rate-limit in `src/lib/scryfall.js`. Legality from Scryfall’s `legalities` object at validation time, not a static dump. Ban lists: fetch on demand.

2. **Learn / practice table**  
   Stay in `docs/TURN_STRUCTURE.md` + `src/lib/board/`. Small deterministic model over a listed pool — **not** a full rules engine. CLAUDE.md is explicit about this.

3. **Rules-enforced table**  
   Host Forge or XMage. Talk to it over a protocol. Do not reimplement the Comprehensive Rules.

4. **Hotseat / P2P casual**  
   Existing signal + relay. Serialisable actions, seeded shuffle.

5. **Reality Fracture content**  
   Scryfall `e:fra` / `e:frc`  
   + [REALITY_FRACTURE_SET_REFERENCE.md](https://github.com/rporter33/mtg-companion/blob/main/docs/REALITY_FRACTURE_SET_REFERENCE.md)  
   + Wizards mechanics / release notes  
   + in-repo `src/data/set-mechanics.js` and `src/data/set-themes.js` (provisional until official freeze)

6. **Storage**  
   `localStorage` for decks / games / guide progress. IndexedDB for the card cache. Migrations in `src/lib/board/model.js`: read old data forgivingly, fill missing fields, drop unreadable parts, never surface a migration error.

---

## 9. In-repo files Claude should treat as the contract

From ARCHITECTURE.md and CLAUDE.md:

| Path | Role |
| --- | --- |
| `src/lib/scryfall.js` | API client, rate limit, retries, 429 handling |
| `src/lib/cache.js` | IndexedDB card cache, pin / evict |
| `src/lib/storage.js` | localStorage for decks, games, guide |
| `src/lib/formats.js` | format defs, deck sizes, copy limits, commander eligibility |
| `src/lib/deck.js` | deck model + validation |
| `src/lib/board/model.js` | board state + migrations |
| `src/lib/game.js` | play companion as event log |
| `src/data/turn-structure.js` | five phases / steps / priority (must match TURN_STRUCTURE.md) |
| `src/data/set-mechanics.js` | curated set mechanics |
| `src/data/set-themes.js` | set themes / season engine |
| `src/data/example-decks.js` | example decks by **name**, not Scryfall ID |
| `tests/scryfall.test.js` | Scryfall client tests |
| `tests/turn-structure.test.js` | turn structure sync |
| `tests/board-restore.test.js` | board migrations |
| `tests/deck.test.js` | deck validation |

Commands after any change: `npm test`. Browser suite: `npm run test:browser` against a built preview. Token CSS / docs: `npm run tokens:check`.

---

## 10. What not to do

- Do not clone or scrape **Moxgate**. There is no public source. Study the live UI only ([moxgate.com](https://www.moxgate.com), [bugs](https://www.moxgate.com/bugs/), [terms](https://www.moxgate.com/terms)).
- Do not build a general Magic rules engine. Use Forge or XMage, or stay on the small practice model.
- Do not hammer Scryfall for a full catalog. Download bulk (`jsonl.gz`) and process locally.
- Do not ignore HTTP 429. Back off. Scryfall will block you.
- Do not fetch Moxfield / Archidekt / EDHREC pages as an API.

---

## 11. Quick copy-paste list (plain URLs)

```
https://github.com/rporter33/mtg-companion
https://github.com/rporter33/mtg-companion/blob/main/ARCHITECTURE.md
https://github.com/rporter33/mtg-companion/blob/main/CLAUDE.md
https://github.com/rporter33/mtg-companion/blob/main/docs/PROJECT_BRIEF.md
https://github.com/rporter33/mtg-companion/blob/main/docs/TURN_STRUCTURE.md
https://github.com/rporter33/mtg-companion/blob/main/docs/REALITY_FRACTURE_SET_REFERENCE.md
https://github.com/rporter33/mtg-companion/blob/main/docs/MOXGATE_STUDY.md
https://github.com/rporter33/mtg-companion/blob/main/scripts/signal-server.mjs
https://github.com/rporter33/mtg-companion/blob/main/scripts/relay-server.mjs
https://github.com/rporter33/mtg-companion/blob/main/src/lib/scryfall.js

https://scryfall.com/docs/api
https://scryfall.com/docs/api/rate-limits
https://scryfall.com/docs/api/bulk-data
https://api.scryfall.com/bulk-data
https://scryfall.com/docs/syntax
https://scryfall.com/docs/api/cards/named
https://scryfall.com/docs/api/cards/collection
https://scryfall.com/docs/api/sets
https://scryfall.com/docs/api/rulings
https://api.scryfall.com/sets/fra
https://api.scryfall.com/cards/search?q=e:fra
https://scryfall.com/sets/fra

https://mtgjson.com/
https://mtgjson.com/api/v5/
https://mtgjson.com/api/v5/AllPrintings.json
https://mtgjson.com/types/AllMTGJSONTypes.ts
https://github.com/mtgjson/mtgjson

https://github.com/Card-Forge/forge
https://github.com/Card-Forge/forge-extras
https://card-forge.github.io/forge/
https://github.com/Card-Forge/forge/wiki/User-Guide
https://github.com/magefree/mage
https://github.com/magefree/mage/wiki
https://xmage.today/
https://github.com/GregorStocks/mage-bench
https://www.moxgate.com/terms

https://magic.wizards.com/en/rules
https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf
https://magic.wizards.com/en/news/feature/reality-fracture-mechanics
https://magic.wizards.com/en/news/feature/reality-fracture-release-notes
https://magic.wizards.com/en/news/feature/reality-fracture-prerelease-guide
https://magic.wizards.com/en/products/reality-fracture
https://magic.wizards.com/en/banned-restricted-list
https://magic.wizards.com/en/formats

https://github.com/Cockatrice/Cockatrice
https://github.com/Cockatrice/Cockatrice/wiki/Deck-List-Import-Formats
https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection

https://company.wizards.com/en/legal/fancontentpolicy
https://github.com/rporter33/mtg-companion/blob/main/LICENSE
```
