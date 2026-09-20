import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { guest } from '../../lib/board/net.js'
import { relay, rooms } from '../../lib/board/relay.js'
import { openingActions } from '../../lib/board/deck.js'
import { laneFor } from '../../lib/board/placement.js'

/**
 * A seat at a shared table.
 *
 * The relay holds the table; this is the browser's end of it. It opens the
 * wire, says hello, and hands the screen the same things the solo table has
 * — a run, a way to act, a refusal to show — so the table component does not
 * know which kind of table it is sitting at. The one difference it cannot
 * hide is honest: at a shared table nothing changes on screen until the
 * relay says it happened, so a press during a gap in the connection simply
 * does not happen, and `status` is how the screen says so.
 *
 * The seat is remembered per room in this browser, so a reload or a lost
 * connection comes back to the same chair rather than the next empty one.
 * Sitting down deals the deck once: if the seat already has cards, the
 * table was left mid-game and is resumed as it stands.
 */
const memoryKey = (code) => `mtg-companion:room:${code}`
const remember = (code, value) => { try { localStorage.setItem(memoryKey(code), JSON.stringify(value)) } catch { /* private mode */ } }
const recall = (code) => { try { return JSON.parse(localStorage.getItem(memoryKey(code)) ?? 'null') } catch { return null } }

/** Actions that are about a player, given the seat they came from. */
const PLAYER_ACTIONS = new Set(['seat', 'draw', 'untapAll', 'life', 'playerCounter', 'shuffle', 'fromTop', 'makeToken', 'tidy'])
const withPlayer = (action, seat) => (PLAYER_ACTIONS.has(action.type) && action.player === undefined ? { ...action, player: seat } : action)

export default function useRoom({ address, code, name, deck, deckLookup, cardsReady }) {
  const [tick, setTick] = useState(0)
  const [status, setStatus] = useState('connecting')
  const [refusal, setRefusal] = useState(null)
  const [seats, setSeats] = useState([])
  const player = useRef(null)
  const wire = useRef(null)
  const memory = useMemo(() => recall(code) ?? {}, [code])
  const [kept, setKeptState] = useState(Boolean(memory.kept))

  useEffect(() => {
    if (!address || !code) return undefined
    const api = rooms(address)
    const line = relay({ url: api.socketUrl(code), onStatus: (s) => setStatus(s) })
    const me = guest({
      send: line.send,
      name,
      seat: memory.seat ?? null,
      onRefused: (reason, action) => setRefusal({ ...reason, action }),
      onSeats: (list) => setSeats(list),
    })
    line.onMessage((message) => {
      me.receive(message)
      if (me.ready && me.seat && memory.seat !== me.seat) { memory.seat = me.seat; remember(code, memory) }
      setTick((t) => t + 1)
    })
    line.onOpen(() => me.hello())
    player.current = me
    wire.current = line
    return () => { me.leave(); line.close(); player.current = null; wire.current = null }
    // The room and the address are the identity of the connection; the name
    // is said once at hello and a change would mean sitting down again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, code])

  const me = player.current
  const run = me?.ready ? me.run : null
  const seat = me?.seat ?? null

  const doAction = useCallback((action) => {
    const who = player.current
    if (!who?.ready || !who.seat) return
    setRefusal(null)
    who.do(withPlayer(action, who.seat))
  }, [])
  const doAll = useCallback((actions) => { for (const action of actions) doAction(action) }, [doAction])

  /*
   * Sitting down deals the deck — once. The lanes travel with the seat action,
   * as they do at the solo table, so the relay never has to know what a card
   * is. Not before the cards have arrived, because a lane is read off a type
   * line; and not at all if this seat already has cards on the table.
   */
  const dealt = useRef(false)
  useEffect(() => {
    if (dealt.current || !run || !seat || !deck || !cardsReady) return
    const mine = Object.values(run.board.cards).some((inst) => inst.owner === seat)
    dealt.current = true
    if (mine) return
    const seed = Math.floor(Math.random() * 1e9)
    const actions = openingActions(deck, { player: seat, seed })
    actions[0].lanes = Object.fromEntries(
      [...new Set([...actions[0].cards, ...actions[0].command])].map((id) => [id, laneFor(deckLookup(id))]),
    )
    doAll(actions)
  }, [run, seat, deck, cardsReady, deckLookup, doAll])

  const setKept = useCallback((value) => {
    setKeptState(value)
    memory.kept = value
    remember(code, memory)
  }, [code, memory])

  return {
    run, seat, seats, status, refusal, tick,
    doAction, doAll,
    kept, setKept,
    clearRefusal: () => setRefusal(null),
  }
}
