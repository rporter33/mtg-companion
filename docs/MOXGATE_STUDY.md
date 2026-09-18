# Moxgate: what it does, and what of it belongs here

A study of [Moxgate](https://www.moxgate.com/), a free browser Magic simulator,
written to decide what this project should take from it.

## How this was researched

The site itself could not be opened from the machine this was written on — the
build environment's network policy refuses every host outside a small allowed
list, `moxgate.com` among them. So the evidence here is:

- **Ten screenshots** of the running app on an iPad, held sideways, in a solo
  Commander game and at the lobby. These are the primary source and the reason
  most of this document can be specific about layout and wording.
- **Three screen recordings**, 12, 24 and 20 seconds, of the same iPad: the
  lobby, seating an opponent, and the first two turns of a game. Sampled at
  two frames a second and de-duplicated, they came to 29 distinct screens.
  They are what the section *What the recordings added* below is drawn from,
  and they are better evidence than the screenshots for anything involving a
  sequence — what a button says before and after it is pressed, what the log
  looks like as it fills. They carry no sound, so nothing here is taken from
  narration.
- **The public index**: Moxgate's own pages as summarised by a search engine —
  its [front page](https://www.moxgate.com/), [solo mode](https://www.moxgate.com/solo),
  [learn page](https://www.moxgate.com/learn/), [bug fixes and rulings](https://www.moxgate.com/bugs/),
  [deck guides](https://www.moxgate.com/guides/) and a
  [developer API](https://www.moxgate.com/developer/).

Where something is inferred from a screenshot rather than stated by Moxgate, it
says so. Nothing here is a claim about how their code works.

## What Moxgate is

A Magic simulator that runs in a browser with no download and no account. It
offers solo practice against an AI, 1v1, and four-player Commander pods (pods
were paused for server load when the screenshots were taken). Formats on the
lobby are Commander, Standard, Pauper and Draft, with more behind a menu.

The thing that defines it: **the rules are enforced**. Their own phrasing is
that the game will not let you make an illegal play. Their bugs page reads like
a rules engine's changelog — a note about a priority stop at the beginning of
combat that auto-passed while the player held removal, and another about
`The Warring Triad` making mana without being a mana ability, because a mana
ability has no target, so it cannot be reached for halfway through paying a
cost. That is a engine that knows what cards do.

Their teaching pitch is five minutes of reading and then a real game against
one of five mono-coloured decks, with every rule enforced so a beginner cannot
make a mistake.

## What the screenshots show

### The table, held sideways

The whole game is one landscape screen with no scrolling. Each player's
belongings sit on their own edge: the opponent's hand as card backs along the
top with their library, graveyard, command and exile as labelled dashed boxes
beside them; your hand fanned along the bottom with your own zones at the
bottom right. The battlefield is the middle, divided into two halves by a faint
seam, each half tinted. Cards sit at slight individual rotations, so it looks
laid out by hand rather than snapped to a grid.

### The game log

A panel down the right, newest first, grouped by player and turn with headers
like `SYTHIS · TURN 4`. Each entry has a thumbnail of the card it concerns and
reads as a sentence: `You drew Thrór's Map`, `Sythis cast Aegis of the Gods`,
`Sythis Sunpetal Grove - {T}: Add {G} or {W}.` Between the entries, in a
quieter type, are the step transitions the game passed through without anything
happening: `untap → upkeep`, `sythis' beginning of combat → sythis' cleanup`,
`main phase, precombat`. The collapsed steps are what makes it readable: the
log says where the game went, not only what was done.

### The prompt

Under the log, a panel that names the step and says what is being asked of you:

- *Your first main. Nothing to play.* — with a `FIRST MAIN` chip and one `Pass`.
- *Your combat. Nothing to respond with.* — chip `COMBAT`, one `Pass`.
- *Sythis's end step. Nothing to flash in.* — chip `END STEP`, one `Done`.
- *Your first main. Make a play, or pass.* — chip `FIRST MAIN`, then `Pass`
  **and** `Play`.

This is the best idea in the app. It is a priority prompt that explains itself.
"Nothing to respond with" and "nothing to flash in" tell a new player *why*
there is nothing to do, in the vocabulary of the thing they are learning. It
needs a rules engine to be true.

### Available Actions

A modal: *Tap a card to preview it, tap it again to do it.* A list on the left
grouped by zone with a count (`BATTLEFIELD 1`), each row naming the card and its
action in shorthand (`Add {R}. · {T}`). On the right, the full card image, then
an `ACTIVATE` block spelling out `COST {T}` and `Add {R}.`, and at the bottom
the available mana. It is the legal-move list, made browsable.

### The zone browser

*Sythis's Command Zone* as a modal with a count, grouped by card type with
counts per group (`CREATURES 1`), and a search box whose placeholder teaches its
own syntax: `Search name/type/text · t: o: name:`. The same shape presumably
serves library, graveyard and exile.

### Counters

*You · Counters* — a grid of the counters a player can have, each with minus,
value, plus: poison, energy, experience, rad, storm, ticket, speed. Then
**commander damage received**, one row per opponent (`from Sythis`). Then
**custom counters**, a name field and an `Add` button for anything the game did
not anticipate. One `Done`.

### The hand

The cards overlap and arc — a fan, not a row — which is why seven of them fit
in the width of three and a half and can each be half as wide again as a row
would allow. Mana costs float above each card as pips — `{2}{R}`, `{2}`, `{T}` — so you read
what a card costs without reading the card. In the later screenshots several
hand cards have a green glow and others do not: castability, shown on the card
itself. The left rail carries the phase chip (`MAIN 1`, `DRAW`, `UP NEXT`),
life with plus and minus, `ACTIONS` / `COMBAT` / `END TURN`, and
**AVAILABLE MANA** as a generic count and a coloured pip.

### The battlefield card

A `SICK` badge for summoning sickness, power and toughness in a boxed corner
overlay, tapped cards rotated. Small, quiet, readable at a glance.

### The lobby

*Solo: Commander — 100-card singleton.* Format tabs across the top. Below them
a deck search and three filter dropdowns that open into chips **with counts**:
colours (`{W} 256`, `{U} 258`, … plus `Exactly these`), archetype (`Tribal 77`,
`Counters 56`, `Tokens 53`, … down to `Extra Turns 2`, `Goodstuff 110`), and
bracket (`B2 Core 279`, `B3 Upgraded 184`, `B4 Optimized 66`, `B5 cEDH 12`).
Three cards offer a **random deck**, **import** ("Paste a decklist to brew your
own") and a rotating **guide**. Then a shelf of decks, each a card with art, an
archetype tag, colour pips, a bracket badge and a card count. On the right, the
table: your seat, an open seat with `+ AI`, an honest notice that pods are
paused, and a line explaining what solitaire means. `Preview deck` and
`Start game` at the bottom.

The counts are what make the filters usable. You are not guessing whether a
filter has anything behind it.


## What the recordings added

The screenshots showed the table at rest. The recordings show it moving, and
four things only a sequence could have shown.

### A confirm dialog names the consequence, not the action

Starting a solo game with nobody in the second seat brings up:

> **No opponent seated**
> Every seat but yours is empty, so nobody will play against you. You'll be
> drawing and casting on your own. Good for testing a deck, not a game.
> `Play alone anyway`  ·  `Seat an opponent`

No "Are you sure?", no OK and Cancel. The title is the situation, the body is
what will happen, and each button says what pressing it does. This is a house
style worth stealing outright — it needs no engine and it is better than what
this app does in several places today.

The same idea runs through the buttons: picking a rival changes
`Roll the dice →` into `Start game vs Sythis →`.

### The prompt teaches the step, and its wording changes with the step

At each stop the panel says where you are, then what the step is *for*:

| Step | What it says | The teaching line under it |
| --- | --- | --- |
| Your upkeep | Nothing to respond with. | Some cards trigger now. Most turns, nothing does. |
| Your first main | Make a play, or pass. | Play a land and cast your spells |
| Your combat | Nothing to respond with. | Choose which creatures attack |
| Sythis's end step | Nothing to **flash in**. | — |

Two halves, and they do not port together. "Nothing to respond with" is a
claim about the rules and is theirs alone. The teaching line is a fact about
the turn, which is already written down here in `docs/TURN_STRUCTURE.md` — so
`TurnTracker` can say the second half and must not say the first.

The wording shifting to "nothing to flash in" at end step is the kind of care
worth matching.

### Pace is chosen once, as a posture, not as a settings page

Before the first turn:

> **How do you want to play?** You can change any of this later in Settings.
> **Fast** — Keep it moving. *Fewer clicks.*
> **Controlled** — See every window. *More passing.*
> **Learning** — Explain as you go. *Phases explained.* "Stops at every
> window, and each phase says what it is for the first few times you see it."

Underneath, an `Advanced` disclosure holds the three settings the presets
actually set: playback speed, auto-pay mana, full control. The preset is a
bundle; the disclosure is the truth. "The first few times you see it" is the
detail that makes Learning tolerable rather than nagging.

### Hidden information is visibly hidden in the log

`Sythis drew a card` is greyed and has no thumbnail. `You drew Mithril Coat`
is in full colour with the card's art beside it. The log never pretends to
know what it cannot see, and it shows that it does not know by how the line
looks rather than by saying so. That rule belongs in `readLog` the moment
there is a second seat (T4b-2).

### Smaller things, all portable

- Zone tiles in the corners — `LIB 92`, `CMD 1`, `GY`, `EXILE` — as small
  stacked cards with a count, mirrored top and bottom for the two seats.
- The phase is a pill on the life plate (`MAIN I`, `DRAW`, `UP NEXT`,
  `THEIR TURN`), and the active seat's plate gets a ring. The turn state
  lives next to the player it is about.
- The opening hand is a prompt floating on the battlefield — *Opening Hand,
  7 cards* · `Mulligan — Draw 7, free` · `Keep Hand →` — not a modal.
- `Available Actions` is two panes: the list on the left grouped by zone with
  a count, the whole card plus the cost and effect of the selected action on
  the right, and the rule restated at the bottom — *tap an action to preview
  it here, tap it again to do it*. It minimises as well as closes.
- The opponent picker has difficulty tabs carrying counts
  (Beginner 7, Intermediate 13, Advanced 15), and each rival card gives an
  archetype, a one-line description of what the deck actually does, who built
  it, and *Beats ~77% of challengers*. The playstyle slider under it is
  labelled *Tactics, not difficulty*.

### What the recordings talked me out of

On the battlefield Moxgate does **not** show the whole card. A permanent is
cropped to its art with a name strip under it — *FOREST · LAND* with a green
pip — and the tile is landscape, so far more fits on screen.

It is tempting, and it is wrong here. Their engine taps cards for you and
carries the tapped state in its own panel; ours does not, so the rotation *is*
the signal that a card is tapped, and it only reads as one if the card is
portrait to begin with. A landscape tile rotated ninety degrees becomes
portrait, which says "untapped" to anyone who has played with paper. Add that
the ask was for cards that look like the cards, and the crop is a step back
towards the drawn tile it replaced.

So the battlefield keeps the whole printed face. The space the crop would
have saved was found in the hand instead, where there is nothing to tap.

## The difference that decides everything

Moxgate knows what every card does. This project deliberately does not.

Our table (`src/lib/board/`) holds *where every card is* and never *what a card
does*, so that it works with any card Scryfall has ever printed, including one
released tomorrow. The rules-enforced engine lives only in `src/lib/table/`,
over nineteen cards, for teaching.

So the features above fall into three groups, and the third is the one to be
honest about.

### Ports directly — no rules knowledge needed

| Moxgate | Here |
| --- | --- |
| Game log grouped by player and turn, with collapsed step transitions | We already emit events with the turn stamped on them (`runner.js`), and we have the step list from `docs/TURN_STRUCTURE.md` |
| Zone browser with typed search and type groups | Our piles are lists; a hundred-card library needs search |
| Player counters: poison, energy, experience, commander damage, custom | `board.counters[player]` exists and is unused beyond dice |
| Mana cost pips above hand cards | `mana_cost` from Scryfall; we already draw our own symbols (`ManaCost.jsx`) |
| Power/toughness corner box | `power` / `toughness` from Scryfall |
| Landscape layout, per-seat edges, slight card rotation | Already ours; theirs confirms the direction for seats (T4b-2) |
| Lobby: search, filters with counts, random deck, preview | We have the deck data and the archetype vocabulary already |

### Ports in a reduced, honest form

**Available mana.** Moxgate knows your real mana. We can count untapped lands
on your battlefield and read `produced_mana` off each one. That is arithmetic on
Scryfall data, not a rules engine — it is right for lands and wrong for a
Cabal Coffers. So it is shown as *what your untapped lands say they make*, and
labelled as that.

**Castability.** The green glow needs the engine. Comparing a card's pips
against that available-mana figure is arithmetic, and it is wrong for cost
reduction, alternative costs, and half a dozen other things. If it appears at
all it is a hint that says on screen what it ignores — which is the rule this
project already works to: anything the app works out itself says so.

**Available Actions.** Theirs lists *legal* actions. Ours can list *physical*
ones — everything on the table and in hand, searchable, with the moves this
table allows. Useful for the same reason (finding the thing you want to touch
without hunting for it), honest about being a different promise.

### Cannot port without becoming a different project

**The priority prompt.** "Nothing to respond with" is a claim about the rules.
We cannot make it. What we can say is where you are in the turn and what
happens next, which is what `TurnTracker` already does from
`docs/TURN_STRUCTURE.md` — the wording can borrow from Moxgate without the
claim.

**An AI opponent.** Out of scope.

**Rules enforcement itself.** The nineteen-card teaching table is where rules
live here, on purpose. Extending it to every card is a different product, and
the one this project chose not to build.

## The plan

Five milestones, in value order for a Commander player on a phone.

- **MG1 — The log.** The event stream as a readable panel: newest first,
  grouped by turn, collapsed step transitions, a thumbnail per entry.
- **MG2 — Knowing your mana.** Available mana from untapped lands, cost pips on
  hand cards, both labelled for what they are.
- **MG3 — Counters.** The player-counters dialog, commander damage per
  opponent, custom counters.
- **MG4 — Finding a card.** Zone browser with typed search and type groups,
  over library, graveyard, exile and command.
- **MG5 — The lobby.** Deck picker with search, filters that carry counts,
  random deck, and a table panel.

Each is testable without a rules engine, which is the point.

Then, from the recordings:

- **MG6 — The hand as a fan.** Done: `fan()` in `src/lib/board/geometry.js`.
- **MG7 — Saying what will happen.** The confirm-dialog style above, applied
  to the places this app currently asks "Are you sure?".
- **MG8 — The step, taught.** The teaching half of the prompt, from
  `docs/TURN_STRUCTURE.md`, and the phase pill beside the life total.
- **MG9 — A posture, not a settings page.** Presets over the table's options,
  with the disclosure that shows what each one actually sets.
