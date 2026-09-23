import { useEffect, useState } from 'react'
import { getCardRecordsByIds, refreshCards, migrationsFor } from '../../lib/scryfall.js'
import { pinCards } from '../../lib/cache.js'
import { allCardIds, stampedNames } from '../../lib/deck.js'

const NONE = Object.freeze([])

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
 *
 * A printing id can also stop resolving, because Scryfall merges or deletes
 * ids. For an id it says it has no card for, its /migrations record is read
 * (see card-migrations.js):
 *
 * - `moved` is the ids it merged into another record, each with the card at
 *   the new id. The card is served here under the old id as well, so every
 *   screen reading this hook shows it at once; writing the new id into the
 *   deck is the editor's to do, where it can be said on screen.
 * - `gone` is the ids it has nothing to replace with, each with whatever name
 *   the deck stamped for it, for a screen to say so by.
 *
 * Neither is in `missing`, which is the cards that did not load and have no
 * explanation on screen — so a screen reading this hook must say something
 * about all three, or a card is on it with nothing said about why.
 *
 * Nothing about a migration is guessed. No network and no answer leave the deck
 * exactly as it was, and Scryfall's own not_found still stands, so the id is
 * `gone`. But an id Scryfall says it *merged*, whose replacement card did not
 * arrive, is neither: calling it gone would contradict the answer in hand, so it
 * stays in `missing` with the ordinary "could not be loaded", and the next open
 * asks again.
 */
export default function useDeckCards(deck) {
  const [cards, setCards] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(NONE)
  const [moved, setMoved] = useState(NONE)
  const [gone, setGone] = useState(NONE)

  const ids = deck ? allCardIds(deck) : []
  const key = ids.join(',')

  useEffect(() => {
    setMoved(NONE)
    setGone(NONE)
    if (!ids.length) {
      setCards(new Map())
      setMissing(NONE)
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

    // Only what Scryfall itself said it has no card for, and only then.
    loaded
      .then(({ notFound }) => (cancelled || !notFound?.length
        ? null
        : migrationsFor(notFound, { signal: controller.signal }).then((found) => ({ notFound, found }))))
      .then((answer) => {
        if (cancelled || !answer) return
        const names = stampedNames(deck)
        const followed = []
        const lost = []
        for (const cardId of answer.notFound) {
          const record = answer.found.get(cardId)
          if (record?.strategy === 'merge') {
            // Followed only with the card in hand. Without it the merge is not
            // finished and nothing is said: the record proves the printing was
            // not deleted, so calling it gone would be untrue.
            if (record.card) followed.push({ cardId, newId: record.newId, card: record.card, name: record.card.name })
          } else {
            lost.push({ cardId, name: names.get(cardId) ?? null, at: record?.at ?? null })
          }
        }
        if (followed.length) {
          setCards((current) => {
            const next = new Map(current)
            // Under both ids: the deck still names the old one until the editor
            // writes the new one in.
            for (const m of followed) { next.set(m.cardId, m.card); next.set(m.newId, m.card) }
            return next
          })
          setMissing((current) => current.filter((id) => !followed.some((m) => m.cardId === id)))
        }
        if (lost.length) setMissing((current) => current.filter((id) => !lost.some((g) => g.cardId === id)))
        if (followed.length) setMoved(followed)
        if (lost.length) setGone(lost)
      })
      .catch(() => {})

    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { cards, loading, missing, moved, gone, lookup: (id) => cards.get(id) }
}
