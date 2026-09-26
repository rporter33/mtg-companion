import { describe, it, expect } from 'vitest'
import {
  PLANS, BRACKET_LINE, BRACKET_NAMES, FLOORS, PLAN_LINE, READING_LINE, UNREAD_SENTENCE,
  bracketSentence, floorBadge, floorChip, floorFor, floorWords, planName, planSentence, plansFitting,
  playedEntries, readBracket, readPlan, readableSearches, searchOf, shelfLine,
} from '../src/lib/deck-reading.js'
import { STRATEGIES } from '../src/data/strategies.js'

const card = (name, type_line, over = {}) => ({ id: name, name, type_line, oracle_text: '', game_changer: false, ...over })
const ALARM = card('Raise the Alarm', 'Instant', { oracle_text: 'Create two 1/1 white Soldier creature tokens.' })
const TREASURE = card('Big Score', 'Instant', { oracle_text: 'As an additional cost to cast this spell, discard a card.\nDraw two cards and create two Treasure tokens.' })
const ANGEL = card('Serra Angel', 'Creature — Angel', { oracle_text: 'Flying, vigilance', power: '4', toughness: '4' })
const STAR = card('Tarmogoyf', 'Creature — Lhurgoyf', { oracle_text: "Tarmogoyf's power is equal to the number of card types among cards in all graveyards.", power: '*', toughness: '1+*' })
const CASTLE = card('Castle Ardenvale', 'Land', { oracle_text: '{2}{W}{W}, {T}: Create a 1/1 white Human creature token.' })
const DELVER = card('Delver of Secrets // Insectile Aberration', undefined, {
  type_line: undefined,
  oracle_text: undefined,
  card_faces: [
    { name: 'Delver of Secrets', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of your upkeep, look at the top card of your library.', power: '1', toughness: '1' },
    { name: 'Insectile Aberration', type_line: 'Creature — Human Insect', oracle_text: 'Flying', power: '3', toughness: '2' },
  ],
})
const SOL = card('Sol Ring', 'Artifact', { oracle_text: '{T}: Add {C}{C}.' })
const STUDY = card('Rhystic Study', 'Enchantment', { oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', game_changer: true })
const gc = (name) => card(name, 'Sorcery', { game_changer: true })

const lookupOf = (...cards) => new Map(cards.map((c) => [c.id, c]))
const deckOf = (entries, over = {}) => ({ main: entries.map(([cardId, quantity = 1]) => ({ cardId, quantity })), commanders: [], signatureSpell: null, sideboard: [], ...over })

describe('the vocabulary', () => {
  it('is every plan data/strategies.js names, each once', () => {
    const ids = new Set(Object.values(STRATEGIES).flat().map((p) => p.id))
    expect(PLANS.map((p) => p.id).sort()).toEqual([...ids].sort())
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(PLANS.length)
  })
  it('gives every plan at least one search a card record can answer here', () => {
    for (const plan of PLANS) expect(readableSearches(plan.id).length, plan.id).toBeGreaterThan(0)
  })
  it('names a plan by its own name, and nothing it does not know', () => {
    expect(planName('tokens')).toBe('Tokens')
    expect(planName('tribal')).toBe(null)
  })
})

describe('searchOf', () => {
  it('reads rules text, type line and power, ANDed, a quoted phrase as one term', () => {
    const test = searchOf('o:"create" o:"token"')
    expect(test(ALARM)).toBe(true)
    expect(test(ANGEL)).toBe(false)
    expect(searchOf('t:creature o:flying')(ANGEL)).toBe(true)
    expect(searchOf('t:creature pow>=4')(ANGEL)).toBe(true)
    expect(searchOf('o:"+1/+1 counter"')(card('Hardened Scales', 'Enchantment', { oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.' }))).toBe(true)
  })
  it('ignores case, as Scryfall does', () => {
    expect(searchOf('o:"CREATE" t:INSTANT')(ALARM)).toBe(true)
  })
  it('reads a card of two faces from either face', () => {
    expect(searchOf('t:creature o:flying')(DELVER)).toBe(true)
    expect(searchOf('t:creature pow>=4')(DELVER)).toBe(false)
  })
  it('counts a power it cannot read as a number as no power', () => {
    expect(searchOf('t:creature pow>=4')(STAR)).toBe(false)
  })
  it('cannot run a search holding an oracle tag, or anything else it does not read', () => {
    expect(searchOf('otag:token-generator')).toBe(null)
    expect(searchOf('otag:ramp o:"add {"')).toBe(null)
    expect(searchOf('c:g')).toBe(null)
    expect(searchOf('pow<4')).toBe(null)
    expect(searchOf('')).toBe(null)
    expect(searchOf(undefined)).toBe(null)
  })
})

describe('plansFitting', () => {
  it('fits a card to every plan whose searches it answers', () => {
    expect(plansFitting(ALARM)).toEqual(['tokens'])
    expect(plansFitting(ANGEL)).toEqual(expect.arrayContaining(['flyers', 'big']))
  })
  it('counts a Treasure maker as making tokens, as the plan\'s own search does', () => {
    expect(plansFitting(TREASURE)).toContain('tokens')
  })
  it('leaves lands out, as the first-deck flow\'s searches do', () => {
    expect(plansFitting(CASTLE)).toEqual([])
  })
  it('fits nothing to nothing', () => {
    expect(plansFitting(null)).toEqual([])
    expect(plansFitting(card('Vanilla', 'Creature — Bear', { power: '2' }))).toEqual([])
  })
  // Scryfall's `o:` leaves reminder text out, and only `fo:` reads it in: the plans'
  // own searches, sent to Scryfall by the first-deck flow, find none of these there.
  it('leaves reminder text out, as Scryfall\'s rules-text search does: reach is not flying', () => {
    const spider = card('Giant Spider', 'Creature — Spider', { oracle_text: 'Reach (This creature can block creatures with flying.)', power: '2', toughness: '4' })
    expect(plansFitting(spider)).not.toContain('flyers')
  })
  it('and a Clue made by investigating is neither Tokens nor Draw engine', () => {
    const tracker = card('Tireless Tracker', 'Creature — Human Scout', {
      oracle_text: 'Whenever a land you control enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nWhenever you sacrifice a Clue, put a +1/+1 counter on Tireless Tracker.',
      power: '3', toughness: '2',
    })
    expect(plansFitting(tracker)).toEqual(['counters'])
  })
  it('and an afterlife Spirit is neither Tokens nor Flyers', () => {
    const oligarch = card('Imperious Oligarch', 'Creature — Human Cleric', { oracle_text: 'Vigilance\nAfterlife 1 (When this creature dies, create a 1/1 white and black Spirit creature token with flying.)', power: '2', toughness: '3' })
    expect(plansFitting(oligarch)).toEqual([])
    // A face of a card of two is read the same way.
    const faced = card('Two Faces', undefined, { type_line: undefined, oracle_text: undefined, card_faces: [{ type_line: 'Creature — Spider', oracle_text: 'Reach (This creature can block creatures with flying.)' }, { type_line: 'Instant', oracle_text: 'Draw a card.' }] })
    expect(plansFitting(faced)).not.toContain('flyers')
  })
})

describe('playedEntries', () => {
  it('is the main deck, the commanders and the signature spell, and not the sideboard', () => {
    const entries = playedEntries({ main: [{ cardId: 'a', quantity: 2 }], commanders: ['c'], signatureSpell: 's', sideboard: [{ cardId: 'z', quantity: 1 }] })
    expect(entries).toEqual([{ cardId: 'a', quantity: 2 }, { cardId: 'c', quantity: 1 }, { cardId: 's', quantity: 1 }])
  })
  it('drops what cannot be read, and reads a deck of nothing as nothing', () => {
    expect(playedEntries({ main: [null, { cardId: '' }, { cardId: 'a', quantity: 0 }, { cardId: 'b', quantity: 1.5 }, { cardId: 'c', quantity: 1 }], commanders: 'x' })).toEqual([{ cardId: 'c', quantity: 1 }])
    expect(playedEntries(null)).toEqual([])
    expect(playedEntries({})).toEqual([])
  })
})

describe('readPlan', () => {
  it('reads a deck as the plan the most copies fit', () => {
    const plan = readPlan(deckOf([['Raise the Alarm', 3], ['Serra Angel', 1], ['Castle Ardenvale', 20]]), lookupOf(ALARM, ANGEL, CASTLE))
    expect(plan.top).toEqual(['tokens'])
    expect(plan.most).toBe(3)
    expect(plan.cards).toBe(24)
    expect(plan.counts.flyers).toBe(1)
  })
  it('reads every plan tied at the top, in the vocabulary\'s order', () => {
    const plan = readPlan(deckOf([['Raise the Alarm'], ['Delver of Secrets // Insectile Aberration']]), lookupOf(ALARM, DELVER))
    expect(plan.top).toEqual(PLANS.map((p) => p.id).filter((id) => ['tokens', 'flyers'].includes(id)))
  })
  it('counts a commander and a signature spell as the deck\'s own cards', () => {
    const plan = readPlan(deckOf([['Castle Ardenvale']], { commanders: ['Serra Angel'], signatureSpell: 'Raise the Alarm' }), lookupOf(ALARM, ANGEL, CASTLE))
    expect(plan.counts).toMatchObject({ tokens: 1, flyers: 1, big: 1 })
  })
  it('reads a deck none of whose cards fits any plan as none', () => {
    expect(readPlan(deckOf([['Castle Ardenvale', 2]]), lookupOf(CASTLE))).toEqual({ top: [], counts: {}, cards: 2, most: 0 })
  })
  it('does not read a deck with a card not arrived', () => {
    expect(readPlan(deckOf([['Raise the Alarm'], ['Missing']]), lookupOf(ALARM))).toBe(null)
  })
  it('reads a deck of no cards as what it is, no plan', () => {
    expect(readPlan(deckOf([]), lookupOf(ALARM))).toEqual({ top: [], counts: {}, cards: 0, most: 0 })
    expect(readPlan(null, lookupOf(ALARM))).toEqual({ top: [], counts: {}, cards: 0, most: 0 })
  })
  it('takes a lookup as a function, a Map or an object', () => {
    const deck = deckOf([['Raise the Alarm']])
    for (const lookup of [(id) => (id === ALARM.id ? ALARM : null), lookupOf(ALARM), { [ALARM.id]: ALARM }]) expect(readPlan(deck, lookup).top).toEqual(['tokens'])
  })
})

describe('readBracket', () => {
  it('holds Wizards\' floors: none any bracket, one to three Bracket 3, four or more Bracket 4', () => {
    expect([0, 1, 2, 3, 4, 9].map(floorFor)).toEqual([1, 3, 3, 3, 4, 4])
    expect(FLOORS).toEqual([1, 3, 4])
    expect(BRACKET_NAMES).toEqual({ 1: 'Exhibition', 2: 'Core', 3: 'Upgraded', 4: 'Optimized', 5: 'cEDH' })
  })
  it('counts a deck\'s Game Changers by name, each once, from Scryfall\'s flag', () => {
    const four = [gc('A'), gc('B'), gc('C'), gc('D')]
    expect(readBracket(deckOf([['Sol Ring']]), lookupOf(SOL))).toEqual({ floor: 1, changers: [] })
    expect(readBracket(deckOf([['Sol Ring'], ['Rhystic Study']]), lookupOf(SOL, STUDY))).toEqual({ floor: 3, changers: ['Rhystic Study'] })
    expect(readBracket(deckOf([['A'], ['B'], ['C']]), lookupOf(...four)).floor).toBe(3)
    expect(readBracket(deckOf([['A'], ['B'], ['C'], ['D']]), lookupOf(...four))).toEqual({ floor: 4, changers: ['A', 'B', 'C', 'D'] })
    expect(readBracket(deckOf([['A', 4]]), lookupOf(...four))).toEqual({ floor: 3, changers: ['A'] })
  })
  it('counts the commander: a commander can be a Game Changer', () => {
    expect(readBracket(deckOf([['Sol Ring']], { commanders: ['Rhystic Study'] }), lookupOf(SOL, STUDY)).floor).toBe(3)
  })
  it('does not read a deck with a card not arrived, or a record that does not say either way', () => {
    expect(readBracket(deckOf([['Sol Ring'], ['Missing']]), lookupOf(SOL))).toBe(null)
    const old = { ...SOL, id: 'old' }
    delete old.game_changer
    expect(readBracket(deckOf([['old']]), lookupOf(old))).toBe(null)
    expect(readBracket(deckOf([['old']]), lookupOf({ ...old, game_changer: 'yes' }))).toBe(null)
  })
  it('reads a deck of no cards as holding no Game Changers', () => {
    expect(readBracket(deckOf([]), lookupOf(SOL))).toEqual({ floor: 1, changers: [] })
  })
})

describe('the words', () => {
  it('says a floor as a badge and in words', () => {
    expect(floorBadge(3)).toBe('B3+')
    expect(floorWords(4)).toBe('Bracket 4 or higher')
  })
  it('says what the badge stands for, and that it is this app\'s reading', () => {
    expect(bracketSentence({ floor: 1, changers: [] })).toBe("Bracket 1 or higher, this app's reading: no Game Changers.")
    expect(bracketSentence({ floor: 3, changers: ['Rhystic Study'] })).toBe("Bracket 3 or higher, this app's reading: one Game Changer, Rhystic Study.")
    expect(bracketSentence({ floor: 4, changers: ['A', 'B', 'C', 'D'] })).toBe("Bracket 4 or higher, this app's reading: 4 Game Changers, A, B, C and D.")
  })
  it('says what the plan tag stands for, and that it is this app\'s reading', () => {
    expect(planSentence({ top: ['tokens'], most: 15, cards: 100 })).toBe("Reads as Tokens, this app's reading: 15 of its 100 cards fit.")
    expect(planSentence({ top: ['tokens', 'flyers'], most: 8, cards: 100 })).toBe("Reads as Tokens and Flyers, this app's reading: 8 of its 100 cards fit each.")
    expect(planSentence({ top: [], most: 0, cards: 60 })).toBe("No plan read: none of its 60 cards fits one of this app's plans.")
    expect(planSentence({ top: [], most: 0, cards: 0 })).toBe('No plan read: it has no cards yet.')
  })
  it('says on screen that both are the app\'s reading, and how each is read', () => {
    expect(READING_LINE).toBe("This app's reading of the cards.")
    expect(PLAN_LINE).toMatch(/reminder text left out/)
    expect(BRACKET_LINE).toMatch(/none in Brackets 1 and 2, up to three in Bracket 3, any number in 4 and 5/)
    // The line under a filter says it is the app's reading, so the paragraph behind it does not say so again.
    expect(PLAN_LINE).not.toMatch(/this app's reading/i)
    expect(BRACKET_LINE).not.toMatch(/this app's reading/i)
    expect(UNREAD_SENTENCE).toMatch(/^Not read: not all its cards have arrived/)
  })
  it('names above the shelf only the filters there are: the bracket\'s only where brackets are read', () => {
    expect(shelfLine({ brackets: true })).toBe("Each deck's plan and bracket are this app's reading of its cards, not its builder's word; the Archetype and Bracket filters say how.")
    expect(shelfLine()).toBe("Each deck's plan is this app's reading of its cards, not its builder's word; the Archetype filter says how.")
    expect(shelfLine({ brackets: false })).not.toMatch(/[Bb]racket/)
  })
  it('names each Bracket chip by the decks it keeps, which are those at that floor alone', () => {
    expect(FLOORS.map(floorChip)).toEqual(['B1+ · no Game Changers', 'B3+ · 1–3 Game Changers', 'B4+ · 4 or more Game Changers'])
    expect(FLOORS.map(floorChip).join(' ')).not.toMatch(/or higher/)
  })
})
