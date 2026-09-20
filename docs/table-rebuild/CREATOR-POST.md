# What Moxgate's creator says it is

**Source**: the creator's r/SideProject post, *"I built a browser-based MTG
virtual tabletop, here's the infra esp multiplayer"*, pasted in by the owner
on 2026-09-20. Reddit is unreachable from the build environment, so the text
below is what was pasted; nothing is quoted that was not in it. This is the
only first-hand account of the architecture in this folder, and it outranks
every inference drawn from screenshots.

## The correction that matters

Everything in `TARGET.md` was read off a **Rules Enforced** game — priority
prompts, "nothing to respond with", castable cards glowing, a Forge credit in
the footer. The post describes something else:

> tabletop-style, not rules-engine style
> No enforced rules/triggers — you move things yourself, same as cardboard
> The server is a pure relay written in Express + `ws`. It has zero game logic.

Both are true. **Moxgate began as an unenforced relay tabletop — the thing this
repository's Table already is — and grew an enforced mode on top later.** The
lobby copy I captured says exactly that, and I read past it at the time:
*"Solitaire: no opponent yet. Seat one to play Rules Enforced"* becomes
*"Rules Enforced: the engine runs the game"* only once an AI is seated
(`TARGET.md` §2). Enforcement is a mode you enter, not the foundation.

So the shape `PLAN.md` arrived at — a real engine with the existing
play-by-hand table as the degraded mode — is not a compromise we invented. It
is Moxgate's own architecture: a relay table underneath, an engine layered
over it. The difference is that our engine is MIT and reachable from a
browser, and theirs is GPL and behind their server.

It also explains the friction. The creator's founding instinct was to build
*"the smallest possible thing that removes setup friction"*. The ceremony
users complain about lives entirely in the enforced layer that came after —
which is where `FRICTION.md` already points.

## The architecture, in their words

### Multiplayer is a relay, and every client holds the whole game

- Express + `ws`. The server has **zero game logic**.
- An action is *"a method call name + arguments"*. The acting client applies
  it locally and sends it; the server broadcasts; every other client applies
  the same method with an `isRemoteAction` flag so it does not re-broadcast.
- **One exception: `pass_turn` is handled server-side**, so the active-player
  index *"can't diverge (no 'both players think it's their turn' edge case)"*.
- **State snapshots are stored on the server**, so late joiners and reconnects
  get a full state immediately rather than asking the host.
- **Rooms persist to disk as JSON** (`/tmp/rooms` or a mounted Railway
  volume), so a process restart mid-game does not wipe the table.

### Infra details they call non-obvious

- Railway's proxy has a **60 s idle timeout**. The server **pings every 30 s**
  and terminates connections that do not pong, so the clients'
  **exponential-backoff reconnect** fires cleanly instead of hanging.
- Deploys send SIGTERM → the server **closes every WebSocket with code 1012
  (Service Restart)** before exiting, so clients reconnect rather than showing
  a broken board.

### Client state

- React 19 + Zustand 5.
- **All cards in one flat `Record<instanceId, CardInstance>`.** Moving a card
  is setting `card.zone`. No arrays per zone; selectors filter on demand.
- `React.memo` plus a `useStableArray` hook: a card only gets a new reference
  when it mutates, so element-wise `===` on zone arrays catches updates cheaply.

### Card data

Scryfall's collection API behind a three-layer cache: an **in-memory bundle of
common cards (`/card-bundle.json`) loaded at startup**, localStorage with a
7-day TTL, and the API as fallback in 75-card chunks.

### Drag and drop

`@dnd-kit` with a custom, **priority-ordered collision function**: attach
targets first (pointer-within), then hand reordering if inside the hand zone,
then zone drops, then `closestCenter` as the fallback. The default did not
cope with overlapping zones and attach targets.

### Distribution and deploy

- Runs as an embedded **Discord Activity**; the channel ID is the room code,
  so a voice channel maps to a persistent room. OAuth exchange is server-side.
- **A single Railway service** on the hobby plan serves HTTP, the WebSocket
  relay and the static SPA. No CDN.

That last line is the cost story, and it matches the lobby notice about pods
being paused for *"server load"*: the relay is nearly free; **the JVM engine
behind the enforced mode is what costs**, and multi-seat pods are what drive
it. Our hosting decision (`ENGINE.md`) is for the same expensive piece.

---

## What this changes in the plan

### Phase 2 — seats — becomes a relay server, not peer-to-peer

The current table's two-device play is WebRTC peer-to-peer (`net.js`,
`webrtc.js`), and its signalling service was deferred. The post makes the
case for the other design, and hosting is now approved anyway:

| Relay server gives | Peer-to-peer cannot |
| --- | --- |
| Late joiners get a snapshot from the server | — must ask the host, who may be gone |
| Rooms survive a process restart (JSON on disk) | — state lives only in browsers |
| Turn authority in one place | — clients can disagree |
| Reconnect with a known close code | — ad hoc |
| Link-to-join with no signalling service | — needs one |

The **relay is the signalling**. The deferred signalling item is closed by
this. `net.js`'s replication protocol — apply locally, send, apply remotely
without re-broadcasting — is already the client half of exactly this design,
so it carries over; what is added is the server side, with the four infra
rules above baked in from the first commit.

### Phase 3 — one thin server, two authorities

The thin Kotlin server around Argentum (`SPIKE.md`) is the same process
pattern: **a relay for the degraded mode, engine-authoritative for the
enforced mode**, behind the one transport boundary `PLAN.md` already calls the
most important design decision. Moxgate runs both layers; so will we, with
one server instead of two.

A consequence worth saying out loud: **the degraded mode can seat four
players today.** The board model has no two-seat assumption, and a relay
does not care how many clients it fans out to. That is the thing Moxgate's
lobby apologises for having paused — and it costs us nothing but Phase 2.

### Phase 1 — three things to take into the shell

- **A precomputed bundle of common cards**, shipped as static JSON and loaded
  at startup, ahead of the IndexedDB cache and the API. The lobby's deck shelf
  should not wait on the network for cards every deck contains.
- **The drag collision order**: attachments first, then hand reordering, then
  zones, then nearest centre. `placement.js` and `useDrag.js` decide targets
  today; this is the priority they should apply.
- **The client store mirrors the engine's own view.** Argentum's
  `ClientGameState` is already Moxgate's shape — `cards: Map<EntityId,
  ClientCard>` plus zones as lists of ids — so the new client's state can be
  that DTO held flat, with memoised selectors, rather than a second model
  that has to be kept in step with it.

### What does not change

- `FRICTION.md`. If anything the post strengthens it: the creator's founding
  goal was to remove friction, and the ceremony came in with enforcement.
- The engine decision, `ENGINE.md`.
- `TARGET.md` — every screen in it is still the target. It was simply a
  picture of the upper layer.
