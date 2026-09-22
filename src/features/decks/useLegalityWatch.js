import { useEffect, useState } from 'react'
import { listDecks, getDeck, saveDeck } from '../../lib/storage.js'
import { getCardRecordsByIds, refreshCards } from '../../lib/scryfall.js'
import { getCardRecords } from '../../lib/cache.js'
import { allCardIds } from '../../lib/deck.js'
import { captureSnapshot, diffAllDecks, summarise, oldestFetch } from '../../lib/snapshot.js'

/**
 * On launch, checks whether the rules moved underneath any saved deck.
 *
 * Deliberately quiet: it only reports when something actually changed. A
 * launch check that speaks every time is one you learn to dismiss without
 * reading.
 *
 * Before comparing, the cards that are due are fetched again (see
 * card-refresh.js), in the background lane, so a ban announced this week
 * reaches a deck saved last month, and the watch is not comparing one frozen
 * record with another. Each deck's missing cards are asked for first, deck by
 * deck; then every deck's cards are refreshed in one pass, so decks share
 * their batches of 75 rather than each sending its own. Once a request fails,
 * nothing more is asked this run, and the rest is compared from the cache.
 * It says how old the oldest data it compared is, because a refresh can fail
 * and leave a deck's cards as they were.
 */
export default function useLegalityWatch({ enabled = true } = {}) {
  const [report, setReport] = useState([])
  const [dataFrom, setDataFrom] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const controller = new AbortController()
    const signal = controller.signal

    ;(async () => {
      const decks = listDecks()
      if (!decks.length) return
      const now = Date.now()

      // Each deck's records, { card, fetchedAt }, by card id.
      const held = {}
      let failed = false
      for (const deck of decks) {
        if (cancelled) return
        const ids = allCardIds(deck)
        if (!ids.length) continue
        try {
          if (failed) {
            held[deck.id] = await getCardRecords([...new Set(ids)])
          } else {
            const loaded = await getCardRecordsByIds(ids, { signal, background: true, now })
            held[deck.id] = loaded.records
            failed = loaded.failed
          }
        } catch {
          // The run was abandoned. No data means no verdict — we say nothing
          // rather than reporting a change we cannot substantiate.
        }
      }
      if (cancelled) return

      const all = new Map()
      for (const records of Object.values(held)) for (const [id, record] of records) all.set(id, record)
      let fresh = new Map()
      if (!failed) {
        try {
          fresh = await refreshCards([...all.keys()], { signal, now, records: all })
        } catch {
          // Abandoned: what was saved is what there is.
        }
      }
      if (cancelled) return

      const cardsByDeckId = {}
      for (const [deckId, records] of Object.entries(held)) {
        cardsByDeckId[deckId] = new Map([...records].map(([id, record]) => [id, fresh.get(id) ?? record.card]))
      }

      // The records compared: every loaded card of every deck with a
      // snapshot to compare against, dated as fetched, or now if just fetched.
      const compared = new Set(decks
        .filter((deck) => deck.snapshot && cardsByDeckId[deck.id])
        .flatMap((deck) => [...cardsByDeckId[deck.id].keys()]))
      const fetched = [...compared].map((id) => ({ fetchedAt: fresh.has(id) ? now : all.get(id)?.fetchedAt }))

      setReport(diffAllDecks(decks, cardsByDeckId))
      setDataFrom(oldestFetch(fetched))

      // Re-baseline, so a change is announced once rather than every launch.
      // This happens after the diff is computed, and only for decks we could
      // actually resolve. A deck read from the cache alone, offline or after a
      // failed request, is snapshotted from what the cache says; a card that
      // comes out after such a snapshot is still not announced, because the
      // snapshot notes a record from before Scryfall listed the card (see
      // cameOut in snapshot.js). Each deck is read again first: the refresh
      // can take a while, and a deck edited or deleted in the meantime is the
      // player's, so only its snapshot is replaced, and a deleted one is not
      // brought back.
      for (const deck of decks) {
        const cards = cardsByDeckId[deck.id]
        if (!cards || !cards.size) continue
        const current = getDeck(deck.id)
        if (!current) continue
        const snapshot = captureSnapshot(current, cards)
        if (snapshot) saveDeck({ ...current, snapshot })
      }
    })()

    return () => { cancelled = true; controller.abort() }
  }, [enabled])

  return {
    report: dismissed ? [] : report,
    summary: dismissed ? null : summarise(report),
    dataFrom: dismissed ? null : dataFrom,
    dismiss: () => setDismissed(true),
  }
}
