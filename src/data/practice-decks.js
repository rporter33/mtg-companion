/**
 * Practice decks, built only from the practice pool.
 *
 * Thirty cards each, so a game lasts a lunch break and both players see
 * their whole deck. They are practice decks, not legal decks for any
 * format, and the screen says so: a real deck is sixty cards or a hundred.
 * Twelve lands in thirty is the same ratio as twenty-four in sixty.
 */
import { PRACTICE_CARDS } from './practice-cards.js'

const deck = (id, name, blurb, entries) => ({
  id,
  name,
  blurb,
  entries,
  size: entries.reduce((n, [, q]) => n + q, 0),
})

export const PRACTICE_DECKS = [
  deck('forest-fangs', 'Forests and Fangs',
    'Green: mana creatures, big creatures, and two pump spells. Wins by being larger.',
    [['forest', 12], ['llanowarElves', 3], ['grizzlyBears', 4], ['centaurCourser', 3], ['rumblingBaloth', 2], ['crawWurm', 1], ['giantGrowth', 3], ['titanicGrowth', 2]]),
  deck('goblins-fire', 'Goblins and Fire',
    'Red: cheap attackers, a haste creature, and burn that can go at a creature or a face. Wins by being faster.',
    [['mountain', 12], ['ragingGoblin', 3], ['goblinPiker', 4], ['goblinRoughrider', 3], ['hillGiant', 2], ['canyonMinotaur', 1], ['shock', 3], ['lightningStrike', 1], ['volcanicHammer', 1]]),
  deck('both-at-once', 'Both at Once',
    'Green and red together: more choices, and the colours of your lands start to matter.',
    [['forest', 6], ['mountain', 6], ['llanowarElves', 2], ['grizzlyBears', 3], ['goblinPiker', 3], ['centaurCourser', 2], ['goblinRoughrider', 2], ['hillGiant', 1], ['rumblingBaloth', 1], ['giantGrowth', 2], ['shock', 2]]),
]

export const practiceDeckById = (id) => PRACTICE_DECKS.find((d) => d.id === id) ?? null

/** The deck as a flat list of card ids, one per copy, in list order. */
export function deckCards(deckDef) {
  const out = []
  for (const [cardId, quantity] of deckDef.entries) {
    if (!PRACTICE_CARDS[cardId]) throw new Error(`Practice deck ${deckDef.id} names unknown card "${cardId}"`)
    for (let i = 0; i < quantity; i++) out.push(cardId)
  }
  return out
}
