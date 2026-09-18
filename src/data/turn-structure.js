/**
 * The five phases of a turn, their steps, and what happens in each.
 *
 * Transcribed from `docs/TURN_STRUCTURE.md`, which is adapted from the
 * Comprehensive Rules effective 7 August 2026 in the table form devised by
 * April King and published by BoiledOwlbear. Rule numbers are quoted as that
 * source gives them — they are citations, not claims of our own.
 *
 * This is data, not an engine. The free table walks it as a tracker so the
 * person can see where they are and what is allowed there; the practice table
 * in `src/lib/table/` is the one that actually enforces priority and the
 * stack, over a pool of cards it knows completely.
 *
 * `does` lines are what happens in the step in order. `priority` says whether
 * anyone gets priority there at all — the untap step and a quiet cleanup are
 * the two places nobody does (500.3), which is exactly the thing new players
 * are surprised by.
 */

export const PHASES = [
  {
    id: 'beginning',
    name: 'Beginning phase',
    rule: '501.',
    steps: [
      {
        id: 'untap',
        name: 'Untap',
        rule: '502.',
        priority: false,
        does: [
          { text: 'Phased-out permanents phase in, and phased-in permanents with phasing phase out.', rule: '502.1' },
          { text: 'Day becomes night, or night day, if the last turn’s spell count says so.', rule: '502.2' },
          { text: 'The active player untaps what they control, all at once.', rule: '502.3' },
        ],
        note: 'Nobody gets priority in this step, so nothing can be cast here.',
      },
      {
        id: 'upkeep',
        name: 'Upkeep',
        rule: '503.',
        priority: true,
        does: [
          { text: 'Abilities that triggered during untap and “at beginning of upkeep” abilities go on the stack together.', rule: '503.1a' },
        ],
      },
      {
        id: 'draw',
        name: 'Draw',
        rule: '504.',
        priority: true,
        does: [
          { text: 'The active player draws a card.', rule: '504.1' },
          { text: 'In a two-player game the player going first skips this step on their first turn.', rule: '103.8a' },
        ],
      },
    ],
  },
  {
    id: 'main1',
    name: 'First main phase',
    rule: '505.',
    sorcerySpeed: true,
    steps: [
      {
        id: 'main1',
        name: 'Precombat main',
        rule: '505.',
        priority: true,
        sorcerySpeed: true,
        does: [
          { text: 'Sagas get a lore counter; Attractions are rolled for; the Archenemy sets a scheme in motion.', rule: '505.3–505.5' },
        ],
        note: 'While the stack is empty the active player may cast sorcery-speed spells and play one land. A land does not use the stack and cannot be responded to.',
      },
    ],
  },
  {
    id: 'combat',
    name: 'Combat phase',
    rule: '506.',
    steps: [
      {
        id: 'beginCombat',
        name: 'Beginning of combat',
        rule: '507.',
        priority: true,
        does: [
          { text: 'In some multiplayer games the active player chooses which opponent is defending.', rule: '507.1' },
        ],
      },
      {
        id: 'attackers',
        name: 'Declare attackers',
        rule: '508.',
        priority: true,
        does: [
          { text: 'The active player declares attackers, and what each is attacking.', rule: '508.1' },
        ],
        note: 'If nothing attacks, declare blockers and combat damage are skipped entirely.',
      },
      {
        id: 'blockers',
        name: 'Declare blockers',
        rule: '509.',
        priority: true,
        does: [
          { text: 'The defending player declares blockers and what each is blocking.', rule: '509.1' },
        ],
      },
      {
        id: 'firstStrike',
        name: 'First-strike damage',
        rule: '510.4',
        priority: true,
        optional: true,
        does: [
          { text: 'Creatures with first or double strike assign their combat damage, and it is all dealt at once.', rule: '510.1–510.2' },
        ],
        note: 'This step happens only if something in combat has first strike or double strike.',
      },
      {
        id: 'damage',
        name: 'Combat damage',
        rule: '510.',
        priority: true,
        does: [
          { text: 'Everything else in combat assigns its damage, and it is all dealt at once.', rule: '510.1–510.2' },
        ],
      },
      {
        id: 'endCombat',
        name: 'End of combat',
        rule: '511.',
        priority: true,
        does: [
          { text: 'When this step ends, everything is removed from combat and “until end of combat” effects end.', rule: '511.3, 500.5a' },
        ],
      },
    ],
  },
  {
    id: 'main2',
    name: 'Second main phase',
    rule: '505.',
    sorcerySpeed: true,
    steps: [
      {
        id: 'main2',
        name: 'Postcombat main',
        rule: '505.',
        priority: true,
        sorcerySpeed: true,
        does: [],
        note: 'The same allowances as the first main phase: sorcery-speed spells, and a land if you have not played one this turn.',
      },
    ],
  },
  {
    id: 'ending',
    name: 'Ending phase',
    rule: '512.',
    steps: [
      {
        id: 'end',
        name: 'End',
        rule: '513.',
        priority: true,
        does: [
          { text: '“At the beginning of the end step” abilities trigger.', rule: '513.2' },
        ],
      },
      {
        id: 'cleanup',
        name: 'Cleanup',
        rule: '514.',
        priority: false,
        does: [
          { text: 'The active player discards down to their maximum hand size, usually seven.', rule: '514.1' },
          { text: 'All damage is removed and “until end of turn” effects end, at the same moment.', rule: '514.2' },
        ],
        note: 'Nobody gets priority here either, unless something triggers or a state-based action is waiting — and then the step repeats.',
      },
    ],
  },
]

/** Every step in the order they happen, each carrying the phase it is in. */
export const STEPS = PHASES.flatMap((phase) =>
  phase.steps.map((step) => ({ ...step, phaseId: phase.id, phaseName: phase.name, phaseRule: phase.rule })))

export const stepAt = (i) => STEPS[((i % STEPS.length) + STEPS.length) % STEPS.length]
export const indexOfStep = (id) => STEPS.findIndex((step) => step.id === id)

/**
 * The next step, and whether the turn rolled over.
 *
 * `hasFirstStrike` skips the first-strike damage step when nothing in combat
 * has it, which is what the rules do (510.4) and what would otherwise be a
 * step a player has to press past on every single turn.
 */
export function nextStep(id, { hasFirstStrike = false } = {}) {
  const at = indexOfStep(id)
  let next = at < 0 ? 0 : at + 1
  const wrapped = next >= STEPS.length
  if (wrapped) next = 0
  let step = STEPS[next]
  if (step.optional && !hasFirstStrike) {
    next = (next + 1) % STEPS.length
    step = STEPS[next]
  }
  return { step, wrapped }
}

/** Can a sorcery-speed spell be cast, or a land played, in this step? */
export const isSorcerySpeed = (id) => Boolean(STEPS.find((step) => step.id === id)?.sorcerySpeed)

/** Does anybody get priority in this step at all? */
export const hasPriority = (id) => Boolean(STEPS.find((step) => step.id === id)?.priority)

export const FIRST_STEP = STEPS[0].id
