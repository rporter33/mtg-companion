# The sources, read against the repo

A builder pack, assembled by another model for the owner and handed over on
2026-09-20, lists what a backend for this app could be built against. This
is that pack read the way `CREATOR-POST.md` was read: every claim that can be
checked against the repo or a reachable source is checked, and what changed
because of it is written down. A claim this document could not verify is
marked as such, not repeated as fact.

Two things it settled before anything else.

**Moxgate has no public repository.** The owner asked for a deep read of the
developer's GitHub. There is none: Moxgate is a closed product, and the pack
says so in its first line. The Reddit post in `CREATOR-POST.md` and the
frames in `frames/` remain the only first-hand evidence of how it is built
and how it looks. The pack's own rule — "do not clone or scrape Moxgate;
study the live UI only" — is the rule this repo was already following.

**The pack agrees with `ENGINE.md` on the shape and disagrees on the engine.**
It says: run the rules engine server-side, behind a protocol, never in the
browser, and do not write the Comprehensive Rules yourself. That is Phase 3
exactly. It then names Forge or XMage for the engine. `ENGINE.md` chose
Argentum after running it (`SPIKE.md`), and nothing in the pack changes that:
Forge is GPL-3.0 and Java, which is why the pack itself insists it stay
server-side; Argentum is the engine this repo has measured. The pack does not
mention Argentum at all, which says only that its author did not look.

---

## What was checked

| Claim in the pack | Checked against | Result | Change |
| --- | --- | --- | --- |
| Scryfall holds `/cards/search`, `/cards/named`, `/cards/random` and `/cards/collection` to 2/sec (500 ms) and everything else to 10/sec (100 ms) | `src/lib/scryfall.js` spaced every request 100 ms. scryfall.com is unreachable from the build container, so the per-endpoint figures could not be read at source. | **Unverified, adopted.** Being slower than a limit costs a person nothing they can feel — a search is one request, a deck import two — and being faster costs everyone a 429. | The queue now spaces a request by its endpoint: 500 ms before those four, 100 ms before the rest. `tests/scryfall.test.js` covers the split. |
| Set a descriptive `User-Agent` on every request | `src/lib/scryfall.js` lines 8–10 | Browsers forbid scripts from setting that header. The file already says so. | None possible from a client. A server-side proxy could, and the file notes that the parts the client *can* honour, it does. |
| Cache at least 24 hours; use bulk for catalogues; do not crawl card by card | `src/lib/cache.js`: queries a day, cards a week; `docs/table-rebuild/PLAN.md`, "common-card bundle" | Already true. The bundle is written and blocked only on a machine that can reach Scryfall. | None. |
| Scryfall bulk files are `jsonl.gz` | https://api.scryfall.com/bulk-data (unreachable here); the app's own earlier bulk work | **Wrong as written.** Scryfall's bulk files are JSON arrays (gzip is the transfer encoding, not the file), not JSON Lines. Anyone streaming them line by line gets one line. | None; noted so nobody builds on it. |
| `/cards/collection` takes at most 75 identifiers | `src/lib/scryfall.js`, the collection lookups | Already batched at 75. | None. |
| Reality Fracture: codes FRA and FRC, release 2026-10-02, prerelease 2026-09-25, mechanics Empower Jace, Heartwood tokens, Prepare | `docs/REALITY_FRACTURE_SET_REFERENCE.md`, `src/data/set-mechanics.js` | All three mechanics and the release date are already present and marked provisional until the official freeze. | None. |
| Decklists: `3x Forest`, `SB: 1 Island`, `//` comments, a `Sideboard` header | `src/lib/decklist.js`, run on the pack's own sample | `3x`, `//`, blank lines and the header all worked. **`SB: 2 Plains` on its own line was dropped** — the parser knew `SB:` only as a header. | The prefix now places that one line in the sideboard and leaves the section alone. Test added. |
| Moxfield, Archidekt, Deckstats, TappedOut, MTGGoldfish, EDHREC have no supported public API; parse pasted lists, do not scrape | `src/features/decks/DeckImportExport.jsx`, `src/lib/deck-sources.js` | The app reads pasted exports. A URL is read directly only where the site sends CORS headers that allow it, found out at runtime; otherwise the app names the export button to press on that site, with the paste box open. Nothing is scraped, and the file says why in its first comment. | None. |
| Fan content must be free, with no paywall or account | The app | No accounts, no payments, no survey. | None. |
| Do not crop, distort, watermark or recolour card images; **for `art_crop`, show artist and copyright on the same screen** | Every screen that shows an art crop | The whole-card views show the printed face, which carries both. The table's tiles, the log's thumbnails, the lobby's shelf, the Decks list and the editor's header and rows show Scryfall's `art_crop` — the painting alone — and none of those screens said whose it was. The only artist credit was one row in the card detail panel. | Each of those screens now carries the Fan Content line the practice screens already had, naming Wizards of the Coast and the artists; on the table the selected card's actions panel also names its artist (`art by …`, from Scryfall's `artist` field). Custom cards, which have no Scryfall artist, say nothing. |
| Keep Forge server-side to stay MIT on the companion | `ENGINE.md`, `PLAN.md` Phase 3 | The transport boundary the relay already draws is the boundary the pack describes. Argentum sits behind it just as Forge would. | None. |
| Storage: localStorage for decks and games, IndexedDB for cards, migrations that read forgivingly | `src/lib/storage.js`, `src/lib/cache.js`, `src/lib/board/model.js` | True, and the house rule in `CLAUDE.md`. | None. |
| Every table action is small, serialisable and clock-free; the only randomness is a seeded shuffle | `ARCHITECTURE.md`, `src/lib/board/reducer.js` | True. Dice rolls carry a seed in the action for the same reason. | None. |
| The in-repo file table (section 9) | The tree | Accurate: every path exists and does what the pack says, and `upgrade()` is in `src/lib/board/model.js` where it points. | None. |

## What the pack could not help with

- **The look.** The owner still likes Moxgate's look, and the pack is a
  backend pack: it has nothing on the interface. `TARGET.md` and `frames/`
  remain the whole of the visual evidence. The parchment playmat from those
  frames is now the table's (`TARGET.md` §7); the chrome around it stays the
  app's own dark and gold rather than Moxgate's purple, which is a brand, not
  a table.
- **Verifying Scryfall's limits.** `scryfall.com` and `api.scryfall.com`
  return 403 from the build container. The per-endpoint figures above should
  be read against https://scryfall.com/docs/api/rate-limits from a machine
  that can reach it, and this table corrected if they differ.
- **The engines it names.** `github.com` HTML and its API are also blocked;
  only `raw.githubusercontent.com` answers. Forge's README confirmed GPL-3.0
  and nothing more. XMage's and mage-bench's README paths returned 404.
  Neither changes the Argentum decision.

## What stays as it was

Nothing in the pack moved the plan. It confirmed the transport boundary, the
storage rules, the deck formats and the set content, corrected one parser
gap, tightened one rate limit, and added a credit line that a legal reading
of the Fan Content Policy would have asked for anyway. Multiplayer stays
built and unadvertised until the client is robust; the engine stays Phase 3.


---

## The Grok preview — read 2026-09-21

The owner pasted a Grok conversation (`inbox/grok-2026-09-21-reality-fracture-preview.md`)
in which Grok describes a *preview* of this app it restyled for Reality
Fracture, built "from Moxgate's UI, not from their source", and then
repeats the backend pack checked above. The preview is not in the repo and
was not seen; only Grok's description of it was. The paste ends
mid-sentence, so anything after "I have not touched" is unknown.

| What Grok's preview has | Checked against | Result | Change |
| --- | --- | --- | --- |
| "Midnight ink, cyan fracture light" as the whole app's look | `src/lib/season.js`, `src/data/set-themes.js`, `tests/browser/theme.spec.mjs` | Already built, as a **season**: while Reality Fracture is the focus the root wears the `fra` theme, the accent is the set's cyan app-wide, the shell is the indigo void, headings take the theory face, and the banner says its colours and lore are the app's reading, not official. The house rule makes it seasonal and provisional until release, not permanent. | None. The owner's standing preference is Moxgate's look for the table; the season colours the shell around it. |
| "Jace's tower on the home screen" | `docs/ART_DIRECTION.md`, `set-themes.js` `art.wide/portrait`, `CLAUDE.md` IP boundaries | The app's hero is its own generated art (the Echoverse hero, the Sanctum portrait), by the art direction's prompts. A depiction of the Theorist's Tower would be Wizards' setting drawn on purpose, which the IP rule does not allow beyond Scryfall's own images under the Fan Content Policy. | None. |
| "Tap a Hexhaven college" on Home | `set-themes.js` `schools` (five allied pairs, emblems, disciplines) | The five schools exist as data with the app's own emblems and are shown in Learn during the season. There is no Home tab; Learn's season banner is the equivalent surface. | Nothing new to build; noted for the season's Learn surface. |
| Cards: "Live Scryfall, default `set:fra`" | `src/features/cards/CardsView.jsx` | The Cards tab starts empty with "Try one of these" suggestions; none is season-aware. | **Adopted, small:** while a set is the focus, the first suggestion is that set's cards (`e:fra`), dated and provisional like the rest of the season. In `HANDOFF.md` M0. |
| "Preview never covers Pass" | `src/features/game/Peek.jsx`, `.prompt` in `game.css` | The hover preview of a card in hand is placed *above* the card, which is the bottom of the battlefield, which is where the prompt panel with Pass sits. **It can cover Pass.** | **Adopted:** the preview avoids the prompt's rectangle. In `HANDOFF.md` M1b, with a screenshot. |
| "Playable cards glow; targets glow cyan" | `table.css` (only the arrived-this-turn glow exists), `Table.jsx` engine mode | At the engine's table the offers say which cards are playable (`meaningful && affordable`) and a targets decision says which are legal, and neither is shown on the cards themselves. `TARGET.md` §11 asked for the castability glow. | **Adopted:** a playable glow on hand cards with an affordable offer, a target glow on legal targets while a decision asks for one, in the set's cyan where the season is on and the accent otherwise. In `HANDOFF.md` M1b. |
| "Three-step sit-down: seat, format, deck" | `Lobby.jsx`, `Seats.jsx` | The lobby is one screen: format tabs, the deck shelf, the seats panel; the seat (alone, together, the engine) is chosen first because the room is opened before the deck. The order is the same; the steps are not separate screens. | None; the deck gate in M1 keeps that order. |
| "Reserved bands: opponent, board, inspector, hand" | `game.css` grid areas `them`, `field`, `you`, `side` | The same four bands, by other names. | None. |
| Life pad: "1–6 players, commander damage, poison, dice, undo" | `src/features/play/PlayView.jsx` | Commander damage, poison, dice and undo are there; the board lays out by player count. *Verify* the count runs to six. | None unless the count is short. |
| "Paper date on the hero is October 2. Prerelease is already this week." | `set-themes.js`, `docs/REALITY_FRACTURE_SET_REFERENCE.md` | Release 2026-10-02 and prerelease 2026-09-25 are recorded and the countdown is drawn from them. | None. |
| The backend pack, repeated | This document, above | Same claims; same results. The rate-limit figures remain unverified from here. | None beyond M0's verification on the owner's machine. |

Two things the preview description does not change: the engine decision
(Grok names Forge and XMage; `ENGINE.md` chose Argentum after running it),
and the look of the table itself, which the owner chose (parchment playmat
after the Moxgate frames, the app's dark and gold chrome, the season's cyan
when the season is on).
