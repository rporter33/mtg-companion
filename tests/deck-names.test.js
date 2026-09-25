import { describe, it, expect, beforeEach } from 'vitest'
import { memoryBackend } from '../src/lib/storage-backend.js'
import { useBackend, listDecks, clearAll, saveDeck } from '../src/lib/storage.js'
import {
  createDeck, addCard, setCommanders, deckFromSeed, stampNames, stampedNames, swapPrinting, upgradeDeck,
} from '../src/lib/deck.js'
import { deckSections } from '../src/lib/categories.js'
import { deckToText } from '../src/lib/decklist.js'
import { seatDeck } from '../src/lib/engine/deck.js'
import { captureSnapshot } from '../src/lib/snapshot.js'
import { BEAR, FOREST, COMMANDER_BEAR, legalEverywhere } from './fixtures.js'

/**
 * The name a deck keeps for its own cards.
 *
 * A deck stores printing ids, and a printing id can stop resolving: Scryfall
 * merges or deletes ids, most often the preview printings a deck built during a
 * spoiler season is full of. Once that happens there is no record to read a
 * name from, and a row, an export and the rules engine had nothing to call the
 * card. So the name Scryfall gave is written down while the card is in hand,
 * and read wherever the card is missing. Nothing invents one.
 *
 * A preview printing of a Reality Fracture card, the case this is for.
 */
const SCHOLAR = legalEverywhere({ id: 'fra-scholar-preview', name: 'Fractured Scholar', set: 'fra', collector_number: '53' })
const SCHOLAR_AGAIN = { ...SCHOLAR, id: 'fra-scholar-merged', collector_number: '53a' }
// A bear with a printing to name, as a record off the wire has.
const BEAR_HOB = { ...BEAR, set: 'hob', collector_number: '12' }
const cards = new Map([[BEAR.id, BEAR_HOB], [FOREST.id, FOREST], [COMMANDER_BEAR.id, COMMANDER_BEAR], [SCHOLAR.id, SCHOLAR]])
const lookup = (id) => cards.get(id) ?? null

/** A Commander deck of a bear, a forest and a preview printing. */
function built() {
  let deck = createDeck({ name: 'Rift Green', formatId: 'commander' })
  deck = setCommanders(deck, [COMMANDER_BEAR.id])
  deck = addCard(deck, BEAR.id, 1)
  deck = addCard(deck, SCHOLAR.id, 1)
  deck = addCard(deck, FOREST.id, 2, 'sideboard')
  return stampNames(deck, lookup)
}

describe('stamping a name', () => {
  it('writes each card\'s name, as Scryfall gave it, on the entry', () => {
    const deck = built()
    expect(deck.main.map((e) => [e.cardId, e.name])).toEqual([
      [BEAR.id, 'Grizzly Bears'], [SCHOLAR.id, 'Fractured Scholar'],
    ])
    expect(deck.sideboard[0].name).toBe('Forest')
  })

  it('keeps the command zone\'s names beside it, since it holds ids and not entries', () => {
    expect(built().cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear' })
  })

  it('leaves everything else about an entry alone', () => {
    const deck = stampNames({
      ...createDeck(), main: [{ cardId: BEAR.id, quantity: 3, category: 'Beaters' }], sideboard: [], commanders: [],
    }, lookup)
    expect(deck.main[0]).toEqual({ cardId: BEAR.id, quantity: 3, category: 'Beaters', name: 'Grizzly Bears' })
  })

  it('invents nothing for a card that is not in hand, and keeps what was stamped before', () => {
    const deck = built()
    // The scholar's printing is gone: nothing can be looked up for it now.
    const later = stampNames(deck, (id) => (id === SCHOLAR.id ? null : lookup(id)))
    expect(later.main.find((e) => e.cardId === SCHOLAR.id).name).toBe('Fractured Scholar')
    expect(later.cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear' })
    const bare = stampNames(createDeck(), () => null)
    expect('cardNames' in bare).toBe(false)
  })

  it('gives back the very same deck when there is nothing to write', () => {
    const deck = built()
    expect(stampNames(deck, lookup)).toBe(deck)
    expect(stampNames(deck, () => null)).toBe(deck)
  })

  it('keeps the name of a commander that has been taken out, for the versions that hold it', () => {
    // A main-deck entry keeps its name through any removal, because a version
    // clones the entry whole. `cardNames` is in no version, so pruning it here
    // threw away the only record of what a commander was called — and restoring
    // the version that holds it then brought the commander back nameless.
    const deck = stampNames(setCommanders(built(), []), lookup)
    expect(deck.cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear' })
    expect(stampedNames(deck).get(COMMANDER_BEAR.id)).toBe('Legendary Bear')
    // A deck that never had one still gets no store at all.
    expect('cardNames' in stampNames(createDeck(), () => null)).toBe(false)
  })

  it('survives a commander swapped for another, so a restore still names the first', () => {
    // What the editor's commit does when the incoming commander has not loaded.
    const other = legalEverywhere({ id: 'other-bear', name: 'Another Bear' })
    const deck = stampNames(setCommanders(built(), [other.id]), (id) => (id === other.id ? other : null))
    expect(deck.cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear', [other.id]: 'Another Bear' })
  })

  it('reads a Map or an object of cards as well as a function', () => {
    const deck = addCard(createDeck(), BEAR.id, 1)
    expect(stampNames(deck, cards).main[0].name).toBe('Grizzly Bears')
    expect(stampNames(deck, { [BEAR.id]: BEAR }).main[0].name).toBe('Grizzly Bears')
  })

  it('is written where a card is added from the card sheet', () => {
    // What AddToDeck does: the card it is showing is the only one in hand.
    useBackend(memoryBackend())
    clearAll()
    saveDeck(createDeck({ name: 'Elves', formatId: 'commander' }))
    const deck = listDecks()[0]
    saveDeck(stampNames(addCard(deck, SCHOLAR.id, 1), (id) => (id === SCHOLAR.id ? SCHOLAR : null)))
    expect(listDecks()[0].main).toEqual([{ cardId: SCHOLAR.id, quantity: 1, name: 'Fractured Scholar' }])
  })

  it('is written where the guide hands a commander over', () => {
    const deck = deckFromSeed({ card: COMMANDER_BEAR })
    expect(deck.commanders).toEqual([COMMANDER_BEAR.id])
    expect(deck.cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear' })
  })

  it('follows the card when a printing is swapped', () => {
    const deck = swapPrinting(built(), SCHOLAR.id, SCHOLAR_AGAIN.id)
    // The same card under a new id: the name it was stamped with still holds.
    expect(stampedNames(deck).get(SCHOLAR_AGAIN.id)).toBe('Fractured Scholar')
    expect(stampedNames(deck).has(SCHOLAR.id)).toBe(false)
  })

  it('follows a commander whose printing is swapped, name and all', () => {
    const other = `${COMMANDER_BEAR.id}-again`
    const deck = swapPrinting(built(), COMMANDER_BEAR.id, other)
    expect(deck.commanders).toEqual([other])
    // Both ids: it is the same card under each, and a version taken before the
    // swap still holds the old one in its command zone.
    expect(deck.cardNames).toEqual({
      [COMMANDER_BEAR.id]: 'Legendary Bear', [other]: 'Legendary Bear',
    })
  })

  it('follows a signature spell, which choosing a printing used to leave behind', () => {
    const deck = stampNames({
      ...createDeck({ formatId: 'oathbreaker' }),
      commanders: ['walker'], signatureSpell: SCHOLAR.id, main: [], sideboard: [],
    }, lookup)
    expect(deck.cardNames[SCHOLAR.id]).toBe('Fractured Scholar')
    const swapped = swapPrinting(deck, SCHOLAR.id, SCHOLAR_AGAIN.id)
    expect(swapped.signatureSpell).toBe(SCHOLAR_AGAIN.id)
    expect(swapped.cardNames[SCHOLAR_AGAIN.id]).toBe('Fractured Scholar')
  })

  it('survives a save and a read back', () => {
    const store = memoryBackend()
    useBackend(store)
    clearAll()
    saveDeck(built())
    // A new session over the same store, so the decks come from the documents
    // rather than from memory.
    useBackend(store)
    const back = listDecks()[0]
    expect(stampedNames(back).get(SCHOLAR.id)).toBe('Fractured Scholar')
    expect(stampedNames(back).get(COMMANDER_BEAR.id)).toBe('Legendary Bear')
    expect(upgradeDeck(back)).toBe(back)
  })

  it('reads a name out of an older deck\'s legality snapshot, so it needs no new save', () => {
    // Snapshots have recorded each card's name since they existed, and a deck
    // saved before any of this has one but no stamp.
    const plain = addCard(createDeck({ formatId: 'commander' }), SCHOLAR.id, 1)
    const older = { ...plain, snapshot: captureSnapshot(plain, cards) }
    expect(older.main[0].name).toBeUndefined()
    expect(stampedNames(older).get(SCHOLAR.id)).toBe('Fractured Scholar')
  })

  it('prefers the stamp on the entry to the one in the snapshot', () => {
    const deck = { ...built(), snapshot: { version: 1, cards: { [SCHOLAR.id]: { name: 'Something Else' } } } }
    expect(stampedNames(deck).get(SCHOLAR.id)).toBe('Fractured Scholar')
  })

  it('promotes the snapshot\'s name onto the entry, rather than leaving it to be overwritten', () => {
    // A deck saved before the stamp existed, whose only name for the scholar is
    // in the snapshot — and whose printing Scryfall no longer has, so the
    // snapshot the next save writes will not hold it. The commit has to move
    // the name onto the entry, or that save deletes it for good.
    const plain = addCard(createDeck({ formatId: 'commander' }), SCHOLAR.id, 1)
    const older = { ...plain, snapshot: captureSnapshot(plain, cards) }
    const committed = stampNames(older, () => null)
    expect(committed.main[0].name).toBe('Fractured Scholar')
    // And it survives the snapshot being replaced from the cards that loaded.
    const rebaselined = { ...committed, snapshot: captureSnapshot(committed, new Map()) }
    expect(stampedNames(rebaselined).get(SCHOLAR.id)).toBe('Fractured Scholar')
  })

  it('promotes a commander\'s snapshot name the same way', () => {
    const plain = setCommanders(createDeck({ formatId: 'commander' }), [COMMANDER_BEAR.id])
    const older = { ...plain, snapshot: captureSnapshot(plain, cards) }
    expect(stampNames(older, () => null).cardNames).toEqual({ [COMMANDER_BEAR.id]: 'Legendary Bear' })
  })
})

describe('what reads the stamp', () => {
  /** The deck as it stands once Scryfall has no card for the scholar's id. */
  const gone = () => built()
  const withoutScholar = (id) => (id === SCHOLAR.id ? null : lookup(id))

  it('the editor\'s rows, in every view', () => {
    const sections = deckSections(gone(), withoutScholar)
    const entries = sections.flatMap((s) => s.entries)
    const scholar = entries.find((e) => e.cardId === SCHOLAR.id)
    expect(scholar.card).toBe(null)
    expect(scholar.name).toBe('Fractured Scholar')
    // And the commander, whose name is not on an entry at all.
    expect(entries.find((e) => e.cardId === COMMANDER_BEAR.id).name).toBe('Legendary Bear')
  })

  it('the rows of a deck that stamped nothing, which say what they always said', () => {
    const deck = addCard(createDeck(), 'never-seen', 1)
    const entry = deckSections(deck, () => null).flatMap((s) => s.entries)[0]
    expect(entry.name).toBeUndefined()
  })

  it('the deck text export, by name and without a printing it cannot know', () => {
    const text = deckToText(gone(), withoutScholar)
    expect(text).toContain('1 Fractured Scholar\n')
    expect(text).not.toContain('(FRA)')
    expect(text).toContain('1 Legendary Bear')
    // A card in hand still carries its printing, as it always has.
    expect(deckToText(gone(), lookup)).toContain('1 Fractured Scholar (FRA) 53')
  })

  it('the deck text export, which says so where nothing was stamped', () => {
    const deck = addCard(createDeck(), 'abcdef1234567890', 2)
    expect(deckToText(deck, () => null)).toContain('2 (unloaded abcdef12)')
  })

  it('the engine\'s deck, so a gone printing still plays', () => {
    const seat = seatDeck(gone(), withoutScholar)
    expect(seat.deck['Fractured Scholar']).toBe(1)
    // The card still in hand keeps its printing; the stamped one is a plain
    // count, because a name is all the deck knows.
    expect(seat.deck['Grizzly Bears']).toEqual({ count: 1, set: 'hob', number: '12' })
    expect(seat.unloaded).toBe(0)
    // A Commander deck's commander goes apart from its library, to the command
    // zone, and counts among its cards (M6; CR 903.5a).
    expect(seat.commander).toEqual({ name: 'Legendary Bear' })
    expect(seat.deck).not.toHaveProperty('Legendary Bear')
    expect(seat.total).toBe(3)
  })

  it('the engine\'s deck, which still counts a card with no name at all as unloaded', () => {
    const deck = addCard(built(), 'never-seen', 3)
    const seat = seatDeck(deck, withoutScholar)
    expect(seat.unloaded).toBe(3)
    expect(seat.total).toBe(6)
  })

  it('the engine\'s deck, sending a name the engine can read', () => {
    // Scryfall names a reversible card "X // X", which the engine refuses, and
    // a stamp carries no layout to tell it apart by. Two halves the same are
    // the one shape that can only be that card.
    const deck = { ...createDeck({ formatId: 'modern' }), main: [{ cardId: 'rev', quantity: 1, name: 'Propaganda // Propaganda' }], sideboard: [], commanders: [] }
    expect(Object.keys(seatDeck(deck, () => null).deck)).toEqual(['Propaganda'])
    // A real two-faced card keeps both names, as Scryfall spells it.
    const two = { ...deck, main: [{ cardId: 'mdfc', quantity: 1, name: 'Agadeem\'s Awakening // Agadeem, the Undercrypt' }] }
    expect(Object.keys(seatDeck(two, () => null).deck)).toEqual(['Agadeem\'s Awakening // Agadeem, the Undercrypt'])
  })
})

beforeEach(() => {
  useBackend(memoryBackend())
  clearAll()
})
