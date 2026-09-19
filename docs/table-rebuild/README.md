# Rebuilding the Table as a Moxgate-class simulator

**Read this file first. It is the brief for a new session.**

The goal, in the owner's words: *a near one-to-one of the Moxgate application
that runs smoothly on web and desktop*, without disturbing the rest of
mtg-companion.

This folder is everything needed to start that work cold:

| File | What it is |
| --- | --- |
| `README.md` | This. The brief, the constraint, and how to begin. |
| `CURRENT.md` | What the Table is today — every file, what it does, what is tested. |
| `TARGET.md` | Moxgate, screen by screen, from 10 screenshots and 3 recordings. |
| `ENGINE.md` | **The decision that governs everything else.** Read before planning. |
| `PLAN.md` | Phases, and how to build without breaking the working app. |
| `HOUSE-RULES.md` | The conventions this repo is held to. Non-negotiable. |
| `frames/` | 29 de-duplicated frames from the recordings — the primary evidence. |
| `extract-frames.py` | How `frames/` was made, for the next batch of video. |

---

## The one thing to understand before anything else

Moxgate's own footer says it:

> Rules-enforced game modes are powered by **Forge**, an independent
> open-source rules engine, used under the **GNU GPL-3.0**.

**Moxgate did not write a rules engine.** They built an excellent web client
over an existing Java one. Everything people admire about Moxgate — that it
will not let you make an illegal play, that it knows what every card does,
that it can show you "available mana" as a number and glow the cards you can
actually cast — comes from Forge, which is twenty years of work by hundreds of
contributors.

Two consequences follow, and they are the whole shape of this project:

1. **Forge is Java. It cannot run in a browser.** Moxgate must run it on a
   server, one game instance per table, and stream state to the client. Their
   own lobby says so out loud: *"Four player pods are paused. We are keeping
   tables steady for everyone while we work on server load."* That is a
   sentence you only write when you are paying for CPU per table.

2. **mtg-companion today has no server at all.** It is a local-first static
   PWA on GitHub Pages: no backend, works offline, loads instantly, costs
   nothing to run. A near one-to-one Moxgate is not a feature to add to that
   architecture — it replaces it.

**But we do not have to make Moxgate's choice.** Forge is GPL-3.0, which is
why Moxgate keeps it behind a server. Two comparable engines — **XMage** and
**Argentum Engine** — are **MIT licensed**, which means they can be *shipped*,
not just called. XMage carries 32,000+ cards, full rules and an AI, and runs
offline against a local server.

So the shape that actually answers "web and desktop" is: **our client, someone
else's engine.** Desktop bundles the engine and gets everything offline; web
either pays for a hosted instance or falls back to the play-by-hand table that
already exists. `ENGINE.md` has the verified comparison.

The first job of the new session is still not to write code — it is to settle
`ENGINE.md` with the owner. **Read it before writing a plan.**

---

## What is already true and worth keeping

The Table is not starting from nothing. What exists is roughly the *client*
half of Moxgate, minus the engine:

- A board model that holds where every card is, for any card Scryfall has
  ever printed, with undo, persistence and a tested reducer.
- Two-device play over WebRTC with a replication protocol.
- The card presentation: real printed faces, a hand that fans, treatments and
  foils, a playmat with lanes, arrows, counters, dice.
- A game log read back in English, grouped by turn.
- A zone browser with Scryfall-style search over any pile.
- A turn tracker that teaches the turn from `docs/TURN_STRUCTURE.md`.
- 1191 unit tests across 58 files, 26 browser specs, an axe-core sweep, CI.

`CURRENT.md` inventories all of it. A rules engine underneath this is a very
different job from a rules engine plus a client from scratch.

---

## What must not break

The rest of the app is finished work the owner uses: **Cards**, **Decks**
(builder, coach, first-deck flow, collection, versions), **Learn**, **Play**.
None of it depends on the Table, and the rebuild must not touch it.

`PLAN.md` opens with the isolation strategy. The short version: the new engine
goes in a new folder behind a new route, the existing Table keeps working
untouched until the new one is at parity, and the switch is one flag.

---

## Decisions already taken

Settled with the owner on 2026-09-19, so the new session does not re-open them:

- **Both web and desktop are rules-enforced.** The owner will pay for hosting,
  so the web build gets a hosted engine rather than falling back to the
  play-by-hand table. That fallback still gets built — it is what runs when
  the engine is unreachable — but it is no longer the web *plan*.
- **Neither engine is chosen yet, on purpose.** The first task is the
  verification list at the end of `ENGINE.md`; the choice is made on evidence.
- **The study frames are committed.**

## How to start

1. Read `ENGINE.md`, then **do the verification list at the end of it**. That
   is the first task, and it is research, not code.
2. Report what you find and settle XMage vs Argentum with the owner.
3. Read `CURRENT.md` and `HOUSE-RULES.md`.
4. Read `TARGET.md` with `frames/` open beside it.
5. Start Phase 1 in `PLAN.md` — it is not blocked on any of the above.

### About `frames/`

The 29 frames are committed, at the owner's direction, as study material for
this folder. They are named `v<clip>_<order>_at<time>.jpg` and `TARGET.md`
cites each one by name. `extract-frames.py` regenerates them, or makes a new
batch from the next set of recordings:

```
python3 extract-frames.py <video.mp4> frames/
```

One warning about the evidence: the recordings have **no sound**, the site
itself was unreachable from the build environment, and nothing here is a claim
about how Moxgate's code works. It is what the screen showed.
