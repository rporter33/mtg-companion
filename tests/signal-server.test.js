import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { server, rooms, makeCode, ALPHABET } from '../scripts/signal-server.mjs'
import { signalling } from '../src/lib/board/webrtc.js'

/**
 * The signalling service, driven over real HTTP.
 *
 * It is forty lines and it is the only server this app has, so what it does
 * and does not do are both worth pinning down. What it does: hand out a code,
 * pass a message from one side to the other, and hold a request open rather
 * than making a browser ask again. What it does not do: keep anything, know
 * anything about a game, or let either side read its own messages back.
 */

let base
beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((resolve) => {
  // A held request would otherwise keep the server open past the test run.
  server.closeAllConnections?.()
  server.close(resolve)
}))

const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

describe('the signalling service', () => {
  it('hands out a code people can read to each other', async () => {
    const { code } = await (await post('/rooms')).json()
    expect(code).toHaveLength(5)
    // Nothing that sounds or looks like something else when read aloud.
    expect(code).toMatch(/^[A-Z2-9]+$/)
    for (const confusable of ['O', '0', 'I', '1', 'S', '5']) {
      expect(ALPHABET, `${confusable} is too easy to mishear`).not.toContain(confusable)
    }
  })

  it('passes a message from one side to the other', async () => {
    const { code } = await (await post('/rooms')).json()
    await post(`/rooms/${code}/from/host`, { sdp: { type: 'offer' } })
    const got = await (await fetch(`${base}/rooms/${code}/to/guest?since=0`)).json()
    expect(got.messages).toEqual([{ sdp: { type: 'offer' } }])
  })

  it('does not let a side read back what it said itself', async () => {
    const { code } = await (await post('/rooms')).json()
    await post(`/rooms/${code}/from/host`, { ice: 'mine' })
    // Asking for the host's own box finds nothing, so the request is held
    // open — which is itself the proof that the message went the other way.
    const mine = fetch(`${base}/rooms/${code}/to/host?since=0`, { signal: AbortSignal.timeout(400) })
      .then((r) => r.json())
      .catch(() => 'held open')
    expect(await mine).toBe('held open')
    // And it is waiting for the guest, where it was sent.
    const theirs = await (await fetch(`${base}/rooms/${code}/to/guest?since=0`)).json()
    expect(theirs.messages).toEqual([{ ice: 'mine' }])
  })

  it('holds a request open until there is something to say', async () => {
    const { code } = await (await post('/rooms')).json()
    const waiting = fetch(`${base}/rooms/${code}/to/guest?since=0`).then((r) => r.json())
    // Nothing has been posted yet, so this is still open a moment later.
    const raced = await Promise.race([waiting, new Promise((r) => setTimeout(() => r('still waiting'), 120))])
    expect(raced).toBe('still waiting')
    await post(`/rooms/${code}/from/host`, { sdp: 'late' })
    expect((await waiting).messages).toEqual([{ sdp: 'late' }])
  })

  it('says so when a room has gone, rather than pretending', async () => {
    const missing = await fetch(`${base}/rooms/ZZZZZ/to/guest?since=0`)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toMatch(/gone quiet/)
  })

  it('refuses a name for a side it does not have', async () => {
    const { code } = await (await post('/rooms')).json()
    expect((await fetch(`${base}/rooms/${code}/to/referee?since=0`)).status).toBe(400)
  })

  it('keeps nothing about the game, because nothing about it passes through', async () => {
    const { code } = await (await post('/rooms')).json()
    await post(`/rooms/${code}/from/host`, { sdp: { type: 'offer', sdp: 'v=0...' } })
    const kept = JSON.stringify(rooms.get(code))
    // Whatever is in there is the handshake and the clock, and nothing else.
    expect(kept).not.toMatch(/card|deck|board|library|battlefield/i)
  })

  it('is the same client the app uses, talking to it', async () => {
    const service = signalling(base)
    const code = await service.open()
    await service.post(code, 'host', { sdp: 'offer' })
    expect(await service.take(code, 'guest')).toEqual([{ sdp: 'offer' }])
    // Taken once: the mark moved, so the same message is not read twice.
    await service.post(code, 'host', { ice: 'one' })
    expect(await service.take(code, 'guest')).toEqual([{ ice: 'one' }])
  })

  it('tells the client plainly when the room is gone', async () => {
    const service = signalling(base)
    await expect(service.post('ZZZZZ', 'host', { sdp: 'x' })).rejects.toThrow(/room has gone/)
  })

  it('makes codes that do not collide in any run anyone will have', () => {
    const seen = new Set()
    for (let i = 0; i < 4000; i++) seen.add(makeCode())
    // 29^5 is twenty million, so four thousand should be almost all distinct.
    expect(seen.size).toBeGreaterThan(3990)
  })
})
