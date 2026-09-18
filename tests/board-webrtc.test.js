import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { peer } from '../src/lib/board/webrtc.js'

/**
 * The transport, without a network.
 *
 * Everything the protocol promises is tested over the loopback in `net.js`,
 * and the handshake itself is tested between two real browsers. What is left
 * is the seam between them: whether a message written before the channel is
 * usable still arrives. It is worth its own test because the failure is
 * silent — a connection that reports itself connected, a guest that waits for
 * a table forever — and because it is reachable with a channel and a
 * connection that are only shaped like the real ones.
 */

/** As much of RTCDataChannel as the transport touches. */
class FakeChannel {
  constructor(readyState = 'connecting') {
    this.readyState = readyState
    this.sent = []
    this.onopen = null
    this.onclose = null
    this.onmessage = null
  }

  send(data) { this.sent.push(JSON.parse(data)) }

  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
}

let made = []

class FakeConnection {
  constructor() {
    this.connectionState = 'new'
    this.ondatachannel = null
    this.onicecandidate = null
    this.onconnectionstatechange = null
    made.push(this)
  }

  createDataChannel() {
    this.channel = new FakeChannel()
    return this.channel
  }
  close() { this.connectionState = 'closed' }
}

/** A signalling service that answers nothing: no handshake happens here. */
const quiet = { open: async () => 'aaaaa', post: async () => {}, take: async () => new Promise(() => {}) }

beforeEach(() => {
  made = []
  globalThis.RTCPeerConnection = FakeConnection
})
afterEach(() => { delete globalThis.RTCPeerConnection })

describe('a message written before the channel is usable', () => {
  it('waits, and goes as soon as the channel opens', () => {
    const wire = peer({ role: 'host', code: 'aaaaa', signal: quiet })
    const { channel } = made[0]
    wire.send({ kind: 'table' })
    expect(wire.open).toBe(false)
    expect(channel.sent).toEqual([])
    channel.open()
    expect(channel.sent).toEqual([{ kind: 'table' }])
    expect(wire.open).toBe(true)
  })

  it('goes at once when the channel handed over is already open', () => {
    const wire = peer({ role: 'guest', code: 'aaaaa', signal: quiet })
    wire.send({ kind: 'hello' })
    const ready = new FakeChannel('open')
    // A channel that arrives already open: its open event has been and gone.
    made[0].ondatachannel({ channel: ready })
    expect(ready.sent).toEqual([{ kind: 'hello' }])
    expect(wire.open).toBe(true)
  })

  it('and when it arrives still connecting, on the open it does see', () => {
    const wire = peer({ role: 'guest', code: 'aaaaa', signal: quiet })
    wire.send({ kind: 'hello' })
    const later = new FakeChannel('connecting')
    made[0].ondatachannel({ channel: later })
    expect(later.sent).toEqual([])
    later.open()
    expect(later.sent).toEqual([{ kind: 'hello' }])
  })

  it('tells the protocol it is open only when it is', () => {
    const wire = peer({ role: 'guest', code: 'aaaaa', signal: quiet })
    expect(wire.open).toBe(false)
    const ready = new FakeChannel('open')
    made[0].ondatachannel({ channel: ready })
    expect(wire.open).toBe(true)
  })
})
