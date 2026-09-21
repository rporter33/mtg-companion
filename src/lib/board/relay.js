/**
 * The wire to the relay.
 *
 * Produces the same shape the loopback and the WebRTC peer do — `{ send,
 * onMessage, close }` — so the protocol in `net.js` never learns which one it
 * is talking through. What is added is the part a real network needs and a
 * loopback does not: coming back.
 *
 * A socket dies for reasons that have nothing to do with the game — a phone
 * changing networks, a proxy's idle timeout, the server restarting for a
 * deploy. Each of those used to look the same to a client: silence. So the
 * wire reconnects on its own, waiting longer each time it fails (half a
 * second, then one, two, four, up to thirty, with a little jitter so a
 * hundred clients do not all return in the same instant), and it says what
 * it is doing through `onStatus` so the screen can say "reconnecting" rather
 * than freezing. Close code 1012 is the server saying "back in a moment", so
 * that one reconnects sooner and is not counted as a failure.
 *
 * Every time the socket opens, `onOpen` fires, which is where the guest says
 * hello again and gets its seat and the table back. Nothing sent while the
 * wire is down is queued: the guest never applies its own actions early, so a
 * press made during a gap simply did not happen, and the screen says so.
 */
const FIRST_MS = 500
const MOST_MS = 30 * 1000
const RESTART_MS = 250
/** The server's "back in a moment". */
export const SERVICE_RESTART = 1012

export function relay({ url, WebSocket: Socket = globalThis.WebSocket, onStatus = null } = {}) {
  let socket = null
  let handler = null
  let opened = null
  let closed = false
  let attempts = 0
  let timer = null
  let status = 'connecting'

  const say = (next, detail) => {
    if (status === next && !detail) return
    status = next
    onStatus?.(next, detail)
  }

  const connect = () => {
    if (closed) return
    say(attempts ? 'reconnecting' : 'connecting', attempts ? { attempt: attempts } : undefined)
    let ws
    try {
      ws = new Socket(url)
    } catch (error) {
      retry()
      return
    }
    socket = ws
    ws.onopen = () => {
      if (ws !== socket) return
      attempts = 0
      say('open')
      opened?.()
    }
    ws.onmessage = (event) => {
      if (ws !== socket) return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      handler?.(message)
    }
    ws.onerror = () => { /* the close that follows carries the decision */ }
    ws.onclose = (event) => {
      if (ws !== socket) return
      socket = null
      if (closed) { say('closed'); return }
      retry(event?.code === SERVICE_RESTART)
    }
  }

  const retry = (restart = false) => {
    if (closed) return
    const wait = restart
      ? RESTART_MS
      : Math.min(MOST_MS, FIRST_MS * 2 ** Math.min(attempts, 6)) * (0.8 + Math.random() * 0.4)
    attempts += restart ? 0 : 1
    say('reconnecting', { attempt: attempts, restart, wait: Math.round(wait) })
    clearTimeout(timer)
    timer = setTimeout(connect, wait)
  }

  connect()

  return {
    get status() { return status },
    send: (message) => {
      if (!socket || socket.readyState !== 1) return false
      socket.send(JSON.stringify(message))
      return true
    },
    onMessage: (fn) => { handler = fn },
    onOpen: (fn) => { opened = fn },
    close: () => {
      closed = true
      clearTimeout(timer)
      const ws = socket
      socket = null
      try { ws?.close(1000, 'bye') } catch { /* already gone */ }
      say('closed')
    },
  }
}

/**
 * The relay's HTTP calls: make a room, ask what is in one, ask whether the
 * relay is up and has an engine, and ask which of a deck's cards that engine
 * knows. `base` is the relay's origin; the socket for a room is derived from it.
 */
export function rooms(base) {
  const origin = String(base).replace(/\/$/, '')
  return {
    async open({ seats = 2, enforced = false, ai = 'heuristic' } = {}) {
      const res = await fetch(`${origin}/rooms`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(enforced ? { seats, enforced: true, ai } : { seats }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'The relay did not answer.')
      }
      return res.json()
    },
    /** Whether the relay is up, and whether it has an engine to enforce a game with. */
    async health() {
      const res = await fetch(`${origin}/health`)
      if (!res.ok) throw new Error('The relay did not answer.')
      return res.json()
    },
    /**
     * Which of a deck's cards the relay's engine knows, asked before any room
     * exists. `deck` is the map a sit sends (`seatDeck`), so the answer is
     * about exactly what would be dealt. Null when this relay cannot check:
     * one from before the endpoint, or one whose engine predates the op. The
     * lobby says so rather than guessing either way.
     */
    async check(deck, { sideboard = null, signal } = {}) {
      const res = await fetch(`${origin}/engine/check`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sideboard ? { deck, sideboard } : { deck }), signal,
      })
      if (res.status === 404 || res.status === 501) return null
      // An answer that cannot be read is not an answer. Taken as one, an empty
      // reply would say the engine knows every card, and be kept as that.
      const unreadable = () => new SyntaxError("The relay's answer could not be read.")
      let body
      try {
        body = await res.json()
      } catch (e) {
        if (e.name === 'AbortError') throw e
        if (!res.ok) throw Object.assign(new Error('The relay did not answer.'), { status: res.status })
        throw unreadable()
      }
      if (!res.ok) throw Object.assign(new Error(body?.error ?? 'The relay did not answer.'), { status: res.status })
      if (!Array.isArray(body?.unknown)) throw unreadable()
      const names = (a) => (Array.isArray(a) ? a.filter((n) => typeof n === 'string') : [])
      return { known: Number(body?.known) || 0, total: Number(body?.total) || 0, unknown: names(body?.unknown), unknownSideboard: names(body?.unknownSideboard) }
    },
    async peek(code) {
      const res = await fetch(`${origin}/rooms/${encodeURIComponent(code)}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error('The relay refused.')
      return res.json()
    },
    socketUrl: (code) => `${origin.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(code)}/ws`,
  }
}
