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
  BRAWL_MULLIGAN, COMMANDER_GAME, COMMANDER_GAMES, COMMANDER_TABLE, GAMES, commanderDamageOf, commanderZoneRule, damageLoses, damageRule, damageWords, formatLine, gameName, gameOf, gameRules,
  isCommanderGame, leaderProblem, leaderWords, leaderlessFamily, leaderlessLine, tableLine, taxWords,
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
  it('is its own Commander game for a Commander, a Duel Commander or a Brawl deck, and the ordinary rules for every other, Oathbreaker too', () => {
    expect(gameOf('commander')).toBe(COMMANDER_GAME)
    // Since §3 item 20, the owner's decision of 2026-09-25.
    expect(gameOf('duel')).toBe('duel')
    expect(gameOf('brawl')).toBe('brawl')
    expect(COMMANDER_GAMES).toEqual(['commander', 'duel', 'brawl'])
    for (const f of ['standard', 'pauper', 'oathbreaker', undefined, 'made-up']) expect(gameOf(f)).toBe('standard')
    expect(leaderlessFamily('oathbreaker')).toBe(true)
    expect(['commander', 'duel', 'brawl', 'standard', 'made-up'].some(leaderlessFamily)).toBe(false)
    expect(['commander', 'duel', 'brawl'].every(isCommanderGame)).toBe(true)
    expect(['standard', 'oathbreaker', undefined, 7].some(isCommanderGame)).toBe(false)
    // An Oathbreaker deck's signature spell is kept apart from its main deck as its oathbreaker is, and neither is dealt.
    expect(leaderlessLine('oathbreaker')).toBe('The engine deals Commander, Duel Commander and Brawl as Commander games, and not Oathbreaker, so an Oathbreaker deck is played by the ordinary rules: 20 life, and its oathbreaker and its signature spell are not dealt.')
    // The rules, each by its number in the Comprehensive Rules.
    for (const n of ['903.6', '903.7', '903.8', '903.10a']) expect(COMMANDER_TABLE).toContain(`(${n})`)
    expect(tableLine('commander')).toBe(COMMANDER_TABLE)
    expect(tableLine('oathbreaker')).toBeNull()
    expect(tableLine('standard')).toBeNull()
  })

  it('says what a Duel Commander or a Brawl deck is dealt as, each number with its rule, and where the table does not follow Brawl\'s own', () => {
    // Duel Commander is not in the Comprehensive Rules: its numbers are its committee's rules, said as theirs.
    expect(tableLine('duel')).toBe("A Duel Commander deck is dealt as a Commander game for two, by Argentum's own Commander rules at Duel Commander's numbers, which are its rules committee's and not in the Comprehensive Rules: 20 life each (Duel Commander rules, 300.1a), each commander in its owner's command zone (903.6), {2} more to cast it from there for each time before (903.8), and commander damage loses nobody the game (Duel Commander rules, 506.1a).")
    const brawl = tableLine('brawl')
    for (const n of ['903.12f', '903.6', '903.8', '903.12h', '903.12g', '903.12d']) expect(brawl).toContain(`(${n})`)
    expect(brawl.startsWith("A Brawl deck is dealt as a Commander game for two, by Argentum's own Commander rules at Brawl's numbers: 25 life each (903.12f)")).toBe(true)
    // The two it does not follow: the free first mulligan, and sixty cards.
    expect(brawl).toContain(BRAWL_MULLIGAN)
    expect(brawl.endsWith("a Brawl deck here holds a hundred cards, as Scryfall's Brawl does, where the Comprehensive Rules' Brawl holds sixty (903.12d).")).toBe(true)
    // The numbers the table says are the ones Server.kt asks Argentum for.
    expect([GAMES.commander.life, GAMES.duel.life, GAMES.brawl.life]).toEqual([40, 20, 25])
    expect([GAMES.commander.damage, GAMES.duel.damage, GAMES.brawl.damage]).toEqual([21, null, null])
    expect([gameName('duel'), gameName('brawl'), gameName('commander'), gameName(undefined)]).toEqual(['Duel Commander', 'Brawl', 'Commander', 'Commander'])
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

  it('sends a Duel Commander or a Brawl deck\'s commander the same way, the game its own (§3 item 20)', () => {
    for (const formatId of ['duel', 'brawl']) {
      const seat = seatDeck({ ...DECK, formatId }, lookup)
      expect(seat).toMatchObject({ game: formatId, leaders: 1, total: 100, commander: { name: 'Rhys the Redeemed', set: 'shm', number: '237' } })
      expect(seat.deck).toEqual(seatDeck(DECK, lookup).deck)
      expect(leaderProblem(seatDeck({ ...DECK, formatId, commanders: [] }, lookup))).toBe('none')
      expect(leaderProblem(seatDeck({ ...DECK, formatId, commanders: ['rhys', 'sythis'] }, lookup))).toBe('partners')
    }
    expect(leaderWords('unknown', 'Rhys the Redeemed', 'brawl')).toBe('It does not know the commander, Rhys the Redeemed, and every Brawl deck has one (903.3), so it cannot deal a Brawl game with this deck.')
    expect(leaderWords('partners', null, 'duel')).toBe('The engine deals one commander, and this deck has two, so it cannot deal a Duel Commander game with it.')
    // Duel Commander's own rule that its deck has a commander, its committee's and not the
    // Comprehensive Rules' (found in the review of item 20, where 903.3 was said of it).
    expect(leaderWords('none', null, 'duel')).toBe('This deck has no commander, and every Duel Commander deck has one (Duel Commander rules, 402.1b), so the engine cannot deal a Duel Commander game with it.')
    expect(leaderWords('unknown', 'Rhys the Redeemed', 'duel')).toBe('It does not know the commander, Rhys the Redeemed, and every Duel Commander deck has one (Duel Commander rules, 402.1b), so it cannot deal a Duel Commander game with this deck.')
  })

  it('cites a commander\'s rules by each game\'s own numbers: Duel Commander\'s committee\'s, which defer to 903, and 903 for the others', () => {
    expect(gameRules('duel')).toMatchObject({ hasRule: 'Duel Commander rules, 402.1b', leaderRule: 'Duel Commander rules, 403.1a, which defers to 903.3', identityRule: 'Duel Commander rules, 103.4b and 403.1a, which defer to 903.4 and 903.5c' })
    for (const game of ['commander', 'brawl', undefined, 'oathbreaker']) expect(gameRules(game)).toMatchObject({ hasRule: '903.3', leaderRule: '903.3', identityRule: '903.4, 903.5c' })
    // Nothing said of Duel Commander cites 903.3 alone, as though it were Duel Commander's own rule.
    for (const said of [leaderWords('unknown', 'X', 'duel'), leaderWords('none', null, 'duel'), formatLine({ asked: 'duel', played: 'standard', fellBack: 'commander' }, 'duel')]) {
      expect(said).not.toMatch(/\(903\.3\)/)
      expect(said).toMatch(/\(Duel Commander rules, 402\.1b\)/)
    }
  })

  it('leaves every other deck exactly as it was, Oathbreaker included', () => {
    const oathbreaker = seatDeck({ ...DECK, formatId: 'oathbreaker' }, lookup)
    expect(oathbreaker).toEqual({ deck: seatDeck(DECK, lookup).deck, sideboard: {}, total: 99, unloaded: 0, sideboardUnloaded: 0 })
    expect(leaderProblem(oathbreaker)).toBeNull()
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
    // Since protocol 10 the room passes on the engine's numbers, which say the same.
    expect(formatLine({ asked: 'commander', played: 'commander', rules: { life: 40, deckSize: 100, commanderDamage: 21 } }, 'commander')).toBe("Played by the Commander rules: 40 life each (903.7), and each commander begins in its owner's command zone (903.6).")
  })

  it('says a Duel Commander or a Brawl game dealt at its own numbers, and each way it was not (§3 item 20)', () => {
    const brawl = { life: 25, deckSize: 100, commanderDamage: null }
    expect(formatLine({ asked: 'brawl', played: 'brawl', rules: brawl }, 'brawl')).toBe(`Played by the Brawl rules, for two: 25 life each (903.12f), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (903.12h). ${BRAWL_MULLIGAN}`)
    expect(formatLine({ asked: 'duel', played: 'duel', rules: { life: 20, deckSize: 100, commanderDamage: null } }, 'duel')).toBe("Played by the Duel Commander rules, for two: 20 life each (Duel Commander rules, 300.1a), each commander begins in its owner's command zone (903.6), and commander damage loses nobody the game (Duel Commander rules, 506.1a).")
    // A number the engine dealt that is not the rule's is said as the engine's, and not cited.
    expect(formatLine({ asked: 'brawl', played: 'brawl', rules: { life: 30 } }, 'brawl').startsWith('Played by the Brawl rules, for two: 30 life each, as the engine dealt it, ')).toBe(true)
    // No numbers passed on: the rule's.
    expect(formatLine({ asked: 'duel', played: 'duel' }, 'duel')).toContain('20 life each (Duel Commander rules, 300.1a)')
    const ordinary = 'played by the ordinary rules: 20 life each, and no commander dealt.'
    expect(formatLine({ asked: 'brawl', played: 'standard', fellBack: 'engine' }, 'brawl')).toBe(`This relay's engine deals no Brawl game, so it is ${ordinary}`)
    expect(formatLine({ asked: 'duel', played: 'standard', fellBack: 'players' }, 'duel')).toBe(`This table has more than two players, and Duel Commander is for two (Duel Commander rules, 205.1a), so it is ${ordinary}`)
    expect(formatLine({ asked: 'brawl', played: 'standard', fellBack: 'players' }, 'brawl')).toBe(`This table has more than two players, and the engine deals Brawl only to two, at 25 life each (903.12f; more begin at 30), so it is ${ordinary}`)
    expect(formatLine({ asked: 'brawl', played: 'standard', fellBack: 'games' }, 'duel')).toBe(`The decks at this table ask for different games of the Commander family, so it is ${ordinary}`)
    expect(formatLine({ asked: 'brawl', played: 'standard', fellBack: 'commander' }, 'brawl')).toBe('With no commander to deal there is no Brawl game, since every Brawl deck has one (903.3), so it is played by the ordinary rules: 20 life each, and no command zone.')
    expect(formatLine({ asked: 'duel', played: 'standard', fellBack: 'commander' }, 'duel')).toBe('With no commander to deal there is no Duel Commander game, since every Duel Commander deck has one (Duel Commander rules, 402.1b), so it is played by the ordinary rules: 20 life each, and no command zone.')
    // A relay from before item 20 read the word as no game at all, and a relay from before Commander says nothing.
    expect(formatLine({ asked: 'standard', played: 'standard' }, 'brawl')).toBe(`This relay deals no Brawl game, so it is ${ordinary}`)
    expect(formatLine(undefined, 'duel')).toBe(`This relay is older than Duel Commander at the engine's table, so the game is ${ordinary}`)
  })

  it('says commander damage can lose only a game whose rules have that loss', () => {
    expect(damageLoses({ asked: 'commander', played: 'commander', rules: { life: 40, commanderDamage: 21 } })).toBe(true)
    expect(damageLoses({ asked: 'brawl', played: 'brawl', rules: { life: 25, commanderDamage: null } })).toBe(false)
    // Duel Commander and Brawl have none whatever the engine said; the engine's null is believed of any game.
    expect(damageLoses({ asked: 'duel', played: 'duel' })).toBe(false)
    expect(damageLoses({ asked: 'commander', played: 'commander', rules: { life: 40, commanderDamage: null } })).toBe(false)
    // Nothing said, or unreadable: as every Commander game before item 20.
    for (const r of [undefined, null, 'brawl', { played: 'standard' }, { played: 'commander', rules: 'none' }]) expect(damageLoses(r)).toBe(true)
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
