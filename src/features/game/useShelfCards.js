import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../../lib/scryfall.js'
import { faceIdFor } from '../../lib/deck-art.js'

/**
 * The few cards the shelf needs per deck: its face, for the painting behind
 * the name, and its commanders, for the colour pips. Two or three ids a deck
 * rather than a hundred, which is what lets a screen listing every deck stay
 * cheap.
 *
 * One batched call. Every card in a saved deck is already pinned in the
 * cache, so this is normally a handful of local reads; anything missing is
 * fetched in one request and pinned on the way in, and if there is no network
 * the shelf simply shows names without paintings or pips. Nothing here waits
 * on the network to render.
 */
export default function useShelfCards(decks) {
  const ids = useMemo(() => {
    const set = new Set()
    for (const deck of decks) {
      const face = faceIdFor(deck)
      if (face) set.add(face)
      for (const id of deck.commanders ?? []) if (id) set.add(id)
    }
    return [...set]
  }, [decks])
  const key = ids.join(',')

  const [cards, setCards] = useState(() => new Map())
  useEffect(() => {
    if (!ids.length) { setCards(new Map()); return undefined }
    const controller = new AbortController()
    getCardsByIds(ids, { signal: controller.signal })
      .then((found) => { if (!controller.signal.aborted) setCards(found) })
      .catch(() => { /* offline with a cold cache: the shelf shows names only */ })
    return () => controller.abort()
    // `key` is the ids joined, which is what actually decides whether to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return cards
}
