import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearCache, getCard } from '../src/lib/cache.js'
import { resolvePrintings, getCardsByNames, __internals } from '../src/lib/scryfall.js'
import { describeChoice } from '../src/lib/printing-choice.js'

/**
 * The printing a name lands on when the app is the one choosing.
 *
 * Scryfall's pick for a bare name is its own choice of printing, previews
 * included: on 2026-09-21 "Island" came back as Star Trek 319, due 13 Nov
 * 2026. These cards are hand-written in the shape Scryfall sends, with
 * made-up oracle ids, and every call is given the day, so the suite reads the
 * same long after the dates in it have passed.
 */

const NOW = '2026-09-21'
const oid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ISLAND_ID = oid(1)
const BOLT_ID = oid(2)

const printing = (over) => ({ object: 'card', digital: false, games: ['paper'], lang: 'en', ...over })
const TRK_ISLAND = printing({
  id: 'trk-319', oracle_id: ISLAND_ID, name: 'Island', set: 'trk', set_name: 'Star Trek',
  collector_number: '319', released_at: '2026-11-13', games: ['paper', 'mtgo', 'arena'],
})
const HOB_ISLAND = printing({
  id: 'hob-195', oracle_id: ISLAND_ID, name: 'Island', set: 'hob', set_name: 'The Hobbit',
  collector_number: '195', released_at: '2026-08-14',
})
const MSC_BOLT = printing({
  id: 'msc-806', oracle_id: BOLT_ID, name: 'Lightning Bolt', set: 'msc',
  set_name: 'Marvel Super Heroes Commander', collector_number: '806', released_at: '2026-06-26',
  games: ['paper', 'mtgo', 'arena'],
})
const PREVIEW_BOLT = printing({
  id: 'fdc-163', oracle_id: BOLT_ID, name: 'Lightning Bolt', set: 'fdc', collector_number: '163', released_at: '2026-10-02',
})
const SLZ_BOLT = printing({
  id: 'slz-305', oracle_id: BOLT_ID, name: 'Lightning Bolt', set: 'slz', collector_number: '305', released_at: '2026-09-02',
})
// A different card whose back face is named Lightning Bolt.
const EMERITUS = printing({
  id: 'psos-113p', oracle_id: oid(3), name: 'Emeritus of Conflict // Lightning Bolt', set: 'psos',
  collector_number: '113p', released_at: '2026-04-01',
})

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status, payload = {}) => ({
  ok: false, status, json: async () => ({ object: 'error', status, ...payload }),
})
const noCards = () => fail(404, { code: 'not_found', details: 'Your query didn’t match any cards.' })

/**
 * A stand-in for Scryfall. `picks` answers a name identifier the way the
 * collection endpoint does (its own pick); `prints` answers a typed printing;
 * `search` answers the released-printing search. `printingsFail` makes every
 * collection request that asks for a typed printing fail with that status.
 */
function scryfall({
  picks = {}, prints = [], search = () => ok({ object: 'list', data: [] }), onCollection, printingsFail,
} = {}) {
  const calls = { collection: [], search: [] }
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    const u = new URL(url)
    if (u.pathname === '/cards/collection') {
      const { identifiers } = JSON.parse(opts.body)
      calls.collection.push(identifiers)
      if (printingsFail && identifiers.some((id) => id.set)) return fail(printingsFail)
      const data = []
      const notFound = []
      for (const id of identifiers) {
        const card = id.collector_number
          ? prints.find((c) => c.set === id.set && c.collector_number === id.collector_number)
          : id.set
            ? prints.find((c) => c.set === id.set && c.name === id.name)
            : picks[id.name]
        if (card) data.push(card)
        else notFound.push(id)
      }
      onCollection?.()
      return ok({ object: 'list', data, not_found: notFound })
    }
    if (u.pathname === '/cards/search') {
      const q = u.searchParams.get('q')
      calls.search.push({ q, unique: u.searchParams.get('unique') })
      return search(q)
    }
    throw new Error(`unexpected request ${url}`)
  }))
  return calls
}

const found = (...cards) => () => ok({ object: 'list', total_cards: cards.length, has_more: false, data: cards })

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

describe('a bare name whose pick is not out gets the newest printing that is out on paper', () => {
  it('passes over a printing that is not out for the newest one that is', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND }, search: found(HOB_ISLAND) })
    const [result] = await resolvePrintings(['Island'], { now: NOW })
    expect(result.card.id).toBe('hob-195')
    expect(result.how).toBe('released')
    expect(result.newest.id).toBe('trk-319')

    expect(calls.search).toHaveLength(1)
    const { q, unique } = calls.search[0]
    expect(q).toBe(`(oracleid:${ISLAND_ID}) date<=now game:paper lang:en prefer:newest`)
    expect(unique).toBe('cards')
    // The printing taken is cached with the deck's cards, as the rest are.
    expect((await getCard('hob-195')).pinned).toBe(true)
  }, 10000)

  it('gives existing callers the same printing through the name-keyed map', async () => {
    scryfall({ picks: { Island: TRK_ISLAND }, search: found(HOB_ISLAND) })
    const cards = await getCardsByNames(['Island'], { now: NOW })
    expect(cards.get('Island').id).toBe('hob-195')
  }, 10000)

  it('keeps a pick that is out, and asks nothing more', async () => {
    const calls = scryfall({ picks: { 'Lightning Bolt': MSC_BOLT } })
    const [result] = await resolvePrintings(['Lightning Bolt'], { now: NOW })
    expect(result.card.id).toBe('msc-806')
    expect(result.how).toBe('newest')
    expect(calls.search).toHaveLength(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops looking past a printing on the day it comes out', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND } })
    const [result] = await resolvePrintings(['Island'], { now: '2026-11-13' })
    expect(result.card.id).toBe('trk-319')
    expect(result.how).toBe('newest')
    expect(calls.search).toHaveLength(0)
  })

  it('passes over a digital-only pick for a paper printing', async () => {
    const digital = printing({ ...HOB_ISLAND, id: 'digital-island', set: 'ydig', digital: true, games: ['arena'], released_at: '2026-09-01' })
    scryfall({ picks: { Island: digital }, search: found(HOB_ISLAND) })
    const [result] = await resolvePrintings(['Island'], { now: NOW })
    expect(result.card.id).toBe('hob-195')
    expect(result.how).toBe('released')
    expect(result.newest.id).toBe('digital-island')
  }, 10000)

  it('takes a result only when it is the same card, not one sharing a face name', async () => {
    scryfall({ picks: { 'Lightning Bolt': PREVIEW_BOLT }, search: found(EMERITUS, SLZ_BOLT) })
    const [result] = await resolvePrintings(['Lightning Bolt'], { now: NOW })
    expect(result.card.id).toBe('slz-305')

    await clearCache()
    scryfall({ picks: { 'Lightning Bolt': PREVIEW_BOLT }, search: found(EMERITUS) })
    const [alone] = await resolvePrintings(['Lightning Bolt'], { now: NOW })
    expect(alone.card.id).toBe('fdc-163')
    expect(alone.how).toBe('unreleased-only')
  }, 10000)

  it('matches a reversible card by the oracle id on its faces', async () => {
    const face = () => ({ oracle_id: oid(7), name: 'Faced Relic' })
    const preview = printing({
      id: 'rev-new', name: 'Faced Relic // Faced Relic', layout: 'reversible_card', set: 'sld',
      collector_number: '900', released_at: '2026-12-01', card_faces: [face(), face()],
    })
    const released = printing({ ...preview, id: 'rev-old', collector_number: '800', released_at: '2025-12-01' })
    const calls = scryfall({ picks: { 'Faced Relic': preview }, search: found(released) })
    const [result] = await resolvePrintings(['Faced Relic'], { now: NOW })
    expect(calls.search[0].q).toContain(`oracleid:${oid(7)}`)
    expect(result.card.id).toBe('rev-old')
    expect(result.how).toBe('released')
  }, 10000)
})

describe('when no released printing can be found', () => {
  const NEW_CARD = printing({
    id: 'fra-12', oracle_id: oid(12), name: 'Academic Ascent', set: 'fra', set_name: 'Reality Fracture',
    collector_number: '12', released_at: '2026-10-02',
  })

  it('keeps the preview and says no printing of it is out, when Scryfall finds none', async () => {
    scryfall({ picks: { 'Academic Ascent': NEW_CARD }, search: noCards })
    const [result] = await resolvePrintings(['Academic Ascent'], { now: NOW })
    expect(result.card.id).toBe('fra-12')
    expect(result.how).toBe('unreleased-only')
    expect(result.unchecked).toBeUndefined()
  }, 10000)

  it('keeps the pick, unclaimed, when the search fails', async () => {
    for (const search of [
      () => fail(400, { details: 'bad query' }),
      () => fail(429),
      () => { throw new TypeError('Failed to fetch') },
    ]) {
      await clearCache()
      scryfall({ picks: { Island: TRK_ISLAND }, search })
      const [result] = await resolvePrintings(['Island'], { now: NOW })
      expect(result.card.id).toBe('trk-319')
      // Not "no printing is out": nobody said so.
      expect(result.how).toBe('newest')
      expect(result.unchecked).toBe(true)
    }
  }, 15000)

  it('keeps the pick when the device goes offline before the search', async () => {
    const calls = scryfall({
      picks: { Island: TRK_ISLAND },
      onCollection: () => vi.stubGlobal('navigator', { onLine: false }),
    })
    const [result] = await resolvePrintings(['Island'], { now: NOW })
    expect(result.card.id).toBe('trk-319')
    expect(result.unchecked).toBe(true)
    expect(calls.search).toHaveLength(0)
  })

  it('sends no more searches after one goes unanswered, and leaves every pick unchecked', async () => {
    // Forty picks are three searches. The first has been through request()'s
    // retries by the time it fails; the other two would meet the same.
    const names = Array.from({ length: 40 }, (_, i) => `Preview ${i}`)
    const picks = Object.fromEntries(names.map((name, i) => [name, printing({
      id: `p-${i}`, oracle_id: oid(200 + i), name, set: 'fra', collector_number: String(i), released_at: '2026-10-02',
    })]))
    for (const [status, attempts] of [[503, __internals.MAX_RETRIES + 1], [429, __internals.MAX_LOCKOUT_RETRIES + 1]]) {
      await clearCache()
      const stages = []
      const calls = scryfall({ picks, search: () => fail(status) })
      const results = await resolvePrintings(names, { now: NOW, onProgress: (done, total, stage) => stages.push([done, total, stage]) })
      expect(calls.search).toHaveLength(attempts)
      expect(results.every((r) => r.unchecked === true && r.how === 'newest')).toBe(true)
      expect(stages.filter(([, , s]) => s === 'released').at(-1)).toEqual([40, 40, 'released'])
    }
  }, 15000)
})

describe('when Scryfall counts a printing as out before the app does', () => {
  // Scryfall reads `date<=now` by its own clock, which can be some hours
  // ahead of the device's on a release day. What it returns then is out by
  // Scryfall's day and not by the app's, and the chip beside it still shows
  // the date, so it is not taken as "the newest one that is out".
  const DAY_BEFORE = '2026-11-12'

  it('keeps the pick, with no note, when the search returns the pick itself', async () => {
    scryfall({ picks: { Island: TRK_ISLAND }, search: found(TRK_ISLAND) })
    const [result] = await resolvePrintings(['Island'], { now: DAY_BEFORE })
    expect(result.card.id).toBe('trk-319')
    expect(result.how).toBe('newest')
    expect(result.newest).toBeUndefined()
    expect(describeChoice(result, DAY_BEFORE).note).toBeNull()

    await clearCache()
    scryfall({ picks: { 'Lightning Bolt': SLZ_BOLT }, search: found(SLZ_BOLT) })
    const [bolt] = await resolvePrintings(['Lightning Bolt'], { now: '2026-09-01' })
    expect(bolt).toMatchObject({ how: 'newest' })
    expect(bolt.card.id).toBe('slz-305')
    expect(bolt.newest).toBeUndefined()
  }, 10000)

  it('keeps the pick when the search returns another printing the app counts as not out', async () => {
    const sameSet = printing({ ...TRK_ISLAND, id: 'trk-320', collector_number: '320' })
    scryfall({ picks: { Island: TRK_ISLAND }, search: found(sameSet) })
    const [result] = await resolvePrintings(['Island'], { now: DAY_BEFORE })
    expect(result.card.id).toBe('trk-319')
    expect(result.how).toBe('newest')
    expect(result.newest).toBeUndefined()
  }, 10000)

  it('leaves a typed printing’s fall-back as the name’s pick, the same way', async () => {
    scryfall({ picks: { Island: TRK_ISLAND }, search: found(TRK_ISLAND) })
    const [result] = await resolvePrintings([{ name: 'Island', set: 'zzz', number: '9' }], { now: DAY_BEFORE })
    expect(result).toMatchObject({ how: 'fallback', byName: 'newest' })
    expect(result.card.id).toBe('trk-319')
    expect(result.newest).toBeUndefined()
  }, 10000)
})

describe('a typed printing Scryfall could not be asked about', () => {
  it('falls back to the name, and says it could not ask, not that Scryfall has none', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND }, prints: [HOB_ISLAND], printingsFail: 503, search: found(HOB_ISLAND) })
    const [result] = await resolvePrintings([{ name: 'Island', set: 'HOB', number: '195' }], { now: NOW })
    // The printing was tried as request() tries anything, then the name once.
    expect(calls.collection).toHaveLength(__internals.MAX_RETRIES + 2)
    expect(calls.collection.at(-1)).toEqual([{ name: 'Island' }])
    expect(result).toMatchObject({ how: 'fallback', byName: 'newest', unasked: true })
    expect(result.card.id).toBe('trk-319')
    // Nobody chose the name's pick over the typed printing, so nothing is
    // searched to replace it.
    expect(calls.search).toHaveLength(0)

    const { line, ...choice } = result
    const { note } = describeChoice({ ...line, ...choice }, NOW)
    expect(note).toBe('Scryfall could not be asked for HOB 195; the app used Star Trek #319 instead.')
    expect(note).not.toMatch(/has no/)
  }, 10000)

  it('is the printing typed when the name’s pick turns out to be it', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND }, printingsFail: 503 })
    const [result] = await resolvePrintings([{ name: 'Island', set: 'trk', number: '319' }], { now: NOW })
    expect(result.how).toBe('exact')
    expect(result.unasked).toBeUndefined()
    expect(result.card.id).toBe('trk-319')
    expect(calls.search).toHaveLength(0)
  }, 10000)
})

describe('the released-printing search', () => {
  it('asks for at most fifteen cards at a time, within Scryfall’s 1000 characters', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `Preview ${i}`)
    const picks = Object.fromEntries(names.map((name, i) => [name, printing({
      id: `p-${i}`, oracle_id: oid(100 + i), name, set: 'fra', collector_number: String(i), released_at: '2026-10-02',
    })]))
    const stages = []
    const calls = scryfall({ picks, search: noCards })
    await resolvePrintings(names, { now: NOW, onProgress: (done, total, stage) => stages.push([done, total, stage]) })

    expect(calls.search).toHaveLength(2)
    const terms = calls.search.map(({ q }) => q.match(/oracleid:/g).length)
    expect(terms).toEqual([15, 5])
    for (const { q } of calls.search) expect(q.length).toBeLessThanOrEqual(1000)
    // Every card is asked about once.
    const asked = calls.search.flatMap(({ q }) => q.match(/oracleid:[\w-]+/g))
    expect(new Set(asked).size).toBe(20)
    expect(stages.filter(([, , s]) => s === 'released').at(-1)).toEqual([20, 20, 'released'])
  }, 15000)

  it('starts a new query before one would pass 1000 characters', async () => {
    // Longer than a real oracle id, so fifteen would not fit in one query.
    const long = (i) => `${'a'.repeat(60)}-${i}`
    const names = Array.from({ length: 15 }, (_, i) => `Long ${i}`)
    const picks = Object.fromEntries(names.map((name, i) => [name, printing({
      id: `l-${i}`, oracle_id: long(i), name, set: 'fra', collector_number: String(i), released_at: '2026-10-02',
    })]))
    const calls = scryfall({ picks, search: noCards })
    await resolvePrintings(names, { now: NOW })
    expect(calls.search.length).toBeGreaterThan(1)
    for (const { q } of calls.search) expect(q.length).toBeLessThanOrEqual(1000)
  }, 15000)

  it('asks once for a card that several lines share', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND }, search: found(HOB_ISLAND) })
    const results = await resolvePrintings([
      { name: 'Island', quantity: 10, section: 'main' },
      { name: 'Island', quantity: 2, section: 'sideboard' },
    ], { now: NOW })
    expect(calls.search).toHaveLength(1)
    expect(results.map((r) => r.card.id)).toEqual(['hob-195', 'hob-195'])
    expect(results.map((r) => r.line.section)).toEqual(['main', 'sideboard'])
  }, 10000)
})

describe('a printing the person typed', () => {
  it('is kept exactly, even when it is not out', async () => {
    const calls = scryfall({ prints: [TRK_ISLAND] })
    const [result] = await resolvePrintings([{ name: 'Island', set: 'TRK', number: '319' }], { now: NOW })
    expect(calls.collection[0]).toEqual([{ set: 'trk', collector_number: '319' }])
    expect(result.card.id).toBe('trk-319')
    expect(result.how).toBe('exact')
    expect(calls.search).toHaveLength(0)
  })

  it('is looked up by name within the set when the line names a set alone', async () => {
    const bolt2x2 = printing({ ...MSC_BOLT, id: '2x2-117', set: '2x2', collector_number: '117', released_at: '2022-07-08' })
    const calls = scryfall({ prints: [bolt2x2] })
    const [result] = await resolvePrintings([{ name: 'Lightning Bolt', set: '2x2' }], { now: NOW })
    expect(calls.collection[0]).toEqual([{ name: 'Lightning Bolt', set: '2x2' }])
    expect(result.card.id).toBe('2x2-117')
    expect(result.how).toBe('set')
  })

  it('falls back to the name, by the same rule, and says the printing was not there', async () => {
    const calls = scryfall({ picks: { Island: TRK_ISLAND }, search: found(HOB_ISLAND) })
    const [result] = await resolvePrintings([{ name: 'Island', set: 'zzz', number: '9' }], { now: NOW })
    expect(calls.collection[1]).toEqual([{ name: 'Island' }])
    expect(result.how).toBe('fallback')
    expect(result.byName).toBe('released')
    expect(result.card.id).toBe('hob-195')
    expect(result.line).toMatchObject({ set: 'zzz', number: '9' })
    // Scryfall answered, and had nothing: that is not a lookup that failed.
    expect(result.unasked).toBeUndefined()
  }, 10000)

  it('says the same of a set alone, and keeps a name’s pick that is out', async () => {
    const calls = scryfall({ picks: { 'Lightning Bolt': MSC_BOLT } })
    const [result] = await resolvePrintings([{ name: 'Lightning Bolt', set: 'zzz' }], { now: NOW })
    expect(calls.collection).toEqual([[{ name: 'Lightning Bolt', set: 'zzz' }], [{ name: 'Lightning Bolt' }]])
    expect(result).toMatchObject({ how: 'fallback', byName: 'newest' })
    expect(result.card.id).toBe('msc-806')
    expect(calls.search).toHaveLength(0)
  })

  it('matches a typed collector number whatever its case', async () => {
    const listBolt = printing({ ...MSC_BOLT, id: 'plst-clb-187', set: 'plst', collector_number: 'CLB-187', released_at: '2026-11-09' })
    // Scryfall answers with its own "CLB-187" for a line that typed
    // "clb-187"; that answer is the printing typed, not a miss.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ object: 'list', data: [listBolt], not_found: [] })))
    const [result] = await resolvePrintings([{ name: 'Lightning Bolt', set: 'plst', number: 'clb-187' }], { now: NOW })
    expect(result).toMatchObject({ how: 'exact' })
    expect(result.card.id).toBe('plst-clb-187')
    // Typed, so kept though it is not out: no search follows.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps two printings of one card as two lines', async () => {
    const calls = scryfall({ prints: [HOB_ISLAND, TRK_ISLAND] })
    const results = await resolvePrintings([
      { name: 'Island', set: 'hob', number: '195', quantity: 2 },
      { name: 'Island', set: 'trk', number: '319', quantity: 2 },
    ], { now: NOW })
    expect(results.map((r) => r.card.id)).toEqual(['hob-195', 'trk-319'])
    expect(results.map((r) => r.how)).toEqual(['exact', 'exact'])
    expect(calls.collection).toHaveLength(1)
  })

  it('answers every line in order, with nothing for a line with no name', async () => {
    scryfall({ picks: { 'Lightning Bolt': MSC_BOLT } })
    const results = await resolvePrintings(['Lightning Bolt', { quantity: 1 }, null], { now: NOW })
    expect(results).toHaveLength(3)
    expect(results[0].card.id).toBe('msc-806')
    expect(results.slice(1).map((r) => r.card)).toEqual([null, null])
  })
})
