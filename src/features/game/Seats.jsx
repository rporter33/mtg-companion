import { useEffect, useState } from 'react'
import { rooms } from '../../lib/board/relay.js'
import { navigate } from '../../lib/router.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { chosenLevel, LEVELS, LEVEL_LINES, LEVEL_NAMES, LEVELS_MEASURED, roomLevel } from '../../lib/engine/levels.js'
import { OPPONENT_KINDS, buildsFor, dealingWords, engineDeckLine, plannedWords, seatWords } from '../../lib/engine/opponent.js'
import { COMMANDER_GAME, COMMANDER_TABLE, leaderProblem, leaderlessFamily, leaderlessLine } from '../../lib/engine/commander.js'
import { nameList, withArticle } from '../../lib/engine/deck.js'
import { getFormat } from '../../lib/formats.js'
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

export default function Seats({ room, engine = null, engineDeck = null }) {
  const [address, setAddress] = useState(() => relayAddress())
  // Whether the relay has an engine: null until it has said.
  const [hasEngine, setHasEngine] = useState(null)
  const [draft, setDraft] = useState(address ?? '')
  const [name, setName] = useState(() => getPrefs().playerName ?? '')
  // How strongly the engine plays, remembered with the player's other table
  // preferences. Intermediate until they choose otherwise: the owner's
  // choice for a first game (2026-09-24).
  const [level, setLevel] = useState(() => chosenLevel(getPrefs().engineLevel))
  const [seats, setSeats] = useState(MIN_SEATS)
  const [peek, setPeek] = useState(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  // Whether the relay has an engine behind it decides whether the table can
  // be rules-enforced at all, so it is asked once, when the panel opens.
  useEffect(() => {
    if (!address) { setHasEngine(false); return undefined }
    let cancelled = false
    rooms(address).health().then((h) => { if (!cancelled) setHasEngine(Boolean(h?.engine)) }).catch(() => { if (!cancelled) setHasEngine(false) })
    return () => { cancelled = true }
  }, [address])

  useEffect(() => {
    const code = room ?? engine
    if (!code || !address) return undefined
    let cancelled = false
    const api = rooms(address)
    const look = () => api.peek(code)
      .then((found) => { if (cancelled) return; if (found) setPeek(found); else setGone(true) })
      .catch(() => { /* the relay is away; the last look stands */ })
    look()
    const timer = setInterval(look, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [room, engine, address])

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

  /*
   * A table the engine holds: two seats, the second the engine's own
   * player. The room is opened on the relay like any other and the deck is
   * chosen in the lobby as for any other; what differs is who decides.
   */
  const challenge = async () => {
    setBusy(true); setError(null)
    try {
      const made = await rooms(address).open({ seats: 2, enforced: true, ai: 'heuristic', level })
      navigate({ tab: 'game', gameEngine: made.code, gameRoom: null })
    } catch (e) {
      setError(e.message === 'This relay has no engine.' ? 'That relay has no engine to enforce a game with.' : 'The relay did not answer. Is it running at that address?')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink(room)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* shown as text anyway */ }
  }

  const saveName = (value) => { setName(value); setPref('playerName', value.trim()) }
  const chooseLevel = (value) => { setLevel(value); setPref('engineLevel', value) }

  if (engine) {
    const seated = peek?.seats ?? []
    // Once the engine has dealt, the table's level is the game's, and is said
    // as the room says it rather than offered as though it could still change.
    // While it is still loading to deal, the level asked for is said as asked,
    // and not offered either: the room takes no other once it has begun.
    const { stage, level: roomAt } = roomLevel(peek)
    // What the engine's seat plays: once dealt, as the room reports it; while
    // it deals, as the room was asked; before that, as the sit will send it —
    // the copy, and why, where the choice cannot be sent as made (plannedWords).
    const choice = engineDeck?.choice ?? null
    const theirs = choice?.kind === 'deck' ? (engineDeck.decks ?? []).find((d) => d.id === choice.deckId) ?? null : null
    const report = peek?.engineDeck && typeof peek.engineDeck === 'object' ? peek.engineDeck : null
    const game = peek?.format && typeof peek.format === 'object' ? peek.format : null
    const engineLine = stage === 'dealt'
      ? seatWords({ report })
      : stage === 'dealing' && report
        ? dealingWords(report)
        : plannedWords({
          choice,
          chosen: theirs,
          check: theirs ? engineDeck.checks?.get(theirs.id) ?? null : null,
          format: engineDeck?.format ?? null,
          yours: engineDeck?.yours ? engineDeck.checks?.get(engineDeck.yours.id) ?? null : null,
        })
    return (
      <aside className="lobby__seats" aria-label="Table">
        <h2 className="lobby__label">Table · {seated.filter((s) => s.here || s.ai).length} / {seated.length || 2} <span className="chip tiny">{engine}</span></h2>
        {gone && typeof peek?.gone !== 'string' && hasEngine === false ? (
          // A relay started with no engine leaves a table the engine holds on its
          // disk, unopened, for a relay that has one (HANDOFF.md §3 item 21): the
          // table may be whole, so it is not said to have gone (M7's review).
          <p className="lobby__notice tiny" role="status">
            <strong>That table is not open on this relay.</strong>{' '}
            This relay is running without an engine. A table the engine holds opens only on a relay with one, and waits on the relay&apos;s disk until it has one again, for a week after its last move.
          </p>
        ) : gone || typeof peek?.gone === 'string' ? (
          <p className="lobby__notice tiny">
            <strong>That table has gone.</strong>{' '}
            {/* A room still on the relay whose game did not come back says why (M7). */}
            {typeof peek?.gone === 'string' ? peek.gone : 'A table the engine holds is kept for a week after the last move, through a restart of its relay.'}
          </p>
        ) : (
          <>
            <ul className="lobby__seatlist" role="list">
              {(seated.length ? seated : [{ seat: 'p1' }, { seat: 'p2', ai: 'heuristic' }]).map((s, i) => (
                <li key={s.seat} className={`lobby__seat${s.here || s.ai ? '' : ' lobby__seat--open'}`}>
                  <span className="lobby__avatar" aria-hidden="true">{s.ai ? '⚙' : s.name ? s.name.slice(0, 1).toUpperCase() : i + 1}</span>
                  <span className={s.here || s.ai ? '' : 'faint'}>{s.ai ? engineLine : s.here ? s.name : 'You, once you sit'}</span>
                </li>
              ))}
            </ul>
            {stage === 'dealt' && report && (report.fellBack || report.played == null) && (
              <p className="lobby__notice tiny">{engineDeckLine(report, { game })}</p>
            )}
            {/* Which game a deck of this format is dealt as (M6), before anyone sits. */}
            {stage === 'open' && engineDeck?.format === COMMANDER_GAME && <p className="lobby__notice tiny">{COMMANDER_TABLE}</p>}
            {stage === 'open' && engineDeck && leaderlessFamily(engineDeck.format) && <p className="lobby__notice tiny">{leaderlessLine(engineDeck.format)}</p>}
            {stage === 'open' && engineDeck && <EngineDeckChoice {...engineDeck} />}
            {stage === 'dealing' ? (
              <p className="lobby__notice tiny" role="status">
                {roomAt
                  ? <>The engine is dealing this table&apos;s game, asked to play at the <strong>{roomAt}</strong> level. A table you open next can be played at another.</>
                  : <>The engine is dealing this table&apos;s game.</>}
              </p>
            ) : stage === 'dealt' ? (
              <>
                <p className="lobby__notice tiny">
                  {roomAt
                    ? <>This table&apos;s game is under way at the <strong>{roomAt}</strong> level. A table you open next can be played at another.</>
                    : <>This table&apos;s game is under way, and its engine plays one way only.</>}
                </p>
                {/* Said by the room while an engine takes the game back (M7). */}
                {peek?.restoring && (
                  <p className="lobby__notice tiny" role="status">
                    {peek.restoring === 'engine'
                      ? 'Its engine stopped, and is starting again with the game as it was at the last stop.'
                      : 'Its relay restarted, and the game is coming back as it was at the last stop.'}
                  </p>
                )}
              </>
            ) : (
              <fieldset className="lobby__levels">
                <legend className="lobby__label">How the engine plays</legend>
                {LEVELS.map((l) => (
                  <label key={l} className={`lobby__level${level === l ? ' lobby__level--on' : ''}`}>
                    <input type="radio" name="engine-level" value={l} checked={level === l} onChange={() => chooseLevel(l)} />
                    <span className="lobby__levelname">{LEVEL_NAMES[l]}</span>
                    <span className="lobby__levelline faint tiny">{LEVEL_LINES[l]}</span>
                  </label>
                ))}
                {/* The lines above are the app's own words, and the numbers under them were measured, not claimed. */}
                <p className="faint tiny m0">These descriptions are this app&apos;s own. {LEVELS_MEASURED}</p>
              </fieldset>
            )}
            <label className="lobby__field">
              <span className="lobby__label">Your name at the table</span>
              <input className="input" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" maxLength={24} />
            </label>
            <p className="lobby__notice tiny">
              <strong>Rules enforced:</strong> the engine runs the game and plays the seat opposite. Only what the rules allow is offered, and the engine never stops you where you have nothing to do.
            </p>
          </>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate({ tab: 'game', gameEngine: null })}>← Play alone instead</button>
      </aside>
    )
  }

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
          {hasEngine && (
            <button type="button" className="btn btn--sm" onClick={challenge} disabled={busy}>Play the engine</button>
          )}
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

/*
 * What the engine's seat plays, chosen before the deal (HANDOFF.md, M5, and
 * the owner's answer of 2026-09-25). The names and lines are the app's own,
 * and each says what the choice does rather than how well it will play.
 */
const KIND_NAMES = { mirror: 'A copy of yours', deck: 'One of your decks', own: 'A deck of its own' }
const KIND_LINES = {
  mirror: 'It plays the deck you sit down with, card for card.',
  deck: 'It plays another deck from your shelf, chosen below.',
  own: 'Built afresh for each game by Argentum\'s own deck builder.',
}

/**
 * The choice itself: three radios, as the levels are, then what the chosen one
 * needs. One of your decks is picked from this shelf's decks, and one the
 * engine does not fully know cannot be picked, since the engine would refuse
 * the game over it. A deck of its own has one switch, for its card pool: off,
 * the owner's default, it builds only from the sets your deck uses, a fair
 * fight; on, from every card of the format the engine knows. Where the engine
 * builds no deck of its own for the format, that is said instead of a switch.
 */
function EngineDeckChoice({ choice, onChoose, format, decks = [], checks = null, yours = null }) {
  const formatName = getFormat(format)?.name ?? format
  const whole = choice.pool === 'format'
  const present = decks.some((d) => d.id === choice.deckId)
  const used = yours ? checks?.get(yours.id)?.sets ?? [] : []
  const option = (d) => {
    const check = checks?.get(d.id)
    const state = check?.state
    // A Commander deck goes with its commander (M6), so one the engine cannot deal a
    // Commander game with cannot be picked either, and says why.
    const leaderless = state !== 'short' && state !== 'asking' && leaderProblem(check?.seat, check)
    const why = state === 'asking' ? ' (asking the engine about it)' : state === 'short' ? ' (the engine does not know every card)' : leaderless ? ' (no commander the engine can deal)' : ''
    return <option key={d.id} value={d.id} disabled={state === 'short' || Boolean(leaderless)}>{d.name}{why}</option>
  }
  return (
    <fieldset className="lobby__levels">
      <legend className="lobby__label">The engine&apos;s deck</legend>
      {OPPONENT_KINDS.map((k) => (
        <label key={k} className={`lobby__level${choice.kind === k ? ' lobby__level--on' : ''}`}>
          <input type="radio" name="engine-deck" value={k} checked={choice.kind === k} onChange={() => onChoose({ kind: k })} />
          <span className="lobby__levelname">{KIND_NAMES[k]}</span>
          <span className="lobby__levelline faint tiny">{KIND_LINES[k]}</span>
        </label>
      ))}
      {choice.kind === 'deck' && (
        <label className="lobby__field">
          <span className="lobby__label">Which of your {formatName} decks</span>
          <select className="input" value={present ? choice.deckId : ''} onChange={(e) => onChoose({ deckId: e.target.value || null })}>
            <option value="">Choose a deck…</option>
            {decks.map(option)}
          </select>
          {!present && <span className="faint tiny">Until you choose one, the engine plays a copy of yours.</span>}
        </label>
      )}
      {choice.kind === 'own' && (buildsFor(format) ? (
        <label className={`lobby__level${whole ? ' lobby__level--on' : ''}`}>
          <input type="checkbox" role="switch" checked={whole} aria-checked={whole} aria-describedby="engine-pool-line"
            onChange={(e) => onChoose({ pool: e.target.checked ? 'format' : 'sets' })} />
          <span className="lobby__levelname">From the whole of {formatName}</span>
          <span id="engine-pool-line" className="lobby__levelline faint tiny">
            {whole
              ? `On: it builds from every ${formatName} card the engine knows.`
              : `Off: it builds only from the sets your deck uses, for a fair fight.${used.length ? ` ${yours.name} uses ${nameList(used.map((s) => s.name), 4)}.` : ''}`}
          </span>
        </label>
      ) : (
        <p className="faint tiny m0">The engine builds no {formatName} deck of its own, so with {withArticle(formatName)} deck it plays a copy of yours.</p>
      ))}
    </fieldset>
  )
}
