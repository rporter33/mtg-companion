# The structure of a turn

The reference this app follows for phases, steps, priority and the stack.

**Source.** Adapted from the Comprehensive Rules effective 7 August 2026, in
the table form devised by April King (@CubeApril) and published by
BoiledOwlbear (boiledowlbear.com). Rule numbers below are quoted as the source
gives them; where a number here differs from one you remember, the source is
what this app follows, and the number is a citation rather than a claim.

**How to read it.** The first column is the five phases, the second the steps
inside each, the third what happens in that step, in order. Every phase and
step happens whether or not anything is done in it (500.1) unless a rule says
otherwise. No player receives priority in the untap step, or in a cleanup step
where no state-based actions would be performed and no triggered abilities are
waiting (500.3). Those steps end when their actions are done. Every other
phase and step ends when the stack is empty and all players pass priority in
succession (500.2), and at that point unused mana empties from each player's
mana pool (500.5).

Two markers recur and are spelled out in the legend at the end:

- **A** — triggered abilities are put on the stack, in the two-part APNAP
  process of 603.3b.
- **B** — a player gets priority: state-based actions, then triggers, then the
  priority itself (117.5).

---

## Beginning phase (501.)

### Untap step (502.)

1. Phasing happens. All phased-out permanents the active player controlled
   when they phased out phase in, and all phased-in permanents with phasing
   that the active player controls phase out, simultaneously. A turn-based
   action that does not use the stack. (502.1)
2. If it is day and the previous turn's active player cast no spells during
   that turn, it becomes night. If it is night and that player cast two or
   more spells during that turn, it becomes day. If it is neither day nor
   night, this check does not happen. A turn-based action that does not use
   the stack. (502.2)
3. The active player determines which permanents they control will untap, then
   untaps them all simultaneously. A turn-based action that does not use the
   stack. (502.3)

*No player receives priority in this step.* Unused mana empties. (500.5)

### Upkeep step (503.)

- **A** — Abilities that triggered during the untap step (502.4) and "at
  beginning of upkeep" triggered abilities are put on the stack together
  before the active player gets priority, in the order described in legend A
  regardless of which triggered first. (503.1a)
- **B** — The active player gets priority. (503.1)

### Draw step (504.)

1. The active player draws a card. A turn-based action that does not use the
   stack. (504.1) In a two-player game, the player who plays first skips the
   draw step of their first turn. (103.8a)
- **A** — "At the beginning of the draw step" triggered abilities trigger
  (500.6), as do any abilities that trigger when the active player draws a
  card.
- **B** — The active player gets priority. (504.2)

---

## First (precombat) main phase (505.)

This phase has no steps.

1. First, the active player sets the top card of their scheme deck in motion
   if they are the Archenemy (Archenemy games, rule 904). Turn-based, does not
   use the stack. (505.3)
2. Second, the active player puts a lore counter on each Saga they control
   with one or more chapter abilities. Turn-based, does not use the stack.
   (505.4)
3. Third, if the active player controls one or more Attractions, they roll to
   visit their Attractions. Turn-based, does not use the stack. (505.5)
- **A** — "At beginning of next main phase" and "at the beginning of precombat
  main phase" triggered abilities trigger. (500.6)
- **B** — The active player gets priority. **While the stack is empty** they
  may also cast sorcery-speed spells — sorceries, creatures, artifacts,
  enchantments, planeswalkers and battles — and play a land if they have not
  played one this turn (305.2, 505.6a–b). **Lands may not be countered or
  responded to** (505.6b): playing a land does not use the stack.

---

## Combat phase (506.)

### Beginning of combat step (507.)

1. In a multiplayer game where the active player's opponents do not all
   automatically become defending players, the active player chooses one of
   their opponents; that player becomes the defending player. Turn-based, does
   not use the stack. (507.1)
- **A** — "At beginning of combat" triggered abilities trigger. (500.6)
- **B** — The active player gets priority. (507.2)

### Declare attackers step (508.)

1. The active player declares their attackers. If the defending player
   controls any planeswalkers or protects any battles — or the game allows
   attacking multiple players — the active player also announces which player,
   planeswalker or battle each attacker is attacking. (508.1b) **If no
   creatures are declared as attackers or put onto the battlefield attacking,
   the declare blockers and combat damage steps are skipped** (508.8).
   Turn-based, does not use the stack. (508.1)
- **A** — Triggered abilities that trigger off attackers being declared
  trigger. (508.1m)
- **B** — The active player gets priority. (508.2)

### Declare blockers step (509.)

1. The defending player declares their blockers and which attacking creatures
   they will block. Turn-based, does not use the stack. (509.1)
- **A** — Triggered abilities that trigger off blockers being declared
  trigger. (509.1i)
- **B** — The active player gets priority. (509.2)

### Combat damage step (510.)

**First combat damage step.** If no attacking or blocking creature has first
strike or double strike as this step begins, ignore the bracketed text — there
is only one combat damage step. (510.4)

1. All blocked creatures [with first strike or double strike] assign combat
   damage to their blockers. (510.1c)
2. All unblocked creatures [with first strike or double strike] assign combat
   damage to the player, planeswalker or battle they are attacking. (510.1b)
3. All blocking creatures [with first strike or double strike] assign combat
   damage to the creatures they are blocking. (510.1d)
4. All assigned damage is dealt simultaneously. Turn-based, does not use the
   stack. (510.2)
- **A** — "Deals combat damage" and "is dealt combat damage" triggered
  abilities trigger. (510.3a)
- **B** — The active player gets priority. (510.3)

**Second combat damage step (510.4).** If no attacking or blocking creature
had first strike or double strike as the first combat damage step began, this
second step never occurs.

1. All blocked creatures that did not have first strike or double strike when
   the first combat damage step began, or that currently have double strike,
   assign combat damage to their blockers. (510.1c)
2. The same creatures, if unblocked, assign combat damage to the player,
   planeswalker or battle they are attacking. (510.1b)
3. All blocking creatures under the same condition assign combat damage to the
   creatures they are blocking. (510.1d)
4. All assigned damage is dealt simultaneously. Turn-based, does not use the
   stack. (510.2)
- **A** — "Deals combat damage" and "is dealt combat damage" triggered
  abilities trigger. (510.3a)
- **B** — The active player gets priority. (510.3)

### End of combat step (511.)

- **A** — "At end of combat" triggered abilities trigger. (511.2)
- **B** — The active player gets priority. (511.1)
1. As soon as the end of combat step ends, all creatures, battles and
   planeswalkers are removed from combat. (511.3)
2. "Until end of combat" effects end. (500.5a)

---

## Second (postcombat) main phase (505.)

This phase has no steps.

- **A** — "At beginning of next main phase" and "at the beginning of
  postcombat main phase" triggered abilities trigger. (500.6)
- **B** — The active player gets priority, with the same sorcery-speed and
  land-drop allowances as the first main phase (505.6, 305.2, 505.6a–b).

---

## Ending phase (512.)

### End step (513.)

- **A** — "At the beginning of the end step" or "at the beginning of the next
  end step" triggered abilities trigger (500.6). A permanent with such an
  ability that enters the battlefield during this step, or a delayed trigger
  created during this step, waits until the next turn's end step. (513.2)
- **B** — The active player gets priority. (513.1)

### Cleanup step (514.)

1. The active player discards down to their maximum hand size, usually seven.
   Turn-based, does not use the stack. (514.1)
2. Simultaneously, all damage marked on permanents — including phased-out
   permanents — is removed and all "until end of turn" and "this turn" effects
   end. Turn-based, does not use the stack. (514.2)
3. Check for state-based actions and triggered abilities, such as those that
   trigger "at the beginning of the next cleanup step". (514.3a)
4. **If no state-based actions or triggered abilities occur**, unused mana
   empties from each player's mana pool and the cleanup step ends. (500.5,
   514.3a) *No player receives priority.*
   - Otherwise: **A** — "At the beginning of the next cleanup step" triggered
     abilities trigger (514.3a); **B** — the active player gets priority
     (514.3a); then the cleanup step repeats. (514.3a)

---

## Legend

**A — putting triggered abilities on the stack.** The next time a player would
receive priority (603.3), triggered abilities are put on the stack in a
two-part process. First, each player in APNAP order — the active player, then
each other player in turn order — puts on the stack each triggered ability
they control whose trigger condition is not another ability triggering, in any
order they choose. Then each player in APNAP order puts their remaining
triggered abilities on the stack in any order they choose. (603.3b)

**B — a player gets priority.** Each time a player would get priority, the
game first performs all applicable state-based actions as a single event, then
repeats that until no state-based actions are performed. Then triggered
abilities are put on the stack. These steps repeat in order until no further
state-based actions are performed and no abilities trigger. Then the player
who would have received priority does so. (117.5)

All players must pass priority in succession, without any player casting a
spell, activating an ability or taking a special action, for the top spell or
ability on the stack to resolve — or, if the stack is empty, for the step or
phase to end. (117.4)

**Exception:** mana abilities do not use the stack and cannot be responded to.
A player may activate one whenever they have priority, and also in the middle
of casting a spell, activating an ability or resolving a spell or ability,
whenever a mana payment is called for. (605.3)

Choices and actions that a resolving spell or ability instructs players to
make happen during that resolution and are **not** separate response windows.

---

## How this maps to the code

| Concept here | Where it lives |
| --- | --- |
| The phases and steps, in order, with what may be done in each | `src/data/turn-structure.js`, checked by `tests/turn-structure.test.js` |
| The turn tracker on the free table | `src/features/table/TurnTracker.jsx` |
| Which zone a card belongs in, and what may sit on the battlefield | `src/lib/board/placement.js` |
| The stack as a zone on the free table | `src/lib/board/model.js` (`ZONES`) |
| Priority, the stack and state-based actions, actually enforced | `src/lib/table/` — the practice engine, over its own small pool of cards |

Two engines, and the difference matters. `src/lib/table/` **enforces** these
rules over nineteen cards it knows completely, and refuses by name what it
does not model. `src/lib/board/` is the free table: it walks the same phases
and steps as a **tracker**, so the person can see where they are and what is
allowed there, but it does not resolve anything on their behalf. What the free
table does enforce is placement — where a card of a given type sits, and the
fact that an instant never stays on the battlefield — because that is what a
printed playmat does, and because getting it wrong is the mistake that makes a
new player's board unreadable.
