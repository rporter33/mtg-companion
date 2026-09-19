# The thing we beat Moxgate on

Moxgate is well liked. The one complaint its users keep making is that it is
**cumbersome**, and the owner has named the two specific places:

1. **Being asked to confirm non-events.**
2. **Two taps to do one thing.**

That is the whole differentiator. Everything else in `TARGET.md` we copy;
these two we fix. This document is the design law, and it is written as rules
that can be tested rather than as a mood.

Notably *not* on the list, though I offered them: the five dialogs before turn
one, and the amount of chrome on screen. Those were judged fine. **Do not
"simplify" the setup flow or hide panels in the name of friction** — that is
not the complaint, and `TARGET.md` §1–§6 should be matched as they are.

---

## Law 1 — Never stop for a step where the player can do nothing

Moxgate stops and asks you to press `Done`:

> **Sythis's upkeep. Nothing to respond with.** `[Done]` — `v2_11`
>
> **Sythis's end step. Nothing to flash in.** `[Done]` — `v3_03`

It has already worked out that you hold nothing playable — that is what the
sentence *says* — and it asks you to acknowledge it anyway. Every one of those
is a click that cannot change the game.

Moxgate's own answer is a setting: `Fast — Keep it moving · FEWER CLICKS`
against `Controlled · MORE PASSING` (`v2_05`). **We make it the default and the
only sensible behaviour**, rather than an option the player has to find.

**The rule**: the game pauses at a priority window **only** when the player
holds at least one legal action other than passing. Otherwise it passes and
moves on, and the log records that the step happened.

### This is an engine requirement, not a UI one

To obey Law 1 the client must be able to ask, cheaply and before rendering
anything:

> *Does this player have any legal action right now other than passing
> priority?*

- **Argentum** exposes exactly this: its gym API is documented as
  `reset / step / observe / legalActions`, and it "pauses on `PendingDecision`s
  (scry, targets, search, distribute…)". Legal actions are a first-class
  concept.
- **XMage** — **unverified, and this is now a selection criterion.** Add it to
  the verification list in `ENGINE.md`. If the answer is "the server tells the
  client to choose, but will not enumerate what is choosable", Law 1 becomes
  expensive and that counts heavily against it.

An engine that cannot answer that question forces us back to Moxgate's
behaviour, which is the thing we are trying to beat.

### Where it must still stop

Passing automatically is only safe where nothing can be lost. It must **not**
auto-pass when:

- The player holds any castable instant, flash permanent or activatable
  ability — even one they will not use. Holding a trick *is* the decision.
- A **priority stop has been armed** for that step. Moxgate's armed stops
  (`v2_09`, "Priority stops live on the half-hand tab") are a good idea and we
  keep them: the player says "always ask me at beginning of combat" and we do.
- **Full Control** is on.
- A trigger, a choice or a targeting decision is waiting. Those are not
  non-events.

So Law 1 is narrower than "skip everything". It is: **an empty window is not a
question.**

### How to test it

A browser spec that plays several turns against the AI holding a hand of only
sorcery-speed cards, and asserts the number of times the client asked for
input. It should be zero outside the player's own main phases. Then the same
game with a Lightning Bolt in hand, which should stop at every opponent
window. That is a real regression test for the product's whole thesis.

---

## Law 2 — One tap does the thing

Moxgate's Available Actions panel says it twice, header and footer:

> **Tap a card to preview it, tap it again to do it.** — `v3_08`

Two taps per action, everywhere. **One tap acts.**

Preview moves to the affordances that cost nothing: **hover** on a pointer
device, **long-press** on touch. Moxgate already has the hover half of this —
`Hold Z to zoom the card you are hovering` (`v2_09`) — so the preview is not
lost, it stops being compulsory.

### What one tap has to answer for

Moxgate's second tap is not pure ceremony. In a rules-enforced game a mis-tap
can be unrecoverable, and that is the problem the extra tap was solving. So
one-tap needs its own answers:

- **Undo for anything reversible.** The current table already has undo
  (`runner.js`). An engine with immutable state makes this cheap — Argentum's
  gym has O(1) `fork()` and snapshot/restore precisely because state is never
  mutated in place. Use it.
- **Confirm only what is genuinely irreversible**, and name the consequence
  when you do, in the house style of `v1_04` — a title that is the situation,
  a body that is the outcome, and buttons that say what they do. Never a
  generic "Are you sure?".
- **Targeting is not a mis-tap risk** if the target is picked after the action
  rather than before: one tap starts the spell, then you choose targets, then
  it goes on the stack. That is also how paper works.
- **A tap that would be illegal does nothing and says why**, rather than being
  silently inert. An engine that enumerates legal actions can also say why a
  given one is not among them.

### How to test it

Count taps for a fixed scripted turn — play a land, cast a creature, attack —
and assert the total against a number. If a change adds a tap, the test fails
and someone has to justify it.

---

## The measure

Two numbers, tracked in the browser suite from the first week:

| Metric | Target |
| --- | --- |
| Input prompts in a turn where the player can do nothing | **0** |
| Taps to play a land, cast a creature and attack with it | **as few as the rules allow, and never more than Moxgate** |

If the rebuild is not clearly better on both, it has not earned the rewrite.
