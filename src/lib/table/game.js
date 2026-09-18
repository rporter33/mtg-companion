/**
 * A whole game on the practice table.
 *
 * A game is a scenario like any lesson, built from two practice decks, a
 * seed and a mode: solo against a named policy, or hot-seat with two
 * people at one screen. The seed decides the shuffles, so a saved action
 * log replays to the same game. Both players start with a hand of seven
 * and a London mulligan; the first player skips the first draw.
 *
 * A practice deck is thirty cards. It is not a legal deck for any format,
 * and the setup screen says so.
 */
import { rng, shuffle } from '../goldfish.js'
import { practiceDeckById, deckCards } from '../../data/practice-decks.js'
import { policyFor } from './opponent.js'

export const OPENING_HAND = 7

/** Shuffles a deck's cards with a seed and player-specific salt, so the two libraries differ. */
export function shuffledLibrary(deckId, seed, salt) {
  const cards = deckCards(practiceDeckById(deckId))
  return shuffle(cards, rng((seed * 7919 + salt * 104729) >>> 0))
}

/**
 * The scenario for a game. `mode` is 'solo' (the opponent is a policy) or
 * 'hotseat' (two people; the opponent is a person, and the table waits).
 */
export function buildGame({ you, foe, seed = 1, mode = 'solo', first = 'you', opponent = 'simple' } = {}) {
  const yours = shuffledLibrary(you, seed, 1)
  const theirs = shuffledLibrary(foe, seed, 2)
  return {
    id: 'game',
    kind: 'game',
    version: 1,
    mode,
    title: mode === 'hotseat' ? 'Two players, one table' : 'A game against the practice opponent',
    summary: `${practiceDeckById(you).name} against ${practiceDeckById(foe).name}.`,
    decks: { you, foe },
    seed,
    opponent: mode === 'hotseat' ? 'human' : opponent,
    setup: {
      turn: 1, active: first, firstPlayer: first, step: 'untap', priority: first, turnsBy: { you: 0, foe: 0 },
      you: { hand: yours.slice(0, OPENING_HAND), library: yours.slice(OPENING_HAND) },
      foe: { hand: theirs.slice(0, OPENING_HAND), library: theirs.slice(OPENING_HAND) },
      mulligan: true,
    },
    goals: [{ id: 'won', label: 'Win the game', done: (state) => state.over?.winner === 'you' }],
    coach: {
      intro: mode === 'hotseat'
        ? 'Two people, one screen. The table waits for whoever it says it is waiting for. Pass the device between turns; the other hand stays hidden until its owner reveals it.'
        : `A whole game. Your opponent plays by a few stated rules: ${policyFor(opponent).description}`,
      steps: [],
    },
    hints: [],
    paper: null,
    explain: null,
  }
}

/** Everything the game screen needs to describe the mode on screen. */
export const MODES = {
  solo: { id: 'solo', name: 'Solo', blurb: 'You against the practice opponent, whose rules are written on the screen.' },
  hotseat: { id: 'hotseat', name: 'Two players', blurb: 'Two people at one screen, taking turns. Good for teaching someone sitting beside you.' },
}
