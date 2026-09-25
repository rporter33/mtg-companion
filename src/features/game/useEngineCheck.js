import { useEffect, useMemo, useRef, useState } from 'react'
import { rooms } from '../../lib/board/relay.js'
import { getCardsByIds } from '../../lib/scryfall.js'
import { checkedDeck, recordsByName, seatDeck, verdictOf } from '../../lib/engine/deck.js'
import { setsOf } from '../../lib/engine/opponent.js'

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
 * so it is asked again when the chosen deck, the shelf or the address changes;
 * it is not retried on a timer.
 *
 * Returns a Map from deck id to `{ state, total, unloaded, seat?, sets?, … }`, where state is
 * 'asking', 'complete', 'short', 'cannot-check', 'no-engine', 'failed' (with
 * the relay's words), 'unreachable' or 'unreadable'. With no address, nothing
 * is asked and the Map is empty: the lobby is not at the engine's table.
 */
export default function useEngineCheck({ address, decks, first = null }) {
  const [cards, setCards] = useState(null)
  const [results, setResults] = useState(() => new Map())
  const answers = useRef(new Map())

  // Every card of every deck, not the few the shelf loads for its art, and its
  // commanders, which a Commander deck sends apart (M6). Saved decks are
  // pinned, so these are reads from this device.
  const idsKey = address ? [...new Set(decks.flatMap((d) => [...(d.main ?? []), ...(d.sideboard ?? []), ...(d.commanders ?? []).map((cardId) => ({ cardId }))].map((e) => e.cardId)))].filter(Boolean).sort().join('\n') : ''
  // The cards are kept with the shelf they were fetched for. Straight after a
  // change of tab the new decks would otherwise be read against the old
  // shelf's cards, found wanting, and asked about as decks of nothing.
  useEffect(() => {
    if (!idsKey) { setCards(null); return undefined }
    const ctl = new AbortController()
    getCardsByIds(idsKey.split('\n'), { signal: ctl.signal })
      .then((found) => setCards({ key: idsKey, found }))
      .catch((e) => { if (e.name !== 'AbortError') setCards({ key: idsKey, found: new Map() }) })
    return () => ctl.abort()
  }, [idsKey])

  // Beside each seat, the main deck's cards by the name the seat sends them
  // under, so a card the engine does not know can be given a reason from its
  // printing's set. Never sent: the engine is asked about names alone.
  // And the sets each deck uses (`setsOf`), which a deck of the engine's own
  // is built from by default (M5), so the lobby can name them before anyone sits.
  const [seats, records, setLists] = useMemo(() => {
    const out = new Map()
    const named = new Map()
    const used = new Map()
    if (!cards || cards.key !== idsKey) return [out, named, used]
    const lookup = (id) => cards.found.get(id)
    for (const deck of decks) {
      out.set(deck.id, seatDeck(deck, lookup))
      named.set(deck.id, recordsByName([...(deck.main ?? []), ...(deck.commanders ?? []).map((cardId) => ({ cardId }))], lookup))
      used.set(deck.id, setsOf(deck, lookup))
    }
    return [out, named, used]
  }, [decks, cards, idsKey])

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
            found = { reply: await api.check(checkedDeck(seat), { sideboard: Object.keys(seat.sideboard).length ? seat.sideboard : null, signal: ctl.signal }) }
            answers.current.set(list, found)
          } catch (e) {
            if (e.name === 'AbortError' || !live) return
            found = { error: e }
          }
        }
        if (!live) return
        setResults((was) => new Map(was).set(`${id}=${list}`, stateOf(seat, found, records.get(id))))
      }
    })()
    return () => { live = false; ctl.abort() }
    // askKey carries the address, the chosen deck and every deck's list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey])

  // Each answer carries the seat it was asked about (`seat`, the map a sit
  // would send), so a deck chosen for the engine's own seat (M5) is sent as
  // exactly the names the engine was asked about, as a player's own deck is.
  return useMemo(() => {
    const out = new Map()
    if (!address) return out
    for (const deck of decks) {
      const seat = seats.get(deck.id)
      const done = seat && results.get(`${deck.id}=${listOf(seat)}`)
      out.set(deck.id, { ...(done ?? { state: 'asking', total: seat?.total ?? 0, unloaded: seat?.unloaded ?? 0 }), ...(seat ? { seat, sets: setLists.get(deck.id) ?? [] } : {}) })
    }
    return out
  }, [address, decks, seats, setLists, results])
}

/** A deck's lists as one string: what is asked about, and what an answer is kept under. */
const listOf = (seat) => JSON.stringify({ deck: seat.deck, sideboard: seat.sideboard, ...(seat.commander ? { commander: seat.commander } : {}) })

/** One deck's answer, or the reason there is none, in the lobby's terms. */
function stateOf(seat, { reply, error }, records) {
  const base = { total: seat.total, unloaded: seat.unloaded }
  if (!error) return verdictOf(seat, reply, records)
  if (error.status === 503) return { state: 'no-engine', ...base }
  if (error.status) return { state: 'failed', message: error.message, ...base }
  if (error instanceof SyntaxError) return { state: 'unreadable', ...base }
  return { state: 'unreachable', ...base }
}
