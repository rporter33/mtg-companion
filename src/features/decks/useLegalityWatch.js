import { useEffect, useState } from 'react'
import { listDecks, saveDeck } from '../../lib/storage.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { allCardIds } from '../../lib/deck.js'
import { captureSnapshot, diffAllDecks, summarise } from '../../lib/snapshot.js'

/**
 * On launch, checks whether the rules moved underneath any saved deck.
 *
 * Deliberately quiet: it resolves cards from cache first and only reports when
 * something actually changed. A launch check that speaks every time is one you
 * learn to dismiss without reading.
 */
export default function useLegalityWatch({ enabled = true } = {}) {
  const [report, setReport] = useState([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      const decks = listDecks()
      if (!decks.length) return

      const cardsByDeckId = {}
      for (const deck of decks) {
        const ids = allCardIds(deck)
        if (!ids.length) continue
        try {
          cardsByDeckId[deck.id] = await getCardsByIds(ids, { signal: controller.signal })
        } catch {
          // Offline, or Scryfall unreachable. No data means no verdict — we say
          // nothing rather than reporting a change we cannot substantiate.
        }
      }
      if (cancelled) return

      setReport(diffAllDecks(decks, cardsByDeckId))

      // Re-baseline, so a change is announced once rather than every launch.
      // This happens after the diff is computed, and only for decks we could
      // actually resolve — a deck checked while offline keeps its old snapshot.
      for (const deck of decks) {
        const cards = cardsByDeckId[deck.id]
        if (!cards || !cards.size) continue
        const snapshot = captureSnapshot(deck, cards)
        if (snapshot) saveDeck({ ...deck, snapshot })
      }
    })()

    return () => { cancelled = true; controller.abort() }
  }, [enabled])

  return {
    report: dismissed ? [] : report,
    summary: dismissed ? null : summarise(report),
    dismiss: () => setDismissed(true),
  }
}
