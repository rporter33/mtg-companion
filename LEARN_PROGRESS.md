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

## Next

M1 — the table domain model and the mana lesson.
