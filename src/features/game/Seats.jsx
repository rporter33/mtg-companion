import { useEffect, useState } from 'react'
import { rooms } from '../../lib/board/relay.js'
import { navigate } from '../../lib/router.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { relayAddress, setRelayAddress, inviteLink } from './relayAddress.js'

/**
 * The seats panel: who is at the table, and how to get somebody else there.
 *
 * Moxgate's line under the seats changes with who is seated. Ours does the
 * same, and always says what is true: alone, that this is solitaire; with a
 * room, who is in it and the link to hand a friend; with no relay to reach,
 * that there is none and where to point one. The room is read from the
 * relay every few seconds while this panel is open, so a friend arriving
 * shows up without a reload.
 */
const MIN_SEATS = 2
const MAX_SEATS = 6

export default function Seats({ room }) {
  const [address, setAddress] = useState(() => relayAddress())
  const [draft, setDraft] = useState(address ?? '')
  const [name, setName] = useState(() => getPrefs().playerName ?? '')
  const [seats, setSeats] = useState(MIN_SEATS)
  const [peek, setPeek] = useState(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!room || !address) return undefined
    let cancelled = false
    const api = rooms(address)
    const look = () => api.peek(room)
      .then((found) => { if (cancelled) return; if (found) setPeek(found); else setGone(true) })
      .catch(() => { /* the relay is away; the last look stands */ })
    look()
    const timer = setInterval(look, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [room, address])

  const invite = async () => {
    setBusy(true); setError(null)
    try {
      const made = await rooms(address).open({ seats })
      navigate({ tab: 'game', gameRoom: made.code })
    } catch (e) {
      setError('The relay did not answer. Is it running at that address?')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink(room)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* shown as text anyway */ }
  }

  const saveName = (value) => { setName(value); setPref('playerName', value.trim()) }

  if (room) {
    const players = peek?.players ?? []
    const seated = peek?.seats ?? []
    return (
      <aside className="lobby__seats" aria-label="Table">
        <h2 className="lobby__label">Table · {seated.length} / {players.length || '?'} <span className="chip tiny">{room}</span></h2>
        {gone ? (
          <p className="lobby__notice tiny"><strong>That room has gone.</strong> Rooms are kept for a week after the last move.</p>
        ) : (
          <>
            <ul className="lobby__seatlist" role="list">
              {players.map((p, i) => {
                const s = seated.find((x) => x.seat === p)
                return (
                  <li key={p} className={`lobby__seat${s ? '' : ' lobby__seat--open'}${s && !s.here ? ' lobby__seat--away' : ''}`}>
                    <span className="lobby__avatar" aria-hidden="true">{s ? s.name.slice(0, 1).toUpperCase() : i + 1}</span>
                    <span className={s ? '' : 'faint'}>
                      {s ? s.name : 'Open seat'}
                      {s && !s.here && <span className="tiny"> · away</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            <label className="lobby__field">
              <span className="lobby__label">Your name at the table</span>
              <input className="input" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" maxLength={24} />
            </label>
            <div className="lobby__invite">
              <span className="lobby__label">Invite by link</span>
              <code className="lobby__link">{inviteLink(room)}</code>
              <button type="button" className="btn btn--sm" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <p className="lobby__notice tiny">
              <strong>Together:</strong> the relay holds the table, so anyone with the link can sit down, leave and come back. Pick a deck and sit.
            </p>
          </>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate({ tab: 'game', gameRoom: null })}>← Play alone instead</button>
      </aside>
    )
  }

  return (
    <aside className="lobby__seats" aria-label="Table">
      <h2 className="lobby__label">Table · 1 / 2</h2>
      <ul className="lobby__seatlist" role="list">
        <li className="lobby__seat lobby__seat--you">
          <span className="lobby__avatar" aria-hidden="true">Y</span>
          <span>You</span>
        </li>
        <li className="lobby__seat lobby__seat--open">
          <span className="lobby__avatar" aria-hidden="true">2</span>
          <span className="faint">Open seat<span className="tiny"> · invite a friend</span></span>
        </li>
      </ul>
      {/*
        Moxgate's line changes from "Solitaire: no opponent yet" to "Rules
        Enforced: the engine runs the game" once someone is seated. Ours says
        what starting will get you: alone, a table to test a deck on; with a
        room, a friend across it.
      */}
      <p className="lobby__notice tiny">
        <strong>Solitaire:</strong> no opponent yet. You will be drawing and casting on your own —
        good for testing a deck. Invite a friend to play together, or wait for the engine.
      </p>
      {address ? (
        <div className="lobby__invite">
          <label className="lobby__field">
            <span className="lobby__label">Seats</span>
            <select className="input" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => MIN_SEATS + i).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn--sm" onClick={invite} disabled={busy}>{busy ? 'Opening a room…' : 'Invite a friend'}</button>
          {error && <p className="faint tiny m0" role="alert">{error}</p>}
        </div>
      ) : (
        <form className="lobby__field" onSubmit={(e) => { e.preventDefault(); setRelayAddress(draft); setAddress(relayAddress()) }}>
          <span className="lobby__label">No relay to reach</span>
          <p className="faint tiny m0">
            Playing together needs a relay. There is no hosted one yet; run <code>npm run relay</code> and put its address here.
          </p>
          <div className="row">
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="http://localhost:8788" aria-label="Relay address" />
            <button type="submit" className="btn btn--sm">Use it</button>
          </div>
        </form>
      )}
    </aside>
  )
}
