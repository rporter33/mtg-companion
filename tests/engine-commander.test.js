/**
 * Commander at the engine's table (HANDOFF.md, M6), everything that can be held
 * without a browser: the deck as the sit sends it, the lobby's verdict on it,
 * the words the table says, the glow and the stop's line for a commander cast
 * from the command zone, and the board laid from a view carrying a command zone
 * and a tally of commander damage — each in the shapes Server.kt sends, as the
 * built engine sent them on 2026-09-25 (PLAN.md, M6), and each read forgivingly.
 */
import { describe, it, expect } from 'vitest'
import {
  COMMANDER_GAME, COMMANDER_TABLE, commanderDamageOf, commanderZoneRule, damageRule, damageWords, formatLine, gameOf,
  leaderProblem, leaderWords, leaderlessFamily, leaderlessLine, taxWords,
} from '../src/lib/engine/commander.js'
import { checkedDeck, leaveOut, seatDeck, verdictOf } from '../src/lib/engine/deck.js'
import { GLOW_SAYS, glowsAt, offeredElsewhere, pileHolding } from '../src/lib/engine/glow.js'
import { engineDeckLine, insteadLine, seatWords } from '../src/lib/engine/opponent.js'
import { boardFromView } from '../src/lib/engine/board.js'
import { stopLine } from '../src/features/game/EnginePrompt.jsx'

const CARDS = {
  rhys: { name: 'Rhys the Redeemed', set: 'shm', collector_number: '237' },
  sythis: { name: "Sythis, Harvest's Hand", set: 'mh2', collector_number: '214' },
  forest: { name: 'Forest', set: 'por', collector_number: '211' },
  plains: { name: 'Plains', set: 'por', collector_number: '196' },
}
const lookup = (id) => CARDS[id] ?? null
const DECK = { id: 'c1', formatId: 'commander', commanders: ['rhys'], main: [{ cardId: 'forest', quantity: 50 }, { cardId: 'plains', quantity: 49 }] }

describe('which game a deck asks the engine for', () => {
  it('is Commander for a Commander deck, and the ordinary rules for every other, the rest of the family too', () => {
    expect(gameOf('commander')).toBe(COMMANDER_GAME)
    for (const f of ['standard', 'pauper', 'brawl', 'duel', 'oathbreaker', undefined, 'made-up']) expect(gameOf(f)).toBe('standard')
    expect(['brawl', 'duel', 'oathbreaker'].every(leaderlessFamily)).toBe(true)
    expect(['commander', 'standard', 'made-up'].some(leaderlessFamily)).toBe(false)
    expect(leaderlessLine('brawl')).toBe('The engine deals the Commander rules for Commander alone, so a Brawl deck is played by the ordinary rules: 20 life, and its commander is not dealt.')
    // An Oathbreaker deck's signature spell is kept apart from its main deck as its oathbreaker is, and neither is dealt.
    expect(leaderlessLine('oathbreaker')).toBe('The engine deals the Commander rules for Commander alone, so an Oathbreaker deck is played by the ordinary rules: 20 life, and its oathbreaker and its signature spell are not dealt.')
    // The rules, each by its number in the Comprehensive Rules.
    for (const n of ['903.6', '903.7', '903.8', '903.10a']) expect(COMMANDER_TABLE).toContain(`(${n})`)
  })
})

describe('the deck as the sit sends it', () => {
  it('sends a Commander deck\'s commander apart from its library, with its printing, and counts it', () => {
    const seat = seatDeck(DECK, lookup)
    expect(seat.deck).toEqual({ Forest: { count: 50, set: 'por', number: '211' }, Plains: { count: 49, set: 'por', number: '196' } })
    expect(seat.commander).toEqual({ name: 'Rhys the Redeemed', set: 'shm', number: '237' })
    expect(seat).toMatchObject({ game: 'commander', leaders: 1, total: 100, unloaded: 0, commanderUnloaded: 0 })
  })

  it('leaves a commander listed in the main deck too out of the library', () => {
    const seat = seatDeck({ ...DECK, main: [...DECK.main, { cardId: 'rhys', quantity: 1 }] }, lookup)
    expect(seat.deck).not.toHaveProperty('Rhys the Redeemed')
    expect(seat.total).toBe(100)
  })

  it('sends a commander that has not loaded by its stamped name, and counts one with no name as unloaded', () => {
    const stamped = seatDeck({ ...DECK, cardNames: { rhys: 'Rhys the Redeemed' } }, (id) => (id === 'rhys' ? null : lookup(id)))
    expect(stamped.commander).toEqual({ name: 'Rhys the Redeemed' })
    const nameless = seatDeck(DECK, (id) => (id === 'rhys' ? null : lookup(id)))
    expect(nameless).toMatchObject({ commander: null, commanderUnloaded: 1, unloaded: 1 })
  })

  it('sends none for two commanders, which the engine cannot deal, and says how many there were', () => {
    const seat = seatDeck({ ...DECK, commanders: ['rhys', 'sythis'] }, lookup)
    expect(seat).toMatchObject({ commander: null, leaders: 2, total: 101 })
    expect(leaderProblem(seat)).toBe('partners')
    expect(leaderProblem(seatDeck({ ...DECK, commanders: [] }, lookup))).toBe('none')
    expect(leaderProblem(seatDeck(DECK, lookup))).toBeNull()
  })

  it('leaves every other deck exactly as it was, the rest of the Commander family included', () => {
    const brawl = seatDeck({ ...DECK, formatId: 'brawl' }, lookup)
    expect(brawl).toEqual({ deck: seatDeck(DECK, lookup).deck, sideboard: {}, total: 99, unloaded: 0, sideboardUnloaded: 0 })
    expect(leaderProblem(brawl)).toBeNull()
    const sixty = seatDeck({ id: 's', formatId: 'standard', commanders: [], main: [{ cardId: 'forest', quantity: 60 }], sideboard: [] }, lookup)
    expect(sixty).not.toHaveProperty('commander')
    expect(sixty).not.toHaveProperty('game')
  })

  it('asks the engine about the commander with the library', () => {
    const seat = seatDeck(DECK, lookup)
    expect(checkedDeck(seat)).toEqual({ ...seat.deck, 'Rhys the Redeemed': { count: 1, set: 'shm', number: '237' } })
    expect(checkedDeck(seatDeck({ ...DECK, formatId: 'standard' }, lookup))).toEqual(seatDeck({ ...DECK, formatId: 'standard' }, lookup).deck)
    expect(checkedDeck(null)).toEqual({})
  })
})

describe('the lobby\'s verdict on a Commander deck', () => {
  const seat = seatDeck(DECK, lookup)

  it('knows the commander when the engine does, counting it among the hundred', () => {
    const verdict = verdictOf(seat, { known: 100, total: 100, unknown: [], unknownSideboard: [] })
    expect(verdict).toMatchObject({ state: 'complete', total: 100, known: 100, commanderUnknown: false })
    expect(leaderProblem(seat, verdict)).toBeNull()
  })

  it('names an unknown commander first, marked, and says a Commander game cannot be dealt without it', () => {
    const verdict = verdictOf(seat, { known: 50, total: 100, unknown: ['Plains', 'Rhys the Redeemed'], unknownSideboard: [], engineSets: [{ code: 'POR' }] })
    expect(verdict.state).toBe('short')
    expect(verdict.unknown[0]).toMatchObject({ name: 'Rhys the Redeemed', count: 1, commander: true })
    expect(verdict.known).toBe(50)
    expect(leaderProblem(seat, verdict)).toBe('unknown')
    expect(leaderWords('unknown', 'Rhys the Redeemed')).toBe('It does not know the commander, Rhys the Redeemed, and every Commander deck has one (903.3), so it cannot deal a Commander game with this deck.')
  })

  it('leaves out an unknown commander with the rest where the player chose to play without them', () => {
    const { seat: without, left } = leaveOut(seat, ['Rhys the Redeemed', 'Plains', 'Not In The Deck'])
    expect(without.commander).toBeNull()
    expect(without.deck).toEqual({ Forest: seat.deck.Forest })
    expect(without.total).toBe(50)
    expect(left).toEqual([{ name: 'Rhys the Redeemed', count: 1, commander: true }, { name: 'Plains', count: 49 }])
    // A sixty-card seat has no commander to leave out, and gains no key for one.
    expect(leaveOut({ deck: { Forest: 20 }, total: 20 }, ['Forest']).seat).not.toHaveProperty('commander')
  })
})

describe('what the table says of a Commander game', () => {
  it('says which game was dealt, and why where it was not Commander, and nothing of a game nobody asked to be one', () => {
    expect(formatLine({ asked: 'commander', played: 'commander' }, 'commander')).toBe("Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6).")
    expect(formatLine({ asked: 'commander', played: 'standard', fellBack: 'engine' }, 'commander')).toMatch(/older than Commander/)
    expect(formatLine({ asked: 'commander', played: 'standard', fellBack: 'commander' }, 'commander')).toMatch(/\(903\.3\)/)
    expect(formatLine({ asked: 'commander', played: 'standard', fellBack: 'something new' }, 'commander')).toBe('The game is played by the ordinary rules, not the Commander rules asked for.')
    expect(formatLine(undefined, 'commander')).toMatch(/^This relay is older than Commander/)
    expect(formatLine({ asked: 'standard', played: 'standard' }, 'standard')).toBeNull()
    expect(formatLine(undefined, 'standard')).toBeNull()
    expect(formatLine('commander', 'standard')).toBeNull()
  })

  it('says the commander tax by the engine\'s own count, and nothing where there is none', () => {
    expect(taxWords({ commanderTax: { casts: 1, generic: 2 } })).toBe('{2} more for the commander tax, as it has been cast from the command zone once before (903.8)')
    expect(taxWords({ commanderTax: { casts: 2, generic: 4 } })).toMatch(/twice before/)
    expect(taxWords({ commanderTax: { casts: 3, generic: 6 } })).toMatch(/3 times before/)
    for (const offer of [{ commanderTax: { casts: 0, generic: 0 } }, {}, null, { commanderTax: 'lots' }, { commanderTax: { casts: 'one', generic: 2 } }]) expect(taxWords(offer)).toBeNull()
  })

  it('names the rule that asks whether a commander goes to the command zone, by where it is', () => {
    // 903.9a is a state-based action on a commander already there, and says no "instead"; 903.9b is a replacement, and does.
    const sba = "A commander put into a graveyard or exile may be put into its owner's command zone, a state-based action (903.9a)."
    const replacement = "A commander that would go to its owner's hand or library may go to the command zone instead (903.9b)."
    expect(commanderZoneRule('graveyard')).toBe(sba)
    expect(commanderZoneRule('exile')).toBe(sba)
    expect(commanderZoneRule('hand')).toBe(replacement)
    expect(commanderZoneRule('library')).toBe(replacement)
    expect(commanderZoneRule(undefined)).toBeNull()
    expect(commanderZoneRule('battlefield')).toBeNull()
  })

  it('reads commander damage off a player forgivingly, and says it in words', () => {
    const player = { commanderDamage: [
      { commanderId: 'e2', commanderName: 'Rhys the Redeemed', controllerId: 'e0', amount: 3, threshold: 21, imageUri: 'x' },
      { commanderId: 'e9', amount: 0, threshold: 21 },
      { commanderName: 'Nameless', amount: 'lots' },
      null,
      { commanderId: 'e7', amount: 5 },
    ] }
    const tally = commanderDamageOf(player)
    expect(tally).toEqual([
      { commander: 'e2', name: 'Rhys the Redeemed', controller: 'e0', amount: 3, threshold: 21 },
      { commander: 'e7', name: 'A commander', controller: null, amount: 5, threshold: 21 },
    ])
    expect(damageWords(tally)).toBe('Commander damage: Rhys the Redeemed 3 of 21 and A commander 5 of 21')
    expect(commanderDamageOf({})).toEqual([])
    expect(commanderDamageOf({ commanderDamage: 'none' })).toEqual([])
    expect(damageWords([])).toBeNull()
  })

  it('tells two commanders of one name apart by whose each is, and says what the tally counts towards', () => {
    // A copy of the person's deck plays their commander: both are Rhys, and each tally is its own (903.10a).
    const tally = commanderDamageOf({ commanderDamage: [
      { commanderId: 'e2', commanderName: 'Rhys the Redeemed', controllerId: 'e0', amount: 5, threshold: 21 },
      { commanderId: 'e9', commanderName: 'Rhys the Redeemed', controllerId: 'e1', amount: 7, threshold: 21 },
      { commanderId: 'e4', commanderName: 'Sythis', controllerId: 'e1', amount: 1, threshold: 21 },
    ] })
    const whose = (d) => ({ e0: 'your', e1: "the engine's" })[d.controller] ?? null
    expect(damageWords(tally, { whose })).toBe("Commander damage: your Rhys the Redeemed 5 of 21, the engine's Rhys the Redeemed 7 of 21 and Sythis 1 of 21")
    // Where whose it is cannot be said, the name stands alone rather than a guess.
    expect(damageWords(tally, { whose: () => null })).toBe('Commander damage: Rhys the Redeemed 5 of 21, Rhys the Redeemed 7 of 21 and Sythis 1 of 21')
    expect(damageRule(tally)).toBe('A player dealt 21 combat damage by one commander loses the game (903.10a).')
    expect(damageRule([{ threshold: 16 }])).toBe('A player dealt 16 combat damage by one commander loses the game (903.10a).')
    expect(damageRule([])).toBeNull()
    expect(damageRule(undefined)).toBeNull()
  })

  it('names the engine\'s commander beside its deck, it being face up from the start', () => {
    const own = { asked: 'own', played: 'own', cards: 100, colours: ['W', 'G'], commander: "Sythis, Harvest's Hand", format: 'commander', formatName: 'Commander', from: 'format' }
    expect(seatWords({ report: own })).toBe("The engine, with a deck of its own: green-white from the whole of Commander, led by Sythis, Harvest's Hand")
    expect(engineDeckLine(own)).toBe("The engine plays a deck of its own, built by Argentum's deck builder: green-white, from the whole of Commander, led by Sythis, Harvest's Hand.")
    expect(engineDeckLine({ ...own, from: 'format', fellBack: 'thin' })).toBe("The sets your deck uses hold too few Commander cards to build a deck from, so the engine built one from the whole of Commander instead: green-white, led by Sythis, Harvest's Hand.")
    expect(seatWords({ report: { asked: 'mirror', played: 'mirror', commander: 'Rhys the Redeemed' } })).toBe('The engine, with a copy of your deck, led by Rhys the Redeemed')
    expect(engineDeckLine({ asked: 'deck', played: 'mirror', name: 'Leaderless', fellBack: 'commander' })).toBe('Leaderless came with no commander to lead it in a Commander game, so the engine plays a copy of yours.')
    expect(insteadLine('leader', 'Enchantress')).toBe('Enchantress has no commander the engine can deal, so it plays a copy of yours.')
    // A commander that is not a name is not said.
    expect(seatWords({ report: { asked: 'mirror', played: 'mirror', commander: 7 } })).toBe('The engine, with a copy of your deck')
  })
})

describe('the commander in the command zone, on the table', () => {
  const ME = 'e0'
  const cast = { index: 1, type: 'CastSpell', description: 'Cast Rhys the Redeemed', card: 'e2', affordable: true, meaningful: true, manaCost: '{2}{G/W}', from: 'command', commanderTax: { casts: 1, generic: 2 }, requiresTargets: false }
  const pass = { index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false }
  const status = { actor: ME, waiting: 'action', actions: [pass, cast] }
  const zones = { e2: 'command', e5: 'hand' }
  const zoneOf = (id) => zones[id]

  it('glows the commander a tap on the command zone casts, says so, and lists it nowhere else', () => {
    const glows = glowsAt({ status, me: ME, zoneOf })
    expect(glows.get('e2')).toEqual({ kind: 'playable', says: GLOW_SAYS.command })
    expect(pileHolding(['e2'], glows)).toBe('cast')
    expect(offeredElsewhere(status, zoneOf)).toEqual([])
    // Not a stop's play where it is not affordable, and not glowing where it is not in the command zone.
    expect(glowsAt({ status: { ...status, actions: [pass, { ...cast, affordable: false }] }, me: ME, zoneOf }).size).toBe(0)
  })

  it('says it at the stop, with its cost and what the commander tax adds to it', () => {
    const glows = glowsAt({ status, me: ME, zoneOf })
    const line = stopLine({ status, me: ME, glows, nameOf: (id) => (id === 'e2' ? 'Rhys the Redeemed' : id) })
    expect(line).toBe('Your commander, Rhys the Redeemed, can be cast from the command zone for {2}{G/W}: {2} more for the commander tax, as it has been cast from the command zone once before (903.8). Tap the command zone to cast it, or pass.')
    // Beside a card in hand: both said, the pass offered once, at the end.
    const both = { ...status, actions: [...status.actions, { index: 2, type: 'PlayLand', description: 'Play Forest', card: 'e5', affordable: true, meaningful: true }] }
    const said = stopLine({ status: both, me: ME, glows: glowsAt({ status: both, me: ME, zoneOf }), nameOf: (id) => (id === 'e2' ? 'Rhys the Redeemed' : 'Forest') })
    expect(said).toMatch(/^The card you can play glows\. Tap it\. Your commander, Rhys the Redeemed, can be cast/)
    expect(said.match(/or pass/g)).toHaveLength(1)
  })

  it('lays the command zone, the commander and the tally of commander damage from the engine\'s view', () => {
    const card = (id, zone, over = {}) => ({ id, name: 'Rhys the Redeemed', typeLine: 'Legendary Creature — Elf Warrior', controllerId: ME, ownerId: ME, zone: { ownerId: ME, zoneType: zone }, ...over })
    const view = {
      viewingPlayerId: ME, turnNumber: 3, activePlayerId: ME, priorityPlayerId: ME, currentPhase: 'PRECOMBAT_MAIN', currentStep: 'PRECOMBAT_MAIN',
      cards: { e2: card('e2', 'Command', { isCommander: true }), e3: card('e3', 'Battlefield', { name: 'Forest', typeLine: 'Basic Land — Forest' }) },
      zones: [
        { zoneId: { ownerId: ME, zoneType: 'Command' }, cardIds: ['e2'], size: 1, isVisible: true },
        { zoneId: { ownerId: ME, zoneType: 'Battlefield' }, cardIds: ['e3'], size: 1, isVisible: true },
        { zoneId: { ownerId: 'e1', zoneType: 'Command' }, cardIds: [], size: 0, isVisible: true },
      ],
      players: [
        { playerId: ME, life: 38, commanderDamage: [{ commanderId: 'e102', commanderName: 'Sythis', controllerId: 'e1', amount: 2, threshold: 21 }] },
        { playerId: 'e1', life: 40 },
      ],
    }
    const board = boardFromView(view, { seats: [ME, 'e1'] })
    expect(board.zones[ME].command).toEqual(['e2'])
    expect(board.cards.e2).toMatchObject({ zone: 'command', commander: true })
    expect(board.cards.e3).not.toHaveProperty('commander')
    expect(board.life).toEqual({ [ME]: 38, e1: 40 })
    expect(board.engine.commanderDamage).toEqual({ [ME]: [{ commander: 'e102', name: 'Sythis', controller: 'e1', amount: 2, threshold: 21 }] })
    // A view with no tally, as every view before Commander, has none.
    expect(boardFromView({ ...view, players: [{ playerId: ME, life: 20 }, { playerId: 'e1', life: 20 }] }, { seats: [ME, 'e1'] }).engine.commanderDamage).toEqual({})
  })
})
