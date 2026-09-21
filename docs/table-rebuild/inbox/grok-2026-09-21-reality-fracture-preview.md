# Grok conversation, pasted by the owner on 2026-09-21

The share link (grok.com) is unreachable from the build environment, so
this is the owner's paste, verbatim, ending where the paste ended
("I have not touched"). The second link the owner gave, a Grok project's
conversations tab, is not in this file. Read against the repo in
`../SOURCES.md`, "The Grok preview".

---

> changes. Don't affect my repo

Your GitHub repo was not touched. This is the companion frontend only,
restyled for Reality Fracture.

MTG Companion is now a local Hexhaven desk — midnight ink, cyan fracture
light, Jace's tower on the home screen. No account. Lists stay in the
browser.

What carried over from the Moxgate table:

- Reserved bands: opponent, board, inspector, hand
- Preview never covers Pass
- Playable cards glow; targets glow cyan
- Three-step sit-down: seat, format, deck

What's new around it:

| Surface | What to try |
| --- | --- |
| Home | Face yourself. Tap a Hexhaven college. |
| Cards | Live Scryfall, default set:fra. Open The Theorist. |
| Decks / First deck | Walk colours, pick a commander, paste a list. |
| Life pad | 1–6 players, commander damage, poison, dice, undo. |
| Learn | Four tracks, a real wrong answer, then the glossary. |
| Table | Sit down with Stingerquill Drill. Play a Mountain. |

Paper date on the hero is October 2. Prerelease is already this week.

> Where's the repo for moxgate?

There isn't a public Moxgate repo. moxgate.com is a closed product.

The only source they point to is Forge, the rules engine behind optional
rules-enforced games: github.com/Card-Forge/forge (GPL-3.0). Their terms
say Moxgate is a separate project, runs Forge server-side, and does not
ship that engine to the browser.

Your companion is still github.com/rporter33/mtg-companion. This preview
was built from Moxgate's UI, not from their source.

> Provide all useful links to build the backend.

Moxgate has no public backend. Use these instead.

Your repo is already the spec: rporter33/mtg-companion. It is local-first
(Scryfall + IndexedDB + optional P2P). A full rules engine is not in that
design unless you choose to add one.

[The "backend builder pack" that followed — repo links, Scryfall and
MTGJSON links and rate limits, Forge and XMage, official rules, deck
interchange, multiplayer, legal, the practical split — is the same
material as the pack already checked in `../SOURCES.md`. Its only
additional phrasings: "Rate limits: /cards/search, /named, /collection =
2/sec"; "Scryfall data/image rules: no paywall, no crop of copyright, no
implying Wizards/Scryfall endorsement"; "if you ship Forge in the client,
the client inherits GPL".]

> I have not touched
