/**
 * What the engine's seat plays, as the lobby offers it and the table says it
 * (HANDOFF.md, M5). Everything here reads what storage or a relay gave it, so
 * most of what is held is that a shape it did not expect is read as the
 * nearest honest thing, and that every case is said as what it is.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OPPONENT, buildsFor, chosenOpponent, colourWords, dealingWords, engineDeckLine, engineDeckRecord, formatWord, insteadLine, noOwnLine, plannedWords, seatWords, setsOf,
} from '../src/lib/engine/opponent.js'

describe('the choice kept with the player\'s preferences', () => {
  it('is a copy of their deck until they choose, and builds from their sets by default, the owner\'s choice', () => {
    expect(DEFAULT_OPPONENT).toEqual({ kind: 'mirror', deckId: null, pool: 'sets' })
    expect(chosenOpponent(undefined)).toEqual(DEFAULT_OPPONENT)
  })

  it('reads what another build wrote forgivingly', () => {
    expect(chosenOpponent({ kind: 'own', pool: 'format' })).toEqual({ kind: 'own', deckId: null, pool: 'format' })
    expect(chosenOpponent({ kind: 'deck', deckId: 'd2' })).toEqual({ kind: 'deck', deckId: 'd2', pool: 'sets' })
    // A kind this build does not know, a deck id that is not one, a pool it has no word for.
    expect(chosenOpponent({ kind: 'draft', deckId: 7, pool: 'cube' })).toEqual(DEFAULT_OPPONENT)
    expect(chosenOpponent('own')).toEqual(DEFAULT_OPPONENT)
    expect(chosenOpponent(['own'])).toEqual(DEFAULT_OPPONENT)
    expect(chosenOpponent(null)).toEqual(DEFAULT_OPPONENT)
  })
})

describe('the sets a deck uses', () => {
  const cards = {
    bolt: { name: 'Lightning Bolt', set: 'm11', set_name: 'Magic 2011', type_line: 'Instant' },
    elf: { name: 'Llanowar Elves', set: 'fdn', set_name: 'Foundations', type_line: 'Creature — Elf Druid' },
    forest: { name: 'Forest', set: 'trk', set_name: 'Star Trek', type_line: 'Basic Land — Forest' },
    snow: { name: 'Snow-Covered Forest', set: 'khm', set_name: 'Kaldheim', type_line: 'Basic Snow Land — Forest' },
    pool: { name: 'Bottomless Pool // Locker Room', set: 'DSK', set_name: 'Duskmourn: House of Horror', type_line: 'Enchantment — Room // Enchantment — Room' },
    noset: { name: 'Mystery', type_line: 'Instant' },
  }
  const lookup = (id) => cards[id] ?? null

  it('names each printing\'s set, the most copies first, and leaves out basic lands', () => {
    const deck = { main: [
      { cardId: 'bolt', quantity: 2 }, { cardId: 'elf', quantity: 4 }, { cardId: 'forest', quantity: 16 },
      { cardId: 'snow', quantity: 4 }, { cardId: 'pool', quantity: 2 },
    ] }
    // The Star Trek Forests would otherwise put every Star Trek card in the pool.
    expect(setsOf(deck, lookup)).toEqual([
      { code: 'fdn', name: 'Foundations' },
      { code: 'dsk', name: 'Duskmourn: House of Horror' },
      { code: 'm11', name: 'Magic 2011' },
    ])
  })

  it('skips a card that has not loaded, or has no set, and reads a deck of nothing as no sets', () => {
    expect(setsOf({ main: [{ cardId: 'gone', quantity: 4 }, { cardId: 'noset', quantity: 1 }] }, lookup)).toEqual([])
    expect(setsOf(null, lookup)).toEqual([])
    expect(setsOf({ main: 'lots' }, lookup)).toEqual([])
  })
})

describe('the format as the engine is asked for it', () => {
  it('is Scryfall\'s word for the app\'s format, and a word the app does not know goes as it is', () => {
    expect(formatWord('standard')).toBe('standard')
    expect(formatWord('duel')).toBe('duel')
    expect(formatWord('premodern')).toBe('premodern')
    expect(formatWord(undefined)).toBeNull()
  })

  it('is one the engine builds a deck of its own for: outside the Commander family, since M6 Commander itself, and since §3 item 20 Brawl', () => {
    expect(['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'brawl'].every(buildsFor)).toBe(true)
    // Argentum has no Duel Commander card pool, and no Oathbreaker one.
    expect(['duel', 'oathbreaker', 'constructor', null].some(buildsFor)).toBe(false)
    expect(noOwnLine('duel')).toBe('The engine builds no Duel Commander deck of its own, as Argentum has no Duel Commander card pool to build one from, so with a Duel Commander deck it plays a copy of yours.')
    expect(noOwnLine('oathbreaker')).toBe('The engine builds no Oathbreaker deck of its own, so with an Oathbreaker deck it plays a copy of yours.')
  })
})

describe('a deck\'s colours in words', () => {
  it('says one, two, three or none', () => {
    expect(colourWords(['R'])).toBe('mono-red')
    expect(colourWords(['R', 'G'])).toBe('red-green')
    expect(colourWords(['G', 'R'])).toBe('red-green')
    // Each pair in the order it is usually said, not in the order of the wheel's letters.
    expect(colourWords(['W', 'G'])).toBe('green-white')
    expect(colourWords(['U', 'G'])).toBe('green-blue')
    expect(colourWords(['W', 'R'])).toBe('red-white')
    expect(colourWords(['W', 'U', 'B'])).toBe('white, blue and black')
    expect(colourWords([])).toBe('colourless')
  })

  it('reads nothing that is not a colour', () => {
    expect(colourWords(['R', 'X', 7])).toBe('mono-red')
    expect(colourWords('RG')).toBe('colourless')
    expect(colourWords(undefined)).toBe('colourless')
  })
})

describe('the seat list', () => {
  it('says what was asked before the deal', () => {
    expect(seatWords({ asked: 'mirror' })).toBe('The engine, with a copy of your deck')
    expect(seatWords({ asked: 'deck', deckName: 'Elves' })).toBe('The engine, with your deck Elves')
    expect(seatWords({ asked: 'deck' })).toBe('The engine, with one of your decks')
    expect(seatWords({ asked: 'own' })).toBe('The engine, with a deck of its own')
    expect(seatWords({})).toBe('The engine, with a copy of your deck')
  })

  it('says what was dealt after it: a deck of its own by its colours and where it came from, the brief\'s own example', () => {
    expect(seatWords({ report: { played: 'own', colours: ['R', 'G'], from: 'sets', sets: [{ code: 'BLB', name: 'Bloomburrow' }] } }))
      .toBe('The engine, with a deck of its own: red-green from Bloomburrow')
    expect(seatWords({ report: { played: 'own', colours: ['B'], from: 'format', format: 'standard' } }))
      .toBe('The engine, with a deck of its own: mono-black from the whole of Standard')
    expect(seatWords({ report: { played: 'mirror', fellBack: 'format' } })).toBe('The engine, with a copy of your deck')
    expect(seatWords({ report: { played: 'deck', name: 'Elves' } })).toBe('The engine, with your deck Elves')
  })
})

/**
 * Before the deal the seat list said the choice as made, and the sit could send
 * something else: a copy on a Brawl table where "a deck of its own" was chosen,
 * and a copy for a chosen deck the engine does not know (found in M6's review).
 * Both now come from what the sit will send.
 */
describe('the seat list before the deal, as the sit will send it', () => {
  const elves = { id: 'd2', name: 'Elves' }
  const seat = { deck: { Forest: 20, 'Llanowar Elves': 20 }, sideboard: {}, total: 40, unloaded: 0 }
  const complete = { state: 'complete', seat }
  const leaderless = { state: 'complete', seat: { ...seat, game: 'commander', leaders: 0, commander: null, commanderUnloaded: 0 } }
  const own = { kind: 'own', deckId: null, pool: 'sets' }
  const theirs = { kind: 'deck', deckId: 'd2', pool: 'sets' }

  it('records what the sit sends: the copy, a deck of the player\'s by its checked names, or a deck of its own', () => {
    expect(engineDeckRecord({ choice: { kind: 'mirror' } })).toEqual({ kind: 'mirror' })
    expect(engineDeckRecord({ choice: own })).toEqual({ kind: 'own', pool: 'sets' })
    expect(engineDeckRecord({ choice: { ...own, pool: 'format' } })).toEqual({ kind: 'own', pool: 'format' })
    expect(engineDeckRecord({ choice: theirs, chosen: elves, check: complete })).toEqual({ kind: 'deck', deckId: 'd2', name: 'Elves', deck: seat.deck })
    // Not sendable: the copy, with the reason the table says.
    expect(engineDeckRecord({ choice: theirs })).toEqual({ kind: 'mirror', instead: 'none' })
    expect(engineDeckRecord({ choice: theirs, chosen: elves, check: { state: 'short', seat } })).toEqual({ kind: 'mirror', instead: 'short', name: 'Elves' })
    expect(engineDeckRecord({ choice: theirs, chosen: elves, check: { state: 'complete', seat: { ...seat, unloaded: 2 } } })).toEqual({ kind: 'mirror', instead: 'unloaded', name: 'Elves' })
    expect(engineDeckRecord({ choice: theirs, chosen: elves, check: leaderless })).toEqual({ kind: 'mirror', instead: 'leader', name: 'Elves' })
    expect(engineDeckRecord()).toEqual({ kind: 'mirror' })
  })

  it('says what the sit will send, and why where that is the copy', () => {
    expect(plannedWords({ choice: own, format: 'standard' })).toBe('The engine, with a deck of its own')
    // Since §3 item 20 a Brawl deck of its own is built for a Brawl game; a Duel Commander one never is.
    expect(plannedWords({ choice: own, format: 'brawl' })).toBe('The engine, with a deck of its own')
    expect(plannedWords({ choice: own, format: 'duel' })).toBe('The engine, with a copy of your deck: it builds no Duel Commander deck of its own')
    expect(plannedWords({ choice: own, format: 'brawl', yours: { state: 'complete', seat: { game: 'brawl', leaders: 0, commander: null } } }))
      .toBe('The engine, with a copy of your deck: it builds a Brawl deck of its own only for a Brawl game, and yours has no commander it can deal')
    expect(plannedWords({ choice: own, format: 'commander' })).toBe('The engine, with a deck of its own')
    // A Commander deck the engine cannot lead is played by the ordinary rules, where a Commander deck of its own is not built.
    expect(plannedWords({ choice: own, format: 'commander', yours: { state: 'complete', seat: { game: 'commander', leaders: 2, commander: null } } }))
      .toBe('The engine, with a copy of your deck: it builds a Commander deck of its own only for a Commander game, and yours has no commander it can deal')
    expect(plannedWords({ choice: theirs, chosen: elves, check: complete })).toBe('The engine, with your deck Elves')
    expect(plannedWords({ choice: theirs, chosen: elves, check: { state: 'short', seat } })).toBe('The engine, with a copy of your deck: it does not know every card in Elves')
    expect(plannedWords({ choice: theirs, chosen: elves, check: { state: 'complete', seat: { ...seat, unloaded: 1 } } })).toBe('The engine, with a copy of your deck: not every card in Elves has loaded')
    expect(plannedWords({ choice: theirs, chosen: elves, check: leaderless })).toBe('The engine, with a copy of your deck: Elves has no commander it can deal')
    // A deck still being asked about is waited for at the sit, so it is said as chosen until the engine answers.
    expect(plannedWords({ choice: theirs, chosen: elves, check: { state: 'asking' } })).toBe('The engine, with your deck Elves')
    expect(plannedWords({ choice: theirs })).toBe('The engine, with a copy of your deck')
    expect(plannedWords()).toBe('The engine, with a copy of your deck')
  })

  it('says the copy while the engine deals where it builds no deck of its own, and a room that names no format as asked', () => {
    expect(dealingWords({ asked: 'own', pool: 'sets', format: 'oathbreaker' })).toBe('The engine, with a copy of your deck: it builds no Oathbreaker deck of its own')
    expect(dealingWords({ asked: 'own', pool: 'sets', format: 'duel' })).toBe('The engine, with a copy of your deck: it builds no Duel Commander deck of its own')
    expect(dealingWords({ asked: 'own', pool: 'sets', format: 'brawl' })).toBe('The engine, with a deck of its own')
    expect(dealingWords({ asked: 'own', pool: 'sets', format: 'standard' })).toBe('The engine, with a deck of its own')
    expect(dealingWords({ asked: 'own', pool: 'format' })).toBe('The engine, with a deck of its own')
    expect(dealingWords({ asked: 'deck', name: 'Elves' })).toBe('The engine, with your deck Elves')
    expect(dealingWords(null)).toBe('The engine, with a copy of your deck')
  })
})

describe('the log\'s line about the engine\'s deck', () => {
  const own = { asked: 'own', played: 'own', cards: 60, colours: ['R', 'G'], format: 'standard', formatName: 'Standard' }

  it('names a deck of its own by its colours and the sets it was built from, and who built it', () => {
    expect(engineDeckLine({ ...own, from: 'sets', sets: [{ code: 'BLB', name: 'Bloomburrow' }, { code: 'DSK', name: 'Duskmourn: House of Horror' }] }))
      .toBe("The engine plays a deck of its own, built by Argentum's deck builder: red-green, from Bloomburrow and Duskmourn: House of Horror.")
    expect(engineDeckLine({ ...own, from: 'format' }))
      .toBe("The engine plays a deck of its own, built by Argentum's deck builder: red-green, from the whole of Standard.")
  })

  it('says a set it has not got by the name the player\'s deck knows it by', () => {
    const line = engineDeckLine({ ...own, from: 'sets', sets: [{ code: 'BLB', name: 'Bloomburrow' }], missingSets: ['sld'] }, { sets: [{ code: 'sld', name: 'Secret Lair Drop' }] })
    expect(line).toMatch(/It has no cards from Secret Lair Drop, so did not draw on it\.$/)
  })

  it('says every fallback, and why', () => {
    expect(engineDeckLine({ ...own, from: 'format', fellBack: 'sets' }))
      .toBe('The engine has none of the sets your deck uses, so it built its deck from the whole of Standard instead: red-green.')
    expect(engineDeckLine({ ...own, from: 'format', fellBack: 'thin' }))
      .toBe('The sets your deck uses hold too few Standard cards to build a deck from, so the engine built one from the whole of Standard instead: red-green.')
    expect(engineDeckLine({ ...own, from: 'format', fellBack: 'failed' }))
      .toBe('The engine could not build a deck from the sets your deck uses, so it built one from the whole of Standard instead: red-green.')
    expect(engineDeckLine({ asked: 'own', played: 'mirror', format: 'brawl', fellBack: 'format' }))
      .toBe('The engine builds no Brawl deck of its own, so it plays a copy of yours.')
    expect(engineDeckLine({ asked: 'own', played: 'mirror', format: 'pauper', fellBack: 'thin' }))
      .toBe('The engine could not build a Pauper deck of its own, so it plays a copy of yours.')
    expect(engineDeckLine({ asked: 'own', played: 'mirror', format: 'oathbreaker', fellBack: 'failed' }))
      .toBe('The engine could not build an Oathbreaker deck of its own, so it plays a copy of yours.')
    expect(engineDeckLine({ asked: 'own', played: 'mirror', fellBack: 'engine' }))
      .toBe("This relay's engine is older than decks of its own, so it plays a copy of yours.")
  })

  it('says why a Commander deck of its own was not built: the game dealt by the ordinary rules, or an engine that builds none', () => {
    const report = { asked: 'own', played: 'mirror', format: 'commander', fellBack: 'format', why: 'A "commander" deck of its own is built only for a Commander game.' }
    // Since protocol 8: a Commander deck with no commander the engine can deal is played by the ordinary rules.
    expect(engineDeckLine(report, { game: { asked: 'commander', played: 'standard', fellBack: 'commander' } }))
      .toBe('The engine builds a Commander deck of its own only for a Commander game, and this one is played by the ordinary rules, so it plays a copy of yours.')
    // An engine older than 8 builds none at all, which the room says, as a room older than Commander does by saying nothing.
    const older = 'The engine builds no Commander deck of its own, so it plays a copy of yours.'
    expect(engineDeckLine(report, { game: { asked: 'commander', played: 'standard', fellBack: 'engine' } })).toBe(older)
    expect(engineDeckLine(report)).toBe(older)
    expect(engineDeckLine(report, { game: 'commander' })).toBe(older)
  })

  it('says why a Brawl deck of its own was not built: a Brawl game not dealt, for whatever reason the room gives, or an engine older than Brawl (§3 item 20)', () => {
    const report = { asked: 'own', played: 'mirror', format: 'brawl', fellBack: 'format', why: 'A "brawl" deck of its own is built only for a Brawl game.' }
    const only = 'The engine builds a Brawl deck of its own only for a Brawl game, and this one is played by the ordinary rules, so it plays a copy of yours.'
    for (const fellBack of ['commander', 'players', 'games']) expect(engineDeckLine(report, { game: { asked: 'brawl', played: 'standard', fellBack } })).toBe(only)
    expect(engineDeckLine(report, { game: { asked: 'brawl', played: 'standard', fellBack: 'engine' } })).toBe('The engine builds no Brawl deck of its own, so it plays a copy of yours.')
    // At a Duel Commander table, which it builds none for, it says so by the engine's word.
    expect(engineDeckLine({ asked: 'own', played: 'mirror', format: 'duel', fellBack: 'format' }, { game: { asked: 'duel', played: 'duel' } })).toBe('The engine builds no Duel Commander deck of its own, so it plays a copy of yours.')
    // Another of the person's decks with no commander, in the words of the game dealt.
    expect(engineDeckLine({ asked: 'deck', played: 'mirror', name: 'Leaderless', fellBack: 'commander' }, { game: { asked: 'brawl', played: 'brawl' } })).toBe('Leaderless came with no commander to lead it in a Brawl game, so the engine plays a copy of yours.')
  })

  it('names a format the app does not know by the engine\'s word for it', () => {
    expect(engineDeckLine({ ...own, format: 'premodern', formatName: 'Premodern', from: 'format' })).toMatch(/the whole of Premodern\.$/)
  })

  it('says a copy and another deck plainly', () => {
    expect(engineDeckLine({ asked: 'mirror', played: 'mirror' })).toBe('The engine plays a copy of your deck.')
    expect(engineDeckLine({ asked: 'deck', played: 'deck', name: 'Elves' })).toBe('The engine plays your deck Elves.')
    expect(engineDeckLine({ asked: 'own', played: null })).toBe('The engine did not say which deck it plays.')
  })

  it('says a relay older than the choice was asked in vain, and says nothing where only the copy was asked', () => {
    expect(engineDeckLine(undefined, { asked: 'own' })).toBe("This relay is older than the choice of the engine's deck, so the engine plays a copy of yours.")
    expect(engineDeckLine(undefined, { asked: 'mirror' })).toBeNull()
    expect(engineDeckLine(null)).toBeNull()
  })
})

describe('why a deck chosen for the engine was not sent', () => {
  it('says each reason', () => {
    expect(insteadLine('none')).toBe('No deck was chosen for the engine in this format, so it plays a copy of yours.')
    expect(insteadLine('short', 'Elves')).toBe('The engine does not know every card in Elves, so it plays a copy of yours.')
    expect(insteadLine('unloaded', 'Elves')).toBe('Not every card in Elves had loaded, so the engine plays a copy of yours.')
    expect(insteadLine('missing')).toBe("The deck chosen for the engine was not sent from this device's lobby, so it plays a copy of yours.")
    expect(insteadLine(undefined)).toBeNull()
  })
})
