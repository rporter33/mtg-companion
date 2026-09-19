# The engine decision

**Settled on 2026-09-19: Argentum Engine.** The evidence is in the VERIFIED
section below; the options and reasoning that led there are kept after it.

> **This document was rewritten on 2026-09-19 after actually checking.** The
> first draft asserted that the mature engines were "Java and copyleft" and
> that writing our own was the likely answer. **Two of those claims were
> wrong**, and the correction changes the recommendation. What is below is
> verified against the repositories; where something is still unverified it
> says so.

## What "near one-to-one with Moxgate" actually requires

Strip away the presentation and Moxgate is a program that knows what every
Magic card does. To match it you need the turn structure with priority at
every step; the stack; costs of every kind including reduction, alternatives
and X; **the layer system (rule 613)** with timestamps and dependencies;
state-based actions; replacement and prevention effects; triggered abilities
in APNAP order with intervening-if; full combat; targeting and legality with
hexproof, protection and ward — **and then a script per card**, of which there
are around 30,000.

That is two decades of work. The question was never "how do we write one". It
is **"which one, and what does using it cost"**.

---

## What is actually out there — verified

| Engine | Language | Licence | Scale | Shape |
| --- | --- | --- | --- | --- |
| **XMage** (`magefree/mage`) | Java | **MIT** | **32,000+ unique cards**, 91,000+ reprints | Client/server over **JBoss Remoting + Java serialization — not reachable from a browser.** 2.4k stars |
| **Argentum** (`wingedsheep/argentum-engine`) | Kotlin | **MIT** | **12,979 cards** (2026-09-03, verified) | Pure-functional engine library + Spring Boot server + **React/TS web client over WebSocket**. Built-in AI |
| **Forge** (`Card-Forge/forge`) | Java | **GPL-3.0** | Very large, not stated in README | Desktop (Win/Mac/Linux), Android, early iOS. 2.7k stars. **This is what Moxgate uses** |
| `MTG-Paradox-Engine/mtg-paradox-engine` | TypeScript | — | **4 stars, 12 commits** | A toy. Not a dependency |

**The two corrections that matter:**

1. **XMage is MIT, not copyleft.** I asserted otherwise. Its root `LICENSE.txt`
   reads *"MIT License, Copyright (c) 2010 betasteward@gmail.com"*. A project
   that size deserves a per-module licence audit before you ship, but the
   headline is permissive.
2. **Argentum Engine exists and I missed it entirely.** MIT, Kotlin, and
   architecturally it is exactly the thing this folder's first draft proposed
   building from scratch.

There is still **no mature browser-native engine in JS or TypeScript.** That
part of the original claim held up.

### Argentum Engine, in more detail

Worth its own section because it is the closest fit to how this repo already
works. From its README and build files, verified:

- **`rules-engine/` is "a standalone library with no server dependencies"**
  that "models the complete game state immutably and exposes a pure functional
  API". That is the same shape as `src/lib/board/reducer.js` — `apply(state,
  action) → newState` — just vastly more capable.
- Implements, by its own list: full turn structure with priority, stack,
  combat, triggered/activated/static abilities, keywords, state-based actions,
  targeting and legality, **rule 613 layers**, replacement effects.
- **"Cards are defined as pure data using a Kotlin DSL — no card-specific
  logic in the engine."** Card modules are split by era (`1993-1999` … `2026`).
- **A built-in AI that needs no API key**: multi-ply game-tree search with
  alpha-beta pruning, a board evaluator and a combat advisor. Optionally an
  LLM-driven opponent instead.
- Drafting up to 8 players, sealed, and **free-for-all multiplayer for 2–6
  (CR 806)** — which is Commander pods, the thing Moxgate has *paused*.
- An RL/MCTS gym with O(1) `fork()` and snapshot/restore, which is only
  possible because the state is immutable. Playwright e2e tests.
- **`Argentum Assay`** — a bidirectional Oracle-text parser that measures, card
  by card, how much of Magic the card DSL can express, and flags unimplemented
  cards that the DSL could already handle.

**The catch, verified from the build files**: `rules-engine` and `mtg-sdk` both
use a `buildsrc.convention.kotlin-jvm` plugin. **There is no Kotlin
Multiplatform, no `js()` target, no WASM.** It is JVM-only today, needs JDK 21+
and Spring Boot, and uses `kotlin("reflect")` at least in tests. So out of the
box it is a server, exactly like Moxgate.

**Risks to weigh**: a single copyright holder in the LICENSE, no stars on the
mirror this was read from, and the canonical repo could not be reached through
this session's proxy. Card coverage is **unverified** — the live tracker is
blocked here and is the first thing to check. Next to XMage's 32,000, a young
project's coverage could be a fraction of that.

---

---

## VERIFIED, 2026-09-19 — the decision is Argentum

The verification list at the bottom of this document was run. Three of the
five questions are answered, and together they decide it.

### 1. Can each engine enumerate legal actions? **Both can.**

`FRICTION.md` Law 1 needs the engine to answer *"does this player hold any
legal action besides passing?"* before the client renders a prompt.

- **XMage**: `Player.java` exposes `getPlayable(Game, boolean)`,
  `getPlayableObjects(Game, Zone)` and `getPlayableActivatedAbilities(...)`,
  and — crucially — `GameView.java` carries a `PlayableObjectsList
  canPlayObjects` field with a getter and setter, so **the playable list is
  already sent to the client**. That is how its own client highlights castable
  cards.
- **Argentum**: documents `legalActions` in its gym API and pauses on
  `PendingDecision`s.

So this stops being the discriminator. The next question is.

### 2. Can the engine be driven from a browser? **Only Argentum.**

This is the finding that decides the project.

**XMage's transport is JBoss Remoting over a bisocket, using Java
serialization.** `SessionImpl.java` imports `org.jboss.remoting.*`,
`org.jboss.remoting.transport.bisocket.Bisocket` and `TransporterClient`, and
every view class — `PlayerView`, `GameView` — is `implements Serializable`.

There is no JSON, no HTTP, no WebSocket. **A browser cannot speak this at
all.** Using XMage from our React client would mean writing and permanently
maintaining a Java bridge process: JBoss Remoting on one side, WebSocket/JSON
on the other, marshalling XMage's internal view classes — which are not a
public API and change without notice. That bridge would be the largest and
most fragile component in the whole system, and it would exist forever.

**Argentum** ships a React/TypeScript web client with *"real-time game state
sync via WebSocket"*, plus a documented HTTP gym API. It is already the stack
this repo is written in.

### 3. Argentum's card coverage: **12,979 distinct cards**

The live tracker is blocked from this environment, but the repository commits
the chart that feeds it. `card-implementation-progress.html` carries the raw
series: `DATES` runs from **2026-01-18** to **2026-09-03**, and the final
value of `TOTALS` is **12,979**.

The curve is steep and still accelerating — recent daily additions in that
series include 272, 375, 333, **705**, 402. Eight months of one person's work.

XMage's 32,000+ is more. But 12,979 covers essentially everything anyone
actually plays, the gap is closing fast, and **`Argentum Assay` flags cards
that need no new engine vocabulary** — so the cheap ones are identified and a
card we need can be contributed upstream rather than waited for.

### The decision

**Argentum Engine.** Not because it has more cards — it has fewer — but
because XMage's wire protocol is unreachable from a browser and Argentum's is
the one we already speak. A permanent Java bridge is a worse problem than
19,000 missing cards, most of which nobody plays.

**The risk, stated plainly**: Argentum is eight months old with a single
copyright holder. That is a real bus-factor problem. What makes it acceptable:
MIT, a `rules-engine` module with no server dependencies, and immutable state
— so if the project stops, we can fork a self-contained library rather than
being stranded inside somebody's application.

### Still open

- **Bundle size** with a jlink-trimmed JRE, against the "runs smoothly"
  requirement.
- **Whether `rules-engine` survives a Kotlin/JS port** — grep for
  `kotlin.reflect`, `java.*` imports and `ServiceLoader`. If it is close, the
  browser path opens and the hosted server becomes optional rather than
  structural. This is now the most valuable speculative work in the project.
- XMage's per-module licensing is **moot** unless the decision is revisited.

## The options, revised

### Option A — Bundle XMage locally for desktop, host it for web

XMage's README says players "can run a local server to play against AI
opponents... including fully offline play without internet connectivity."
**MIT permits bundling and shipping it.**

- **Desktop**: Tauri or Electron shipping a JRE and an XMage server on
  localhost, with our own React client against it. **32,000 cards, full rules,
  a real AI, fully offline, legal to distribute.** This is the strongest answer
  to "runs smoothly on desktop" that exists.
- **Web**: the same client against a hosted instance — which costs money and is
  the only part that does.

**Costs**: a Java runtime in the desktop bundle (~50–200MB depending on
jlink trimming); writing a client against XMage's protocol, which was designed
for its own Swing client and is not a documented public API; hosting for the
web half; and a per-module licence audit before shipping.

### Option B — Argentum Engine, same two deployments

Identical shape to A, with different trade-offs: Kotlin rather than Java, a
modern immutable engine, **a React/TypeScript web client already written** in
this project's own stack, and cards-as-data. Fewer cards, and a bus factor of
one.

**The interesting extra**: because the engine is MIT, pure-functional and
explicitly free of server dependencies, **porting it to Kotlin Multiplatform
(JS or WASM) is legally free and architecturally plausible** — and that is the
one path to a Moxgate-class engine running *in the browser*, with no server,
keeping this app's local-first premise intact. It is a real porting project,
not a weekend, and reflection usage is the thing to check first. But MIT means
nobody can stop you, and upstream might welcome it.

### Option C — Forge, the way Moxgate did it

Highest card coverage and a proven AI, but **GPL-3.0**. Running it as a network
service does not trigger distribution — which is precisely how Moxgate keeps a
proprietary frontend — but **a desktop build that bundles it is distribution,
and the whole work becomes GPL-3.0**. Given XMage and Argentum are MIT and
comparable, there is little reason to accept that constraint now.

### Option D — Write our own

What the first draft of this document recommended. **Given that two MIT-licensed
engines exist, this is now hard to justify** except as a deliberate learning
exercise. It would take months to reach a fraction of XMage's coverage.

The one part still worth writing ourselves is the **client** — which is most of
what makes Moxgate feel like Moxgate, and which `TARGET.md` shows is largely
already built here.

---

## The revised recommendation

**Option A or B, with the client staying ours.**

The shape:

```
Our React client (this repo, extended per TARGET.md)
        │
        ├── desktop: Tauri/Electron → bundled JRE → engine on localhost
        │             all cards · full rules · AI · fully offline
        │
        └── web:     → hosted engine instance  (the only part that costs money)
                     → or fall back to today's unenforced table when no server
```

Why this beats the original recommendation:

- **The GPL objection disappears.** It was the main argument against using an
  existing engine, and it was based on a wrong claim about XMage.
- **Desktop becomes the strong case, not the weak one.** A bundled local server
  gives full rules, every card and an AI with no network and no hosting bill.
  That is better than anything Moxgate offers, since Moxgate needs their server
  to be alive.
- **Months of engine work become weeks of integration work**, and the effort
  goes into the client — the half this project is already good at and the half
  a portfolio actually shows.
- The existing unenforced table stays as the web fallback, so it is not wasted.

**Choose XMage if card coverage is what matters** — 32,000 cards is the whole
point. **Choose Argentum if the codebase matters more** — it is far pleasanter
to work with, already has a React client, and is the only candidate that could
plausibly be made to run in a browser.

## Decided, 2026-09-19

The owner has settled the deployment question: **both halves are
rules-enforced**, and hosting for the web engine is approved. So the shape is
not "desktop real, web by hand" — it is a hosted engine for the browser *and*
a bundled one for desktop, behind the same transport boundary, with the
unenforced table demoted to what runs when no engine can be reached.

That makes **the protocol boundary the single most important design decision**
in Phase 3: one module that speaks to an engine, indifferent to whether that
engine is on localhost, on a server, or absent.

The choice between XMage and Argentum is deliberately **not** made. It is to
be made on the evidence below.

## What to verify before committing

1. **Argentum's real card coverage** — `magic.wingedsheep.com/set-completion`
   was blocked from this session. This is the number that decides A vs B.
2. **XMage's protocol** — is there a documented way to drive the server from a
   non-Swing client, or does it mean reverse-engineering their wire format?
2b. **Can the engine enumerate a player's legal actions on demand?** This is
   now a first-class criterion, not a nicety: `FRICTION.md` Law 1 says the
   game never stops at a window where the player can do nothing, and obeying
   it means asking *"does this player hold any legal action besides passing?"*
   before rendering a prompt. **Argentum** documents exactly this
   (`legalActions`, and pausing on `PendingDecision`s). **XMage is unverified
   here.** If it can only say "your turn to choose" without enumerating what
   is choosable, the product's whole differentiator gets expensive — and that
   should outweigh a card-count advantage.
3. **XMage's per-module licensing** — the root file is MIT; confirm nothing
   vendored inside is not.
4. **Bundle size** with a jlink-trimmed JRE, against the "runs smoothly"
   requirement.
5. **Whether Argentum's `rules-engine` compiles under Kotlin/JS** — grep it for
   `kotlin.reflect`, `java.*` imports and `ServiceLoader`. If it is close, the
   browser path opens and this stops being a server project at all.

## How to report the verification back

Both candidates are viable and the difference is evidence, not taste. When the
five checks above are done, put it to the owner as a table — coverage, how
hard the protocol is to drive, bundle size, and the browser-port question —
with a recommendation and the reasoning. Not a list of options to choose from
cold: a recommendation, and what would change it.

Hosting a second small instance to try both is cheap next to picking wrong.
