import { describe, it, expect } from 'vitest'
import { FORMATS, cardLegality, legalityStatus, poolQuery } from '../src/lib/formats.js'
import {
  createDeck, addCard, setCommanders, validateDeck, notOutCount, deckVerdict, NOT_OUT_CODES,
} from '../src/lib/deck.js'
import { card, legalEverywhere, FOREST, COMMANDER_BEAR } from './fixtures.js'
// What Scryfall sent on 2026-09-21 (see tests/browser/unreleased.spec.mjs).
import CAPTURED from './fixtures/scryfall-unreleased.json'

const captured = (set, number) => CAPTURED.cards.find((c) => c.set === set && c.collector_number === number)

/**
 * Legality for cards Scryfall lists ahead of their release.
 *
 * The cards are shaped as Scryfall sent Reality Fracture on 2026-09-21: a new
 * card not_legal everywhere with Future Standard legal, a Commander-product
 * card not_legal in Future Standard too, a reprint legal throughout. Every
 * check is given its day, the day before the set is out or the day it is,
 * so the suite reads the same once the set is released and for years after.
 */

const BEFORE = '2026-09-21'
const RELEASE = '2026-10-02'

const notLegalAnywhere = Object.fromEntries(
  Object.values(FORMATS).map((f) => [f.legalityKey, 'not_legal']),
)

// A new Reality Fracture card, as previewed: nothing is legal yet, but
// Scryfall's Future Standard already lists it.
const FRA_NEW = card({
  id: 'fra-new', name: 'Fractured Scholar', set: 'fra', released_at: RELEASE,
  legalities: { ...notLegalAnywhere, future: 'legal' },
})
// A card from the Commander decks released alongside it: never Standard-legal,
// and Future Standard says so.
const FRC_NEW = card({
  id: 'frc-new', name: 'Rift Commander', set: 'frc', released_at: RELEASE,
  legalities: { ...notLegalAnywhere, future: 'not_legal' },
})
// Legality belongs to the card, so a reprint in the new set is legal already.
const FRA_REPRINT = legalEverywhere({
  id: 'fra-unsummon', name: 'Unsummon', set: 'fra', released_at: RELEASE,
  legalities: { ...legalEverywhere().legalities, future: 'legal' },
})
const BANNED = legalEverywhere({
  id: 'banned', name: 'Banned Card', released_at: '2025-11-14',
  legalities: { ...legalEverywhere().legalities, standard: 'banned', future: 'banned' },
})

const lookup = new Map([FOREST, COMMANDER_BEAR, FRA_NEW, FRC_NEW, FRA_REPRINT, BANNED].map((c) => [c.id, c]))
const warningsOf = (r) => r.violations.filter((v) => v.severity === 'warning')
const errorCodes = (r) => r.violations.filter((v) => v.severity === 'error').map((v) => v.code)

function standardDeck(extra, copies = 4) {
  let deck = createDeck({ formatId: 'standard' })
  deck = addCard(deck, FOREST.id, 60 - copies)
  return addCard(deck, extra.id, copies)
}

function commanderDeckWith(extra) {
  let deck = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
  deck = addCard(deck, FOREST.id, 98)
  return addCard(deck, extra.id, 1)
}

describe('legalityStatus', () => {
  it("reads a new card in Standard from Scryfall's Future Standard until it is out", () => {
    expect(legalityStatus(FRA_NEW, FORMATS.standard, BEFORE)).toBe('future_legal')
    expect(legalityStatus(FRC_NEW, FORMATS.standard, BEFORE)).toBe('not_legal')
  })

  it('leaves every other format to Scryfall at release, whatever the card', () => {
    for (const id of ['commander', 'pioneer', 'modern', 'pauper', 'brawl']) {
      expect(legalityStatus(FRA_NEW, FORMATS[id], BEFORE)).toBe('pending')
      expect(legalityStatus(FRC_NEW, FORMATS[id], BEFORE)).toBe('pending')
    }
  })

  it("is Scryfall's word again from release day, even on a record from before it", () => {
    // A card saved before release still says not_legal until it is fetched
    // again; that is Scryfall's word and it stands.
    expect(legalityStatus(FRA_NEW, FORMATS.standard, RELEASE)).toBe('not_legal')
    expect(legalityStatus(FRA_NEW, FORMATS.commander, RELEASE)).toBe('not_legal')
    expect(legalityStatus({ ...FRA_NEW, legalities: { ...FRA_NEW.legalities, standard: 'legal' } }, FORMATS.standard, RELEASE)).toBe('legal')
  })

  it('passes legal, banned and unknown straight through, out or not', () => {
    for (const now of [BEFORE, RELEASE]) {
      expect(legalityStatus(FRA_REPRINT, FORMATS.standard, now)).toBe('legal')
      expect(legalityStatus(FRA_REPRINT, FORMATS.commander, now)).toBe('legal')
      expect(legalityStatus(BANNED, FORMATS.standard, now)).toBe('banned')
    }
    const bannedBeforeRelease = { ...FRA_NEW, legalities: { ...FRA_NEW.legalities, standard: 'banned' } }
    expect(legalityStatus(bannedBeforeRelease, FORMATS.standard, BEFORE)).toBe('banned')
    expect(legalityStatus({ ...FRA_NEW, legalities: {} }, FORMATS.standard, BEFORE)).toBe('unknown')
  })

  it('does not promise Standard when Future Standard is missing, as on an older record', () => {
    const { future, ...rest } = FRA_NEW.legalities
    expect(future).toBe('legal')
    expect(legalityStatus({ ...FRA_NEW, legalities: rest }, FORMATS.standard, BEFORE)).toBe('pending')
  })

  it('treats a card with no readable release date as out', () => {
    const { released_at, ...undated } = FRA_NEW
    expect(released_at).toBe(RELEASE)
    expect(legalityStatus(undated, FORMATS.standard, BEFORE)).toBe('not_legal')
    expect(legalityStatus({ ...FRA_NEW, released_at: 'soon' }, FORMATS.commander, BEFORE)).toBe('not_legal')
  })

  it('leaves cardLegality as the raw reading', () => {
    expect(cardLegality(FRA_NEW, FORMATS.standard)).toBe('not_legal')
    expect(cardLegality(FRA_NEW, FORMATS.commander)).toBe('not_legal')
  })
})

describe('a reprint that is not out yet', () => {
  // The Marvel Super Heroes Commander Lightning Bolt, as Scryfall sent it:
  // a reprint, out on 26 Jun 2026, not_legal in Pioneer. Judged the week
  // before, it is a card that already exists, and not_legal is Scryfall's
  // answer for it, not a ruling to come.
  const MSC_BOLT = captured('msc', '806')
  const WEEK_BEFORE = '2026-06-20'
  const pioneerDeck = () => addCard(addCard(createDeck({ formatId: 'pioneer' }), FOREST.id, 56), MSC_BOLT.id, 4)
  const withBolt = new Map([[FOREST.id, FOREST], [MSC_BOLT.id, MSC_BOLT]])

  it('is the captured card it claims to be', () => {
    expect(MSC_BOLT).toMatchObject({ name: 'Lightning Bolt', reprint: true, released_at: '2026-06-26' })
    expect(MSC_BOLT.legalities.pioneer).toBe('not_legal')
  })

  it("keeps Scryfall's not_legal outside Standard", () => {
    expect(legalityStatus(MSC_BOLT, FORMATS.pioneer, WEEK_BEFORE)).toBe('not_legal')
    const deck = pioneerDeck()
    const result = validateDeck(deck, withBolt, { now: WEEK_BEFORE })
    expect(errorCodes(result)).toEqual(['not_legal'])
    expect(warningsOf(result).map((w) => w.code)).toEqual([])
    expect(deckVerdict(deck, result, withBolt, { now: WEEK_BEFORE })).toEqual({ tone: 'error', text: '1 problem' })
  })

  it("still reads Standard from Scryfall's Future Standard", () => {
    const reprint = { ...FRA_NEW, id: 'fra-reprint', reprint: true }
    expect(legalityStatus(reprint, FORMATS.standard, BEFORE)).toBe('future_legal')
  })

  it('leaves a new card, and a record that does not say, pending', () => {
    const fresh = { ...FRA_NEW, reprint: false }
    expect(legalityStatus(fresh, FORMATS.pioneer, BEFORE)).toBe('pending')
    expect('reprint' in FRA_NEW).toBe(false)
    expect(legalityStatus(FRA_NEW, FORMATS.pioneer, BEFORE)).toBe('pending')
  })
})

describe('poolQuery', () => {
  it("takes in Future Standard for Standard only", () => {
    expect(poolQuery(FORMATS.standard)).toBe('(legal:standard or legal:future)')
    expect(poolQuery(FORMATS.commander)).toBe('legal:commander')
    expect(poolQuery(FORMATS.pauper)).toBe('legal:pauper')
  })
})

describe('validateDeck with cards not out yet', () => {
  it('warns about a new card Future Standard lists, and the deck stays legal', () => {
    const result = validateDeck(standardDeck(FRA_NEW), lookup, { now: BEFORE })
    expect(result.legal).toBe(true)
    expect(errorCodes(result)).toEqual([])
    const [warning] = warningsOf(result)
    expect(warning.code).toBe('not_out_yet')
    expect(warning.cardId).toBe(FRA_NEW.id)
    expect(warning.message).toBe(
      "Fractured Scholar is not out until 2 Oct 2026. Scryfall's Future Standard lists it, so it is expected to be Standard-legal once out.",
    )
  })

  it('fails a Commander-product card in Standard, out or not', () => {
    for (const now of [BEFORE, RELEASE]) {
      const result = validateDeck(standardDeck(FRC_NEW), lookup, { now })
      expect(result.legal).toBe(false)
      expect(errorCodes(result)).toEqual(['not_legal'])
    }
  })

  it('warns in Commander that Scryfall settles it at release, and the deck stays legal', () => {
    const result = validateDeck(commanderDeckWith(FRA_NEW), lookup, { now: BEFORE })
    expect(result.legal).toBe(true)
    expect(errorCodes(result)).toEqual([])
    const [warning] = warningsOf(result)
    expect(warning.code).toBe('legality_pending')
    expect(warning.message).toBe(
      'Fractured Scholar is not out until 2 Oct 2026. Scryfall sets its Commander legality when it is released.',
    )
  })

  it('reports a stale not_legal record as an error from release day, as before', () => {
    expect(errorCodes(validateDeck(standardDeck(FRA_NEW), lookup, { now: RELEASE }))).toEqual(['not_legal'])
    expect(errorCodes(validateDeck(commanderDeckWith(FRA_NEW), lookup, { now: RELEASE }))).toEqual(['not_legal'])
  })

  it('leaves reprints and banned cards as they were', () => {
    const reprint = validateDeck(standardDeck(FRA_REPRINT), lookup, { now: BEFORE })
    expect(reprint.violations).toEqual([])
    expect(errorCodes(validateDeck(standardDeck(BANNED), lookup, { now: BEFORE }))).toEqual(['banned'])
  })

  it('uses only the two not-out codes for these warnings', () => {
    expect([...NOT_OUT_CODES].sort()).toEqual(['legality_pending', 'not_out_yet'])
  })
})

describe('the deck verdict', () => {
  const verdictOn = (deck, now) => deckVerdict(deck, validateDeck(deck, lookup, { now }), lookup, { now })

  it('counts copies not out yet instead of saying Legal', () => {
    const deck = standardDeck(FRA_NEW, 4)
    expect(notOutCount(deck, lookup, { now: BEFORE })).toBe(4)
    expect(verdictOn(deck, BEFORE)).toEqual({ tone: 'warn', text: '4 cards not out yet' })
    expect(verdictOn(commanderDeckWith(FRA_NEW), BEFORE)).toEqual({ tone: 'warn', text: '1 card not out yet' })
  })

  it('counts every copy labelled not out, legal or not, so it matches the rows', () => {
    // A reprint Scryfall already calls legal carries no warning, but its
    // printing is not out, and its row says so; the count says so too.
    let deck = addCard(createDeck({ formatId: 'standard' }), FOREST.id, 55)
    deck = addCard(deck, FRA_NEW.id, 4)
    deck = addCard(deck, FRA_REPRINT.id, 1)
    expect(validateDeck(deck, lookup, { now: BEFORE }).violations.map((v) => v.code)).toEqual(['not_out_yet'])
    expect(verdictOn(deck, BEFORE)).toEqual({ tone: 'warn', text: '5 cards not out yet' })

    // In the sideboard and the command zone as much as the main deck.
    const sided = addCard(addCard(createDeck({ formatId: 'standard' }), FOREST.id, 60), FRA_REPRINT.id, 2, 'sideboard')
    expect(notOutCount(sided, lookup, { now: BEFORE })).toBe(2)
    const previewLeader = new Map([...lookup, [COMMANDER_BEAR.id, { ...COMMANDER_BEAR, released_at: RELEASE }]])
    expect(notOutCount(commanderDeckWith(FOREST), previewLeader, { now: BEFORE })).toBe(1)
  })

  it('reads a card that has not loaded, or has no date, as nothing to count', () => {
    const deck = addCard(standardDeck(FRA_NEW, 4), 'not-loaded', 1)
    expect(notOutCount(deck, lookup, { now: BEFORE })).toBe(4)
    expect(notOutCount(deck, {}, { now: BEFORE })).toBe(0)
    expect(notOutCount(deck, undefined, { now: BEFORE })).toBe(0)
  })

  it('says Legal only when nothing is held back, and problems before anything else', () => {
    expect(verdictOn(standardDeck(FRA_REPRINT), BEFORE)).toEqual({ tone: 'warn', text: '4 cards not out yet' })
    expect(verdictOn(standardDeck(FRA_REPRINT), RELEASE)).toEqual({ tone: 'ok', text: 'Legal' })

    let mixed = standardDeck(FRA_NEW, 4)
    mixed = addCard(mixed, FRC_NEW.id, 1)
    expect(verdictOn(mixed, BEFORE)).toEqual({ tone: 'error', text: '1 problem' })

    expect(verdictOn(standardDeck(FRA_NEW), RELEASE)).toEqual({ tone: 'error', text: '1 problem' })
  })
})
