# 03 — Frontend ↔ backend contract

Match these shapes if you add a server, a worker, or a thicker client store. Names come from the Grok prototype **and** the GitHub architecture notes. Prefer GitHub names when they differ.

---

## Storage

Prototype key: `mtg-companion.v1` (localStorage JSON).

GitHub: versioned localStorage + IndexedDB card cache (`src/lib/cache.js`, `src/lib/storage.js`). **Migrate forgivingly.** Read old decks/tables, fill missing fields, drop unreadable parts, never throw at the user.

```ts
type DeckCard = {
  name: string;          // oracle name — source of truth
  n: number;
  id?: string;           // scryfall id, optional
  set?: string;
  collector?: string;
  image?: string | null;
  typeLine?: string;
  cmc?: number;
  colors?: string[];
};

type SavedDeck = {
  id: string;            // e.g. "d-xxxxxxxx"
  name: string;
  format: string;        // standard | pioneer | modern | commander | pauper | brawl | casual
  commander?: DeckCard;
  cards: DeckCard[];
  note?: string;
  updatedAt: number;     // epoch ms
};

type LifePlayer = {
  id: string;
  name: string;
  life: number;
  poison: number;
  commander: Record<string, number>; // keyed by opponent player id
};

type LifeSession = {
  format: string;
  starting: number;
  players: LifePlayer[];
  history: Array<{ t: number; text: string }>; // do NOT nest LifeSession[]
  dice?: number;
};
```

Example decks on GitHub are stored **by name, not Scryfall ID**, so reprints/set rotations don’t break them.

---

## Formats

```ts
const FORMATS = [
  { id: "standard",  size: 60,  life: 20, copies: 4 },
  { id: "pioneer",   size: 60,  life: 20, copies: 4 },
  { id: "modern",    size: 60,  life: 20, copies: 4 },
  { id: "commander", size: 100, life: 40, copies: 1 },
  { id: "pauper",    size: 60,  life: 20, copies: 4 },
  { id: "brawl",     size: 60,  life: 25, copies: 1 },
];
```

Legality is **live** from Scryfall `legalities` at validation time. Ban lists: fetch on demand, do not freeze them in the repo.

Deck text import (Arena / MTGO / Cockatrice family):

```
3 Island
2 Mountain
1 Sol Ring
Sideboard
1 Forest
```

Also: `3x Forest`, `SB: 1 Island`, `//` comments, `Commander` header.

---

## Scryfall

Base: `https://api.scryfall.com`

Every request:

```
User-Agent: MTGCompanion/1.0
Accept: application/json;q=0.9,*/*;q=0.8
```

| Call | URL | Min spacing |
| --- | --- | --- |
| Search | `GET /cards/search?q=&page=&unique=cards` | 500ms |
| Named fuzzy | `GET /cards/named?fuzzy=` | 500ms |
| By id | `GET /cards/{id}` | 100ms |
| Collection | `POST /cards/collection` ≤75 ids | 500ms |
| Set | `GET /sets/fra` | 100ms |
| Bulk index | `GET /bulk-data` | 100ms |

Default search in the FRA-themed UI: `set:fra` (also written `e:fra`).

Card object fields the UI actually uses:

```
id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
power, toughness, colors, color_identity, keywords, rarity,
set, set_name, collector_number, artist, image_uris, card_faces,
prices.usd, legalities, produced_mana
```

Images: prefer `image_uris.normal`; DFC fallback `card_faces[0].image_uris`. Never crop copyright. For `art_crop`, show artist + copyright on the same screen.

Catalog ingest: download Scryfall **bulk** (`jsonl.gz`) or MTGJSON `AllPrintings.json`. Do not paginate the whole site.

---

## Table (small model, not CR)

GitHub practice table: one pure function `(state, action) → { state, events } | { refuse, reason }`.

Prototype action union (serialisable, no clocks except seeded shuffle):

```ts
type Zone =
  | "library" | "hand" | "battlefield" | "graveyard"
  | "exile" | "stack" | "command";

type Phase =
  | "untap" | "upkeep" | "draw" | "main1"
  | "attackers" | "blockers" | "damage" | "main2" | "end";

type Action =
  | { type: "play-land"; iid: string }
  | { type: "cast"; iid: string }
  | { type: "activate"; iid: string }
  | { type: "choose-target-card"; iid: string }
  | { type: "choose-target-player"; player: 0 | 1 }
  | { type: "toggle-attack"; iid: string }
  | { type: "toggle-block"; blocker: string; attacker: string }
  | { type: "confirm-attackers" }
  | { type: "confirm-blockers" }
  | { type: "pass" }
  | { type: "undo" }
  | { type: "concede"; player: 0 | 1 };
```

Which **row** a card belongs in travels **in the action**, not via a local lookup. Two devices applying the same actions in the same order reach the same table (ARCHITECTURE.md).

Priority, stack, phases: **only** from `docs/TURN_STRUCTURE.md` + `src/data/turn-structure.js`. Cite rule numbers in comments/tests.

If you need real Oracle enforcement (FRA mechanics: Empower Jace, Heartwood, Prepare): **do not extend this union into a CR**. Host Forge or XMage.

---

## P2P

Existing scripts on GitHub:

- `scripts/signal-server.mjs` — `npm run signal`
- `scripts/relay-server.mjs` — `npm run relay`

Prototype RTC poll shapes:

```ts
type SignalKind = "offer" | "answer" | "ice";

interface PeerRow { id: string; name: string }
interface SignalRow { id: number; from: string; kind: SignalKind; payload: unknown }
interface RtcPollResponse { peers: PeerRow[]; signals: SignalRow[] }
```

Perfect negotiation: polite peer = lexicographically smaller id. Client-authoritative for casual. Rules-enforced play is a **different** server.

---

## Hexhaven colleges (UI queries)

| id | Name | School | Colours | Scryfall |
| --- | --- | --- | --- | --- |
| fatehold | Fatehold | Future History | WU | `set:fra id:wu` |
| theorix | Theorix | Esoteric Mathematics | UB | `set:fra id:ub` |
| stingerquill | Stingerquill | Painful Words | BR | `set:fra id:br` |
| konstrari | Konstrari | Constructive Arts | RG | `set:fra id:rg` |
| vigorbloom | Vigorbloom | Invasive Healing | GW | `set:fra id:gw` |

Featured names the home page resolved via `/cards/named?fuzzy=`:

- The Theorist, Jace Beleren
- Chandra, Chill of Compliance
- Omnipresence
- Hexhaven Invigorator
- Jace, Reality Sculptor
- Emrakul, the Exigent Doom

Resolve by **name**. IDs change with printings.

---

## GitHub files that are the real contract

| Path | Role |
| --- | --- |
| `src/lib/scryfall.js` | API client |
| `src/lib/cache.js` | IndexedDB |
| `src/lib/storage.js` | localStorage |
| `src/lib/formats.js` | formats |
| `src/lib/deck.js` | validation |
| `src/lib/board/model.js` | board + migrations |
| `src/lib/game.js` | event-log play companion |
| `src/data/turn-structure.js` | phases/steps |
| `src/data/set-mechanics.js` | FRA mechanics (provisional) |
| `src/data/set-themes.js` | season theme |
| `src/data/example-decks.js` | decks by name |
| `tests/*.test.js` | must stay green |

Commands: `npm test` · `npm run test:browser` · `npm run tokens:check`
