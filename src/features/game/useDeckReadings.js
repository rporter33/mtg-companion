import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../../lib/scryfall.js'
import { playedEntries, readBracket, readPlan } from '../../lib/deck-reading.js'

/**
 * What this app reads of each deck on the shelf (lib/deck-reading.js): the plan
 * most of its cards fit, and, where `brackets` is set, the lowest Commander bracket
 * its Game Changers allow.
 *
 * Both need every card a deck plays, not the two or three the shelf loads for its
 * paintings (useShelfCards), so this asks for them apart, and the paintings never
 * wait on it. Saved decks are pinned in the card cache, so this is normally reads
 * from this device; anything missing is fetched and pinned as the shelf's cards
 * are. The cards are kept with the shelf they were asked for, so straight after a
 * change of tab no deck is read against another shelf's cards.
 *
 * Returns a Map from deck id to `{ plan, bracket }`, each null where it was not
 * read — a card not arrived, or no bracket asked for — and an empty Map until the
 * cards are here.
 */
export default function useDeckReadings(decks, { brackets = false } = {}) {
  const idsKey = [...new Set(decks.flatMap((d) => playedEntries(d).map((e) => e.cardId)))].sort().join('\n')
  const [cards, setCards] = useState(null)
  useEffect(() => {
    if (!idsKey) { setCards(null); return undefined }
    const ctl = new AbortController()
    getCardsByIds(idsKey.split('\n'), { signal: ctl.signal })
      .then((found) => setCards({ key: idsKey, found }))
      // Offline with a cold cache: nothing is read, and the shelf says nothing of it.
      .catch((e) => { if (e.name !== 'AbortError') setCards({ key: idsKey, found: new Map() }) })
    return () => ctl.abort()
  }, [idsKey])

  return useMemo(() => {
    const out = new Map()
    if (!cards || cards.key !== idsKey) return out
    const lookup = (id) => cards.found.get(id)
    for (const deck of decks) {
      out.set(deck.id, { plan: readPlan(deck, lookup), bracket: brackets ? readBracket(deck, lookup) : null })
    }
    return out
  }, [decks, cards, idsKey, brackets])
}
