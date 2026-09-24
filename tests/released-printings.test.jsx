import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { clearCache } from '../src/lib/cache.js'
import { __internals } from '../src/lib/scryfall.js'
import { SWITCH_LABEL } from '../src/lib/released-switch.js'
import ReleasedPrintings from '../src/features/decks/ReleasedPrintings.jsx'
import FIXTURE from './fixtures/scryfall-unreleased.json'

/**
 * The offer in the deck editor, on its own: it says what is not out, asks
 * Scryfall only when pressed, shows every switch, and hands a switched deck
 * back only on the player's word. Nothing about it is stored. The cards are
 * the ones Scryfall sent on 2026-09-21 and the day is passed in, so this reads
 * the same after Star Trek is out; the one made-up printing says so.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = '2026-09-24'
const print = (set, number) => FIXTURE.cards.find((c) => c.set === set && c.collector_number === number)
const TRK_ISLAND = print('trk', '319')
const HOB_ISLAND = print('hob', '195')
const HOB_MOUNTAIN = print('hob', '197')
const PHOENIX = print('fra', '53')
const MADE_UP_MOUNTAIN = {
  ...HOB_MOUNTAIN, id: 'made-up-mountain', set: 'zzz', set_name: 'A made-up set',
  collector_number: '1', released_at: '2026-11-13',
}
const PRINTINGS = [...FIXTURE.cards, MADE_UP_MOUNTAIN]

const DECK = {
  id: 'imported', name: 'Imported before', formatId: 'standard', commanders: [], signatureSpell: null,
  main: [
    { cardId: TRK_ISLAND.id, quantity: 20 }, { cardId: MADE_UP_MOUNTAIN.id, quantity: 4 },
    { cardId: HOB_MOUNTAIN.id, quantity: 30 }, { cardId: PHOENIX.id, quantity: 4 },
  ],
  sideboard: [], categoryOrder: [], versions: [],
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
}
const CARDS = new Map([TRK_ISLAND, MADE_UP_MOUNTAIN, HOB_MOUNTAIN, PHOENIX].map((c) => [c.id, c]))
const lookup = (id) => CARDS.get(id)

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const fail = (status) => ({ ok: false, status, json: async () => ({ object: 'error', status }) })

/**
 * Scryfall's released-printing search as of NOW. `refuse` answers with a
 * status instead: every search, or, as a function, those it gives a status
 * for, by the order in which each different search was first sent.
 */
function scryfall({ asked = [], refuse = null } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (address) => {
    const q = new URL(address).searchParams.get('q')
    asked.push(q)
    const status = typeof refuse === 'function' ? refuse([...new Set(asked)].indexOf(q)) : refuse
    if (status) return fail(status)
    const ids = [...q.matchAll(/oracleid:([\w-]+)/g)].map((m) => m[1])
    const data = ids.map((id) => PRINTINGS
      .filter((c) => c.oracle_id === id && c.released_at <= NOW && c.games.includes('paper') && !c.digital)
      .sort((a, b) => b.released_at.localeCompare(a.released_at))[0]).filter(Boolean)
    return data.length ? ok({ object: 'list', data }) : fail(404)
  }))
  return asked
}

let root
let host
function mount(props) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root.render(<ReleasedPrintings deck={DECK} cards={CARDS} lookup={lookup} now={NOW} onSwitch={() => {}} {...props} />)
  })
}
/** The same offer drawn again with new props, as the editor does after a save. */
function rerender(props) {
  act(() => {
    root.render(<ReleasedPrintings deck={DECK} cards={CARDS} lookup={lookup} now={NOW} onSwitch={() => {}} {...props} />)
  })
}
function unmount() {
  act(() => { root?.unmount() })
  host?.remove()
  root = null
  host = null
}

async function until(done, ms = 8000) {
  const started = Date.now()
  while (!done()) {
    if (Date.now() - started > ms) throw new Error('timed out')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
}

const text = () => host.textContent.replace(/\s+/g, ' ').trim()
const button = (name) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)
const items = (label) => [...host.querySelectorAll(`ul[aria-label="${label}"] li`)].map((li) => li.textContent)

beforeEach(async () => {
  await clearCache()
  vi.stubGlobal('navigator', { onLine: true })
  __internals.setBackoffBase(1)
  __internals.setLockoutMs(1)
  // Scryfall's own spacing between searches is tested in scryfall.test.js;
  // here it would only spend the tests' time.
  __internals.setSpacingScale(0.02)
  localStorage.clear()
})

afterEach(() => {
  unmount()
  __internals.setSpacingScale(1)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the offer', () => {
  it('is not there for a deck whose printings are all out', () => {
    mount({ deck: { ...DECK, main: [{ cardId: HOB_MOUNTAIN.id, quantity: 60 }] } })
    expect(host.innerHTML).toBe('')
  })

  it('says how many printings are not out and until when, and asks Scryfall nothing until pressed', () => {
    const asked = scryfall()
    mount()
    expect(text()).toContain('3 printings in this deck are not out yet: 1 until 2 Oct 2026 and 2 until 13 Nov 2026.')
    expect(button('Find released printings')).toBeTruthy()
    expect(button('Not now')).toBeTruthy()
    expect(asked).toEqual([])
  })

  it('lists each switch and each card that stays, and changes nothing yet', async () => {
    const asked = scryfall()
    const onSwitch = vi.fn()
    mount({ onSwitch })
    act(() => button('Find released printings').click())
    await until(() => button('Switch these'))
    // One search, for the three printings not out and nothing else. The
    // made-up Mountain is asked for by the Mountain's oracle id; the thirty
    // Hobbit Mountains beside it are out, and are not what put it there.
    expect(asked).toEqual([
      `(oracleid:${TRK_ISLAND.oracle_id} or oracleid:${MADE_UP_MOUNTAIN.oracle_id} or oracleid:${PHOENIX.oracle_id}) date<=now game:paper lang:en prefer:newest`,
    ])
    expect(items('Switches the app would make')).toEqual([
      'Island: Star Trek #319 → The Hobbit #195',
      'Mountain: A made-up set #1 → The Hobbit #197 (joins the copies already in the main deck)',
    ])
    expect(text()).toContain('One has nothing to switch to:')
    expect(items('Printings that stay as they are')).toEqual([
      'Darklight Phoenix stays as Reality Fracture #53: Scryfall lists no paper printing of it that is out yet.',
    ])
    expect(text()).toContain('It cannot tell a printing you chose from one it picked, so nothing changes until you say.')
    expect(onSwitch).not.toHaveBeenCalled()
    // The button that had focus has gone; focus is on what came instead.
    expect(document.activeElement.textContent).toBe('The app would make these 2 switches:')
  })

  it('switches on the player’s word, with a History checkpoint and the new printings in hand', async () => {
    scryfall()
    const onSwitch = vi.fn()
    mount({ onSwitch })
    act(() => button('Find released printings').click())
    await until(() => button('Switch these'))
    act(() => button('Switch these').click())
    expect(onSwitch).toHaveBeenCalledTimes(1)
    const [next, arrived] = onSwitch.mock.calls[0]
    expect(next.main.map((e) => [e.cardId, e.quantity])).toEqual([
      [HOB_ISLAND.id, 20], [HOB_MOUNTAIN.id, 34], [PHOENIX.id, 4],
    ])
    expect(next.versions[0]).toMatchObject({ label: SWITCH_LABEL, auto: true })
    expect(next.versions[0].main.map((e) => e.cardId)).toEqual(DECK.main.map((e) => e.cardId))
    expect([...arrived.keys()]).toEqual([HOB_ISLAND.id, HOB_MOUNTAIN.id])
    const status = host.querySelector('[role="status"]')
    expect(status.textContent).toBe('Switched 2 printings. 1 printing with nothing to switch to stays as it is. '
      + `The deck as it stood is in History, as “${SWITCH_LABEL}”.`)
    expect(document.activeElement).toBe(status)
  })

  it('goes on "Not now", stores nothing, and is back when the deck is next opened', () => {
    scryfall()
    const onSwitch = vi.fn()
    const onDismiss = vi.fn()
    mount({ onSwitch, onDismiss })
    act(() => button('Not now').click())
    expect(host.innerHTML).toBe('')
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onSwitch).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    unmount()
    mount()
    expect(button('Find released printings')).toBeTruthy()
  })

  it('says so when Scryfall could not be asked, changes nothing, and can ask again', async () => {
    scryfall({ refuse: 503 })
    const onSwitch = vi.fn()
    mount({ onSwitch, offline: false })
    act(() => button('Find released printings').click())
    await until(() => button('Try again'), 12000)
    expect(text()).toContain('Scryfall could not be asked just now. Nothing in the deck has changed.')
    expect(button('Switch these')).toBeUndefined()
    scryfall()
    act(() => button('Try again').click())
    await until(() => button('Switch these'))
    expect(onSwitch).not.toHaveBeenCalled()
  }, 20000)

  it('offers no switch when there is none to make, and names what stays', async () => {
    scryfall()
    mount({ deck: { ...DECK, main: [{ cardId: PHOENIX.id, quantity: 4 }, { cardId: HOB_MOUNTAIN.id, quantity: 56 }] } })
    expect(text()).toContain('1 printing in this deck is not out until 2 Oct 2026.')
    act(() => button('Find released printings').click())
    await until(() => button('Close'))
    expect(text()).toContain('There is nothing to switch to yet.')
    expect(items('Printings that stay as they are')).toEqual([
      'Darklight Phoenix stays as Reality Fracture #53: Scryfall lists no paper printing of it that is out yet.',
    ])
    expect(button('Switch this')).toBeUndefined()
  })
})

describe('an answer Scryfall gave only in part', () => {
  // Made-up cards, each with one made-up printing not out and none out, so a
  // deck can hold more cards not out than one search asks about (fifteen).
  const madeUp = (n) => Array.from({ length: n }, (_, i) => ({
    ...PHOENIX, id: `made-up-${i}`, oracle_id: `made-up-oracle-${i}`, name: `Made-up card ${i}`,
    set: 'zzz', set_name: 'A made-up set', collector_number: String(100 + i),
  }))
  const entries = (list) => list.map((c) => ({ cardId: c.id, quantity: 1 }))
  const withCards = (list) => {
    const cards = new Map([...CARDS, ...list.map((c) => [c.id, c])])
    return { cards, lookup: (id) => cards.get(id) }
  }
  const query = (card) => `(oracleid:${card.oracle_id}) date<=now game:paper lang:en prefer:newest`
  // The three cards of DECK not out and thirteen more: sixteen, so two
  // searches, the second for the last card alone.
  const thirteen = madeUp(13)
  const DEEP = { ...DECK, main: [...DECK.main, ...entries(thirteen)] }
  const LAST = thirteen.at(-1)

  it('lists the cards it could not ask about apart from those with nothing to switch to, and asks again about those alone', async () => {
    let refusing = true
    const asked = scryfall({ refuse: (i) => (refusing && i === 1 ? 503 : null) })
    const onSwitch = vi.fn()
    mount({ deck: DEEP, ...withCards(thirteen), onSwitch })
    act(() => button('Find released printings').click())
    await until(() => button('Try again'), 12000)
    expect(items('Switches the app would make')).toHaveLength(2)
    expect(text()).toContain('13 have nothing to switch to:')
    expect(items('Printings that stay as they are')).toHaveLength(13)
    expect(text()).toContain('Scryfall could not be asked about one of them just now:')
    expect(items('Printings Scryfall could not be asked about')).toEqual([
      'Made-up card 12 stays as A made-up set #112: Scryfall could not be asked about it just now.',
    ])
    // The switches found can be made now, or after asking again.
    expect(button('Switch these')).toBeTruthy()

    refusing = false
    const before = asked.length
    act(() => button('Try again').click())
    await until(() => !button('Try again') && button('Switch these'))
    expect(asked.slice(before)).toEqual([query(LAST)])
    expect(items('Switches the app would make')).toHaveLength(2)
    expect(text()).toContain('14 have nothing to switch to:')
    expect(items('Printings Scryfall could not be asked about')).toEqual([])
    expect(onSwitch).not.toHaveBeenCalled()
    expect(document.activeElement.textContent).toBe('The app would make these 2 switches:')
  }, 20000)

  it('says after the switch which printings Scryfall could not be asked about, and can still ask', async () => {
    let refusing = true
    const asked = scryfall({ refuse: (i) => (refusing && i === 1 ? 503 : null) })
    let saved = null
    const hand = withCards(thirteen)
    mount({ deck: DEEP, ...hand, onSwitch: (next) => { saved = next } })
    act(() => button('Find released printings').click())
    await until(() => button('Switch these'), 12000)
    act(() => button('Switch these').click())
    // The editor saves the switched deck and draws the offer again with it.
    rerender({ deck: saved, ...hand })
    const status = host.querySelector('[role="status"]')
    expect(status.textContent).toBe('Switched 2 printings. 13 printings with nothing to switch to stay as they are. '
      + '1 printing Scryfall could not be asked about stays as it is for now. '
      + `The deck as it stood is in History, as “${SWITCH_LABEL}”.`)
    expect(document.activeElement).toBe(status)

    refusing = false
    const before = asked.length
    act(() => button('Try again').click())
    await until(() => button('Close'))
    expect(asked.slice(before)).toEqual([query(LAST)])
    expect(text()).toContain('There is nothing to switch to yet.')
    expect(items('Printings that stay as they are')).toHaveLength(14)
    expect(items('Printings Scryfall could not be asked about')).toEqual([])
  }, 20000)

  it('does not say a card Scryfall was never asked about has nothing to switch to', async () => {
    // Darklight Phoenix and fifteen made-up cards, none with a printing out.
    const fifteen = madeUp(15)
    scryfall({ refuse: (i) => (i === 1 ? 503 : null) })
    mount({
      deck: { ...DECK, main: [{ cardId: PHOENIX.id, quantity: 4 }, { cardId: HOB_MOUNTAIN.id, quantity: 41 }, ...entries(fifteen)] },
      ...withCards(fifteen),
    })
    act(() => button('Find released printings').click())
    await until(() => button('Try again'), 12000)
    expect(document.activeElement.textContent).toBe('None that Scryfall answered for has a printing to switch to yet.')
    expect(text()).not.toContain('There is nothing to switch to yet.')
    expect(items('Printings that stay as they are')).toHaveLength(15)
    expect(items('Printings Scryfall could not be asked about')).toEqual([
      'Made-up card 14 stays as A made-up set #114: Scryfall could not be asked about it just now.',
    ])
    expect(button('Not now')).toBeTruthy()
    expect(button('Close')).toBeUndefined()
  }, 20000)
})
