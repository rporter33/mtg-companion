import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend } from '../src/lib/storage-backend.js'
import { useBackend, listDecks, getDeck, importAll, exportAll, clearAll, saveDeck } from '../src/lib/storage.js'
import { upgradeDeck, validateDeck, deckSize, allCardIds } from '../src/lib/deck.js'
import { deckSections } from '../src/lib/categories.js'
import { restoreVersion } from '../src/lib/versions.js'
import { BEAR, FOREST } from './fixtures.js'

/**
 * A deck outlives the code that wrote it.
 *
 * There are no accounts here, so somebody's decks exist in exactly one place:
 * their browser. A deck saved by a build from months ago, or by a newer one a
 * stale service worker is serving this bundle against, has whatever shape it
 * had then — and none of that may reach a screen as a thrown error. This is the
 * same job as `upgrade` in lib/board/model.js for a saved table, and
 * tests/board-restore.test.js is the shape of this test.
 */

/** Exactly the shape the first build wrote: no categories, no history. */
const BEFORE_CATEGORIES = {
  id: 'd1',
  name: 'Wren of the Deep Green',
  formatId: 'commander',
  commanders: ['legend'],
  main: [{ cardId: 'forest', quantity: 34 }, { cardId: 'bear', quantity: 1 }],
  sideboard: [],
  createdAt: '2026-02-01T10:00:00Z',
  updatedAt: '2026-02-01T10:00:00Z',
  // No categoryOrder: sections did not exist yet.
  // No versions: a deck could not carry a history.
  // No signatureSpell: Oathbreaker came later.
  // No name on an entry: nothing stamped one until printings could vanish.
}

describe('a deck saved by an older build', () => {
  it('opens, rather than taking the screen down with it', () => {
    const deck = upgradeDeck(BEFORE_CATEGORIES)
    expect(deck).not.toBe(null)
    expect(() => validateDeck(deck, new Map())).not.toThrow()
    expect(() => deckSections(deck, () => null)).not.toThrow()
    expect(deckSize(deck, { deck: { min: 100 }, commanderCountsTowardDeck: true })).toBe(36)
  })

  it('keeps everything the player had', () => {
    const deck = upgradeDeck(BEFORE_CATEGORIES)
    expect(deck).toMatchObject({
      id: 'd1', name: 'Wren of the Deep Green', formatId: 'commander', commanders: ['legend'],
      createdAt: '2026-02-01T10:00:00Z',
    })
    expect(deck.main).toEqual([{ cardId: 'forest', quantity: 34 }, { cardId: 'bear', quantity: 1 }])
    expect(allCardIds(deck)).toEqual(['forest', 'bear', 'legend'])
  })

  it('fills in the fields this build has and that one did not', () => {
    const deck = upgradeDeck(BEFORE_CATEGORIES)
    expect(deck.categoryOrder).toEqual([])
    expect(deck.versions).toEqual([])
    expect(deck.signatureSpell).toBe(null)
    expect(deck.sideboard).toEqual([])
  })

  it('fills in a deck with nothing in it at all, rather than dropping it', () => {
    // Nothing is lost by opening this: an empty deck is a deck being built.
    const deck = upgradeDeck({ id: 'd2' })
    expect(deck.name).toBe('Untitled deck')
    expect(deck.formatId).toBe('commander')
    expect(deck.main).toEqual([])
    expect(deck.sideboard).toEqual([])
    expect(deck.commanders).toEqual([])
    expect(validateDeck(deck, new Map()).violations.some((v) => v.code === 'deck_too_small')).toBe(true)
  })

  it('drops the entries it cannot make sense of and keeps the rest', () => {
    const deck = upgradeDeck({
      id: 'd3',
      main: [
        { cardId: 'forest', quantity: 4 },
        { cardId: 'bear' },                       // no quantity
        { cardId: 'bear', quantity: 0 },          // no copies
        { cardId: 'bear', quantity: -2 },         // fewer than none
        { cardId: 'bear', quantity: 1.5 },        // half a card
        { cardId: 'bear', quantity: '3' },        // a quantity written as text
        { quantity: 2 },                          // nothing to point at
        { cardId: '', quantity: 2 },
        { cardId: 42, quantity: 2 },
        null,
        'forest',
      ],
      sideboard: { forest: 4 },                   // not a list at all
      commanders: ['legend', '', null, 7],
    })
    expect(deck.main).toEqual([{ cardId: 'forest', quantity: 4 }])
    expect(deck.sideboard).toEqual([])
    expect(deck.commanders).toEqual(['legend'])
  })

  it('leaves alone the fields a newer build wrote', () => {
    const fromTomorrow = {
      id: 'd4',
      name: 'Next Year',
      formatId: 'modern',
      main: [{ cardId: 'bear', quantity: 4, category: 'Beaters', sleeve: 'matte' }],
      sideboard: [],
      commanders: [],
      signatureSpell: null,
      categoryOrder: [],
      maybeboard: [{ cardId: 'forest', quantity: 1 }],   // a zone this build has never heard of
      playgroup: { id: 'p1', rules: ['no fast mana'] },
      versions: [{ label: 'kept', at: '2027-01-01T00:00:00Z' }],
    }
    const deck = upgradeDeck(fromTomorrow)
    expect(deck.maybeboard).toEqual(fromTomorrow.maybeboard)
    expect(deck.playgroup).toBe(fromTomorrow.playgroup)
    expect(deck.versions).toBe(fromTomorrow.versions)
    expect(deck.main[0]).toEqual({ cardId: 'bear', quantity: 4, category: 'Beaters', sleeve: 'matte' })
    // Nothing to put right: the very same object comes back, so storage still
    // decides what to write by identity.
    expect(deck).toBe(fromTomorrow)
  })

  it('keeps a stamped name when it is one, and drops anything else', () => {
    const deck = upgradeDeck({
      id: 'd5',
      main: [
        { cardId: 'a', quantity: 1, name: 'Fractured Scholar' },
        { cardId: 'b', quantity: 1, name: { first: 'Scholar' } },
        { cardId: 'c', quantity: 1, name: 7 },
      ],
      sideboard: [],
      commanders: [],
      cardNames: { legend: 'Legendary Bear', other: 12 },
    })
    expect(deck.main[0].name).toBe('Fractured Scholar')
    expect('name' in deck.main[1]).toBe(false)
    expect('name' in deck.main[2]).toBe(false)
    expect(deck.cardNames).toEqual({ legend: 'Legendary Bear' })
  })

  it('drops the names store when there is nothing left in it', () => {
    expect('cardNames' in upgradeDeck({ id: 'd6', cardNames: { a: 5 } })).toBe(false)
    expect('cardNames' in upgradeDeck({ id: 'd7', cardNames: 'Bear' })).toBe(false)
    expect('cardNames' in upgradeDeck({ id: 'd8' })).toBe(false)
  })

  it('drops a deck it cannot make sense of instead of breaking', () => {
    expect(upgradeDeck(null)).toBe(null)
    expect(upgradeDeck(undefined)).toBe(null)
    expect(upgradeDeck('not a deck')).toBe(null)
    expect(upgradeDeck(7)).toBe(null)
    // A list is not a deck: an array with a main would read as one field.
    expect(upgradeDeck([{ cardId: 'bear', quantity: 1 }])).toBe(null)
  })

  it('puts a name and a format it cannot read back to something usable', () => {
    const deck = upgradeDeck({ id: 'd9', name: { text: 'Wren' }, formatId: 42, signatureSpell: 5 })
    expect(deck.name).toBe('Untitled deck')
    expect(deck.formatId).toBe('commander')
    expect(deck.signatureSpell).toBe(null)
  })

  it('invents no dates for a deck that has none', () => {
    const deck = upgradeDeck({ id: 'd10', main: [], sideboard: [], commanders: [] })
    expect('createdAt' in deck).toBe(false)
    expect('updatedAt' in deck).toBe(false)
  })

  it('round-trips a deck this build wrote, unchanged', () => {
    const mine = {
      id: 'd11', name: 'Rift Burn', formatId: 'modern', commanders: [], signatureSpell: null,
      categoryOrder: [], versions: [], sideboard: [],
      main: [{ cardId: 'bear', quantity: 4, name: 'Grizzly Bears' }],
      createdAt: '2026-09-23T09:00:00Z', updatedAt: '2026-09-23T09:00:00Z',
    }
    expect(upgradeDeck(JSON.parse(JSON.stringify(mine)))).toEqual(mine)
    expect(upgradeDeck(mine)).toBe(mine)
  })
})

describe('the decks storage reads back', () => {
  beforeEach(() => {
    useBackend(memoryBackend())
    clearAll()
  })

  it('opens a deck document written by an older build', () => {
    const backend = memoryBackend()
    backend.write('mtg-companion:v1:deck:d1', JSON.stringify(BEFORE_CATEGORIES))
    useBackend(backend)
    const deck = getDeck('d1')
    expect(deck.name).toBe('Wren of the Deep Green')
    expect(deck.categoryOrder).toEqual([])
    expect(deck.versions).toEqual([])
    expect(listDecks()).toHaveLength(1)
  })

  it('leaves out a deck document that is not a deck, and keeps the others', () => {
    const backend = memoryBackend()
    backend.write('mtg-companion:v1:deck:d1', JSON.stringify(BEFORE_CATEGORIES))
    backend.write('mtg-companion:v1:deck:junk', JSON.stringify('a deck, honestly'))
    backend.write('mtg-companion:v1:deck:half', JSON.stringify({ id: 'half', main: [{ cardId: 'bear', quantity: 2 }, 'nonsense'] }))
    useBackend(backend)
    expect(listDecks().map((d) => d.id).sort()).toEqual(['d1', 'half'])
    expect(getDeck('half').main).toEqual([{ cardId: 'bear', quantity: 2 }])
    expect(getDeck('half').name).toBe('Untitled deck')
  })

  it('takes the key as the deck id when the document has none', () => {
    const backend = memoryBackend()
    backend.write('mtg-companion:v1:deck:d2', JSON.stringify({ ...BEFORE_CATEGORIES, id: undefined }))
    useBackend(backend)
    expect(getDeck('d2')?.id).toBe('d2')
  })

  it('splits an old single-blob file and reads each deck forgivingly', () => {
    const backend = memoryBackend()
    backend.write('mtg-companion:v1', JSON.stringify({
      version: 1,
      decks: [BEFORE_CATEGORIES, { id: 'd2', main: [{ cardId: 'bear', quantity: 1.5 }] }],
    }))
    useBackend(backend)
    expect(listDecks().map((d) => d.id)).toEqual(['d2', 'd1'])
    expect(getDeck('d2').main).toEqual([])
    // Written out as documents of their own, put right.
    expect(JSON.parse(backend.read('mtg-companion:v1:deck:d2')).main).toEqual([])
  })

  it('reads a backup file forgivingly too', () => {
    const file = JSON.stringify({
      version: 4,
      decks: [
        BEFORE_CATEGORIES,
        { id: 'broken', name: 'Broken', main: [{ cardId: 'bear', quantity: 'four' }], sideboard: [] },
        'not a deck',
        null,
      ],
    })
    expect(() => importAll(file)).not.toThrow()
    expect(listDecks().map((d) => d.id).sort()).toEqual(['broken', 'd1'])
    expect(getDeck('broken').main).toEqual([])
    expect(getDeck('d1').versions).toEqual([])
  })

  it('gives a deck in a file with no id one, rather than dropping it and reporting success', () => {
    // A hand-written or hand-edited file. Storage keys a deck by its id, so
    // without one every id-less deck collapsed onto the same key and write()
    // skipped it: the deck was never there, and the importer said "Merged."
    const file = JSON.stringify({
      version: 4,
      decks: [
        { name: 'Goblins', formatId: 'modern', main: [{ cardId: 'bolt', quantity: 4 }], sideboard: [] },
        { name: 'Elves', formatId: 'modern', main: [{ cardId: 'forest', quantity: 2 }], sideboard: [] },
      ],
    })
    importAll(file)
    const decks = listDecks()
    expect(decks.map((d) => d.name).sort()).toEqual(['Elves', 'Goblins'])
    // Two decks, two ids, and each one usable as a key.
    expect(new Set(decks.map((d) => d.id)).size).toBe(2)
    expect(decks.every((d) => typeof d.id === 'string' && d.id)).toBe(true)
    expect(getDeck(decks.find((d) => d.name === 'Goblins').id).main).toEqual([{ cardId: 'bolt', quantity: 4 }])
  })

  it('reads a version being restored as forgivingly, since it was stored too', () => {
    const deck = upgradeDeck({
      ...BEFORE_CATEGORIES,
      versions: [{
        id: 'v1', at: '2026-03-01T10:00:00Z', label: 'Before the rebuild', auto: false,
        commanders: ['legend'], signatureSpell: null, categoryOrder: [],
        main: [{ cardId: 'forest', quantity: 30 }, { cardId: 'bear', quantity: 0 }, null],
        sideboard: [],
      }],
    })
    const back = restoreVersion(deck, 'v1')
    expect(back.main).toEqual([{ cardId: 'forest', quantity: 30 }])
    expect(back.versions[0].label).toBe('Before restore')
  })

  it('exports what it read, so a file from an older build comes back whole', () => {
    saveDeck(upgradeDeck({ ...BEFORE_CATEGORIES, main: [{ cardId: BEAR.id, quantity: 2 }, { cardId: FOREST.id, quantity: 1 }] }))
    const again = JSON.parse(exportAll())
    expect(again.decks[0].main).toEqual([{ cardId: BEAR.id, quantity: 2 }, { cardId: FOREST.id, quantity: 1 }])
  })
})
