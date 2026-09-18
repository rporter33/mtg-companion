#!/usr/bin/env node
/**
 * The smallest thing two browsers need in order to stop needing it.
 *
 * WebRTC peers cannot find each other without someone to pass the first two
 * messages — an offer and an answer, plus the network candidates that go with
 * them. That someone is this. It hands out a room code, relays whatever is
 * posted to that room to the other side, and forgets the room when it goes
 * quiet. Once the peers are connected it is out of the way, and **no part of
 * the game ever passes through it**: no board, no deck, no card, no name that
 * was not typed into a join box.
 *
 * Written in plain node:http with no dependencies, because it is small enough
 * to be a single serverless function and because a dependency on a signalling
 * library would be larger than the thing it signals. Plain polling rather than
 * websockets for the same reason: it is two or three requests per connection,
 * once, and it deploys anywhere that can run a function.
 *
 *   node scripts/signal-server.mjs            # localhost:8787
 *   PORT=9000 node scripts/signal-server.mjs
 *
 * The API, in full:
 *   POST /rooms                    -> { code }
 *   POST /rooms/<code>/from/<who>  body: any JSON  -> { at }
 *   GET  /rooms/<code>/to/<who>?since=<n>         -> { messages: [...], at }
 *
 * `who` is 'host' or 'guest'. A message posted by one is readable by the
 * other and by nobody else.
 */
import { createServer } from 'node:http'
import { randomInt } from 'node:crypto'

const PORT = Number(process.env.PORT) || 8787
/** How long a room lives with nothing happening in it. */
const IDLE_MS = 10 * 60 * 1000
/**
 * How long a poll waits for something to say before answering empty. Tunable
 * because twenty seconds is right for a browser and far too long for a test.
 */
const HOLD_MS = Number(process.env.SIGNAL_HOLD_MS) || 20 * 1000

/**
 * Codes people read to each other out loud, so no characters that sound or
 * look alike: no O or 0, no I or 1, no S or 5.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY2346789'
const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

const rooms = new Map() // code -> { at, host: [], guest: [], waiting: [] }

const now = () => Date.now()
const room = (code) => {
  const found = rooms.get(code)
  if (found) found.at = now()
  return found
}

setInterval(() => {
  for (const [code, r] of rooms) if (now() - r.at > IDLE_MS) rooms.delete(code)
}, 60 * 1000).unref?.()

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // The app is served from somewhere else entirely; this is a relay, and it
    // is the peers' own encryption that protects what matters.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const body = (req) => new Promise((resolve) => {
  let text = ''
  req.on('data', (chunk) => {
    text += chunk
    // A signalling message is a few kilobytes. Anything larger is not one.
    if (text.length > 64_000) { req.destroy(); resolve(null) }
  })
  req.on('end', () => { try { resolve(JSON.parse(text || 'null')) } catch { resolve(null) } })
})

/** Wakes anyone holding a poll on this room. */
function nudge(r) {
  const waiting = r.waiting
  r.waiting = []
  for (const wake of waiting) wake()
}

export const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
    let code = makeCode()
    while (rooms.has(code)) code = makeCode()
    rooms.set(code, { at: now(), host: [], guest: [], waiting: [] })
    return json(res, 200, { code })
  }

  // /rooms/<code>/from/<who>  and  /rooms/<code>/to/<who>
  if (parts.length === 4 && parts[0] === 'rooms') {
    const [, code, direction, who] = parts
    if (who !== 'host' && who !== 'guest') return json(res, 400, { error: 'who' })
    const r = room(code)
    if (!r) return json(res, 404, { error: 'No room with that code. It may have gone quiet and been forgotten.' })

    if (req.method === 'POST' && direction === 'from') {
      const message = await body(req)
      if (message === null) return json(res, 400, { error: 'json' })
      const box = who === 'host' ? r.guest : r.host   // posted BY host, read BY guest
      box.push({ at: box.length + 1, message })
      if (box.length > 200) box.splice(0, box.length - 200)
      nudge(r)
      return json(res, 200, { at: box.length })
    }

    if (req.method === 'GET' && direction === 'to') {
      const box = who === 'host' ? r.host : r.guest
      const since = Number(url.searchParams.get('since') ?? 0) || 0
      const answer = () => json(res, 200, {
        messages: box.filter((m) => m.at > since).map((m) => m.message),
        at: box.length,
      })
      if (box.length > since) return answer()
      // Nothing yet: hold the request open rather than making the browser ask
      // again in a moment. One request instead of forty.
      let done = false
      const finish = () => { if (!done) { done = true; clearTimeout(timer); answer() } }
      const timer = setTimeout(finish, HOLD_MS)
      r.waiting.push(finish)
      req.on('close', () => { done = true; clearTimeout(timer) })
      return undefined
    }
  }

  return json(res, 404, { error: 'not found' })
})

// Started only when run directly, so the tests can import and drive it.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => {
    console.log(`Signalling on http://localhost:${PORT}`)
    console.log('It passes two messages between two browsers and then gets out of the way.')
    console.log('No board, no deck and no card ever goes through it.')
  })
}

export { rooms, makeCode, ALPHABET, HOLD_MS }
