import { useEffect, useState } from 'react'
import { getCardsByIds } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import { allCardIds } from '../../lib/deck.js'

/**
 * Resolves every card id a deck references into card objects.
 *
 * Deck cards are pinned in the cache on load, which is what makes a deck built
 * at home still open on a phone with no signal. Partial results are returned
 * rather than an error — a deck with two unresolved cards should still open and
 * say which two are missing.
 */
export default function useDeckCards(deck) {
  const [cards, setCards] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState([])

  const ids = deck ? allCardIds(deck) : []
  const key = ids.join(',')

  useEffect(() => {
    if (!ids.length) {
      setCards(new Map())
      setMissing([])
      return undefined
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)

    getCardsByIds(ids, { signal: controller.signal })
      .then((found) => {
        if (cancelled) return
        setCards(found)
        setMissing(ids.filter((id) => !found.has(id)))
        pinCards([...found.keys()])
      })
      .catch(() => { if (!cancelled) setMissing(ids) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { cards, loading, missing, lookup: (id) => cards.get(id) }
}
