import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, getCard } from '../src/lib/cache.js'
import { findReleasedFor, __internals } from '../src/lib/scryfall.js'
import {
  notOutPrintings, notOutSummary, switchPlan, switchLine, joinNote, keptLine, applySwitches, SWITCH_LABEL,
} from '../src/lib/released-switch.js'
import { restoreVersion } from '../src/lib/versions.js'
import { deckToText } from '../src/lib/decklist.js'
import { stampedNames } from '../src/lib/deck.js'
import FIXTURE from './fixtures/scryfall-unreleased.json'

/**
 * Moving a deck off printings that are not out yet.
 *
 * A deck imported before the released-first rule (2026-09-21) can hold the
 * app's old pick for a name, such as Star Trek's Island, due 13 Nov 2026. The
 * editor offers to switch each to the newest paper printing of the same card
 * that is out, by the importer's own rule, and changes nothing until the
 * player says. These are the cards Scryfall sent on 2026-09-21
 * (tests/fixtures/scryfall-unreleased.json), and every check is given its
 * day, so the file reads the same after Star Trek is out. The one made-up
 * printing is named as made up.
 */

const NOW = '2026-09-24'
const print = (set, number) => FIXTURE.cards.find((c) => c.set === set && c.collector_number === number)

// Star Trek's Island is out on 13 Nov 2026 and The Hobbit's was on 14 Aug.
// Every printing of Darklight Phoenix is Reality Fracture's, out on 2 Oct.
const TRK_ISLAND = print('trk', '319')
const HOB_ISLAND = print('hob', '195')
const HOB_MOUNTAIN = print('hob', '197')
const MSC_BOLT = print('msc', '806')
const PHOENIX = print('fra', '53')
// A second printing not out yet, so a plan can hold two switches.
const MADE_UP_MOUNTAIN = {
  ...HOB_MOUNTAIN, id: 'made-up-mountain', set: 'zzz', set_name: 'A made-up set',
  collector_number: '1', released_at: '2026-11-13',
}
const PRINTINGS = [...FIXTURE.cards, MADE_UP_MOUNTAIN]

const deckOf = (over = {}) => ({
  id: 'imported', name: 'Imported before', formatId: 'standard', commanders: [], signatureSpell: null,
  main: [], sideboard: [], categoryOrder: [], versions: [],
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...over,
})
const lookupOf = (...cards) => {
  const byId = new Map(cards.map((c) => [c.id, c]))
  return (id) => byId.get(id)
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status, payload = {}) => ({ ok: false, status, json: async () => ({ object: 'error', status, ...payload }) })

/**
 * Scryfall's released-printing search, as of `now`: for each oracle id asked,
 * the newest printing out on paper by that day, and a 404 when none is, as
 * Scryfall answers. `answer` overrides it; `asked` records each search.
 */
function scryfall({ now = NOW, asked = [], answer } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (address) => {
    const url = new URL(address)
    if (url.pathname !== '/cards/search') throw new Error(`unexpected request ${address}`)
    const q = url.searchParams.get('q')
    asked.push({ q, unique: url.searchParams.get('unique') })
    if (answer) return answer(q)
    const ids = [...q.matchAll(/oracleid:([\w-]+)/g)].map((m) => m[1])
    const data = ids.map((id) => PRINTINGS
      .filter((c) => c.oracle_id === id && c.released_at <= now && c.games.includes('paper') && !c.digital)
      .sort((a, b) => b.released_at.localeCompare(a.released_at))[0]).filter(Boolean)
    return data.length ? ok({ object: 'list', total_cards: data.length, has_more: false, data })
      : fail(404, { code: 'not_found', details: 'Your query didn’t match any cards.' })
  }))
  return asked
}

beforeEach(async () => {
  await clearCache()
  vi.stubGlobal('navigator', { onLine: true })
  __internals.setBackoffBase(1)
  __internals.setLockoutMs(1)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the printings the offer counts', () => {
  const deck = deckOf({
    main: [{ cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: HOB_MOUNTAIN.id, quantity: 34 }, { cardId: PHOENIX.id, quantity: 4 }],
    sideboard: [{ cardId: TRK_ISLAND.id, quantity: 2 }, { cardId: 'never-loaded', quantity: 1 }],
  })
  const lookup = lookupOf(TRK_ISLAND, HOB_MOUNTAIN, PHOENIX)

  it('is each printing not out by the day given, once, whatever zones it sits in', () => {
    const held = notOutPrintings(deck, lookup, NOW)
    expect(held.map((h) => [h.cardId, h.date])).toEqual([
      [TRK_ISLAND.id, '2026-11-13'],
      [PHOENIX.id, '2026-10-02'],
    ])
  })

  it('leaves out a card that has not loaded, whose date nobody knows, and a card that is out', () => {
    const ids = notOutPrintings(deck, lookup, NOW).map((h) => h.cardId)
    expect(ids).not.toContain('never-loaded')
    expect(ids).not.toContain(HOB_MOUNTAIN.id)
  })

  it('reaches the command zone and the signature spell', () => {
    const oathbreaker = deckOf({ formatId: 'oathbreaker', commanders: [TRK_ISLAND.id], signatureSpell: PHOENIX.id })
    expect(notOutPrintings(oathbreaker, lookup, NOW).map((h) => h.cardId)).toEqual([TRK_ISLAND.id, PHOENIX.id])
  })

  it('counts nothing once each is out, so the offer goes on release day by itself', () => {
    expect(notOutPrintings(deck, lookup, '2026-10-02').map((h) => h.cardId)).toEqual([TRK_ISLAND.id])
    expect(notOutPrintings(deck, lookup, '2026-11-13')).toEqual([])
  })

  it('counts a printing the player typed like any other: the deck does not say who chose it', () => {
    // An entry imported from "1 Island (TRK) 319" is the same id with the same
    // shape as the app's own old pick, and is offered the same way.
    const typed = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 1, name: 'Island' }] })
    expect(notOutPrintings(typed, lookup, NOW)).toHaveLength(1)
  })

  it('reads forgivingly: no deck or no lookup is nothing to offer', () => {
    expect(notOutPrintings(null, lookup, NOW)).toEqual([])
    expect(notOutPrintings(deck, null, NOW)).toEqual([])
  })
})

describe('what the notice says', () => {
  const on = (date, n = 1) => Array.from({ length: n }, () => ({ date }))

  it('gives the number of printings and the day, when they share one', () => {
    expect(notOutSummary(on('2026-11-13', 2))).toBe('2 printings in this deck are not out until 13 Nov 2026.')
    expect(notOutSummary(on('2026-11-13'))).toBe('1 printing in this deck is not out until 13 Nov 2026.')
  })

  it('gives each day, earliest first, when they do not', () => {
    expect(notOutSummary([...on('2026-11-13', 2), ...on('2026-10-02')]))
      .toBe('3 printings in this deck are not out yet: 1 until 2 Oct 2026 and 2 until 13 Nov 2026.')
  })

  it('says nothing when there is nothing', () => {
    expect(notOutSummary([])).toBe('')
    expect(notOutSummary(undefined)).toBe('')
  })
})

describe('asking Scryfall, by the importer’s rule', () => {
  it('asks for those cards only, by oracle id, in one search, and answers each', async () => {
    const asked = scryfall()
    const answers = await findReleasedFor([TRK_ISLAND, PHOENIX], { now: NOW })
    expect(asked).toEqual([{
      q: `(oracleid:${TRK_ISLAND.oracle_id} or oracleid:${PHOENIX.oracle_id}) date<=now game:paper lang:en prefer:newest`,
      unique: 'cards',
    }])
    expect(answers.map((a) => [a.card.id, a.answer, a.released?.id ?? null])).toEqual([
      [TRK_ISLAND.id, 'released', HOB_ISLAND.id],
      [PHOENIX.id, 'none', null],
    ])
  })

  it('caches and pins the printing found, as an import does, since it is about to be offered', async () => {
    scryfall()
    await findReleasedFor([TRK_ISLAND], { now: NOW })
    expect((await getCard(HOB_ISLAND.id)).pinned).toBe(true)
  })

  it('asks nothing about a printing that is out on paper', async () => {
    const asked = scryfall()
    const answers = await findReleasedFor([MSC_BOLT, HOB_ISLAND], { now: NOW })
    expect(asked).toEqual([])
    expect(answers.map((a) => a.answer)).toEqual(['out', 'out'])
  })

  it('says a failed search is unchecked, never that no printing is out, and sends nothing after it', async () => {
    const asked = scryfall({ answer: () => fail(503) })
    const answers = await findReleasedFor([TRK_ISLAND, PHOENIX], { now: NOW })
    expect(answers.map((a) => a.answer)).toEqual(['unchecked', 'unchecked'])
    expect(answers.every((a) => a.released === null)).toBe(true)
    // One search, retried by request() and no more.
    expect(new Set(asked.map((a) => a.q)).size).toBe(1)
  }, 15000)

  it('answers the cards a first search reached when a later one fails, and calls only the rest unchecked', async () => {
    // Sixteen made-up cards not out, so two searches: fifteen, then one.
    const many = Array.from({ length: 16 }, (_, i) => ({
      ...PHOENIX, id: `made-up-${i}`, oracle_id: `made-up-oracle-${i}`, name: `Made-up card ${i}`,
    }))
    const asked = []
    // The first search is answered (nothing matching, a 404), the second refused.
    scryfall({ asked, answer: () => (new Set(asked.map((a) => a.q)).size === 1 ? fail(404, { code: 'not_found' }) : fail(503)) })
    const answers = await findReleasedFor(many, { now: NOW })
    expect(new Set(asked.map((a) => a.q)).size).toBe(2)
    expect(answers.map((a) => a.answer)).toEqual([...Array(15).fill('none'), 'unchecked'])

    const deck = deckOf({ main: many.map((c) => ({ cardId: c.id, quantity: 1 })) })
    const plan = switchPlan(deck, notOutPrintings(deck, lookupOf(...many), NOW), answers)
    expect(plan.switches).toEqual([])
    expect(plan.kept.filter((k) => k.answer === 'unchecked').map((k) => k.cardId)).toEqual(['made-up-15'])
    expect(keptLine(plan.kept.at(-1))).toBe('Made-up card 15 stays as Reality Fracture #53: Scryfall could not be asked about it just now.')
  }, 15000)

  it('says Scryfall is ahead when its search counts the printing as out and the app’s day does not', async () => {
    // On a release day Scryfall's clock can be hours ahead of the app's.
    scryfall({ answer: () => ok({ object: 'list', data: [TRK_ISLAND] }) })
    const [answer] = await findReleasedFor([TRK_ISLAND], { now: NOW })
    expect(answer).toMatchObject({ answer: 'ahead', released: null })
  })

  it('does not ask about a record with no oracle id, and says so', async () => {
    const asked = scryfall()
    const [answer] = await findReleasedFor([{ ...TRK_ISLAND, oracle_id: undefined }], { now: NOW })
    expect(asked).toEqual([])
    expect(answer.answer).toBe('unasked')
  })

  it('stops when the deck is closed', async () => {
    scryfall()
    const controller = new AbortController()
    controller.abort()
    await expect(findReleasedFor([TRK_ISLAND], { now: NOW, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the plan', () => {
  const deck = deckOf({
    main: [
      { cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: MADE_UP_MOUNTAIN.id, quantity: 4 },
      { cardId: HOB_MOUNTAIN.id, quantity: 30 }, { cardId: PHOENIX.id, quantity: 4 },
    ],
  })
  const held = notOutPrintings(deck, lookupOf(TRK_ISLAND, MADE_UP_MOUNTAIN, HOB_MOUNTAIN, PHOENIX), NOW)
  const answers = [
    { card: TRK_ISLAND, released: HOB_ISLAND, answer: 'released' },
    { card: MADE_UP_MOUNTAIN, released: HOB_MOUNTAIN, answer: 'released' },
    { card: PHOENIX, released: null, answer: 'none' },
  ]

  it('lists each switch it would make and names the card with nothing to switch to, writing nothing', () => {
    const before = JSON.stringify(deck)
    const plan = switchPlan(deck, held, answers)
    expect(plan.switches.map(switchLine)).toEqual([
      'Island: Star Trek #319 → The Hobbit #195',
      'Mountain: A made-up set #1 → The Hobbit #197',
    ])
    expect(plan.kept.map(keptLine)).toEqual([
      'Darklight Phoenix stays as Reality Fracture #53: Scryfall lists no paper printing of it that is out yet.',
    ])
    expect(JSON.stringify(deck)).toBe(before)
  })

  it('marks a switch whose rows join the rows of the printing switched to, in the zone where they meet', () => {
    const plan = switchPlan(deck, held, answers)
    expect(plan.switches.map((s) => s.joins)).toEqual([[], [{ zone: 'main', already: true }]])
    expect(plan.switches.map((s) => joinNote(s.joins))).toEqual(['', 'joins the copies already in the main deck'])
  })

  it('marks no join across zones, since rows merge only within the main deck and within the sideboard', () => {
    // A printing the deck holds only in the sideboard is not joined by a main
    // deck row switched to it: the switch leaves two rows, one in each zone.
    const apart = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 20 }], sideboard: [{ cardId: HOB_ISLAND.id, quantity: 2 }] })
    const plan = switchPlan(apart, [{ cardId: TRK_ISLAND.id, card: TRK_ISLAND }], [{ answer: 'released', released: HOB_ISLAND }])
    expect(plan.switches[0].joins).toEqual([])
    const next = applySwitches(apart, plan.switches, { at: '2026-09-24T10:00:00.000Z' })
    expect([next.main, next.sideboard].map((zone) => zone.map((e) => [e.cardId, e.quantity])))
      .toEqual([[[HOB_ISLAND.id, 20]], [[HOB_ISLAND.id, 2]]])

    // Nor does a second switch to the same printing join the first when the
    // two are in different zones.
    const twice = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 1 }], sideboard: [{ cardId: 'trk-other', quantity: 1 }] })
    const both = switchPlan(twice, [{ cardId: TRK_ISLAND.id, card: TRK_ISLAND }, { cardId: 'trk-other', card: TRK_ISLAND }],
      [{ answer: 'released', released: HOB_ISLAND }, { answer: 'released', released: HOB_ISLAND }])
    expect(both.switches.map((s) => s.joins)).toEqual([[], []])
  })

  it('says when an earlier switch in the plan brings in the copies a later one joins', () => {
    const same = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 1 }, { cardId: 'trk-other', quantity: 1 }] })
    const both = switchPlan(same, [{ cardId: TRK_ISLAND.id, card: TRK_ISLAND }, { cardId: 'trk-other', card: TRK_ISLAND }],
      [{ answer: 'released', released: HOB_ISLAND }, { answer: 'released', released: HOB_ISLAND }])
    expect(both.switches.map((s) => s.joins)).toEqual([[], [{ zone: 'main', already: false }]])
    expect(joinNote(both.switches[1].joins)).toBe('joins the copies another switch brings into the main deck')
    const next = applySwitches(same, both.switches, { at: '2026-09-24T10:00:00.000Z' })
    expect(next.main.map((e) => [e.cardId, e.quantity])).toEqual([[HOB_ISLAND.id, 2]])
  })

  it('names both zones when a printing held in each joins copies in each', () => {
    const everywhere = deckOf({
      main: [{ cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: HOB_ISLAND.id, quantity: 2 }],
      sideboard: [{ cardId: TRK_ISLAND.id, quantity: 1 }, { cardId: HOB_ISLAND.id, quantity: 1 }],
    })
    const plan = switchPlan(everywhere, [{ cardId: TRK_ISLAND.id, card: TRK_ISLAND }], [{ answer: 'released', released: HOB_ISLAND }])
    expect(joinNote(plan.switches[0].joins)).toBe('joins the copies already in the main deck and the sideboard')
    expect(joinNote([{ zone: 'main', already: true }, { zone: 'sideboard', already: false }]))
      .toBe('joins the copies already in the main deck and the copies another switch brings into the sideboard')
    // Read forgivingly: nothing that is not a join says anything.
    expect(joinNote(undefined)).toBe('')
    expect(joinNote([{ zone: 'commanders', already: true }, null, { zone: 'constructor', already: true }])).toBe('')
  })

  it('leaves out a printing that is out after all, or is itself the answer', () => {
    const plan = switchPlan(deck, held, [
      { answer: 'out' }, { answer: 'released', released: MADE_UP_MOUNTAIN }, { answer: 'none' },
    ])
    expect(plan.switches).toEqual([])
    expect(plan.kept.map((k) => k.cardId)).toEqual([PHOENIX.id])
  })

  it('calls a missing or unknown answer unchecked, which claims no more than that nobody said', () => {
    const plan = switchPlan(deck, held, [{ answer: 'maybe' }])
    expect(plan.kept.map((k) => k.answer)).toEqual(['unchecked', 'unchecked', 'unchecked'])
  })

  it('says why each card stays, in Scryfall’s terms', () => {
    const line = (answer) => keptLine({ card: TRK_ISLAND, answer })
    expect(line('none')).toBe('Island stays as Star Trek #319: Scryfall lists no paper printing of it that is out yet.')
    expect(line('ahead')).toBe('Island stays as Star Trek #319: Scryfall already counts a printing of it as out, though its release day has not begun here.')
    expect(line('unchecked')).toBe('Island stays as Star Trek #319: Scryfall could not be asked about it just now.')
    expect(line('unasked')).toBe("Island stays as Star Trek #319: Scryfall's record of it gives nothing to search by.")
  })
})

describe('switching, on the player’s word', () => {
  const AT = '2026-09-24T10:00:00.000Z'
  const switches = [
    { fromId: TRK_ISLAND.id, from: TRK_ISLAND, to: HOB_ISLAND },
    { fromId: MADE_UP_MOUNTAIN.id, from: MADE_UP_MOUNTAIN, to: HOB_MOUNTAIN },
  ]

  it('keeps the deck as it stood in History first, then switches every place the printing sits', () => {
    const deck = deckOf({
      formatId: 'oathbreaker',
      commanders: [MADE_UP_MOUNTAIN.id], signatureSpell: TRK_ISLAND.id, artCardId: TRK_ISLAND.id,
      main: [{ cardId: TRK_ISLAND.id, quantity: 20, category: 'Lands' }, { cardId: PHOENIX.id, quantity: 4 }],
      sideboard: [{ cardId: TRK_ISLAND.id, quantity: 2 }],
      versions: [{ id: 'v_old', at: '2026-09-01T00:00:00Z', label: 'Before import', auto: true, main: [], sideboard: [], commanders: [], signatureSpell: null, categoryOrder: [] }],
    })
    const next = applySwitches(deck, switches, { at: AT })
    expect(next.versions).toHaveLength(2)
    expect(next.versions[0]).toMatchObject({ label: SWITCH_LABEL, auto: true, at: AT, signatureSpell: TRK_ISLAND.id })
    expect(next.versions[0].main.map((e) => e.cardId)).toEqual([TRK_ISLAND.id, PHOENIX.id])
    expect(next.main).toEqual([
      { cardId: HOB_ISLAND.id, quantity: 20, category: 'Lands', name: 'Island' },
      { cardId: PHOENIX.id, quantity: 4 },
    ])
    expect(next.sideboard).toEqual([{ cardId: HOB_ISLAND.id, quantity: 2, name: 'Island' }])
    expect(next.commanders).toEqual([HOB_MOUNTAIN.id])
    expect(next.signatureSpell).toBe(HOB_ISLAND.id)
    expect(next.artCardId).toBe(HOB_ISLAND.id)
    // The deck passed in is not touched.
    expect(deck.main[0].cardId).toBe(TRK_ISLAND.id)
  })

  it('joins two rows of one card when the deck already holds the printing switched to', () => {
    const deck = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 1 }, { cardId: HOB_ISLAND.id, quantity: 20 }] })
    const next = applySwitches(deck, switches.slice(0, 1), { at: AT })
    expect(next.main.map((e) => [e.cardId, e.quantity])).toEqual([[HOB_ISLAND.id, 21]])
  })

  it('moves a stamped name with its id, and names a printing a deck never stamped from the card in hand', () => {
    // Imported before names were stamped: the only record of a name is the
    // snapshot, under the old id.
    const deck = deckOf({
      commanders: [MADE_UP_MOUNTAIN.id], cardNames: { [MADE_UP_MOUNTAIN.id]: 'Mountain' },
      main: [{ cardId: TRK_ISLAND.id, quantity: 20 }],
      snapshot: { version: 1, formatId: 'standard', capturedAt: '2026-09-01T00:00:00Z', cards: { [TRK_ISLAND.id]: { name: 'Island', status: 'legal' } } },
    })
    const next = applySwitches(deck, switches, { at: AT })
    const names = stampedNames(next)
    expect(names.get(HOB_ISLAND.id)).toBe('Island')
    expect(names.get(HOB_MOUNTAIN.id)).toBe('Mountain')
    expect(next.main[0].name).toBe('Island')
  })

  it('exports the printings switched to', () => {
    const deck = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: PHOENIX.id, quantity: 4 }] })
    const next = applySwitches(deck, switches, { at: AT })
    const text = deckToText(next, lookupOf(HOB_ISLAND, PHOENIX))
    expect(text).toMatch(/^20 Island \(HOB\) 195$/m)
    expect(text).toMatch(/^4 Darklight Phoenix \(FRA\) 53$/m)
  })

  it('is one restore away from the deck as it stood', () => {
    const deck = deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: HOB_ISLAND.id, quantity: 2 }] })
    const next = applySwitches(deck, switches, { at: AT })
    const back = restoreVersion(next, next.versions[0].id)
    expect(back.main.map((e) => [e.cardId, e.quantity])).toEqual([[TRK_ISLAND.id, 20], [HOB_ISLAND.id, 2]])
  })

  it('takes no second checkpoint when History’s newest version already holds these lists', () => {
    const lists = { main: [{ cardId: TRK_ISLAND.id, quantity: 20 }], sideboard: [], commanders: [], signatureSpell: null, categoryOrder: [] }
    const deck = deckOf({ ...lists, versions: [{ id: 'v_import', at: AT, label: 'Before import', auto: true, ...lists }] })
    const next = applySwitches(deck, switches, { at: AT })
    expect(next.versions.map((v) => v.id)).toEqual(['v_import'])
    expect(next.main[0].cardId).toBe(HOB_ISLAND.id)
  })

  it('does nothing for a printing the deck no longer holds, and with nothing to do gives the deck back untouched', () => {
    const deck = deckOf({ main: [{ cardId: PHOENIX.id, quantity: 4 }] })
    expect(applySwitches(deck, switches, { at: AT })).toBe(deck)
    expect(applySwitches(deck, [], { at: AT })).toBe(deck)
    const partly = applySwitches(deckOf({ main: [{ cardId: TRK_ISLAND.id, quantity: 1 }] }), switches, { at: AT })
    expect(partly.main.map((e) => e.cardId)).toEqual([HOB_ISLAND.id])
  })
})

describe('the whole offer, from the deck to the switch', () => {
  it('finds, plans and switches a deck imported before the rule, and keeps what has nothing to switch to', async () => {
    const asked = scryfall()
    const deck = deckOf({
      main: [{ cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: HOB_MOUNTAIN.id, quantity: 36 }, { cardId: PHOENIX.id, quantity: 4 }],
    })
    const lookup = lookupOf(TRK_ISLAND, HOB_MOUNTAIN, PHOENIX)
    const held = notOutPrintings(deck, lookup, NOW)
    expect(notOutSummary(held)).toBe('2 printings in this deck are not out yet: 1 until 2 Oct 2026 and 1 until 13 Nov 2026.')
    const plan = switchPlan(deck, held, await findReleasedFor(held.map((h) => h.card), { now: NOW }))
    expect(asked).toHaveLength(1)
    expect(asked[0].q).not.toContain(HOB_MOUNTAIN.oracle_id)
    expect(plan.switches.map(switchLine)).toEqual(['Island: Star Trek #319 → The Hobbit #195'])
    expect(plan.kept.map((k) => k.card.name)).toEqual(['Darklight Phoenix'])
    const next = applySwitches(deck, plan.switches, { at: '2026-09-24T10:00:00.000Z' })
    expect(notOutPrintings(next, lookupOf(HOB_ISLAND, HOB_MOUNTAIN, PHOENIX), NOW).map((h) => h.cardId)).toEqual([PHOENIX.id])
  })
})
