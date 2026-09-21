# 05 — Moxgate UX (study, not source)

Moxgate is a **closed** browser MTG table: https://www.moxgate.com

There is **no GitHub**. Do not scrape. Do not ship their assets. This file is what to *steal as layout ideas* for Companion.

Terms (Forge split): https://www.moxgate.com/terms  
Bugs / paper trail: https://www.moxgate.com/bugs/  
In-repo study: https://github.com/rporter33/mtg-companion/blob/main/docs/MOXGATE_STUDY.md

## Product facts (from their site / terms)

- Free, no account required to play
- Casual tabletop (you move cards) **or** optional rules-enforced (Forge, server-side)
- Card images from Scryfall, not hosted by Moxgate
- 2–4 players, room codes, Discord activity
- Formats include Standard + Commander
- Solo vs AI exists
- Forge is GPL and **never sent to the browser**

## UX pain they already fixed (don’t reintroduce)

From `/bugs` and live UI:

- Hand overlapping the battlefield
- Inspector / zoom covering **Pass** and other actions
- Post-draft / mode panels that didn’t match the rest of the lobby
- Aggressive disconnect health checks (online — less relevant to local-first)

## Layout rule (non-negotiable for Companion table)

**Reserved zones.** The table is a grid, not a pile of absolutely-positioned layers.

1. Opponent rail — life, library count, grave, exile, command
2. Battlefield — theirs, then yours
3. Action bar — phase chip, Pass, priority, log
4. Hand dock — always its own row
5. Inspector rail — **its own column**; opening a card must not cover Pass

Playable objects glow. Unplayable objects stay quiet. The next legal action is the loudest thing on screen.

## What Companion should *not* copy

- Moxgate’s purple/gold brand
- Their Forge hosting
- Their room-code / Discord activity (unless the owner asks)
- Any JS/CSS from moxgate.com

## Companion mapping

| Moxgate | Companion |
| --- | --- |
| Casual table | Hotseat + P2P + small practice model |
| Rules-enforced | Optional later: Forge or XMage behind a protocol |
| Lobby / rooms | `/setup` then `/play` |
| Card inspector | Reserved rail + card sheet that never eats the action bar |
| AI seat | Existing practice AI / scripted learn opponent — not “watch my deck play itself” (Moxgate declined that ask) |

## Screenshots in this zip

| File | What to notice |
| --- | --- |
| `screenshots/moxgate-home.png` | Marketing + entry |
| `screenshots/moxgate-home-1440.png` | Desktop chrome |
| `screenshots/moxgate-home-mobile.png` | Mobile |
| `screenshots/moxgate-learn.png` | How they teach |
| `screenshots/moxgate-solo.png` | Solo vs AI entry |
| `screenshots/table-play.png` | Prototype: inspector open, Pass still visible |
| `screenshots/table-land.png` | Prototype: land on battlefield, hand docked |
