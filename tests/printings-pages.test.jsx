import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { clearCache, putCards, putQuery } from '../src/lib/cache.js'
import { getPrintings, __internals } from '../src/lib/scryfall.js'
import { usePrintings } from '../src/components/PrintingPages.jsx'
import Printings from '../src/components/Printings.jsx'

/**
 * Every printing of a card can be reached, a page at a time.
 *
 * Scryfall's search sends 175 cards a page. On 2026-09-24 its printings
 * search for Island answered total_cards 917, has_more true, and a next_page
 * of the form built by `nextPage` below, and the first page went back only to
 * November 2022. The Scryfall here pages a made-up list the same way, so
 * nothing leaves the machine. Every card is released long before the day
 * the tests give, and that day is passed in wherever the order depends on it.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = 24 * 60 * 60 * 1000
const TODAY = '2026-09-24'
const ISLAND = 'b2c6aa39-2d2a-459c-a555-fb48ba993373'
const PAGE = 175

/** Printing `n` of a card, newest first: one week older for each step down. */
const printing = (oracle, n, extra = {}) => ({
  id: `${oracle.slice(0, 8)}-${String(n).padStart(3, '0')}`,
  oracle_id: oracle,
  name: 'Island',
  set: `s${n}`,
  set_name: `Set ${n}`,
  collector_number: String(n),
  released_at: new Date(Date.UTC(2026, 7, 14) - n * 7 * DAY).toISOString().slice(0, 10),
  games: ['paper'],
  digital: false,
  finishes: ['nonfoil'],
  image_uris: { art_crop: `https://cards.scryfall.io/art_crop/${n}.jpg` },
  ...extra,
})

const printingsOf = (oracle, count, extra = {}) =>
  Array.from({ length: count }, (_, n) => printing(oracle, n, extra[n]))

/** Scryfall's own address for a page, as it gave it on 2026-09-24. */
const nextPage = (oracle, page) => `https://api.scryfall.com/cards/search?${new URLSearchParams({
  format: 'json', include_extras: 'true', include_multilingual: 'false', include_variations: 'false',
  order: 'released', page: String(page), q: `oracleid:${oracle}`, unique: 'prints',
})}`

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status) => ({ ok: false, status, json: async () => ({ object: 'error', status }) })

/**
 * Scryfall's printings search over `lists` (oracle id to printings, newest
 * first), 175 to a page. `asked` records every address fetched; `refuse`
 * answers a page number with a status instead.
 */
function scryfall(lists, { asked = [], refuse = {} } = {}) {
  return vi.fn(async (address) => {
    asked.push(address)
    const url = new URL(address)
    const oracle = url.searchParams.get('q')?.match(/^oracleid:([\w-]+)$/)?.[1]
    const page = Number(url.searchParams.get('page') ?? 1)
    if (url.pathname !== '/cards/search' || url.searchParams.get('unique') !== 'prints' || !lists[oracle]) return fail(404)
    if (refuse[page]) return fail(refuse[page])
    const all = lists[oracle]
    const data = all.slice((page - 1) * PAGE, page * PAGE)
    const hasMore = page * PAGE < all.length
    return ok({
      object: 'list', total_cards: all.length, has_more: hasMore,
      ...(hasMore ? { next_page: nextPage(oracle, page + 1) } : {}), data,
    })
  })
}

// Several tests here send six searches or more, each spaced half a second
// apart by request() at Scryfall's own rate, which is tested in
// scryfall.test.js. Spacing is shrunk so these tests are about paging and not
// about how busy the machine is, and each that sends more than one search
// still has time to spare (SLOW).
const SLOW = 20000

beforeEach(async () => {
  await clearCache()
  __internals.setBackoffBase(1)
  __internals.setLockoutMs(1)
  __internals.setSpacingScale(0.02)
  __internals.resumeBackground()
})

afterEach(() => {
  __internals.setSpacingScale(1)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getPrintings', () => {
  const islands = printingsOf(ISLAND, 917)
  const card = islands[0]

  it('gives the first page with Scryfall\'s count and its address for the next, and asks for nothing more', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: islands }, { asked }))
    const page = await getPrintings(card)
    expect(page.cards.map((c) => c.id)).toEqual(islands.slice(0, PAGE).map((c) => c.id))
    expect(page.totalCards).toBe(917)
    expect(page.next).toBe(nextPage(ISLAND, 2))
    expect(asked).toHaveLength(1)
    const url = new URL(asked[0])
    expect(url.searchParams.get('q')).toBe(`oracleid:${ISLAND}`)
    expect(url.searchParams.get('unique')).toBe('prints')
    expect(url.searchParams.get('order')).toBe('released')
    // No direction is sent: Scryfall's own for `released` is newest first.
    expect(url.searchParams.has('dir')).toBe(false)
  })

  it('reaches every printing, page by page, by the addresses Scryfall gives', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: islands }, { asked }))
    const seen = []
    let next = null
    let pages = 0
    do {
      const page = await getPrintings(card, { next })
      seen.push(...page.cards.map((c) => c.id))
      expect(page.totalCards).toBe(917)
      next = page.next
      pages++
    } while (next)
    expect(pages).toBe(6)
    expect(seen).toEqual(islands.map((c) => c.id))
    // Each page after the first is the very address Scryfall sent.
    expect(asked.slice(1)).toEqual([2, 3, 4, 5, 6].map((p) => nextPage(ISLAND, p)))
  }, SLOW)

  it('keeps each page for a day, so turning back through them asks nothing', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: islands }, { asked }))
    const first = await getPrintings(card)
    const second = await getPrintings(card, { next: first.next })
    expect(asked).toHaveLength(2)
    const again = await getPrintings(card)
    const againSecond = await getPrintings(card, { next: again.next })
    expect(asked).toHaveLength(2)
    expect(again).toEqual(first)
    expect(againSecond.cards.map((c) => c.id)).toEqual(second.cards.map((c) => c.id))
    expect(againSecond.next).toBe(nextPage(ISLAND, 3))
  }, SLOW)

  it('asks for a later page through the same line as every request, retries and all', async () => {
    const answer = scryfall({ [ISLAND]: islands })
    let failures = 0
    vi.stubGlobal('fetch', vi.fn(async (address, init) => {
      if (/page=2/.test(address) && failures < 2) { failures++; return fail(503) }
      return answer(address, init)
    }))
    const first = await getPrintings(card)
    const second = await getPrintings(card, { next: first.next })
    expect(failures).toBe(2)
    expect(second.cards[0].id).toBe(islands[PAGE].id)
    const [, init] = fetch.mock.calls.at(-1)
    expect(init.headers.Accept).toBe('application/json')
  }, SLOW)

  it('says there is no next page when Scryfall says so, or gives an address that is not its search', async () => {
    const few = printingsOf(ISLAND, 3)
    vi.stubGlobal('fetch', vi.fn(async () => ok({ object: 'list', total_cards: 3, has_more: false, data: few })))
    expect(await getPrintings(few[0])).toMatchObject({ totalCards: 3, next: null })

    for (const next_page of [
      'https://example.com/cards/search?page=2',
      'https://api.scryfall.com/cards/collection?page=2',
      'not an address',
      42,
    ]) {
      await clearCache()
      vi.stubGlobal('fetch', vi.fn(async () => ok({ object: 'list', total_cards: 917, has_more: true, next_page, data: few })))
      const page = await getPrintings(few[0])
      expect(page.next).toBe(null)
      expect(page.totalCards).toBe(917)
    }
  }, SLOW)

  it('does not follow an address that is not Scryfall\'s search, and asks nothing for it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const next of ['https://example.com/cards/search?page=2', 'https://api.scryfall.com/cards/named?exact=Island', '/cards/search?page=2']) {
      expect(await getPrintings(card, { next })).toEqual({ cards: [], totalCards: null, next: null })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads a count Scryfall did not give as unknown, not as nought', async () => {
    const few = printingsOf(ISLAND, 3)
    vi.stubGlobal('fetch', vi.fn(async () => ok({ object: 'list', has_more: true, next_page: nextPage(ISLAND, 2), data: few })))
    expect(await getPrintings(few[0])).toMatchObject({ totalCards: null, next: nextPage(ISLAND, 2) })
  })

  it('gives a card with no oracle id itself, without asking', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const token = { id: 'token', name: 'Soldier' }
    expect(await getPrintings(token)).toEqual({ cards: [token], totalCards: 1, next: null })
    expect(await getPrintings(null)).toEqual({ cards: [], totalCards: 0, next: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks again over what an older build kept, which never said whether more followed', async () => {
    await putCards(islands.slice(0, PAGE))
    await putQuery(`printings:${ISLAND}`, islands.slice(0, PAGE).map((c) => c.id))
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: islands }, { asked }))
    const page = await getPrintings(card)
    expect(asked).toHaveLength(1)
    expect(page).toMatchObject({ totalCards: 917, next: nextPage(ISLAND, 2) })
  })

  it('reads a kept page forgivingly: a bad count or address is dropped, a bad id is a miss', async () => {
    await putCards(islands.slice(0, 2))
    const ids = islands.slice(0, 2).map((c) => c.id)
    await putQuery(`printings:${ISLAND}`, { ids, totalCards: '917', next: 'https://example.com/elsewhere' })
    const fetchMock = scryfall({ [ISLAND]: islands })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getPrintings(card)).toEqual({ cards: islands.slice(0, 2), totalCards: null, next: null })
    expect(fetchMock).not.toHaveBeenCalled()

    await putQuery(`printings:${ISLAND}`, { ids: [...ids, 7], totalCards: 917, next: null })
    expect((await getPrintings(card)).totalCards).toBe(917)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, SLOW)
})

let root
let host
function mount(element) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root.render(element) })
}

/**
 * Waits for `done` to hold, and says what it was waiting for if it never
 * does. It gives up well inside a test's own time limit, so a slow wait fails
 * as the thing that did not happen rather than as "Test timed out".
 */
async function until(done, what, ms = 4000) {
  const started = Date.now()
  while (!done()) {
    if (Date.now() - started > ms) throw new Error(`waited ${ms} ms for ${what}, and it did not happen`)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = null
  host = null
})

describe('usePrintings', () => {
  it('puts every page that has arrived in one order: the deck\'s copy first, from hand until its page comes, digital and artless after paper', async () => {
    const list = printingsOf(ISLAND, 400, {
      3: { digital: true, games: ['arena'] },
      5: { image_uris: undefined },
    })
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }, { asked }))
    // The deck holds a printing on the third page.
    const mine = list[380]
    let seen
    function Probe() {
      seen = usePrintings(mine, { now: TODAY })
      return null
    }
    mount(<Probe />)
    await until(() => seen.printings, 'the first page')
    const paper = (from, to) => list.slice(from, to).filter((_, i) => ![3, 5, 380].includes(from + i)).map((c) => c.id)
    // The deck's copy is in hand, so it leads before its page has been asked for.
    expect(seen.printings.map((c) => c.id)).toEqual([mine.id, ...paper(0, 175), list[3].id, list[5].id])
    expect(seen).toMatchObject({ extra: true, shown: 175, totalCards: 400, hasMore: true, paged: false, arrivedId: null })
    expect(asked).toHaveLength(1)

    act(() => seen.loadMore())
    await until(() => seen.shown === 350, 'page two')
    // Page two joins the paper printings, ahead of page one's digital and artless ones.
    expect(seen.printings.map((c) => c.id)).toEqual([mine.id, ...paper(0, 350), list[3].id, list[5].id])
    expect(seen.arrivedId).toBe(list[175].id)

    act(() => seen.loadMore())
    await until(() => !seen.hasMore, 'the last page')
    // Page three holds the deck's own copy: it stays where it was, listed
    // once, and is not taken for a new arrival.
    expect(seen.printings.map((c) => c.id)).toEqual([mine.id, ...paper(0, 400), list[3].id, list[5].id])
    expect(seen.arrivedId).toBe(list[350].id)
    expect(seen).toMatchObject({ extra: false, shown: 400, paged: true, hasMore: false, loadingMore: false })
    expect(asked).toEqual([asked[0], nextPage(ISLAND, 2), nextPage(ISLAND, 3)])
  }, SLOW)

  it('asks for one page however often it is pressed while that page is on its way', async () => {
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: printingsOf(ISLAND, 400) }, { asked }))
    let seen
    function Probe() {
      seen = usePrintings(printing(ISLAND, 0), { now: TODAY })
      return null
    }
    mount(<Probe />)
    await until(() => seen.printings, 'the first page')
    act(() => { seen.loadMore(); seen.loadMore(); seen.loadMore() })
    await until(() => seen.printings.length === 350, 'page two')
    expect(asked).toEqual([asked[0], nextPage(ISLAND, 2)])
  }, SLOW)
})

describe('the printings picker', () => {
  const text = () => host.textContent.replace(/\s+/g, ' ')
  const olderButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Older printings')

  it('says how many of Scryfall\'s it shows, fetches the next page only when pressed, and moves focus to it', async () => {
    const list = printingsOf(ISLAND, 180)
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }, { asked }))
    mount(<Printings card={list[0]} onChoose={() => {}} onClose={() => {}} />)
    await until(() => host.querySelector('.printings__print'), 'the first page of printings')
    expect(text()).toContain('Showing the newest 175 of 180 printings.')
    expect(host.querySelectorAll('.printings__print')).toHaveLength(175)
    // The count sits where a screen reader hears it change.
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe('Showing the newest 175 of 180 printings.')
    // Longer than Scryfall's own spacing, unscaled: nothing more is asked unpressed.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
    expect(asked).toHaveLength(1)

    act(() => olderButton().click())
    await until(() => host.querySelectorAll('.printings__print').length === 180, 'all 180 printings to be listed')
    expect(asked).toEqual([asked[0], nextPage(ISLAND, 2)])
    expect(text()).toContain('Showing all 180 printings.')
    expect(olderButton()).toBeUndefined()
    // The button has gone, so focus is on the first printing the page brought.
    expect(document.activeElement?.classList.contains('printings__print')).toBe(true)
    expect(document.activeElement.textContent).toContain('Set 175')
  }, SLOW)

  it('says when an older page could not be fetched, keeps the button, and fetches it on a second press', async () => {
    const list = printingsOf(ISLAND, 180)
    const refuse = { 2: 400 }
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }, { refuse }))
    mount(<Printings card={list[0]} onChoose={() => {}} onClose={() => {}} />)
    await until(() => olderButton(), 'the "Older printings" button')
    act(() => olderButton().click())
    await until(() => /could not be fetched/.test(text()), 'the line saying the older page could not be fetched')
    expect(text()).toContain('Showing the newest 175 of 180 printings. The older ones could not be fetched from Scryfall just now.')
    expect(olderButton()).toBeDefined()

    delete refuse[2]
    act(() => olderButton().click())
    await until(() => /Showing all 180 printings\./.test(text()), '"Showing all 180 printings."')
    expect(host.querySelectorAll('.printings__print')).toHaveLength(180)
  }, SLOW)

  it('lists the deck\'s own copy first when it is older than the newest page, and says so in the count', async () => {
    const list = printingsOf(ISLAND, 180)
    const asked = []
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }, { asked }))
    mount(<Printings card={list[179]} onChoose={() => {}} onClose={() => {}} />)
    await until(() => host.querySelector('.printings__print'), 'the first page of printings')
    const rows = host.querySelectorAll('.printings__print')
    expect(rows).toHaveLength(176)
    expect(rows[0].getAttribute('aria-current')).toBe('true')
    expect(rows[0].textContent).toContain('Set 179')
    expect(rows[0].textContent).toContain('yours')
    expect(text()).toContain('Showing yours and the newest 175 of 180 printings.')
    expect(asked).toHaveLength(1)

    act(() => olderButton().click())
    await until(() => /Showing all 180 printings\./.test(text()), '"Showing all 180 printings."')
    expect(host.querySelectorAll('.printings__print')).toHaveLength(180)
    expect(host.querySelectorAll('.printings__print[aria-current="true"]')).toHaveLength(1)
    // Four came that were not listed; focus is on the first of them.
    expect(document.activeElement.textContent).toContain('Set 175')
  }, SLOW)

  it('moves focus to the count when the page brought nothing that was not listed already', async () => {
    const list = printingsOf(ISLAND, 176)
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }))
    mount(<Printings card={list[175]} onChoose={() => {}} onClose={() => {}} />)
    await until(() => olderButton(), 'the "Older printings" button')
    act(() => olderButton().click())
    await until(() => /Showing all 176 printings\./.test(text()), '"Showing all 176 printings."')
    expect(olderButton()).toBeUndefined()
    expect(document.activeElement?.getAttribute('aria-live')).toBe('polite')
    expect(document.activeElement.textContent).toBe('Showing all 176 printings.')
  }, SLOW)

  it('shows no count and no button for a card whose printings fit on one page', async () => {
    const list = printingsOf(ISLAND, 12)
    vi.stubGlobal('fetch', scryfall({ [ISLAND]: list }))
    mount(<Printings card={list[0]} onChoose={() => {}} onClose={() => {}} />)
    await until(() => host.querySelector('.printings__print'), 'the printings')
    expect(host.querySelectorAll('.printings__print')).toHaveLength(12)
    expect(text()).not.toMatch(/Showing|Older printings/)
  }, SLOW)

  it('asks nothing when it is closed before its first page has been asked for', async () => {
    const fetchMock = scryfall({ [ISLAND]: printingsOf(ISLAND, 180) })
    vi.stubGlobal('fetch', fetchMock)
    mount(<Printings card={printing(ISLAND, 0)} onChoose={() => {}} onClose={() => {}} />)
    act(() => { root.unmount() })
    root = null
    // Longer than Scryfall's own spacing, unscaled, so the line has moved on.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)) })
    expect(fetchMock).not.toHaveBeenCalled()
  }, SLOW)
})
