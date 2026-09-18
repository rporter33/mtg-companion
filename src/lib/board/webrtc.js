/**
 * The wire between two devices.
 *
 * WebRTC, because it is the only way two browsers talk to each other without
 * a server in the middle — and a server in the middle of a card game is a
 * server that can see your hand, that costs money to run, and that decides
 * one day to stop. Here the only server passes two messages before the peers
 * find each other, and then has nothing to do with the game at all.
 *
 * The signalling client and the peer connection are in one file because they
 * are one handshake: offer, answer, candidates, connected. Both sides of it
 * are here, twenty lines apart, which is the only way it stays readable.
 *
 * Everything below produces the same shape the loopback in `net.js` does —
 * `{ send, onMessage, close }` — so the protocol never learns which one it is
 * talking through, and every test of the protocol runs without a network.
 */

/** Public STUN only. No TURN: a relay would see the traffic, and pay for it. */
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Talking to the signalling service: ask for a room, post a message, wait for
 * one. The wait is a held request rather than a loop of quick ones.
 */
export function signalling(base) {
  const at = { host: 0, guest: 0 }
  const url = (path) => `${String(base).replace(/\/$/, '')}${path}`

  return {
    async open() {
      const res = await fetch(url('/rooms'), { method: 'POST' })
      if (!res.ok) throw new Error('The signalling service did not answer.')
      const { code } = await res.json()
      return code
    },
    async post(code, who, message) {
      const res = await fetch(url(`/rooms/${code}/from/${who}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      })
      if (!res.ok) throw new Error(res.status === 404 ? 'That room has gone.' : 'The signalling service refused.')
    },
    /** Every message waiting for `who`, blocking until there is at least one. */
    async take(code, who, { signal } = {}) {
      const res = await fetch(url(`/rooms/${code}/to/${who}?since=${at[who]}`), { signal })
      if (!res.ok) throw new Error(res.status === 404 ? 'That room has gone.' : 'The signalling service refused.')
      const { messages, at: mark } = await res.json()
      at[who] = mark
      return messages ?? []
    },
  }
}

/**
 * One end of a peer connection, as a transport.
 *
 * `role` is 'host' or 'guest' and decides only who speaks first in the
 * handshake; after that the connection is symmetric. `onOpen` fires when the
 * channel is usable, `onClose` when it is not — which on a phone happens
 * every time the screen locks, so it is a fact to show rather than an error.
 */
export function peer({ role, code, signal: service, onOpen, onClose, onError } = {}) {
  const connection = new RTCPeerConnection({ iceServers: ICE })
  let channel = null
  let handler = null
  let closed = false
  const queued = []
  const stop = new AbortController()

  const attach = (ch) => {
    channel = ch
    const opened = () => {
      for (const message of queued.splice(0)) ch.send(JSON.stringify(message))
      onOpen?.()
    }
    ch.onopen = opened
    ch.onclose = () => { if (!closed) onClose?.() }
    ch.onmessage = (event) => {
      try { handler?.(JSON.parse(event.data), role === 'host' ? 'guest' : 'host') } catch { /* not ours */ }
    }
    /*
     * A channel handed to us by `ondatachannel` can already be open, in which
     * case its open event has been and gone before there was anything to hear
     * it. Waiting for one that will never come means the queue never flushes,
     * the guest's hello is never sent, and the table never arrives — on a
     * connection that reports itself as connected, which is what makes it so
     * hard to see.
     */
    if (ch.readyState === 'open') opened()
  }

  if (role === 'host') attach(connection.createDataChannel('table', { ordered: true }))
  else connection.ondatachannel = (event) => attach(event.channel)

  const mine = role
  const theirs = role === 'host' ? 'guest' : 'host'

  connection.onicecandidate = (event) => {
    if (event.candidate) service.post(code, mine, { ice: event.candidate.toJSON() }).catch(() => {})
  }
  connection.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(connection.connectionState) && !closed) onClose?.()
  }

  /** Reads whatever the other side has said, for as long as we are connected. */
  const listen = async () => {
    while (!closed) {
      try {
        const messages = await service.take(code, mine, { signal: stop.signal })
        for (const message of messages) {
          if (message.sdp) {
            await connection.setRemoteDescription(message.sdp)
            if (message.sdp.type === 'offer') {
              const answer = await connection.createAnswer()
              await connection.setLocalDescription(answer)
              await service.post(code, mine, { sdp: connection.localDescription.toJSON() })
            }
          } else if (message.ice) {
            await connection.addIceCandidate(message.ice).catch(() => { /* a late candidate is normal */ })
          }
        }
      } catch (error) {
        if (closed || error?.name === 'AbortError') return
        onError?.(error)
        await sleep(1500)
      }
    }
  }

  const start = async () => {
    listen()
    if (role === 'host') {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      await service.post(code, mine, { sdp: connection.localDescription.toJSON() })
    }
  }

  return {
    start,
    theirs,
    get state() { return connection.connectionState },
    get open() { return channel?.readyState === 'open' },
    send: (message) => {
      if (channel?.readyState === 'open') channel.send(JSON.stringify(message))
      // Before the channel opens, hold rather than drop: the first thing a
      // guest says is hello, and losing it means a table that never appears.
      else queued.push(message)
    },
    onMessage: (fn) => { handler = fn },
    close: () => {
      closed = true
      stop.abort()
      try { channel?.close() } catch { /* already gone */ }
      try { connection.close() } catch { /* already gone */ }
    },
  }
}

export { ICE }
