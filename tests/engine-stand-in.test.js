/**
 * A stand-in commander (HANDOFF.md §3 item 19, the owner's decision of
 * 2026-09-25), everything that can be held without a browser or an engine:
 * which of a deck's own cards the rules allow to lead it in place of a commander
 * the engine does not know, the seat the sit sends led by the one chosen, what is
 * read back from a table's record, the words said about it in the lobby, the log
 * and the seat lists, and the board marking the card — each read forgivingly.
 *
 * The app's own example deck, Commodore Guff's, is held too, with the engine's
 * answer about it and its description of each card it knows, as the built engine
 * gave them on 2026-09-25 (tests/fixtures/example-guff.json).
 */
import { describe, it, expect } from 'vitest'
import {
  identityOf, isLegendaryCreature, leadOf, leadWith, ledSeat, standInLine, standInLostLine, standInOffer, standInPhrase, standInTileLine, standInsFor, unledLine,
} from '../src/lib/engine/stand-in.js'
import { sameCard } from '../src/lib/engine/names.js'
import { leaveOut, seatDeck, verdictOf, checkedDeck } from '../src/lib/engine/deck.js'
import { engineDeckLine, plannedWords, seatWords } from '../src/lib/engine/opponent.js'
import { boardFromView } from '../src/lib/engine/board.js'
import { glowsAt } from '../src/lib/engine/glow.js'
import { stopLine } from '../src/features/game/EnginePrompt.jsx'
import { EXAMPLE_DECKS } from '../src/data/example-decks.js'
import GUFF from './fixtures/example-guff.json'

// Real cards, as Scryfall has them (the fields read here), in the colours of a
// made-up commander the engine cannot know: a name beginning "Made-Up".
const CARDS = {
  lead: { name: 'Made-Up Warden', type_line: 'Legendary Creature — Elf', color_identity: ['G', 'W'] },
  rhys: { name: 'Rhys the Redeemed', type_line: 'Legendary Creature — Elf Warrior', color_identity: ['G', 'W'], set: 'shm', collector_number: '237' },
  sythis: { name: "Sythis, Harvest's Hand", type_line: 'Legendary Enchantment Creature — Nymph', color_identity: ['G', 'W'], set: 'mh2', collector_number: '214' },
  azusa: { name: 'Azusa, Lost but Seeking', type_line: 'Legendary Creature — Human Monk', color_identity: ['G'], set: 'chk', collector_number: '201' },
  blast: { name: "Urza's Ruinous Blast", type_line: 'Legendary Sorcery', color_identity: ['W'] },
  forest: { name: 'Forest', type_line: 'Basic Land — Forest', color_identity: ['G'], set: 'por', collector_number: '211' },
  plains: { name: 'Plains', type_line: 'Basic Land — Plains', color_identity: ['W'], set: 'por', collector_number: '196' },
  bolt: { name: 'Lightning Bolt', type_line: 'Instant', color_identity: ['R'] },
  madeup: { name: 'Made-Up Card', type_line: 'Creature — Elf', color_identity: ['G'] },
}
const lookup = (id) => CARDS[id] ?? null
const WARDEN = {
  id: 'w1', formatId: 'commander', commanders: ['lead'],
  main: [{ cardId: 'rhys', quantity: 1 }, { cardId: 'azusa', quantity: 1 }, { cardId: 'blast', quantity: 1 }, { cardId: 'madeup', quantity: 1 }, { cardId: 'forest', quantity: 48 }, { cardId: 'plains', quantity: 47 }],
}
const UNKNOWN = ['Made-Up Warden', 'Made-Up Card']

describe('what the rules allow to stand in', () => {
  it('reads a legendary creature off its type line, its front face where it has two, and never off its subtypes', () => {
    expect(isLegendaryCreature(CARDS.rhys)).toBe(true)
    expect(isLegendaryCreature(CARDS.sythis)).toBe(true)
    expect(isLegendaryCreature(CARDS.blast)).toBe(false)
    expect(isLegendaryCreature({ type_line: 'Creature — Elf' })).toBe(false)
    expect(isLegendaryCreature({ type_line: 'Legendary Planeswalker — Guff' })).toBe(false)
    expect(isLegendaryCreature({ type_line: 'Legendary Artifact — Creature' })).toBe(false)
    expect(isLegendaryCreature({ type_line: 'Legendary Creature — A // Legendary Land', card_faces: [{ type_line: 'Legendary Creature — God' }, { type_line: 'Legendary Land' }] })).toBe(true)
    expect(isLegendaryCreature({ type_line: 'Sorcery // Legendary Creature', card_faces: [{ type_line: 'Sorcery' }, { type_line: 'Legendary Creature — God' }] })).toBe(false)
    for (const card of [null, {}, { type_line: 7 }]) expect(isLegendaryCreature(card)).toBe(false)
    expect(identityOf({ color_identity: ['W', 'G', 'X'] })).toEqual(['W', 'G'])
    expect(identityOf({ color_identity: [] })).toEqual([])
    expect(identityOf({})).toBeNull()
  })

  it('offers a legendary creature of the deck\'s own the engine knows, within the deck\'s colour identity and holding every card dealt (903.3, 903.4, 903.5c)', () => {
    // Azusa is green alone, and the Plains and the Blast dealt with it are white: not within its identity (903.5c).
    expect(standInsFor(WARDEN, lookup, UNKNOWN)).toEqual([{ name: 'Rhys the Redeemed', set: 'shm', number: '237', identity: ['W', 'G'] }])
    // With nothing white dealt — Rhys is white too — Azusa's identity holds every card.
    const green = { ...WARDEN, main: WARDEN.main.filter((e) => !['plains', 'blast', 'rhys'].includes(e.cardId)) }
    expect(standInsFor(green, lookup, UNKNOWN).map((s) => s.name)).toEqual(['Azusa, Lost but Seeking'])
    // Two that each hold every card are both offered, in the deck's order, and a second copy is one offer.
    const two = { ...WARDEN, main: [{ cardId: 'sythis', quantity: 1 }, ...WARDEN.main, { cardId: 'rhys', quantity: 1 }] }
    expect(standInsFor(two, lookup, UNKNOWN).map((s) => s.name)).toEqual(["Sythis, Harvest's Hand", 'Rhys the Redeemed'])
    // One the engine does not know is not offered: it is left out with the rest it does not know.
    expect(standInsFor(WARDEN, lookup, [...UNKNOWN, 'Rhys the Redeemed'])).toEqual([])
  })

  it('offers none outside the deck\'s colour identity, where the real one needs none, or where the colours cannot be read', () => {
    // A red legendary creature in a green-white deck: outside the deck's colour identity.
    CARDS.krenko = { name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin Warrior', color_identity: ['R'] }
    const offColour = { ...WARDEN, main: [{ cardId: 'krenko', quantity: 1 }, { cardId: 'forest', quantity: 98 }] }
    expect(standInsFor(offColour, lookup, UNKNOWN)).toEqual([])
    // The engine knows the real commander: no stand-in is wanted.
    expect(standInsFor(WARDEN, lookup, ['Made-Up Card'])).toEqual([])
    // Two commanders, or none, or not a Commander deck at all.
    expect(standInsFor({ ...WARDEN, commanders: ['lead', 'sythis'] }, lookup, UNKNOWN)).toEqual([])
    expect(standInsFor({ ...WARDEN, commanders: [] }, lookup, UNKNOWN)).toEqual([])
    expect(standInsFor({ ...WARDEN, formatId: 'oathbreaker' }, lookup, UNKNOWN)).toEqual([])
    expect(standInsFor({ ...WARDEN, formatId: 'standard' }, lookup, UNKNOWN)).toEqual([])
    // The real commander's record has not loaded: the deck's colour identity is not known.
    expect(standInsFor({ ...WARDEN, cardNames: { lead: 'Made-Up Warden' } }, (id) => (id === 'lead' ? null : lookup(id)), UNKNOWN)).toEqual([])
    // A card to be dealt whose record has not loaded, stamped with a name the engine knows: its colours are not known, so 903.5c cannot be checked.
    const stamped = { ...WARDEN, main: [...WARDEN.main, { cardId: 'gone', quantity: 1 }], cardNames: { gone: 'Some Real Card' } }
    expect(standInsFor(stamped, lookup, UNKNOWN)).toEqual([])
    // One stamped with a name the engine does not know is left out, and asks nothing of its colours.
    expect(standInsFor({ ...stamped, cardNames: { gone: 'Made-Up Card' } }, lookup, UNKNOWN).map((s) => s.name)).toEqual(['Rhys the Redeemed'])
    // Nothing readable is none.
    for (const [deck, unknown] of [[null, UNKNOWN], [WARDEN, null], [{ formatId: 'commander', commanders: 'lead', main: 'lots' }, UNKNOWN]]) expect(standInsFor(deck, lookup, unknown)).toEqual([])
  })
})

describe('the seat led by the stand-in chosen', () => {
  const without = leaveOut(seatDeck(WARDEN, lookup), UNKNOWN)

  it('takes one copy of it out of the library and sends it as the commander, in its printing, naming the one it stands in for', () => {
    const seat = leadWith(without.seat, 'Rhys the Redeemed', 'Made-Up Warden')
    expect(seat.commander).toEqual({ name: 'Rhys the Redeemed', set: 'shm', number: '237', standsFor: 'Made-Up Warden' })
    expect(seat.deck).not.toHaveProperty('Rhys the Redeemed')
    expect(seat.deck).not.toHaveProperty('Made-Up Warden')
    expect(seat.deck).not.toHaveProperty('Made-Up Card')
    // It moved from the library to the command zone, so the count is the same: 98 dealt of the hundred.
    expect(seat.total).toBe(without.seat.total)
    expect(seat.total).toBe(98)
    expect(seat.game).toBe('commander')
    // The seat it was made from, and the deck, are as they were.
    expect(without.seat.deck).toHaveProperty('Rhys the Redeemed')
    expect(without.seat.commander).toBeNull()
    expect(WARDEN.main[0]).toEqual({ cardId: 'rhys', quantity: 1 })
  })

  it('takes one copy of several, whatever shape its line is, and says no printing where the line names none', () => {
    const base = { game: 'commander', commander: null, deck: { A: 2, B: { count: 1 }, C: [{ count: 1, set: 'x', number: '1' }, { count: 2, set: 'y', number: '2' }] }, total: 5 }
    expect(leadWith(base, 'A', 'Real').deck.A).toBe(1)
    expect(leadWith(base, 'A', 'Real').commander).toEqual({ name: 'A', standsFor: 'Real' })
    expect(leadWith(base, 'B', 'Real').deck).not.toHaveProperty('B')
    const c = leadWith(base, 'C', 'Real')
    expect(c.deck.C).toEqual({ count: 2, set: 'y', number: '2' })
    expect(c.commander).toEqual({ name: 'C', set: 'x', number: '1', standsFor: 'Real' })
  })

  it('leads nothing that is not a Commander seat, one with a commander still, or a card not in the library', () => {
    expect(leadWith(seatDeck(WARDEN, lookup), 'Rhys the Redeemed', 'Made-Up Warden')).toBeNull()
    expect(leadWith(without.seat, 'Sythis', 'Made-Up Warden')).toBeNull()
    expect(leadWith({ ...without.seat, game: undefined }, 'Rhys the Redeemed', 'Made-Up Warden')).toBeNull()
    expect(leadWith(without.seat, 'Rhys the Redeemed', '')).toBeNull()
    expect(leadWith(null, 'Rhys the Redeemed', 'Made-Up Warden')).toBeNull()
  })

  it('reads the choice back from a table\'s record, asking the rules again, and lets go of one that can no longer lead', () => {
    const back = ledSeat(without, 'Rhys the Redeemed', { deck: WARDEN, lookup, left: UNKNOWN })
    expect(back.lead).toEqual({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' })
    expect(back.seat.commander.name).toBe('Rhys the Redeemed')
    // The deck changed since: Rhys gone from it, or a red card added that its identity does not hold.
    const gone = { ...WARDEN, main: WARDEN.main.filter((e) => e.cardId !== 'rhys') }
    expect(ledSeat(leaveOut(seatDeck(gone, lookup), UNKNOWN), 'Rhys the Redeemed', { deck: gone, lookup, left: UNKNOWN })).toEqual({ lost: 'Rhys the Redeemed' })
    const red = { ...WARDEN, main: [...WARDEN.main, { cardId: 'bolt', quantity: 1 }] }
    expect(ledSeat(leaveOut(seatDeck(red, lookup), UNKNOWN), 'Rhys the Redeemed', { deck: red, lookup, left: UNKNOWN })).toEqual({ lost: 'Rhys the Redeemed' })
    // Nothing recorded, a name that is not one, or no real commander left out: nothing to lead.
    expect(ledSeat(without, null, { deck: WARDEN, lookup, left: UNKNOWN })).toBeNull()
    expect(ledSeat(without, 7, { deck: WARDEN, lookup, left: UNKNOWN })).toBeNull()
    expect(ledSeat(leaveOut(seatDeck(WARDEN, lookup), ['Made-Up Card']), 'Rhys the Redeemed', { deck: WARDEN, lookup, left: ['Made-Up Card'] })).toBeNull()
  })
})

describe('the words said about a stand-in', () => {
  it('reads one off the wire forgivingly, and names it with what it stands in for', () => {
    expect(leadOf({ name: ' Rhys the Redeemed ', for: 'Made-Up Warden' })).toEqual({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' })
    for (const v of [null, 'Rhys', ['Rhys'], { name: 'Rhys' }, { for: 'X' }, { name: 3, for: 'X' }, { name: 'Rhys', for: ' ' }]) expect(leadOf(v)).toBeNull()
    expect(standInPhrase({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' })).toBe('Rhys the Redeemed, a stand-in for Made-Up Warden')
  })

  it('offers it in the gate with each rule by its number, what is dealt, and that the deck is not changed', () => {
    const one = standInOffer({ offered: [{ name: 'Narset, Enlightened Master' }], real: 'Commodore Guff', known: 45 })
    expect(one).toBe("Narset, Enlightened Master can lead it instead, as a stand-in: a legendary creature of the deck's own, as a commander is (903.3), that the engine knows, whose colour identity lies within the deck's and holds every card dealt (903.4, 903.5c). It begins in the command zone in Commodore Guff's place, said throughout to be a stand-in and not the deck's real commander, and the engine deals the other 44 cards with it as a Commander game: 40 life each (903.7), and 45 cards where a Commander deck holds a hundred (903.5a). The deck you keep is not changed.")
    const two = standInOffer({ offered: [{ name: 'A' }, { name: 'B' }], real: 'R', known: 2 })
    expect(two).toMatch(/^A stand-in can lead it instead, one of these: /)
    expect(two).toContain('the other 1 card with it')
    expect(standInTileLine([{ name: 'Narset, Enlightened Master' }])).toBe('A stand-in can lead it: a legendary creature of its own the engine knows, Narset, Enlightened Master.')
    expect(standInTileLine([{ name: 'A' }, { name: 'B' }])).toBe('A stand-in can lead it: legendary creatures of its own the engine knows, A and B.')
    expect(standInTileLine([])).toBeNull()
    expect(standInTileLine(undefined)).toBeNull()
  })

  it('offers one for a Duel Commander or a Brawl deck by the same rules, said in the words of its own game (§3 item 20)', () => {
    for (const formatId of ['duel', 'brawl']) {
      const deck = { ...WARDEN, formatId }
      expect(standInsFor(deck, lookup, UNKNOWN)).toEqual([{ name: 'Rhys the Redeemed', set: 'shm', number: '237', identity: ['W', 'G'] }])
      const without = leaveOut(seatDeck(deck, lookup), UNKNOWN)
      const led = ledSeat(without, 'Rhys the Redeemed', { deck, lookup, left: UNKNOWN })
      expect(led.seat).toMatchObject({ game: formatId, commander: { name: 'Rhys the Redeemed', standsFor: 'Made-Up Warden' } })
    }
    const offered = [{ name: 'Narset, Enlightened Master' }]
    expect(standInOffer({ offered, real: 'Commodore Guff', known: 45, game: 'brawl' }))
      .toMatch(/the engine deals the other 44 cards with it as a Brawl game: 25 life each \(903\.12f\), and 45 cards where a Brawl deck holds a hundred here\. The deck you keep is not changed\.$/)
    expect(standInOffer({ offered, real: 'Commodore Guff', known: 45, game: 'duel' }))
      .toMatch(/as a Duel Commander game: 20 life each \(Duel Commander rules, 300\.1a\), and 45 cards where a Duel Commander deck holds a hundred \(Duel Commander rules, 402\.1b\)\./)
    expect(standInLine({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' }, 'brawl')).toBe("Rhys the Redeemed leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Made-Up Warden, and a Brawl game needs one (903.3).")
    // A game it has no word for is said as Commander, as every line before item 20.
    expect(standInLine({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' }, 'someday')).toMatch(/a Commander game needs one \(903\.3\)\.$/)
  })

  it('cites Duel Commander\'s own rules for its commander, which defer to 903, and never 903 alone as though they were its own', () => {
    // Found in the review of item 20: every number said of Duel Commander is its committee's (§3 item 23).
    expect(standInLine({ name: 'Rhys the Redeemed', for: 'Made-Up Warden' }, 'duel')).toBe("Rhys the Redeemed leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Made-Up Warden, and a Duel Commander game needs one (Duel Commander rules, 402.1b).")
    const one = standInOffer({ offered: [{ name: 'Narset, Enlightened Master' }], real: 'Commodore Guff', known: 45, game: 'duel' })
    expect(one).toMatch(/^Narset, Enlightened Master can lead it instead, as a stand-in: a legendary creature of the deck's own, as a commander is \(Duel Commander rules, 403\.1a, which defers to 903\.3\), that the engine knows, whose colour identity lies within the deck's and holds every card dealt \(Duel Commander rules, 103\.4b and 403\.1a, which defer to 903\.4 and 903\.5c\)\. /)
    const two = standInOffer({ offered: [{ name: 'A' }, { name: 'B' }], real: 'R', known: 2, game: 'duel' })
    expect(two).toContain('as a commander is (Duel Commander rules, 403.1a, which defers to 903.3)')
    for (const said of [one, two]) expect(said).not.toMatch(/\((903\.3|903\.4, 903\.5c)\)/)
  })

  it('says where the stand-in went in a game dealt by the ordinary rules: back in the library, or nowhere from a relay that did not put it back', () => {
    const lead = { name: 'Narset, Enlightened Master', for: 'Commodore Guff' }
    expect(unledLine(lead, lead)).toBe('Narset, Enlightened Master, chosen to lead this deck as a stand-in for Commodore Guff, leads nothing in a game dealt by the ordinary rules, so it is dealt in your library with the rest of the deck.')
    const nowhere = 'Narset, Enlightened Master, chosen to lead this deck as a stand-in for Commodore Guff, leads nothing in a game dealt by the ordinary rules, and this relay did not put it back in the library, so the deck is played without it.'
    expect(unledLine(lead)).toBe(nowhere)
    // A room that says it put back another card has not put back this one.
    expect(unledLine(lead, { name: 'Someone Else', for: 'Commodore Guff' })).toBe(nowhere)
  })

  it('knows a card of two faces the engine names by its front as the one sent by both (`sameCard`)', () => {
    const EDGAR = "Edgar, Charmed Groom // Edgar Markov's Coffin"
    expect(sameCard(EDGAR, 'Edgar, Charmed Groom')).toBe(true)
    expect(sameCard(EDGAR, EDGAR)).toBe(true)
    expect(sameCard('Narset, Enlightened Master', 'Narset, Enlightened Master')).toBe(true)
    // A name that only begins the same, a back face alone, or nothing, is not the card.
    expect(sameCard('Edgar, Charmed Groomsman', 'Edgar, Charmed Groom')).toBe(false)
    expect(sameCard(EDGAR, "Edgar Markov's Coffin")).toBe(false)
    expect(sameCard(EDGAR, '')).toBe(false)
    expect(sameCard(undefined, 'Edgar, Charmed Groom')).toBe(false)
    expect(sameCard(EDGAR, null)).toBe(false)
  })

  it('says the copy the engine deals for a deck of its own it builds none of is led by the stand-in, at Duel Commander', () => {
    const copy = { asked: 'own', played: 'mirror', cards: 99, colours: ['W', 'G'], format: 'duel', fellBack: 'format', why: 'The engine builds no "duel" deck of its own.', commander: 'Rhys the Redeemed', standsFor: 'Made-Up Warden' }
    expect(seatWords({ report: copy })).toBe('The engine, with a copy of your deck, led by Rhys the Redeemed, a stand-in for Made-Up Warden')
    expect(engineDeckLine(copy, { asked: 'own', game: { asked: 'duel', played: 'duel' } })).toBe('The engine builds no Duel Commander deck of its own, so it plays a copy of yours, led as yours is by Rhys the Redeemed, a stand-in for Made-Up Warden.')
    // Any other reason it could not build one says the copy's stand-in the same way.
    expect(engineDeckLine({ ...copy, fellBack: 'thin' })).toBe('The engine could not build a Duel Commander deck of its own, so it plays a copy of yours, led as yours is by Rhys the Redeemed, a stand-in for Made-Up Warden.')
    const { standsFor, ...plain } = copy
    expect(standsFor).toBe('Made-Up Warden')
    expect(engineDeckLine(plain)).toBe('The engine builds no Duel Commander deck of its own, so it plays a copy of yours.')
  })

  it('says in the log that it leads the deck, is not its real commander, and why', () => {
    expect(standInLine({ name: 'Narset, Enlightened Master', for: 'Commodore Guff' })).toBe("Narset, Enlightened Master leads your deck as a stand-in, as you chose: the engine does not know the deck's real commander, Commodore Guff, and a Commander game needs one (903.3).")
    expect(standInLostLine('Narset, Enlightened Master')).toBe('Narset, Enlightened Master, chosen in the lobby to lead this deck as a stand-in, can no longer lead it, so the deck is sent with no commander.')
  })

  it('says the engine\'s commander is a stand-in where the room says it stands in for one, and nothing new where it does not', () => {
    const copy = { asked: 'mirror', played: 'mirror', cards: 45, colours: ['W', 'U', 'R'], commander: 'Narset, Enlightened Master', standsFor: 'Commodore Guff' }
    expect(seatWords({ report: copy })).toBe('The engine, with a copy of your deck, led by Narset, Enlightened Master, a stand-in for Commodore Guff')
    expect(engineDeckLine(copy)).toBe('The engine plays a copy of your deck, led as yours is by Narset, Enlightened Master, a stand-in for Commodore Guff.')
    expect(engineDeckLine({ ...copy, asked: 'deck', name: 'Leaderless', fellBack: 'commander' })).toBe('Leaderless came with no commander to lead it in a Commander game, so the engine plays a copy of yours, led as yours is by Narset, Enlightened Master, a stand-in for Commodore Guff.')
    // Without `standsFor`, M6's words stand; a `standsFor` that is not a name is not said.
    const { standsFor, ...plain } = copy
    expect(standsFor).toBe('Commodore Guff')
    expect(seatWords({ report: plain })).toBe('The engine, with a copy of your deck, led by Narset, Enlightened Master')
    expect(engineDeckLine(plain)).toBe('The engine plays a copy of your deck.')
    expect(seatWords({ report: { ...copy, standsFor: 9 } })).toBe('The engine, with a copy of your deck, led by Narset, Enlightened Master')
  })

  it('says before the sit that a deck of the engine\'s own is built only if a stand-in leads yours, where one could', () => {
    const yours = { seat: { game: 'commander', leaders: 1, commander: { name: 'Commodore Guff' } }, commanderUnknown: true }
    expect(plannedWords({ choice: { kind: 'own', pool: 'sets' }, format: 'commander', yours: { ...yours, standIns: [{ name: 'Narset, Enlightened Master' }] } }))
      .toBe('The engine, with a deck of its own if a stand-in leads yours, and a copy of yours if not: it builds a Commander deck of its own only for a Commander game')
    // Where none could, M6's words stand.
    expect(plannedWords({ choice: { kind: 'own', pool: 'sets' }, format: 'commander', yours: { ...yours, standIns: [] } }))
      .toBe('The engine, with a copy of your deck: it builds a Commander deck of its own only for a Commander game, and yours has no commander it can deal')
  })
})

describe('the stop\'s line', () => {
  it('says a commander that can be cast from the command zone is a stand-in, where the card is marked one', () => {
    const ME = 'e0'
    const cast = { index: 1, type: 'CastSpell', description: 'Cast Rhys the Redeemed', card: 'e2', affordable: true, meaningful: true, manaCost: '{G/W}', from: 'command', commanderTax: { casts: 0, generic: 0 } }
    const status = { actor: ME, waiting: 'action', actions: [{ index: 0, type: 'PassPriority', affordable: true, meaningful: false }, cast] }
    const glows = glowsAt({ status, me: ME, zoneOf: (id) => (id === 'e2' ? 'command' : null) })
    const nameOf = () => 'Rhys the Redeemed'
    expect(stopLine({ status, me: ME, glows, nameOf, standsForOf: (id) => (id === 'e2' ? 'Made-Up Warden' : null) }))
      .toBe('Your commander, Rhys the Redeemed, a stand-in for Made-Up Warden, can be cast from the command zone for {G/W}. Tap the command zone to cast it, or pass.')
    // Where none is marked, M6's words stand.
    expect(stopLine({ status, me: ME, glows, nameOf })).toBe('Your commander, Rhys the Redeemed, can be cast from the command zone for {G/W}. Tap the command zone to cast it, or pass.')
  })
})

describe('the board marks the stand-in', () => {
  const ME = 'e0'
  const card = (id, owner, zone, over = {}) => ({ id, name: 'Rhys the Redeemed', typeLine: 'Legendary Creature — Elf Warrior', controllerId: owner, ownerId: owner, zone: { ownerId: owner, zoneType: zone }, ...over })
  const view = {
    viewingPlayerId: ME, turnNumber: 1, activePlayerId: ME, priorityPlayerId: ME, currentPhase: 'PRECOMBAT_MAIN', currentStep: 'PRECOMBAT_MAIN',
    cards: {
      c0: card('c0', ME, 'Command', { isCommander: true }),
      c1: card('c1', 'e1', 'Command', { isCommander: true }),
      c2: card('c2', ME, 'Battlefield'),
    },
    zones: [
      { zoneId: { ownerId: ME, zoneType: 'Command' }, cardIds: ['c0'], size: 1, isVisible: true },
      { zoneId: { ownerId: 'e1', zoneType: 'Command' }, cardIds: ['c1'], size: 1, isVisible: true },
      { zoneId: { ownerId: ME, zoneType: 'Battlefield' }, cardIds: ['c2'], size: 1, isVisible: true },
    ],
    players: [{ playerId: ME, life: 40 }, { playerId: 'e1', life: 40 }],
  }

  it('by its owner and name, a commander alone, and says nothing where no stand-in was said', () => {
    const lead = { name: 'Rhys the Redeemed', for: 'Made-Up Warden' }
    const board = boardFromView(view, { seats: [ME, 'e1'], leaders: { [ME]: lead } })
    expect(board.cards.c0).toMatchObject({ commander: true, standsFor: 'Made-Up Warden' })
    // The engine's commander of the same name is its own, and no stand-in was said of it.
    expect(board.cards.c1).not.toHaveProperty('standsFor')
    // A card of the same name that is not a commander is not the stand-in.
    expect(board.cards.c2).not.toHaveProperty('standsFor')
    expect(boardFromView(view, { seats: [ME, 'e1'], leaders: { [ME]: lead, e1: lead } }).cards.c1.standsFor).toBe('Made-Up Warden')
    expect(boardFromView(view, { seats: [ME, 'e1'] }).cards.c0).not.toHaveProperty('standsFor')
    expect(boardFromView(view, { seats: [ME, 'e1'], leaders: { [ME]: { name: 'Someone Else', for: 'X' } } }).cards.c0).not.toHaveProperty('standsFor')
    // A card of two faces is sent by both names and may be named by its front.
    expect(boardFromView(view, { seats: [ME, 'e1'], leaders: { [ME]: { name: 'Rhys the Redeemed // Back', for: 'X' } } }).cards.c0.standsFor).toBe('X')
  })
})

describe('the app\'s own example deck, Commodore Guff\'s', () => {
  // As a player has it: the example deck's cards, each with the record Scryfall
  // gives the app, here the engine's own description of each card it knows (the
  // fields read are the same) and Scryfall's of the commander, which the engine
  // does not know; the cards it does not know stand as names alone.
  const example = EXAMPLE_DECKS.find((d) => d.id === 'commodore-guff')
  const records = new Map(GUFF.cards.map((c) => [c.name, c]))
  const deck = {
    id: 'ex-guff', formatId: 'commander', commanders: ['c0'],
    main: example.main.map((e, i) => ({ cardId: `m${i}`, quantity: e.quantity })),
    cardNames: { c0: example.commanders[0], ...Object.fromEntries(example.main.map((e, i) => [`m${i}`, e.name])) },
  }
  const byId = { c0: GUFF.commander, ...Object.fromEntries(example.main.map((e, i) => [`m${i}`, records.get(e.name) ?? null])) }
  const find = (id) => byId[id] ?? null

  it('is known to the engine but for 55 of its cards, its commander among them, and Narset, Enlightened Master alone may stand in', () => {
    const seat = seatDeck(deck, find)
    expect(Object.keys(checkedDeck(seat))).toContain('Commodore Guff')
    const verdict = verdictOf(seat, { known: GUFF.known, total: GUFF.total, unknown: GUFF.unknown, unknownSideboard: [] })
    expect(verdict).toMatchObject({ state: 'short', known: 45, total: 100, commanderUnknown: true })
    // Kazuul, Leori and Mangara are legendary creatures of the deck too, and the engine knows none of them.
    for (const name of ['Kazuul, Tyrant of the Cliffs', 'Leori, Sparktouched Hunter', 'Mangara, the Diplomat']) expect(GUFF.unknown).toContain(name)
    expect(standInsFor(deck, find, verdict.unknown.map((u) => u.name))).toEqual([{ name: 'Narset, Enlightened Master', identity: ['W', 'U', 'R'] }])
  })

  it('led by her, sends 44 cards and her apart, the real commander nowhere, and leaves the deck as it was', () => {
    const before = JSON.stringify(deck)
    const without = leaveOut(seatDeck(deck, find), GUFF.unknown)
    const back = ledSeat(without, 'Narset, Enlightened Master', { deck, lookup: find, left: GUFF.unknown })
    expect(back.lead).toEqual({ name: 'Narset, Enlightened Master', for: 'Commodore Guff' })
    expect(back.seat.commander).toEqual({ name: 'Narset, Enlightened Master', standsFor: 'Commodore Guff' })
    const library = Object.values(back.seat.deck).reduce((n, v) => n + (typeof v === 'number' ? v : v.count), 0)
    expect(library).toBe(44)
    expect(back.seat.total).toBe(45)
    expect(back.seat.deck).not.toHaveProperty('Narset, Enlightened Master')
    expect(back.seat.deck).not.toHaveProperty('Commodore Guff')
    expect(JSON.stringify(deck)).toBe(before)
  })
})
