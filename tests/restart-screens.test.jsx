/**
 * What the screens say of a table the engine holds when its game comes back or
 * does not (HANDOFF.md, M7, and M7's review): the lobby's lines, which no test
 * reached before, and the actions panel while the game is coming back.
 *
 * The lobby asks the relay over HTTP (`rooms(address).peek`, `.health`), so it
 * is rendered against a relay that is this file's own: a `fetch` answering what
 * a relay of the given shape would. The words are the app's own about what the
 * room reports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Seats from '../src/features/game/Seats.jsx'
import { EngineActions } from '../src/features/game/Table.jsx'
import { setPref } from '../src/lib/storage.js'
import { restoringLine } from '../src/lib/engine/restart.js'

const RELAY = 'http://relay.test'
const CODE = 'ABCDE'

let root = null
let container = null
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  setPref('relayUrl', RELAY)
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null; container = null
  vi.unstubAllGlobals()
})

/** A relay answering the lobby: its health, and the room as `peek` finds it (null for a 404). */
const relayAnswering = ({ engine = true, room = null }) => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = new URL(url).pathname
    const answer = (status, body) => ({ ok: status < 400, status, json: async () => body })
    if (path === '/health') return answer(200, { ok: true, rooms: room ? 1 : 0, engine })
    if (path === `/rooms/${CODE}`) return room ? answer(200, { code: CODE, ...room }) : answer(404, { error: 'That room has gone.' })
    return answer(404, { error: 'not found' })
  }))
}

const render = async (element) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(element) })
  // The lobby's first look at the relay, and its health, answered.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return container
}
const notices = (el) => [...el.querySelectorAll('.lobby__notice')]
const said = (el) => notices(el).map((n) => n.textContent)

/** A dealt room the engine holds, as `GET /rooms/<code>` says one. */
const DEALT = {
  mode: 'enforced', ai: 'heuristic', started: true, dealt: true, over: false, pace: 600, paced: true,
  level: 'intermediate', played: 'intermediate', profile: 'production-raceclock', mulligans: true,
  seats: [{ seat: 'p1', name: 'Robin', here: false, ready: true, ai: null, engineSeat: 'e0' }, { seat: 'p2', name: 'The engine', here: true, ready: true, ai: 'heuristic', engineSeat: 'e1', level: 'intermediate' }],
  engineDeck: { asked: 'mirror', played: 'mirror', cards: 60, colours: ['R'] },
  format: { asked: 'standard', played: 'standard' },
}

describe('the lobby of a table the engine holds, when its game comes back or does not', () => {
  it('says a table whose game is coming back is, and which of the two restarted, as a status', async () => {
    relayAnswering({ room: { ...DEALT, started: true, restoring: 'relay' } })
    let el = await render(<Seats engine={CODE} />)
    const coming = notices(el).find((n) => /coming back/.test(n.textContent))
    expect(coming.textContent).toBe('Its relay restarted, and the game is coming back as it was at the last stop.')
    expect(coming.getAttribute('role')).toBe('status')
    await act(async () => { root.unmount() }); container.remove(); root = null
    relayAnswering({ room: { ...DEALT, restoring: 'engine' } })
    el = await render(<Seats engine={CODE} />)
    expect(said(el)).toContain('Its engine stopped, and is starting again with the game as it was at the last stop.')
  })

  it('says why a table whose game could not come back has gone, in the room\'s own words', async () => {
    const reason = 'The engine stopped again before the game could go on, so it was not started a third time: the engine stopped (exit 3).'
    relayAnswering({ room: { ...DEALT, gone: reason } })
    const el = await render(<Seats engine={CODE} />)
    expect(said(el)[0]).toBe(`That table has gone. ${reason}`)
    // Nothing else is offered for a table that has gone.
    expect(el.querySelector('.lobby__seatlist')).toBe(null)
  })

  it('says a table the relay no longer has has gone, and how long one is kept, where the relay has an engine', async () => {
    relayAnswering({ engine: true, room: null })
    const el = await render(<Seats engine={CODE} />)
    expect(said(el)[0]).toBe('That table has gone. A table the engine holds is kept for a week after the last move, through a restart of its relay.')
  })

  it('does not say a table has gone where the relay has no engine to open it with, and says why it is not open', async () => {
    // A relay with no engine leaves such a table's file where it is, for one that has (§3 item 21).
    relayAnswering({ engine: false, room: null })
    const el = await render(<Seats engine={CODE} />)
    const line = notices(el)[0]
    expect(line.textContent).toBe("That table is not open on this relay. This relay is running without an engine. A table the engine holds opens only on a relay with one, and waits on the relay's disk until it has one again, for a week after its last move.")
    expect(line.getAttribute('role')).toBe('status')
    expect(line.textContent).not.toMatch(/has gone/)
  })

  it('says a game that had ended as under way at its level rather than as a table to be dealt, before anybody sits to look at it', async () => {
    // A relay that restarts takes such a game back only when somebody sits (M7's review).
    relayAnswering({ room: { ...DEALT, over: true } })
    const el = await render(<Seats engine={CODE} />)
    expect(el.querySelector('input[name="engine-level"]')).toBe(null)
    expect(said(el).some((t) => /under way at the intermediate level/.test(t))).toBe(true)
  })
})

describe('the actions panel while the game is coming back', () => {
  const panel = async (props) => render(
    <EngineActions offers={[]} selected={null} name={null} card={null} myStop={false} onAct={() => {}} onInspect={() => {}} onClose={() => {}} {...props} />,
  )

  it('says the game is coming back, not whose stop it is not', async () => {
    const el = await panel({ restoring: 'relay' })
    expect(el.textContent).toContain('coming back')
    expect(el.textContent).toContain(restoringLine('relay'))
    expect(el.textContent).not.toMatch(/not your stop|not waiting on you/)
  })

  it('says whose stop it is once the game is back', async () => {
    const el = await panel({ restoring: null })
    expect(el.textContent).toContain('not your stop')
    expect(el.textContent).toContain('The engine is not waiting on you.')
  })
})
