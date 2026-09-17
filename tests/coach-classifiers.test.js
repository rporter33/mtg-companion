import { describe, it, expect } from 'vitest'
import { CLASSIFIERS } from '../src/lib/coach.js'

/**
 * The coach's classifiers, against cards whose category nobody would argue
 * about.
 *
 * Everything else the coach does is arithmetic. These three regexes are the one
 * place it makes a claim about how Magic writes its cards, and they were
 * written from memory — checked only against cards that happened to occur to
 * whoever wrote them. Six of the first sixteen cases here failed, including
 * Farseek, Cultivate and Nature's Lore, which are among the most played ramp
 * spells in Commander and were being counted as nothing at all.
 *
 * `npm run coach:measure` scores the same functions against a few hundred real
 * cards. This file is the part that runs offline and fails the build.
 */

const card = (name, oracle_text, type_line = 'Instant') => ({ name, oracle_text, type_line })
const is = (category) => (c) => CLASSIFIERS[category](c)

describe('removal', () => {
  const removal = is('removal')

  it.each([
    ['Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.'],
    ['Swords to Plowshares', 'Exile target creature. Its controller gains life equal to its power.'],
    ['Beast Within', 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.'],
    ['Counterspell', 'Counter target spell.'],
    ['Wrath of God', 'Destroy all creatures. They can\'t be regenerated.'],
    ['Prey Upon', 'Target creature you control fights target creature you don\'t control.'],
    ['Tragic Slip', 'Target creature gets -1/-1 until end of turn.'],
    ['Toxic Deluge', 'Pay X life. All creatures get -X/-X until end of turn.'],
  ])('counts %s', (name, text) => expect(removal(card(name, text))).toBe(true))

  it.each([
    // A positive pump is the same sentence with the sign flipped, and that is
    // the whole difference between a combat trick and a kill spell.
    ['Giant Growth', 'Target creature gets +3/+3 until end of turn.'],
    ['Sol Ring', '{T}: Add {C}{C}.'],
    ['Divination', 'Draw two cards.'],
    ['Llanowar Elves', '{T}: Add {G}.'],
  ])('does not count %s', (name, text) => expect(removal(card(name, text))).toBe(false))
})

describe('card draw', () => {
  const draw = is('draw')

  it.each([
    ['Divination', 'Draw two cards.'],
    ['Ponder', 'Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.'],
    ['Rhystic Study', 'Whenever an opponent casts a spell, unless that player pays {1}, you may draw a card.'],
    ['Alhammarret\'s Archive', 'If you would draw a card, draw two cards instead.'],
    ['Night\'s Whisper', 'You draw two cards and you lose 2 life.'],
  ])('counts %s', (name, text) => expect(draw(card(name, text))).toBe(true))

  it.each([
    // A card that rewards drawing is not a card that draws. Counting these told
    // players they had draw when they had a payoff and nothing to pay it off.
    ['Reckless Fireweaver', 'Whenever you draw a card, each opponent loses 1 life.'],
    ['Nezahal', 'Whenever a player draws a card, this creature gets +1/+0.'],
    ['Howling Mine', 'At the beginning of each player\'s draw step, that player draws an additional card.'],
    ['Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.'],
  ])('does not count %s', (name, text) => expect(draw(card(name, text))).toBe(false))
})

describe('ramp', () => {
  const ramp = is('ramp')

  it.each([
    ['Sol Ring', '{T}: Add {C}{C}.', 'Artifact'],
    ['Arcane Signet', '{T}: Add one mana of any color in your commander\'s color identity.', 'Artifact'],
    ['Llanowar Elves', '{T}: Add {G}.', 'Creature — Elf Druid'],
    ['Rampant Growth', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 'Sorcery'],
    // The three that used to be missed, and the reason this file exists.
    ['Cultivate', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 'Sorcery'],
    ['Farseek', 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.', 'Sorcery'],
    ['Nature\'s Lore', 'Search your library for a Forest card, put it onto the battlefield, then shuffle.', 'Sorcery'],
    ['Kodama\'s Reach', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 'Sorcery'],
  ])('counts %s', (name, text, type) => expect(ramp(card(name, text, type))).toBe(true))

  it.each([
    ['Demonic Tutor', 'Search your library for a card, then shuffle and put that card on top of it.', 'Sorcery'],
    ['Worldly Tutor', 'Search your library for a creature card, reveal it, then shuffle and put that card on top.', 'Instant'],
    ['Counterspell', 'Counter target spell.', 'Instant'],
    // A land that taps for mana is the mana base, not ramp on top of it —
    // counting lands here would double-count the thing ramp is measured against.
    ['Forest', '({T}: Add {G}.)', 'Basic Land — Forest'],
    ['Command Tower', '{T}: Add one mana of any color in your commander\'s color identity.', 'Land'],
  ])('does not count %s', (name, text, type) => expect(ramp(card(name, text, type))).toBe(false))
})
