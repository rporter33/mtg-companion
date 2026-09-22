import { useEffect, useState } from 'react'
import { getCardRecordsByIds, refreshCards } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import { allCardIds } from '../../lib/deck.js'

/**
 * Resolves every card id a deck references into card objects.
 *
 * Deck cards are pinned in the cache on load, which is what makes a deck built
 * at home still open on a phone with no signal. Partial results are returned
 * rather than an error — a deck with two unresolved cards should still open and
 * say which two are missing.
 *
 * What is cached shows at once. Then the records that are due are fetched
 * again in the background (see card-refresh.js), so a deck saved before its
 * cards came out, or before this week's bans, reads what Scryfall says now,
 * and the deck is drawn again only if something came back. The refresh waits
 * behind anything the player asks for, and a failure of it is silent: the
 * cached cards are still the deck. It works from the records the cache gave
 * the first time, and is not tried when fetching the deck's missing cards
 * has just failed.
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

    const loaded = getCardRecordsByIds(ids, { signal: controller.signal })
    loaded
      .then(({ records }) => {
        if (cancelled) return
        const found = new Map([...records].map(([id, record]) => [id, record.card]))
        setCards(found)
        setMissing(ids.filter((id) => !found.has(id)))
        pinCards([...found.keys()])
      })
      .catch(() => { if (!cancelled) setMissing(ids) })
      .finally(() => { if (!cancelled) setLoading(false) })

    loaded
      .then(({ records, failed }) => (cancelled || failed
        ? null
        : refreshCards(ids, { signal: controller.signal, records })))
      .then((fresh) => {
        if (cancelled || !fresh?.size) return
        setCards((current) => {
          const next = new Map(current)
          for (const [id, card] of fresh) next.set(id, card)
          return next
        })
      })
      .catch(() => {})

    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { cards, loading, missing, lookup: (id) => cards.get(id) }
}
