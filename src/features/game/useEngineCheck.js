import { useEffect, useMemo, useRef, useState } from 'react'
import { rooms } from '../../lib/board/relay.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { seatDeck, verdictOf } from '../../lib/engine/deck.js'

/**
 * What the relay's engine says about each deck on the shelf, asked before a
 * player sits down, so that a deck the engine cannot fully hold says so on its
 * tile rather than after the seat is taken.
 *
 * Each deck is asked about exactly the map a sit would send (`seatDeck`), so
 * the tile and the table cannot disagree. Decks are asked one at a time with
 * the chosen deck first: the engine's first answer waits on the whole card
 * corpus loading, and a shelf's worth of requests would all queue behind it.
 * Answers are kept by the deck's own list, so changing tab does not ask again
 * and two decks with the same list share one answer. A failure is not kept,
 * so the next render after the relay comes back asks again.
 *
 * Returns a Map from deck id to `{ state, total, unloaded, … }`, where state is
 * 'asking', 'complete', 'short', 'cannot-check', 'no-engine', 'failed' (with
 * the relay's words), 'unreachable' or 'unreadable'. With no address, nothing
 * is asked and the Map is empty: the lobby is not at the engine's table.
 */
export default function useEngineCheck({ address, decks, first = null }) {
  const [cards, setCards] = useState(null)
  const [results, setResults] = useState(() => new Map())
  const answers = useRef(new Map())

  // Every card of every deck, not the few the shelf loads for its art. Saved
  // decks are pinned, so these are reads from this device.
  const idsKey = address ? [...new Set(decks.flatMap((d) => [...(d.main ?? []), ...(d.sideboard ?? [])].map((e) => e.cardId)))].sort().join('\n') : ''
  useEffect(() => {
    if (!idsKey) { setCards(null); return undefined }
    const ctl = new AbortController()
    getCardsByIds(idsKey.split('\n'), { signal: ctl.signal })
      .then((found) => setCards(found))
      .catch((e) => { if (e.name !== 'AbortError') setCards(new Map()) })
    return () => ctl.abort()
  }, [idsKey])

  const seats = useMemo(() => {
    const out = new Map()
    if (!cards) return out
    for (const deck of decks) out.set(deck.id, seatDeck(deck, (id) => cards.get(id)))
    return out
  }, [decks, cards])

  // A string, never an object rebuilt each render: an effect keyed on one
  // would ask again on every render (HANDOFF.md, "Traps").
  const askKey = address && seats.size
    ? `${address}|${first ?? ''}|${[...seats].map(([id, s]) => `${id}=${listOf(s)}`).join('|')}`
    : ''
  useEffect(() => {
    if (!askKey) return undefined
    let live = true
    const ctl = new AbortController()
    const api = rooms(address)
    const ids = [...seats.keys()].sort((a, b) => (a === first ? -1 : b === first ? 1 : 0))
    ;(async () => {
      for (const id of ids) {
        const seat = seats.get(id)
        const list = listOf(seat)
        let found = answers.current.get(list)
        if (!found) {
          try {
            found = { reply: await api.check(seat.deck, { sideboard: Object.keys(seat.sideboard).length ? seat.sideboard : null, signal: ctl.signal }) }
            answers.current.set(list, found)
          } catch (e) {
            if (e.name === 'AbortError' || !live) return
            found = { error: e }
          }
        }
        if (!live) return
        setResults((was) => new Map(was).set(`${id}=${list}`, stateOf(seat, found)))
      }
    })()
    return () => { live = false; ctl.abort() }
    // askKey carries the address, the chosen deck and every deck's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey])

  return useMemo(() => {
    const out = new Map()
    if (!address) return out
    for (const deck of decks) {
      const seat = seats.get(deck.id)
      const done = seat && results.get(`${deck.id}=${listOf(seat)}`)
      out.set(deck.id, done ?? { state: 'asking', total: seat?.total ?? 0, unloaded: seat?.unloaded ?? 0 })
    }
    return out
  }, [address, decks, seats, results])
}

/** A deck's lists as one string: what is asked about, and what an answer is kept under. */
const listOf = (seat) => JSON.stringify({ deck: seat.deck, sideboard: seat.sideboard })

/** One deck's answer, or the reason there is none, in the lobby's terms. */
function stateOf(seat, { reply, error }) {
  const base = { total: seat.total, unloaded: seat.unloaded }
  if (!error) return verdictOf(seat, reply)
  if (error.status === 503) return { state: 'no-engine', ...base }
  if (error.status) return { state: 'failed', message: error.message, ...base }
  if (error instanceof SyntaxError) return { state: 'unreadable', ...base }
  return { state: 'unreachable', ...base }
}
