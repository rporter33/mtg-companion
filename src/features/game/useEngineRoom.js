import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { relay } from '../../lib/board/relay.js'
import { boardFromView, eventsBetween, standIn } from '../../lib/engine/board.js'
import { leaveOut, seatDeck } from '../../lib/engine/deck.js'

/**
 * A seat at a table the engine holds.
 *
 * The browser's end of `scripts/relay-engine.mjs`: it sits down with the
 * deck's card names, and from then on receives what the engine decided —
 * a status saying whom the game waits on and what they may do, and a view
 * of the table as this seat may see it — and sends back the one thing a
 * player does at a rules-enforced table: choose among what is offered.
 *
 * What comes back is laid onto the same board model the solo and shared
 * tables draw (`src/lib/engine/board.js`), so the table component does not
 * know which authority is behind it. The one thing it is told plainly is
 * what the engine did on its behalf: the windows it passed because nothing
 * was affordable, and the decisions it answered because this protocol
 * cannot yet ask them, both written into the log as lines of their own.
 */
const memoryKey = (code) => `mtg-companion:engine:${code}`
const remember = (code, value) => { try { localStorage.setItem(memoryKey(code), JSON.stringify(value)) } catch { /* private mode */ } }
const recall = (code) => { try { return JSON.parse(localStorage.getItem(memoryKey(code)) ?? 'null') } catch { return null } }

/**
 * Record, for one table, the cards a player chose to play without: the ones
 * the lobby showed them the engine does not know. Kept with the seat rather
 * than passed along once, so a reload of the table still leaves them out
 * instead of sitting down with a deck the engine will refuse.
 */
export function agreeToLeaveOut(code, deckId, names) {
  if (!code) return
  remember(code, { ...(recall(code) ?? {}), without: { deckId, names } })
}

export default function useEngineRoom({ address, code, name, deck, deckLookup, cardsReady }) {
  const [wireStatus, setWireStatus] = useState('connecting')
  const [seat, setSeat] = useState(null)
  const [seats, setSeats] = useState([])
  const [status, setStatus] = useState(null)
  const [run, setRun] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [gone, setGone] = useState(null)
  const wire = useRef(null)
  const board = useRef(null)
  const view = useRef(null)
  const events = useRef([])
  const seq = useRef(0)
  const stands = useRef(new Map())
  const memory = useMemo(() => recall(code) ?? {}, [code])
  // What the lobby agreed to leave out, for this deck only, read forgivingly:
  // it was written by whatever build was running when the player chose.
  const agreed = memory.without?.deckId === deck?.id && Array.isArray(memory.without?.names) ? memory.without.names : []
  const prepared = cardsReady ? leaveOut(seatDeck(deck, deckLookup), agreed) : null
  // A card that has not loaded has no name to send, and the deck sent without
  // it would be smaller than the player's, so the seat is not taken at all
  // while any is missing; the table says so instead.
  const unloaded = prepared?.seat.unloaded ?? 0
  // The deck by name, as a string: the lookup function is new on every
  // render, and an effect keyed on an object rebuilt from it would open a
  // new socket each time. The names themselves change only with the deck.
  const deckKey = prepared && !unloaded ? JSON.stringify({ deck: prepared.seat.deck, sideboard: prepared.seat.sideboard }) : null
  const deckNames = useMemo(() => (deckKey ? JSON.parse(deckKey) : null), [deckKey])
  const leftKey = JSON.stringify(prepared?.left ?? [])
  const leftOut = useMemo(() => JSON.parse(leftKey), [leftKey])
  const sideboardUnloaded = prepared?.seat.sideboardUnloaded ?? 0
  // Named by the engine when it deals: sideboard cards it does not know, left
  // out rather than refused, which the table then says.
  const [sideboardLeftOut, setSideboardLeftOut] = useState([])
  const sat = useRef(false)
  const sideNoted = useRef(false)
  const printingsNoted = useRef(false)
  const seating = useRef([])

  const note = useCallback((text) => {
    events.current = [...events.current, { type: 'said', seq: ++seq.current, turn: board.current?.turn ?? 1, text, player: null }]
  }, [])

  useEffect(() => {
    if (!address || !code || !deckNames) return undefined
    const line = relay({ url: `${address.replace(/\/$/, '').replace(/^http/, 'ws')}/rooms/${encodeURIComponent(code)}/ws`, onStatus: (s) => setWireStatus(s) })
    const side = Object.keys(deckNames.sideboard ?? {}).length ? { sideboard: deckNames.sideboard } : {}
    line.onOpen(() => line.send({ t: 'engine', op: 'sit', name, seat: memory.seat ?? null, deck: deckNames.deck, ...side }))
    line.onMessage((m) => {
      if (m?.t !== 'engine') return
      switch (m.op) {
        case 'seated': {
          // Read forgivingly: a relay from before the sideboard sends none.
          const sideOut = Array.isArray(m.sideboardLeftOut) ? m.sideboardLeftOut.filter((n) => typeof n === 'string') : []
          setSideboardLeftOut(sideOut)
          // Said when the engine first names them, which is the seated after the
          // deal, not the one that answers the sit at once, before there is a deal.
          if (sideOut.length && !sideNoted.current) {
            sideNoted.current = true
            note(`Your sideboard is played without ${sideOut.join(', ')}: the engine does not know ${sideOut.length === 1 ? 'it' : 'them'}.`)
          }
          // The owner's choice (2026-09-21): a printing the engine has not got is
          // shown as the engine's own art to every seat, and the log says so once.
          const missed = Array.isArray(m.unknownPrintings) ? m.unknownPrintings.filter((n) => typeof n === 'string') : []
          if (missed.length && !printingsNoted.current) {
            printingsNoted.current = true
            note(`The engine does not have your printing of ${missed.join(', ')}, so ${missed.length === 1 ? 'it shows' : 'they show'} the engine's own art.`)
          }
          if (!sat.current) {
            if (leftOut.length) {
              const copies = leftOut.reduce((sum, l) => sum + l.count, 0)
              note(`Played without ${leftOut.map((l) => `${l.count} ${l.name}`).join(', ')}: the engine does not know ${copies === 1 ? 'it' : 'them'}.`)
            }
            if (sideboardUnloaded) note(`${sideboardUnloaded === 1 ? 'One sideboard card' : `${sideboardUnloaded} sideboard cards`} did not load, so ${sideboardUnloaded === 1 ? 'it is' : 'they are'} left out.`)
          }
          sat.current = true
          if (m.engineSeat) setSeat(m.engineSeat)
          if (m.seat && memory.seat !== m.seat) { memory.seat = m.seat; remember(code, memory) }
          break
        }
        case 'seats': seating.current = m.seats ?? []; setSeats(seating.current); break
        case 'status': {
          const s = m.status
          if (s?.autoPassed > 0) note(`The engine passed ${s.autoPassed} priority window${s.autoPassed === 1 ? '' : 's'} for you: nothing was affordable.`)
          for (const d of s?.decided ?? []) note(`Decided for you — ${d.prompt}${d.source ? ` (${d.source})` : ''}.`)
          setStatus(s)
          setRefusal(null)
          break
        }
        case 'view': {
          const next = { ...m.state, log: m.log ?? [] }
          for (const c of Object.values(next.cards ?? {})) { const stand = standIn(c); stands.current.set(stand.id, stand) }
          const fresh = eventsBetween(view.current, next, { seq: seq.current })
          if (fresh.length) seq.current = fresh[fresh.length - 1].seq
          events.current = [...events.current, ...fresh]
          // Seats in the room's order once the engine has named them all, so
          // the plates sit where the lobby said they would.
          const order = seating.current.length && seating.current.every((x) => x.engineSeat) ? seating.current.map((x) => ({ id: x.engineSeat })) : null
          board.current = boardFromView(next, { prev: board.current, seats: order })
          view.current = next
          setRun({ board: board.current, events: events.current, restored: false, past: [], refusal: null })
          break
        }
        case 'refused': setRefusal({ message: m.error, stale: Boolean(m.stale) }); break
        case 'gone': setGone(m.reason ?? 'The engine has gone.'); break
        default: break
      }
    })
    wire.current = line
    return () => { line.close(); wire.current = null }
    // The room, the address and the deck's names are the identity of the seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, code, deckKey])

  const send = useCallback((op, params = {}) => {
    const line = wire.current
    if (!line || !status) return false
    setRefusal(null)
    return line.send({ t: 'engine', op, stop: status.stop, ...params })
  }, [status])
  const act = useCallback((index, extra = {}) => send('act', { index, ...extra }), [send])
  const decide = useCallback((params) => send('decide', params), [send])

  /** A card the engine described, by its Scryfall id, until the real record arrives. */
  const cardFor = useCallback((id) => stands.current.get(id) ?? null, [])

  /** Where a permanent sits is the table's to decide, so a drag stays here. */
  const moveCard = useCallback((id, x, y) => {
    const b = board.current
    if (!b?.cards[id]) return
    b.cards[id] = { ...b.cards[id], x, y, z: b.nextZ++ }
    board.current = { ...b, cards: { ...b.cards } }
    setRun((r) => (r ? { ...r, board: board.current } : r))
  }, [])

  return {
    run, seat, seats, status, refusal, gone, wireStatus, unloaded, leftOut, sideboardLeftOut,
    act, decide, cardFor, moveCard,
    refuse: (message) => setRefusal({ message }),
    clearRefusal: () => setRefusal(null),
  }
}
