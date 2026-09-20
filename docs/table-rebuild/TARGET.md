# Moxgate, screen by screen

Everything here was read off an iPad held sideways: ten screenshots and three
screen recordings (12s, 24s, 20s), the latter sampled at two frames a second
and de-duplicated down to the 29 frames in `frames/`. Frames are cited by name.

The site itself could not be opened from the build environment, so **nothing
here is a claim about how their code works** — only about what the screen
showed. The recordings have no sound.

A fuller narrative version, with the reasoning about what ports and what does
not, is in `../MOXGATE_STUDY.md`. This file is the specification.

---

## 1. Home — `v1_01`

Dark purple, centred wordmark. `3141 playing today` top right beside `Sign in`
and a language picker. One line under the logo: *"Play Magic in your browser,
against the computer or with friends. No installs, no account needed."*

Three panels across: **Multiplayer / Play** ("With a friend, or at an open
table"), **Single Player / Solo** ("Full rules enforcement, against a real AI
opponent") with `Start a game →` and an `OR START IN` row of format chips, and
**Solo or Friends / Draft** ("Three packs, then build").

Below: a shelf of **Commander decks** — *Most played on Moxgate* — each with
art, name and `622 games in 30 days`. Then **New to Magic?** with
`Learn to play →`, and a **Conquest** roguelike preview showing three act
cards and `17% reach the throne`.

The footer carries the Fan Content Policy notice, Scryfall credit, and the
Forge/GPL-3.0 line quoted in `README.md`.

## 2. Lobby — `v1_03`, `v1_08`

Titled **Solo: Commander**, subtitle *100-card singleton*, back arrow.

- **Format tabs**: Commander, Standard, Pauper · Draft · ▾ More.
- **Search decks…** plus three dropdown filters: `Colors ·`, `Archetype ·`,
  `Bracket ·`. Each opens to chips **carrying counts** (`{W} 256`,
  `Tribal 77`, `B2 Core 279`, and an `Exactly these` option for colours). The
  counts are what make the filters usable — you never open an empty one.
- **Three tiles**: `WILDCARD / Random Deck`, `IMPORT / My Decks` ("Paste a
  decklist to brew your own"), `GUIDE / <a commander>` ("rotates every
  visit" — it differs between `v1_03` and `v1_08`).
- **A shelf of decks**, each an art card with an archetype tag (`TRIBAL`),
  colour pips, a bracket badge (`B2`, `B3`), name, commander and `100 cards`.
  A section header can be editorial: *★ New from The Hobbit — WHILE IT'S NEW*.
  The selected deck gets a tick.
- **Right rail — the table**: `TABLE · 1 / 2` with `Y You` and a greyed
  `Open seat / pick who you play against` carrying `+ AI`. Once filled it
  reads `TABLE · 2 / 2` with `S Sythis / defensive`, an `AI` badge and an `×`.
- Under it, an **honest notice**: *"Four player pods are paused. We are keeping
  tables steady for everyone while we work on server load. One on one plays as
  normal, and pods come back as soon as that is done."*
- And a line that **changes with the seats**: `Solitaire: no opponent yet. Seat
  one to play Rules Enforced.` becomes `Rules Enforced: the engine runs the
  game.`
- Bottom: `Preview deck` · `Start game →`.

## 3. "No opponent seated" — `v1_04`

Pressing `Start game` with an empty seat:

> **No opponent seated**
> Every seat but yours is empty, so nobody will play against you. You'll be
> drawing and casting on your own. Good for testing a deck, not a game.
> `Play alone anyway` · `Seat an opponent`

**The house style worth stealing outright.** The title is the situation, the
body is the consequence, and each button says what pressing it does. No "Are
you sure?", no OK/Cancel anywhere in the product.

## 4. Choosing an opponent — `v1_05`, `v1_06`, `v1_07`

**Choose your opponent** — *"Bring your own deck for the AI, roll the dice, or
face a named rival on a signature deck."*

- **Difficulty tabs with counts**: `Beginner 7` · `Intermediate 13` ·
  `Advanced 15`.
- Two tiles: `BROWSE / Custom Deck`, `WILDCARD / Random Rival` ("A fresh face
  and a new deck, every game").
- **Rival cards**: art, an archetype badge on the art (`Defensive`,
  `Aggressive`, `Balanced`), a colour-identity pip, a `SPONSOR` tag where one
  applies, then the rival's name, the deck's name in small caps
  (`SELESNYA ENCHANTRESS`), **one line of what the deck actually does**
  ("Every enchantment draws it another card. Attacking costs more than you can
  pay."), `Deck by dmeffe`, `Beats ~77% of challengers`, and `ADVANCED`.
- **Bottom bar**: `PLAYSTYLE` — *Tactics, not difficulty* — a slider
  Defensive ↔ Balanced ↔ Aggressive, and the action button.
- Selecting a rival (`v1_07`) puts a tick on the card, **snaps the slider to
  that rival's archetype**, and relabels the button `Roll the dice →` →
  **`Start game vs Sythis →`**.

## 5. "How do you want to play?" — `v2_05`, `v2_06`

Before the first turn. *"You can change any of this later in Settings."*

| Preset | Tagline | Chip | Body |
| --- | --- | --- | --- |
| **Fast** | Keep it moving | `FEWER CLICKS` | Dead moments flow past. You are still asked whenever you are holding a play. |
| **Controlled** | See every window | `MORE PASSING` | Stop at every priority point, both turns, and tap your own mana. |
| **Learning** | Explain as you go | `PHASES EXPLAINED` | Stops at every window, and each phase says what it is for **the first few times you see it**. |

Under them a note: *"Either way, you can turn on Full Control or arm priority
stops any time, from the half-hand tab beside your phase readout or from
Settings."*

An **`▾ Advanced`** disclosure (`v2_06`) reveals the three settings the presets
actually set: `Playback speed` (Relaxed / Brisk / Instant), `Always auto-pay
mana` (Off), `Full Control` (On). **The preset is a bundle; the disclosure is
the truth.**

Buttons: `Don't ask again` · `Start`.

## 6. "How to Play" — `v2_07`, `v2_09`

Subtitled **Rules Enforced**. Seven tiles, each an icon, a title and two or
three lines: *Mana from lands*, *The engine runs the turn*, *Play a card*,
*Respond on the stack*, *Combat*, *End your turn*, and a wide one —
*You choose when the game stops*.

`▾ More rules & tips` expands a **GOOD TO KNOW** list: **Priority stops** live
on the half-hand tab; **Mulligan** happens before the game; **Hold Z** to zoom
the card you are hovering.

Buttons: `Don't show again` · `Let's play`.

## 7. The table — `v2_03`, `v2_12`, `v3_09`

Landscape. Reading clockwise from the top:

- **Opponent's hand** as fanned card backs across the top edge, then their
  `LIBRARY 92`, `GY`, `COMMAND` and exile tiles.
- **Opponent's life plate** top left: a status word (`WAITING`, `THEIR TURN`),
  name, life. The **active player's plate gets a coloured ring**.
- **The battlefield**: a parchment playmat with faint horizontal lane rules,
  mirrored — their permanents in the upper half, yours in the lower.
- **Game log** panel, top right, collapsible by a chevron. See §9.
- **The prompt panel** below the log. See §8.
- **Your life plate** bottom left: the **phase as a pill** (`MAIN I`, `DRAW`,
  `UP NEXT`, `YOUR TURN`), name, life with − / + steppers, a small `0/1`
  readout, and **`AVAILABLE MANA`** — the words *No mana available*, or
  coloured pips once you have some (`v3_09` shows two).
- **Actions rail** beside it: `ACTIONS`, `⚔ COMBAT`, `→ END TURN`, `…`. It
  collapses to icons while the prompt panel is showing (`v2_11`).
- **Your hand** along the bottom: real card faces, heavily overlapped,
  arced and each turned a little, with **the mana cost floating above** each
  card, over the sliver of it that is still visible.
- **Zone tiles** bottom right: `LIB 92`, `CMD 1`, `GY`, `EXILE` as small
  stacked cards with counts, mirroring the opponent's. Then a vertical rail of
  round buttons: help, a skull, settings, sound.

**A permanent on the battlefield is cropped, not whole** (`v2_12`): art
filling a landscape tile with a name strip under it — `FOREST` left, `LAND`
right, a green mana pip on the left. A freshly played card glows green.

> **We now copy this.** An earlier decision kept the whole printed face,
> because in an *unenforced* table rotation is the only thing that says
> "tapped", and a landscape tile turned ninety degrees reads as untapped. With
> an engine tracking tapped state that objection largely goes: the app knows,
> and can dim the tile and put a tap glyph on it as well as turning it. The
> crop fits two to three times as many permanents on a screen, which serves
> the friction thesis in `FRICTION.md`.
>
> What still has to be solved, and tested: **tapped must read instantly**.
> Rotation alone is not enough on a landscape tile, so pair it with a dim and
> a glyph — and keep "tapped" in the spoken label, per `HOUSE-RULES.md`.
>
> **The playmat is copied too** (2026-09-20). The battlefield is parchment
> inside the app's dark chrome — `--mat` and its four companions in
> `tokens.css` — with the lane rules drawn solid and faint in ink, and the
> lane names, the empty-table line and the pointing arrow in ink as well,
> since gold and pale grey both vanish on paper. The pooled light and the
> darker edges are gradients; the frames' decorative sun is not reproduced,
> because it is Moxgate's and a mat needs nothing drawn on it.

**Opening hand** (`v2_03`) is a prompt floating on the battlefield, not a
modal: *Opening Hand / 7 cards* · `Mulligan / Draw 7, free` · `Keep Hand →`.

## 8. The prompt panel — `v2_11`, `v3_03`, `v3_04`, `v3_05`, `v3_09`

The single most instructive thing in the recordings. At every stop:

| Frame | Title | Step chip | Teaching line | Buttons |
| --- | --- | --- | --- | --- |
| `v3_04` | Your upkeep. Nothing to respond with. | `UPKEEP` | Some cards trigger now. Most turns, nothing does. | `Pass` |
| `v3_05` | Your first main. Make a play, or pass. | `FIRST MAIN` | Play a land and cast your spells | `Pass` · `Play` |
| `v3_09` | Your combat. Nothing to respond with. | `COMBAT` | Choose which creatures attack | `Pass` |
| `v2_11` | Sythis's upkeep. Nothing to respond with. | `UPKEEP` | — | `Done` |
| `v3_03` | Sythis's end step. Nothing to **flash in**. | `END STEP` | — | `Done` |

Three things to notice:

1. **The wording tracks the step** — "nothing to respond with" at upkeep
   becomes "nothing to flash in" at end step.
2. **The button tracks whose turn it is** — `Pass` on yours, `Done` on theirs.
3. **The teaching line is separable from the rules claim.** "Nothing to
   respond with" requires the engine. "Some cards trigger now. Most turns,
   nothing does." is a fact about the turn — and it is already written down in
   this repo, in `docs/TURN_STRUCTURE.md`. That half ports today.

The panel also has an expand icon (top right) — presumably full-screen.

## 9. The game log — `v2_03`, `v2_12`, `v3_05`, `v3_09`

Newest first. Structure, top to bottom:

- **Turn dividers**: the active player's name in colour and `TURN 2`, e.g.
  `SYTHIS · TURN 1`. Your own turn gets a green dot and reads `YOUR TURN`, and
  can appear as a full-width green banner (`v3_04`).
- **Step dividers** in faint small caps — `SYTHIS' MAIN PHASE, PRECOMBAT`,
  `DRAW` — with **the steps that passed without incident listed beneath them
  in even fainter text**: `sythis' untap · sythis' draw`.
- **Entries**: a small square of the card's art, the actor's name in colour,
  then the sentence. `You played Plains`, `Sythis drew a card`,
  `You have kept a hand of 7 cards`.

**Hidden information is visibly hidden.** `Sythis drew a card` is greyed and
carries **no thumbnail**; `You drew Mithril Coat` is in full colour with the
art beside it. The log never pretends to know what it cannot see, and it shows
that by how the line looks rather than by saying so.

## 10. Available Actions — `v2_04`, `v3_08`

A two-pane overlay. Header: **Available Actions**, and the rule —
*"Tap a card to preview it, tap it again to do it."* Minimise (`−`) as well as
close (`×`).

- **Left**: rows grouped by zone with a count on the header (`BATTLEFIELD  1`).
  Each row is an art thumbnail, the card's name, the action written in mana
  symbols (`Add {W} · {T}`), and a zone chip.
- **Right**: the whole card image, then an `ACTIVATE` block giving
  `COST {T}` and `Add {W}.` Under it the rule is restated — *"Tap an action to
  preview it here. Tap it again to do it."* — and `AVAILABLE MANA` with its
  pips.

## 11. The castability glow — `v3_05`, `v3_07`

In the first main, the cards in hand you can actually cast are **outlined in
green**; the rest are not. In `v3_05` two Mountains and a Plains glow; after
the Plains is played (`v3_07`) the two Mountains still do.

**This is the thing that needs the engine.** Comparing pips to a count of
untapped sources — which is what `src/lib/board/mana.js` does today — is wrong
for cost reduction, alternative costs, and anything conditional. Our version
is deliberately weaker and says so on screen.

---

## What ports without an engine, and what does not

**Ports as-is** — all of §1–§4, §5, §6, §7 (layout, plates, zone tiles,
opening-hand prompt, and now the cropped battlefield tile), §9 in full, §10,
and the whole confirm-dialog and button-labelling style.

**Ports, but fixed** — §8 and §10 carry Moxgate's two friction faults. The
prompt panel must not stop for a window the player cannot act in, and the
actions panel must act on one tap. See `FRICTION.md`; those two changes are
the point of the rebuild.

**Needs the engine** — the castability glow (§11), `AVAILABLE MANA` as a true
number, "nothing to respond with" (the claim, not the teaching line), legal
attack and block declaration, automatic triggers, and the AI opponent.

That second list is short. Most of what makes Moxgate feel like Moxgate is
client-side, and much of it is already built here — which is the argument
`ENGINE.md` makes for Option D.
