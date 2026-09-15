import { useEffect, useRef, useState } from 'react'
import {
  createGame, deriveState, logLife, logCommanderDamage, logCounter, logConcede,
  undo, nextPhase, advanceTurn, renamePlayer, describeLog, gameIsOver, winnerOf,
  PHASES, COUNTER_TYPES,
} from '../../lib/game.js'
import { FORMAT_GROUPS, formatsInGroup, getFormat } from '../../lib/formats.js'
import { saveGame } from '../../lib/storage.js'
import Sheet from '../../components/Sheet.jsx'
import Term from '../../components/Term.jsx'
import './play.css'

export default function PlayView() {
  const [game, setGame] = useState(null)

  if (!game) return <GameSetup onStart={setGame} />
  return <GameBoard game={game} setGame={setGame} onQuit={() => setGame(null)} />
}

function GameSetup({ onStart }) {
  const [formatId, setFormatId] = useState('commander')
  const [playerCount, setPlayerCount] = useState(4)
  const format = getFormat(formatId)

  return (
    <div className="stack">
      <div>
        <h1>Play</h1>
        <p className="muted">
          A life counter for games you play with real cards. Everything here works offline.
        </p>
      </div>

      <section className="panel stack">
        <span className="faint tiny">Format</span>
        {FORMAT_GROUPS.map((group) => (
          <div key={group.id}>
            <div className="faint tiny" style={{ marginBottom: 4 }}>{group.label}</div>
            <div className="row row--wrap">
              {formatsInGroup(group.id).map((f) => (
                <button
                  key={f.id}
                  className={`chip ${formatId === f.id ? 'chip--active' : ''}`}
                  onClick={() => setFormatId(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="panel stack">
        <span className="faint tiny">Players</span>
        <div className="row row--wrap">
          {[2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              className={`chip ${playerCount === n ? 'chip--active' : ''}`}
              onClick={() => setPlayerCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <div className="banner banner--info">
        Starting life <strong>{format.startingLife}</strong>
        {format.commanderDamage && (
          <> · <Term id="commanderDamage">commander damage</Term> tracked to {format.commanderDamage}</>
        )}
        {' · '}poison tracked to 10
      </div>

      <button
        className="btn btn--primary"
        onClick={() => onStart(createGame({ formatId, playerCount }))}
        style={{ minHeight: 52, fontSize: '1rem' }}
      >
        Start game
      </button>
    </div>
  )
}

function GameBoard({ game, setGame, onQuit }) {
  const [sheet, setSheet] = useState(null)
  const players = deriveState(game)
  const over = gameIsOver(game)
  const winner = winnerOf(game)
  useWakeLock(!over)

  // Persist the finished game once, so the history panel has something to show.
  const savedRef = useRef(false)
  useEffect(() => {
    if (over && !savedRef.current) {
      savedRef.current = true
      saveGame({ ...game, endedAt: new Date().toISOString(), winner: winner?.name ?? null })
    }
  }, [over, game, winner])

  const phase = PHASES[game.phase]

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={onQuit}>← End game</button>
        <span className="spacer" />
        <button className="btn btn--sm" onClick={() => setGame(undo(game))} disabled={!game.log.length}>
          Undo
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => setSheet({ kind: 'log' })}>
          History
        </button>
      </div>

      {over && winner && (
        <div className="banner banner--info center">
          <strong>{winner.name} wins.</strong>
        </div>
      )}

      <div className={`board board--${game.players.length}`}>
        {players.map((player) => (
          <PlayerPanel
            key={player.id}
            player={player}
            game={game}
            active={player.id === game.activePlayer && !over}
            onLife={(delta) => setGame(logLife(game, player.id, delta))}
            onOpen={(kind) => setSheet({ kind, playerId: player.id })}
          />
        ))}
      </div>

      {!over && (
        <div className="panel stack" style={{ gap: 'var(--space-3)' }}>
          <div className="row">
            <span className="faint tiny">Turn {game.turn}</span>
            <span className="spacer" />
            <span className="faint tiny">{game.players[game.activePlayer]?.name}</span>
          </div>
          <div className="phases">
            {PHASES.map((p, i) => (
              <button
                key={p.id}
                className={`phase ${i === game.phase ? 'phase--active' : ''}`}
                onClick={() => setGame({ ...game, phase: i })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="row">
            <Term id={phase.term}><span className="faint tiny">What happens in {phase.label}?</span></Term>
            <span className="spacer" />
            <button className="btn btn--sm" onClick={() => setGame(nextPhase(game))}>Next phase</button>
            <button className="btn btn--sm btn--primary" onClick={() => setGame(advanceTurn(game))}>
              Pass turn
            </button>
          </div>
        </div>
      )}

      <DiceRoller />

      <Sheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheetTitle(sheet, game)}
      >
        {sheet?.kind === 'log' && <HistoryPanel game={game} />}
        {sheet?.kind === 'counters' && (
          <CountersPanel
            game={game} playerId={sheet.playerId}
            onChange={(counter, delta) => setGame(logCounter(game, sheet.playerId, counter, delta))}
          />
        )}
        {sheet?.kind === 'commander' && (
          <CommanderDamagePanel
            game={game} playerId={sheet.playerId}
            onChange={(sourceId, delta) => setGame(logCommanderDamage(game, sheet.playerId, sourceId, delta))}
          />
        )}
        {sheet?.kind === 'player' && (
          <PlayerPanelSettings
            game={game} playerId={sheet.playerId}
            onRename={(name) => setGame(renamePlayer(game, sheet.playerId, name))}
            onConcede={() => { setGame(logConcede(game, sheet.playerId)); setSheet(null) }}
          />
        )}
      </Sheet>
    </div>
  )
}

function PlayerPanel({ player, game, active, onLife, onOpen }) {
  const poison = player.counters.poison ?? 0
  const worstCommander = Math.max(0, ...Object.values(player.commanderDamage))

  return (
    <div
      className={`player ${active ? 'player--active' : ''} ${player.out ? 'player--out' : ''}`}
      data-identity={player.color}
    >
      <button className="player__name" onClick={() => onOpen('player')}>
        {player.name}
        {player.out && <span className="chip chip--error tiny">{player.out}</span>}
      </button>

      <div className="player__life">
        <button className="player__step" onClick={() => onLife(-1)} aria-label={`${player.name} lose 1 life`}>−</button>
        <button
          className="player__total"
          onClick={() => onOpen('player')}
          aria-label={`${player.name} at ${player.life} life`}
        >
          {player.life}
        </button>
        <button className="player__step" onClick={() => onLife(+1)} aria-label={`${player.name} gain 1 life`}>+</button>
      </div>

      <div className="player__bulk">
        <button className="btn btn--sm btn--ghost" onClick={() => onLife(-5)}>−5</button>
        <button className="btn btn--sm btn--ghost" onClick={() => onLife(+5)}>+5</button>
      </div>

      <div className="player__tags">
        {game.commanderDamageThreshold && (
          <button
            className={`chip tiny ${worstCommander >= game.commanderDamageThreshold - 5 ? 'chip--warn' : ''}`}
            onClick={() => onOpen('commander')}
          >
            cmdr {worstCommander}
          </button>
        )}
        <button
          className={`chip tiny ${poison >= 7 ? 'chip--warn' : ''}`}
          onClick={() => onOpen('counters')}
        >
          ☠ {poison}
        </button>
      </div>
    </div>
  )
}

function CountersPanel({ game, playerId, onChange }) {
  const player = deriveState(game)[playerId]
  return (
    <div className="stack">
      {COUNTER_TYPES.map((type) => (
        <div className="row" key={type.id}>
          <div style={{ flex: 1 }}>
            <strong>{type.label}</strong>
            {type.hint && <div className="faint tiny">{type.hint}</div>}
          </div>
          <button className="btn btn--sm" onClick={() => onChange(type.id, -1)}>−</button>
          <span className="mono" style={{ minWidth: 30, textAlign: 'center' }}>
            {player.counters[type.id] ?? 0}
          </span>
          <button className="btn btn--sm" onClick={() => onChange(type.id, +1)}>+</button>
        </div>
      ))}
    </div>
  )
}

function CommanderDamagePanel({ game, playerId, onChange }) {
  const player = deriveState(game)[playerId]
  const others = game.players.filter((p) => p.id !== playerId)

  return (
    <div className="stack">
      <p className="muted tiny">
        Damage from each opponent&rsquo;s commander, tracked separately.
        {' '}{game.commanderDamageThreshold} from any single commander ends the game for
        {' '}{player.name} — and it also costs them that much life.
      </p>
      {others.map((other) => {
        const damage = player.commanderDamage[other.id] ?? 0
        return (
          <div className="row" key={other.id}>
            <span style={{ flex: 1 }}>{other.name}&rsquo;s commander</span>
            <button className="btn btn--sm" onClick={() => onChange(other.id, -1)} disabled={damage === 0}>−</button>
            <span className={`mono ${damage >= game.commanderDamageThreshold ? 'chip--error' : ''}`} style={{ minWidth: 30, textAlign: 'center' }}>
              {damage}
            </span>
            <button className="btn btn--sm" onClick={() => onChange(other.id, +1)}>+</button>
          </div>
        )
      })}
    </div>
  )
}

function PlayerPanelSettings({ game, playerId, onRename, onConcede }) {
  const player = game.players[playerId]
  return (
    <div className="stack">
      <label className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="faint tiny">Name</span>
        <input value={player.name} onChange={(e) => onRename(e.target.value)} />
      </label>
      <button className="btn btn--danger" onClick={onConcede}>Concede</button>
    </div>
  )
}

function HistoryPanel({ game }) {
  const entries = describeLog(game)
  if (!entries.length) return <p className="faint">Nothing has happened yet.</p>
  return (
    <div className="stack" style={{ gap: 'var(--space-1)' }}>
      {entries.map((entry) => (
        <div className="row tiny" key={entry.seq}>
          <span className="faint mono" style={{ minWidth: 42 }}>T{entry.turn}</span>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  )
}

function DiceRoller() {
  const [result, setResult] = useState(null)
  const roll = (sides) => {
    const value = 1 + Math.floor(Math.random() * sides)
    setResult(sides === 2 ? (value === 1 ? 'Heads' : 'Tails') : `d${sides}: ${value}`)
  }
  return (
    <div className="panel row row--wrap">
      <span className="faint tiny" style={{ flex: 1 }}>{result ?? 'Dice and coin'}</span>
      <button className="btn btn--sm" onClick={() => roll(2)}>Coin</button>
      <button className="btn btn--sm" onClick={() => roll(6)}>d6</button>
      <button className="btn btn--sm" onClick={() => roll(20)}>d20</button>
    </div>
  )
}

function sheetTitle(sheet, game) {
  if (!sheet) return ''
  const name = game.players[sheet.playerId]?.name
  if (sheet.kind === 'log') return 'History'
  if (sheet.kind === 'counters') return `${name} — counters`
  if (sheet.kind === 'commander') return `${name} — commander damage`
  return name ?? ''
}

/** Keeps the screen awake during a game, where supported. Silent if not. */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined
    let lock = null
    let released = false

    const acquire = () => navigator.wakeLock.request('screen')
      .then((l) => { if (released) l.release(); else lock = l })
      .catch(() => {})

    acquire()
    // Browsers drop the lock when the tab is backgrounded; reacquire on return.
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}
