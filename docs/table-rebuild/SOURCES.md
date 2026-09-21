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
| Scryfall holds `/cards/search`, `/cards/named`, `/cards/random` and `/cards/collection` to 2/sec (500 ms) and everything else to 10/sec (100 ms) | https://scryfall.com/docs/api/rate-limits, read 2026-09-20 from the owner's machine, HTTP 200. | **Verified, and the pack was right, digit for digit.** The page names one case the pack omits: `/cards/manifest` at 10/minute (6,000 ms). It also says a 429 shuts an application out for thirty seconds, and that ignoring one is not acceptable. | The browser client was already correct and its intervals are unchanged. They moved to `src/lib/scryfall-limits.js`, with the manifest case added, because six Node scripts under `scripts/` were spacing those same 500 ms endpoints at 120 ms or 350 ms and now share one source of truth. The 429 path waits out the lockout instead of retrying inside it. `tests/scryfall.test.js` covers the split and the lockout. |
| Set a descriptive `User-Agent` on every request | https://scryfall.com/docs/api, "Required Headers", read 2026-09-20; `src/lib/scryfall.js` | **This row was wrong.** Scryfall requires a `User-Agent` and an `Accept` header, and for on-page browser JavaScript it says to "keep the browser's User-Agent intact". A browser client therefore complies by leaving the header alone, which is exactly what this one does. | The comment in `src/lib/scryfall.js` said we "cannot comply from the client" and now says what the docs ask for. Nothing to apologise for and nothing to proxy. The Node scripts are not browsers and already send a descriptive one. |
| Cache at least 24 hours; use bulk for catalogues; do not crawl card by card | `src/lib/cache.js`: queries a day, cards a week; `docs/table-rebuild/PLAN.md`, "common-card bundle" | Already true. The bundle is written and blocked only on a machine that can reach Scryfall. | None. |
| Scryfall bulk files are `jsonl.gz` | https://scryfall.com/docs/api/bulk-data, read 2026-09-20, HTTP 200 | **The pack was right and this row was wrong.** Scryfall: "Each bulk file is a gzipped JSONL (JSON Lines) archive", and "You will specifically download a jsonl.gz archive and need to decompress or stream it on disk." Streaming line by line is the documented way to read one. | Corrected here before the common-card bundle is built on it. The same page warns that prices "should be considered dangerously stale after 24 hours", which the bundle will have to say on screen. |
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
  returned 403 from the build container, so the per-endpoint figures above were
  adopted unread. **Settled on 2026-09-20** from the owner's machine, where both
  answer HTTP 200: the figures were right, `/cards/manifest` was missing, and
  two verdicts in the table above were wrong and are now corrected. The reading
  also found the only real overage in the repo, which was never in the browser
  client but in six Node scripts.
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
| The backend pack, repeated | This document, above | Same claims; same results. The rate-limit figures are no longer unverified: they were read from Scryfall's own page on 2026-09-20 and were right. | None; M0's verification is done and the table above records what it changed. |

Two things the preview description does not change: the engine decision
(Grok names Forge and XMage; `ENGINE.md` chose Argentum after running it),
and the look of the table itself, which the owner chose (parchment playmat
after the Moxgate frames, the app's dark and gold chrome, the season's cyan
when the season is on).


---

## The Grok handoff pack — read 2026-09-21

The owner uploaded the zip Grok made "for Claude": a README, a conversation
log, the backend pack again, a description of Grok's own prototype, a
"contract" of types, a Reality Fracture note, a Moxgate UX note, and
screenshots. It is filed at `inbox/grok-pack-2026-09-20/` with eight of the
screenshots re-encoded small. The pack's own rule stands: it is context,
not a patch, and the repo's `CLAUDE.md` and `ARCHITECTURE.md` outrank it.
Its Moxgate screenshots are new evidence beside `frames/`.

| Claim in the pack | Checked against | Result | Change |
| --- | --- | --- | --- |
| **Reserved zones**: opponent rail, battlefield, action bar, hand dock, inspector column; "nothing overlays Pass" | `game.css` grid areas; the `.prompt` panel; `Peek.jsx` | The four bands are the table's grid already. The prompt with Pass is a floating panel at the foot of the battlefield, and the hover preview can cover it (found from the first paste). | M1b in `HANDOFF.md`. The preview keeps clear of the prompt; on a wide screen the option of parking the preview in the side column is weighed there, with a screenshot of each. |
| "Space passes" (the prototype's table) | `Peek.jsx` handles Z only | No keyboard pass. Moxgate's own frames do not show one, but it costs nothing and Law 2 likes it. | **Adopted, M1b:** Space acts the pass offer when it is on offer and no field is focused; Z stays the zoom. |
| Moxgate's home footer wording | `screenshots/moxgate-home-1440` (live page, 2026-09-20) | "…unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and imagery provided by Scryfall; all card artwork remains the property of its respective artists and Wizards of the Coast. Rules-enforced game modes are powered by Forge, an independent open-source rules engine, used under the GNU GPL-3.0." The app's credit lines say the first half; none names Scryfall or the engine. | **Adopted, M1b:** the table's credit line gains "Card data and imagery from Scryfall" and, at the engine's table, "Rules-enforced play is powered by Argentum, an independent open-source rules engine, used under the MIT licence." |
| Moxgate's solo lobby: "Open seat · pick who you play against · **+ AI**"; "Solitaire: no opponent yet. Seat one to play Rules Enforced." | `Seats.jsx`, `TARGET.md` §2 | The same panel, built from the frames; "Play the engine" is the "+ AI" seat. The pods notice ("Four player pods are paused… server load") is a reminder that a hosted engine is a capacity problem, which M8 measures. | None. |
| Moxgate's home: Play / Solo / Draft tiles, "New to Magic? Learn to play — five minutes of rules, then a starter deck", Conquest roguelike, "2369 playing today" | `Lobby.jsx`, the Learn tab | Learn and the lobby cover the first two; draft and a roguelike are not in scope and are not in the plan. | None. |
| Moxgate's Learn page: five starter cards fanned, "Magic in five minutes" | The Learn tab's tracks and the tutorial | The app teaches in tracks with a scripted first game; the fanned starters are a presentation idea, not a gap. | None. |
| The prototype's "contract" types (`DeckCard`, `SavedDeck`, `LifeSession`, an `Action` union) | `src/lib/storage.js`, `deck.js`, `game.js`, `board/reducer.js` | The pack itself says the repo's names win. The app's shapes are older, migrated, and tested; nothing is adopted. Its `Action` union is the shape of the unenforced table's actions already. | None. |
| Formats: brawl at 25 life | `src/lib/formats.js` | Brawl is 25 there already. | None. |
| Five colleges including Vigorbloom (GW) | `set-themes.js` `schools` | All five are present with emblems and disciplines. | None. |
| "Default empty search / featured row = FRA until the next set" | `CardsView.jsx` | Not season-aware today. | M0, already in the plan. |
| The prototype's own faults: an 80 ms Scryfall gate, no `User-Agent`, a mistyped life history | `src/lib/scryfall.js` | The app spaces search, named, random and collection at 500 ms and the rest at 100 ms; browsers cannot set `User-Agent`, which the file says. Nothing to inherit. | None. |
| "AI seat: not 'watch my deck play itself' (Moxgate declined that ask)" | `engine/` | The engine could drive two AI seats; nobody asked, and the plan does not include it. | None. |
| Prepare, Empower Jace, Heartwood: "do not approximate in rules-enforced mode" | `src/data/set-mechanics.js`, Argentum's corpus | The app's entries are provisional and sourced. Whether Argentum has FRA cards at the pinned commit is not known: *verify* at M1 with `hello.sets`, and say on the deck gate which cards the engine lacks. | M1, a line added. |
| The look: "not gold-and-purple Moxgate, not green felt; midnight ink, fracture cyan, cool silver instead of gold" | `tokens.css` `--rf-*`, the season theme, the owner's decisions | The season already does this while the set is the focus. The owner chose the parchment playmat and the app's own chrome for the table; the pack's screenshot of its table is slate and cyan, which is the season's palette and not the table's. | None. |
