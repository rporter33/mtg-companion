import { describe, it, expect } from 'vitest'
import {
  captureVersion, restoreVersion, diffVersions, prune, deleteVersion, relabelVersion,
  sameLists, versionSize, versionBytes, listsOf, MAX_VERSIONS,
} from '../src/lib/versions.js'

const card = (id, name, usd = '1.00') => ({ id, name, prices: { usd } })
const CARDS = { a: card('a', 'Alpha', '2.00'), b: card('b', 'Beta'), z: card('z', 'Zeta', '5.00'), c: card('c', 'Commander') }
const lookup = (id) => CARDS[id]
const priceFor = (c, m) => ({ value: Number(c.prices?.[m] ?? null) || null })

const deck = () => ({
  id: 'd1', commanders: ['c'], signatureSpell: null,
  main: [{ cardId: 'a', quantity: 4 }, { cardId: 'b', quantity: 1 }],
  sideboard: [], categoryOrder: [], versions: [],
})

describe('capturing a version', () => {
  it('records the lists, newest first', () => {
    const d = captureVersion(deck(), { label: 'first' })
    expect(d.versions).toHaveLength(1)
    expect(d.versions[0]).toMatchObject({ label: 'first', auto: false, main: deck().main, commanders: ['c'] })
  })

  it('copies the lists, so later edits do not reach into history', () => {
    const d = captureVersion(deck(), { label: 'first' })
    d.main[0].quantity = 99
    expect(d.versions[0].main[0].quantity).toBe(4)
  })

  // Pressing "save version" twice should not spend a slot on a duplicate.
  it('skips a capture identical to the newest version', () => {
    const once = captureVersion(deck(), { label: 'first' })
    const twice = captureVersion(once, { label: 'again' })
    expect(twice.versions).toHaveLength(1)
    expect(twice).toBe(once)
  })

  it('does not count a reordering as a change', () => {
    const once = captureVersion(deck(), { label: 'first' })
    const shuffled = { ...once, main: [...once.main].reverse() }
    expect(captureVersion(shuffled, { label: 'again' }).versions).toHaveLength(1)
  })

  it('does count a quantity change', () => {
    const once = captureVersion(deck(), { label: 'first' })
    const edited = { ...once, main: [{ cardId: 'a', quantity: 3 }, { cardId: 'b', quantity: 1 }] }
    expect(captureVersion(edited, { label: 'second' }).versions).toHaveLength(2)
  })

  it('trims the label and tolerates none', () => {
    expect(captureVersion(deck(), { label: '  spaced  ' }).versions[0].label).toBe('spaced')
    expect(captureVersion(deck()).versions[0].label).toBe('')
  })

  it('records whether it was automatic', () => {
    expect(captureVersion(deck(), { auto: true }).versions[0].auto).toBe(true)
  })

  it('stores ids and quantities, not card objects', () => {
    const v = captureVersion(deck(), { label: 'x' }).versions[0]
    expect(JSON.stringify(v)).not.toContain('Alpha')
    expect(versionBytes(v)).toBeLessThan(400)
  })
})

describe('the cap', () => {
  const many = (n, auto) => Array.from({ length: n }, (_, i) => ({
    id: `v${i}`, at: `2026-01-${String(i + 1).padStart(2, '0')}`, label: `v${i}`, auto,
    main: [], sideboard: [], commanders: [],
  }))

  it('holds at most the maximum', () => {
    expect(prune(many(MAX_VERSIONS + 10, false))).toHaveLength(MAX_VERSIONS)
  })

  it('drops automatic checkpoints before labelled versions', () => {
    const mixed = [...many(5, false), ...many(MAX_VERSIONS, true)]
    const kept = prune(mixed)
    expect(kept.filter((v) => !v.auto)).toHaveLength(5)
  })

  it('drops the oldest first', () => {
    const kept = prune(many(MAX_VERSIONS + 3, false))
    expect(kept.map((v) => v.id)).not.toContain(`v${MAX_VERSIONS + 2}`)
    expect(kept[0].id).toBe('v0')
  })

  it('never prunes the newest entry', () => {
    const list = [{ ...many(1, true)[0], id: 'newest' }, ...many(MAX_VERSIONS + 5, false).slice(1)]
    expect(prune(list)[0].id).toBe('newest')
  })

  it('leaves a short list alone', () => {
    const list = many(3, false)
    expect(prune(list)).toBe(list)
  })
})

describe('diffing', () => {
  const before = captureVersion(deck(), { label: 'before' }).versions[0]

  it('is empty when nothing changed', () => {
    expect(diffVersions(before, deck(), lookup).empty).toBe(true)
  })

  it('names what came in and what went out', () => {
    const after = { ...deck(), main: [{ cardId: 'a', quantity: 4 }, { cardId: 'z', quantity: 1 }] }
    const d = diffVersions(before, after, lookup)
    expect(d.added.map((r) => r.name)).toEqual(['Zeta'])
    expect(d.removed.map((r) => r.name)).toEqual(['Beta'])
    expect(d.empty).toBe(false)
  })

  it('reports a quantity change as a change, not an add and a remove', () => {
    const after = { ...deck(), main: [{ cardId: 'a', quantity: 2 }, { cardId: 'b', quantity: 1 }] }
    const d = diffVersions(before, after, lookup)
    expect(d.changed).toEqual([expect.objectContaining({ name: 'Alpha', from: 4, to: 2 })])
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
  })

  it('keeps main and sideboard apart', () => {
    const after = { ...deck(), main: [{ cardId: 'a', quantity: 4 }], sideboard: [{ cardId: 'b', quantity: 1 }] }
    const d = diffVersions(before, after, lookup)
    expect(d.removed.find((r) => r.name === 'Beta').zone).toBe('main')
    expect(d.added.find((r) => r.name === 'Beta').zone).toBe('sideboard')
  })

  it('notices a commander swap', () => {
    const after = { ...deck(), commanders: ['z'] }
    const d = diffVersions(before, after, lookup)
    expect(d.commandersOut.map((r) => r.name)).toEqual(['Commander'])
    expect(d.commandersIn.map((r) => r.name)).toEqual(['Zeta'])
  })

  it('has a name for a card that has not loaded', () => {
    const after = { ...deck(), main: [...deck().main, { cardId: 'ghost-1234', quantity: 1 }] }
    expect(diffVersions(before, after, lookup).added[0].name).toMatch(/unknown ghost-12/)
  })

  it('prices the change when asked', () => {
    // Before: 4 x 2.00 + 1.00 = 9. After: 4 x 2.00 + 5.00 = 13.
    const after = { ...deck(), main: [{ cardId: 'a', quantity: 4 }, { cardId: 'z', quantity: 1 }] }
    const d = diffVersions(before, after, lookup, 'usd', priceFor)
    expect(d.price).toMatchObject({ before: 9, after: 13, delta: 4 })
  })

  it('leaves price out when no pricer is given', () => {
    expect(diffVersions(before, deck(), lookup).price).toBeNull()
  })

  it('sorts each list by name', () => {
    const after = { ...deck(), main: [{ cardId: 'z', quantity: 1 }, { cardId: 'a', quantity: 1 }, { cardId: 'b', quantity: 1 }] }
    const d = diffVersions({ main: [], sideboard: [], commanders: [] }, after, lookup)
    expect(d.added.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
  })
})

describe('restoring', () => {
  it('puts the old lists back', () => {
    const saved = captureVersion(deck(), { label: 'good' })
    const wrecked = { ...saved, main: [{ cardId: 'z', quantity: 1 }], commanders: [] }
    const back = restoreVersion(wrecked, saved.versions[0].id)
    expect(back.main).toEqual(deck().main)
    expect(back.commanders).toEqual(['c'])
  })

  // Restore is its own undo: the lists you are leaving are one restore away.
  it('checkpoints the current lists first, automatically', () => {
    const saved = captureVersion(deck(), { label: 'good' })
    const wrecked = { ...saved, main: [{ cardId: 'z', quantity: 1 }] }
    const back = restoreVersion(wrecked, saved.versions[0].id)
    expect(back.versions[0]).toMatchObject({ auto: true, label: 'Before restore', main: [{ cardId: 'z', quantity: 1 }] })
    expect(back.versions).toHaveLength(2)
  })

  it('can be undone by restoring the checkpoint it made', () => {
    const saved = captureVersion(deck(), { label: 'good' })
    const wrecked = { ...saved, main: [{ cardId: 'z', quantity: 1 }] }
    const back = restoreVersion(wrecked, saved.versions[0].id)
    const forward = restoreVersion(back, back.versions[0].id)
    expect(forward.main).toEqual([{ cardId: 'z', quantity: 1 }])
  })

  it('does nothing for an id it does not have', () => {
    const d = captureVersion(deck(), { label: 'x' })
    expect(restoreVersion(d, 'nope')).toBe(d)
  })

  it('marks the deck as updated', () => {
    const saved = captureVersion(deck(), { label: 'good' })
    const wrecked = { ...saved, main: [] }
    expect(restoreVersion(wrecked, saved.versions[0].id).updatedAt).toBeTruthy()
  })
})

describe('housekeeping', () => {
  it('deletes a version by id', () => {
    const d = captureVersion(deck(), { label: 'x' })
    expect(deleteVersion(d, d.versions[0].id).versions).toEqual([])
  })

  it('relabels a version', () => {
    const d = captureVersion(deck(), { label: 'x' })
    expect(relabelVersion(d, d.versions[0].id, ' better ').versions[0].label).toBe('better')
  })

  it('counts a version the way the deck header does', () => {
    const v = captureVersion(deck(), { label: 'x' }).versions[0]
    expect(versionSize(v)).toBe(6) // 4 + 1 in main, plus the commander
  })

  it('compares lists without caring about order', () => {
    expect(sameLists(listsOf(deck()), { ...listsOf(deck()), main: [...deck().main].reverse() })).toBe(true)
  })

  it('handles a deck with no history yet', () => {
    const bare = { ...deck() }
    delete bare.versions
    expect(captureVersion(bare, { label: 'x' }).versions).toHaveLength(1)
    expect(deleteVersion(bare, 'nope').versions).toEqual([])
  })
})
