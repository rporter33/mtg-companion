# Learn: progress record

The running record for the practice-table work, kept so a fresh session can
resume from it. Milestones are the ones agreed on 18 September 2026 from the
"MTG Learn" implementation brief, weighed against the code as it stood.

## Baseline

- Baseline commit: `ae5117a` (main), 909 unit tests after M0, 22 browser specs.
- Every finding in the brief (F01–F10) confirmed against that commit. Two
  corrections: F06 is an ungated "Mark complete" button, not completion on
  view; F03 is broader than stated, every permanent on both sides untapped
  whenever the active player changed.
- Found beyond the brief: the Craw Wurm cast never spent its mana; the beat
  titled "A two-for-one" described a one-for-one; the stack quiz's premise
  contradicted its answer; the Commander lesson's ban-list line was stale;
  colourless mana was never explained; the bundled tutorial cards carried no
  source ids; the written lessons had no tests; `seenGlossary` is never read
  or written (left in place, noted here).
- Sources the brief cites (rules hub, How to Play, W3C, Scryfall docs) are
  unreachable from the build session. Rules statements cite Comprehensive
  Rules sections from memory and are listed per milestone for spot-checking.
  Card records are verified on the owner's machine by script.
- Decisions: the practice table lives on main at an unlinked address; the
  scripted tutorial is fixed and kept until the table replaces it; the
  colour explorer is built from the prototype's source once uploaded;
  cards are bundled records drawn with the app's own card face; progress is
  viewed / practiced / demonstrated; undo is one action, practice only;
  paper prompts on every lesson; deep links for Learn and Practice; the
  explorer allows any number of colours; phone first, with a full desktop
  simulation (whole games against the practice opponent, hot-seat, practice
  decks from the pool) as the last milestone.
- "Pay-per-sense" in the brief is read as paper play. No payments.

## M0 — fix what is live, add addresses (done)

- Tutorial script: "select" for the gesture, "tap" only for the action; a
  phase per beat from `PHASES` (untap, draw, main1, attack, block, damage,
  main2, end) and every action in the step it belongs to; permanents untap
  only in their controller's untap step, both sides; every cast taps its
  cost in the beat the spell arrives; a cast creature arrives summoning
  sick; blocking never taps; hand counts follow real draws; Hill Giant is
  cast on their turn four with four Mountains (it was cast with three).
- Saved place in the game is a beat id; a number from the first release maps
  through `LEGACY_BEAT_IDS`; two retired beats map to their successors.
- Lessons: "Mark complete" appears only after a correct answer; colourless
  vs generic taught in the casting lesson with a glossary entry; the stack
  quiz premise rewritten; the Commander lesson corrected on the ban list,
  casting from the command zone, partners and planeswalker commanders, and
  reminder text; haste caveat in the combat lesson.
- Routes: `#/guide/game`, `#/guide/glossary`, `#/guide/track/<id>`,
  `#/guide/track/<id>/<lesson>`, `#/guide/lesson/<id>`; reload, Back and
  unknown ids covered in `tests/router.test.js` and the routing spec.
- Import merge now keeps `tutorialState`, this device's own first.
- Every bundled tutorial card has a `source` block; `npm run
  tutorial:verify` checks each field against Scryfall and prints the ids to
  paste in. Fan Content line on the tutorial screen and in the README.
- Tests: `tests/lessons.test.js` (new), `tests/tutorial.test.js` (rule
  invariants: phase per action, untap timing, payment, sickness, wording,
  legacy mapping), router and storage additions, routing spec additions.
- Rules relied on: 302.6 (summoning sickness), 305.1 (one land), 502.3
  (untap step untaps the active player's permanents), 506–510 (combat
  steps), 509.1 (blocking does not tap), 601.2 (casting pays costs), 704
  (state-based actions), 903 (Commander), 903.8 (commander tax).

## M1 — the table model and the mana lesson (done)

- `src/lib/table/`: `model.js` (state, instances, zones, pool, cost
  payment, timing, targets, invariants), `reducer.js` (pure
  `applyAction`: playLand, tapForMana, beginCast, chooseTarget, assign,
  unassign, autoPay, commitCast, cancelCast, pass, declareAttackers,
  declareBlockers, discard, concede; step and turn structure; priority
  passing; resolution; fizzling; state-based actions; cleanup),
  `mechanics.js` (the supported list and `unsupportedReason`),
  `opponent.js` (passive and simple policies, both stated in words),
  `runner.js` (act, settle, start, replay, passUntil), `objectives.js`
  (goals judged from consequences), `scenarios/mana.js` (fixtures A, B,
  wrong-colour, each with coach steps, hints, a why-question and a paper
  prompt).
- `src/data/practice-cards.js`: nineteen green and red cards with `rules`
  blocks; source blocks to be filled by the verify script.
- Screen at `#/practice` and `#/practice/<scenario>`: table, casting
  panel with per-part assignment and pay-from-pool, coach with refusals in
  the model's words, goals, hints, the why-question, undo (labelled
  practice only) and reset. Phone stacked; coach beside the board from
  900px.
- Tests: `tests/table-mana.test.js` (MANA-01 to MANA-12, timing, turn
  structure, fizzle, state-based actions, registry, 29 tests);
  `tests/browser/practice.spec.mjs` (37 checks); the practice table added
  to the accessibility sweep.
- Narrowings, stated in the code: one blocker per attacker in shipped
  scenarios; no tapped lands; no hybrid, phyrexian or variable costs; the
  opponent's discard is the first cards in hand.
- Rules relied on: 103.8a, 117.3–117.4, 302.6, 305.1–305.2, 307.1,
  400.7, 405, 500.1, 500.4, 502.3–502.4, 504.1, 506–510, 508.8, 514.1–514.3,
  601.2, 605.3, 608.2b, 611.2, 702.10, 704.

## M2 — motion from events, replay, paper, persistence (done)

- `src/lib/table/motion.js`: one sentence per event (`narrate`), cues
  naming only cards and players (`cuesFrom`), `prefersReducedMotion`
  reading the app preference then the system. The screen applies a cue
  class for 320ms after a committed event and never with motion reduced;
  the journal and live region carry the same information in words. A
  "Motion: on / reduced" control on the table stores `prefs.reduceMotion`.
- Persistence: a `practice` record in storage (`runs` keyed by scenario
  holding the action log, bounded to 400 actions, with hints and the
  answered question; `paper` self-reports; `evidence` per lesson). A
  reload replays the saved log to the same state and says so; a log that
  no longer applies in full, or from another content version, is dropped.
  Import merges: later run wins, paper and evidence unioned, the earliest
  date kept. `resetPractice` clears practice alone.
- Replay: "Step through it" renders the table as it was at any point of
  the log with the controls removed; it cannot append to the log.
- Paper prompt on every scenario: needs, steps, words to say, a check,
  and a checkbox recorded as self-reported, never as a demonstration.
- Evidence recorded so far: viewed on arrival, practiced on completion
  with the hint count. Demonstrated is M4.
- Storage failure: the run keeps working from memory and the screen says
  it may not survive a reload.
- Image failure: not applicable; every card on the table is drawn.
- Found on the way: the storage probe treated a write refused for lack
  of room as "no localStorage" and served an empty memory store, so a
  browser that had merely run out of space showed no decks. The probe
  now tells a full store from an absent one (`tests/storage-backend.test.js`).
- Tests: `tests/table-motion.test.js`, storage practice tests, browser
  spec additions (reload resume, Back, replay isolation, paper
  self-report, reduced-motion equivalence on a page with the system
  setting, keyboard-only completion with Enter alone). 57 checks.

## M3 — combat and responses (done)

- Scenarios in `src/lib/table/scenarios/combat.js`: a 2/2 into a 2/1
  that blocks (both die), a 3/3 into the same blocker (Piker dies, the
  Courser keeps 2 damage until cleanup), the same attack into an opponent
  that never blocks (20 to 17), and readiness (Raging Goblin with haste
  attacks the turn it arrives, Grizzly Bears is refused by name). In
  `scenarios/responses.js`: their Shock on the stack at your Bears with
  Giant Growth in hand, guided to the response, and a free choice of
  either branch. Every combat and response scenario asks its prediction
  before the moment it is about; one answer per run, since a guess made
  after the result is not a prediction, and a wrong one is explained and
  left unmet.
- Opponents: `blocker` (blocks every attacker it can, never attacks) and
  a `scripted` policy that casts Shock at the Bears once on its own turn.
  Every policy has a description, shown under the coach.
- Screen: declaration panels for attackers and blockers (chips that mirror
  the cards, with the reason a creature cannot be chosen written before
  the model refuses it), creatures on the table toggle the same choice,
  and priority is withheld until pending predictions are answered.
- Tests: `tests/table-combat.test.js` (attack taps, block does not,
  simultaneous damage, lethal damage as a state-based action, a blocked
  attacker whose blocker died deals no damage, combat cleared at end of
  combat, damage removed at cleanup, no-attackers skips the blockers and
  damage steps, haste vs sickness, both response branches with priority
  going round between resolutions, a sorcery refused on their turn, every
  scenario's shape); browser spec walks the trade, the readiness
  refusal and the two-spell stack (80 checks); the declare panel is in
  the accessibility sweep.
- Rules relied on: 117.3b–c, 117.4, 302.6, 405, 502.3, 506.1, 508.1,
  508.8, 509.1, 509.1h, 510.1–510.2, 511.1, 514.2, 608.2b, 611.2, 702.10,
  704.5f–g.

## Next

M4 — practice home, evidence, colour explorer, evaluation script.
