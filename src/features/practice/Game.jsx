import { useReducer, useState, useEffect, useRef, useMemo } from 'react'
import { navigate } from '../../lib/router.js'
import { buildGame, MODES } from '../../lib/table/game.js'
import { PRACTICE_DECKS } from '../../data/practice-decks.js'
import { start, act, passUntil, replay } from '../../lib/table/runner.js'
import { policyFor } from '../../lib/table/opponent.js'
import { cardOf, STEP_LABELS, MAIN_STEPS } from '../../lib/table/model.js'
import { narrateAll, cuesFrom, CUE_MS, prefersReducedMotion } from '../../lib/table/motion.js'
import { getPractice, savePracticeRun, clearPracticeRun, getPrefs, setPref } from '../../lib/storage.js'
import Table from './Table.jsx'
import CastPanel from './CastPanel.jsx'
import Declare from './Declare.jsx'
import CardZoom from '../../components/CardZoom.jsx'
import './practice.css'

/**
 * Free play: a whole game on the practice table.
 *
 * Solo against a policy whose rules are on the screen, or two people at
 * one screen. The game is a scenario built from two practice decks and a
 * seed, so its action log replays and a reload resumes. In hot-seat the
 * table waits for whoever it says it is waiting for, and that person's
 * hand stays hidden until they reveal it, so the device can be passed.
 *
 * The practice decks are thirty cards from the practice pool and are not
 * legal decks for any format. The screen says so.
 */
const GAME_KEY = 'game'
const NAMES = { solo: { you: 'You', foe: 'Opponent' }, hotseat: { you: 'Player 1', foe: 'Player 2' } }

export default function Game({ mode }) {
  const saved = getPractice().runs[GAME_KEY]
  if (mode === 'game' && saved?.config) return <Play key={JSON.stringify(saved.config)} config={saved.config} />
  return <Setup resumable={Boolean(saved?.config)} />
}

function Setup({ resumable }) {
  const [you, setYou] = useState(PRACTICE_DECKS[0].id)
  const [foe, setFoe] = useState(PRACTICE_DECKS[1].id)
  const [mode, setMode] = useState('solo')
  const [first, setFirst] = useState('you')
  const begin = () => {
    // The seed is chosen here, once, and stored with the game: the model never reads a clock.
    const config = { you, foe, mode, first, seed: (Date.now() % 1000003) + 1 }
    savePracticeRun(GAME_KEY, { version: 1, log: [], config })
    navigate({ scenarioId: 'game' })
  }
  return (
    <div className="stack">
      <button className="btn btn--ghost btn--sm self-start" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
      <div>
        <h1>Play a whole game</h1>
        <p className="muted">
          The whole turn, every zone, the stack and priority, with the same rules as the lessons. The decks are thirty
          cards each from the practice pool: practice decks, not legal decks for any format.
        </p>
      </div>
      {resumable && (
        <div className="panel row row--wrap row--middle">
          <span className="tiny">A game is in progress.</span>
          <button className="btn btn--primary btn--sm" onClick={() => navigate({ scenarioId: 'game' })}>Back to it</button>
        </div>
      )}
      <section className="panel stack stack--snug">
        <h2 className="m0">Who plays</h2>
        <div className="row row--wrap" role="group" aria-label="Mode">
          {Object.values(MODES).map((m) => (
            <button key={m.id} type="button" className={`chip ${mode === m.id ? 'chip--active' : ''}`} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.name}</button>
          ))}
        </div>
        <p className="tiny muted m0">{MODES[mode].blurb}{mode === 'solo' ? ` The opponent: ${policyFor('simple').description}` : ''}</p>
      </section>
      <DeckPicker label={mode === 'hotseat' ? 'Player 1’s deck' : 'Your deck'} value={you} onChange={setYou} />
      <DeckPicker label={mode === 'hotseat' ? 'Player 2’s deck' : 'Their deck'} value={foe} onChange={setFoe} />
      <section className="panel stack stack--snug">
        <h2 className="m0">Who goes first</h2>
        <div className="row row--wrap" role="group" aria-label="First player">
          <button type="button" className={`chip ${first === 'you' ? 'chip--active' : ''}`} aria-pressed={first === 'you'} onClick={() => setFirst('you')}>{NAMES[mode].you}</button>
          <button type="button" className={`chip ${first === 'foe' ? 'chip--active' : ''}`} aria-pressed={first === 'foe'} onClick={() => setFirst('foe')}>{NAMES[mode].foe}</button>
        </div>
        <p className="tiny muted m0">The first player skips the draw on their first turn. In a real game, a die roll decides.</p>
      </section>
      <div className="row">
        <button className="btn btn--primary" onClick={begin}>Shuffle up and start</button>
      </div>
    </div>
  )
}

function DeckPicker({ label, value, onChange }) {
  return (
    <section className="panel stack stack--snug">
      <h2 className="m0">{label}</h2>
      <div className="stack stack--tight" role="group" aria-label={label}>
        {PRACTICE_DECKS.map((d) => (
          <button key={d.id} type="button" className={`lesson-row ${value === d.id ? 'lesson-row--done' : ''}`} aria-pressed={value === d.id} onClick={() => onChange(d.id)}>
            <span className="lesson-row__num" aria-hidden="true">{value === d.id ? '✓' : ''}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{d.name}<br /><span className="muted tiny">{d.blurb} {d.size} cards.</span></span>
          </button>
        ))}
      </div>
    </section>
  )
}

// --- the game runner ---------------------------------------------------------

function fresh(scenario) {
  const begun = start(scenario)
  return { state: begun.state, events: begun.events, log: begun.actions, journal: narrateAll(begun.events, begun.state), history: [], refusal: null, selected: null, chosen: [], blocks: {}, lastEvents: [], seq: 0, restored: false }
}

function initial(scenario) {
  const saved = getPractice().runs[GAME_KEY]
  if (!saved || !Array.isArray(saved.log) || !saved.log.length) return fresh(scenario)
  const rebuilt = replay(scenario, saved.log)
  if (rebuilt.applied !== saved.log.length) return fresh(scenario)
  return { ...fresh(scenario), state: rebuilt.state, events: rebuilt.events, log: saved.log, journal: narrateAll(rebuilt.events, rebuilt.state), restored: true }
}

function committed(run, result) {
  return {
    ...run,
    state: result.state,
    events: [...run.events, ...result.events],
    log: [...run.log, ...result.actions],
    journal: [...run.journal, ...narrateAll(result.events, result.state)],
    history: [...run.history.slice(-40), { state: run.state, events: run.events, log: run.log, journal: run.journal }],
    refusal: null, selected: null, chosen: [], blocks: {}, lastEvents: result.events, seq: run.seq + 1, restored: false,
  }
}

function reduce(run, action) {
  switch (action.type) {
    case 'act': {
      const result = act(run.state, action.action, action.scenario)
      if (!result.ok) return { ...run, refusal: { ...result.reason, action: action.action } }
      return committed(run, result)
    }
    case 'passUntil': return committed(run, passUntil(run.state, action.scenario, action.until))
    case 'undo': { const last = run.history[run.history.length - 1]; return last ? { ...run, ...last, history: run.history.slice(0, -1), refusal: null, selected: null, chosen: [], blocks: {}, lastEvents: [], seq: run.seq + 1 } : run }
    case 'select': return { ...run, selected: action.instanceId, refusal: null }
    case 'toggleChosen': return { ...run, chosen: run.chosen.includes(action.instanceId) ? run.chosen.filter((id) => id !== action.instanceId) : [...run.chosen, action.instanceId], refusal: null }
    case 'setBlock': { const blocks = { ...run.blocks }; if (action.attackerId) blocks[action.blockerId] = action.attackerId; else delete blocks[action.blockerId]; return { ...run, blocks, refusal: null } }
    default: return run
  }
}

function Play({ config }) {
  const scenario = useMemo(() => buildGame(config), [config])
  const [run, dispatch] = useReducer(reduce, scenario, initial)
  const [inspecting, setInspecting] = useState(null)
  const [cues, setCues] = useState({})
  const [motionPref, setMotionPref] = useState(() => getPrefs().reduceMotion ?? null)
  const reduced = prefersReducedMotion(motionPref)
  const { state } = run
  const hotseat = config.mode === 'hotseat'
  const names = NAMES[config.mode]

  // Whose turn to act: in solo always you; in hot-seat whoever the table waits for.
  const me = hotseat ? (state.awaiting?.player ?? state.priority) : 'you'
  const [revealed, setRevealed] = useState(me)
  const handOff = hotseat && revealed !== me
  useEffect(() => { if (!hotseat) setRevealed('you') }, [hotseat])

  const doAction = (action) => dispatch({ type: 'act', action: { player: me, ...action }, scenario })
  const firstSave = useRef(true)
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; if (run.restored) return }
    savePracticeRun(GAME_KEY, { version: 1, log: run.log, config })
  }, [run.log, run.restored, config])
  useEffect(() => {
    if (reduced || !run.lastEvents.length) { setCues({}); return undefined }
    const next = {}
    for (const cue of cuesFrom(run.lastEvents)) next[cue.id] = cue.kind
    setCues(next)
    const timer = setTimeout(() => setCues({}), CUE_MS)
    return () => clearTimeout(timer)
  }, [run.seq, run.lastEvents, reduced])

  const myPriority = state.priority === me && !state.awaiting && !state.over
  const declaring = state.awaiting?.player === me ? state.awaiting : null
  const mulliganing = declaring?.kind === 'mulligan'
  const owed = mulliganing ? Math.min(state.mulligans[me], state.zones.hand[me].length) : 0
  const who = (p) => (p === me && !hotseat ? 'You' : names[p])
  const recent = run.journal.slice(-5)
  const newGame = () => { clearPracticeRun(GAME_KEY); navigate({ scenarioId: 'play' }) }

  return (
    <div className={`stack practice ${reduced ? 'practice--still' : ''}`}>
      <div className="row row--wrap">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
        <span className="spacer" />
        <button className="chip tiny" type="button" onClick={() => { const next = !reduced; setMotionPref(next); setPref('reduceMotion', next) }} aria-pressed={reduced}
          aria-label={reduced ? 'Motion reduced; press to allow motion' : 'Motion on; press to reduce motion'}>{reduced ? 'Motion: reduced' : 'Motion: on'}</button>
        {!hotseat && <button className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'undo' })} disabled={!run.history.length} aria-label="Undo the last action (practice only)">Undo</button>}
        <button className="btn btn--ghost btn--sm" onClick={newGame}>New game</button>
      </div>

      <div>
        <h1 className="m0">{scenario.title}</h1>
        <p className="faint tiny m0">
          {scenario.summary} · {who(state.active)}{state.active === me && !hotseat ? 'r' : '’s'} turn {state.turnsBy[state.active]} · {state.awaiting?.kind === 'mulligan' ? 'Opening hands' : STEP_LABELS[state.step]}
          {' · '}{state.over ? 'Game over' : state.awaiting ? `Waiting on ${who(state.awaiting.player)} to ${state.awaiting.kind === 'mulligan' ? 'keep or mulligan' : `declare ${state.awaiting.kind}`}` : `${who(state.priority)} ${state.priority === me && !hotseat ? 'have' : 'has'} priority`}
        </p>
        {run.restored && <p className="tiny muted m0" role="status">Picked up where you left off.</p>}
      </div>

      {handOff && (
        <section className="panel stack stack--snug practice__handoff" role="region" aria-label="Pass the device">
          <strong>Pass the device to {names[me]}.</strong>
          <p className="tiny muted m0">Their hand stays hidden until they reveal it.</p>
          <button className="btn btn--primary self-start" onClick={() => setRevealed(me)}>I am {names[me]}: show my hand</button>
        </section>
      )}

      <Table
        state={state}
        me={me}
        labels={names}
        hidden={handOff}
        cues={cues}
        highlight={null}
        selected={run.selected}
        chosen={declaring?.kind === 'attackers' ? run.chosen : declaring?.kind === 'blockers' ? Object.keys(run.blocks) : mulliganing ? run.chosen : []}
        casting={state.casting?.player === me ? state.casting : null}
        onSelectHand={(id) => {
          if (handOff) return
          if (mulliganing) return dispatch({ type: 'toggleChosen', instanceId: id })
          dispatch({ type: 'select', instanceId: run.selected === id ? null : id })
        }}
        onPermanent={(inst) => {
          if (handOff) return setInspecting(inst.instanceId)
          if (declaring?.kind === 'attackers' && inst.controller === me) return dispatch({ type: 'toggleChosen', instanceId: inst.instanceId })
          if (declaring?.kind === 'blockers' && inst.controller === me) return dispatch({ type: 'setBlock', blockerId: inst.instanceId, attackerId: run.blocks[inst.instanceId] ? null : state.attackers[0] })
          if (state.casting?.player === me && state.casting.needsTarget && !state.casting.targets.length) return doAction({ type: 'chooseTarget', target: { kind: 'creature', id: inst.instanceId } })
          if (inst.controller === me && (cardOf(inst).rules.mana ?? []).length) return doAction({ type: 'tapForMana', instanceId: inst.instanceId })
          setInspecting(inst.instanceId)
        }}
        onPlayer={(player) => { if (state.casting?.player === me && state.casting.needsTarget === 'any' && !state.casting.targets.length) doAction({ type: 'chooseTarget', target: { kind: 'player', id: player } }) }}
        onInspect={setInspecting}
      />

      <div className="practice__journal" role="log" aria-live="polite" aria-label="What just happened">
        {recent.map((line, i) => <p key={`${i}-${line}`} className="tiny muted m0">{line}</p>)}
      </div>

      {!handOff && mulliganing && (
        <section className="panel stack stack--snug" aria-label="Opening hand">
          <strong>{names[me] === 'You' ? 'Your' : `${names[me]}’s`} opening hand: keep, or mulligan?</strong>
          <p className="tiny muted m0">
            A mulligan shuffles the hand back and draws seven again; on keeping, one card goes on the bottom for each mulligan taken.
            {owed ? ` Choose ${owed} card${owed === 1 ? '' : 's'} in hand to put on the bottom.` : ''} Mulligans so far: {state.mulligans[me]}.
          </p>
          <div className="row row--wrap">
            <button className="btn btn--primary" onClick={() => doAction({ type: 'keepHand', bottom: run.chosen })} disabled={run.chosen.length !== owed}>Keep{owed ? ` (${run.chosen.length}/${owed} to the bottom)` : ''}</button>
            <button className="btn btn--sm" onClick={() => doAction({ type: 'mulligan' })}>Mulligan</button>
          </div>
        </section>
      )}

      {!handOff && run.selected && !state.casting && !mulliganing && (
        <div className="panel row row--wrap row--middle practice__choice" role="group" aria-label={`${cardOf(state.cards[run.selected]).name}, in hand`}>
          <strong>{cardOf(state.cards[run.selected]).name}</strong>
          <span className="spacer" />
          {cardOf(state.cards[run.selected]).rules.kind === 'land'
            ? <button className="btn btn--primary btn--sm" onClick={() => doAction({ type: 'playLand', instanceId: run.selected })}>Play</button>
            : <button className="btn btn--primary btn--sm" onClick={() => doAction({ type: 'beginCast', instanceId: run.selected })}>Cast</button>}
          <button className="btn btn--sm" onClick={() => setInspecting(run.selected)}>Look closely</button>
          <button className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'select', instanceId: null })}>Cancel</button>
        </div>
      )}

      {!handOff && state.casting?.player === me && (
        <CastPanel state={state} player={me} highlight={null}
          onAssign={(part, from) => doAction({ type: 'assign', part, from })} onUnassign={(part) => doAction({ type: 'unassign', part })}
          onAutoPay={() => doAction({ type: 'autoPay' })} onCommit={() => doAction({ type: 'commitCast' })} onCancel={() => doAction({ type: 'cancelCast' })} />
      )}

      {!handOff && declaring && !mulliganing && declaring.kind !== 'discard' && (
        <Declare kind={declaring.kind} state={state} player={me} chosen={run.chosen} blocks={run.blocks} highlight={null}
          onToggle={(id) => dispatch({ type: 'toggleChosen', instanceId: id })}
          onBlock={(blockerId, attackerId) => dispatch({ type: 'setBlock', blockerId, attackerId })}
          onDeclare={() => doAction(declaring.kind === 'attackers' ? { type: 'declareAttackers', attackers: run.chosen } : { type: 'declareBlockers', blocks: run.blocks })}
          onNone={() => doAction(declaring.kind === 'attackers' ? { type: 'declareAttackers', attackers: [] } : { type: 'declareBlockers', blocks: {} })} />
      )}

      {!handOff && declaring?.kind === 'discard' && (
        <section className="panel stack stack--snug" aria-label="Discard">
          <strong>Discard down to seven: choose {declaring.count}.</strong>
          <button className="btn btn--primary self-start" onClick={() => doAction({ type: 'discard', instanceIds: run.chosen })} disabled={run.chosen.length !== declaring.count}>Discard {run.chosen.length}/{declaring.count}</button>
        </section>
      )}

      {!handOff && !state.casting && !state.over && !declaring && (
        <div className="row row--wrap practice__priority">
          <button className="btn" onClick={() => doAction({ type: 'pass' })} disabled={!myPriority}>Pass priority</button>
          {state.stack.length === 0 && state.active === me && !MAIN_STEPS.includes(state.step) && (
            <button className="btn btn--sm" onClick={() => dispatch({ type: 'passUntil', scenario, until: (s) => MAIN_STEPS.includes(s.step) || s.active !== me || Boolean(s.awaiting) })} disabled={!myPriority}>To my main phase</button>
          )}
          {state.stack.length === 0 && (
            <button className="btn btn--sm" onClick={() => dispatch({ type: 'passUntil', scenario, until: (s) => s.active !== state.active || s.turn !== state.turn || Boolean(s.awaiting) })} disabled={!myPriority}>End the turn</button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => doAction({ type: 'concede' })}>Concede</button>
          <span className="faint tiny">{state.stack.length ? `${state.stack.length} on the stack.` : 'Passing with an empty stack moves to the next step.'}</span>
        </div>
      )}

      {run.refusal && <div className="banner banner--warn" role="status"><strong>Not allowed.</strong> {run.refusal.message}</div>}
      {state.over && (
        <div className="banner banner--info" role="status">
          <strong>Game over.</strong> {state.over.winner ? `${who(state.over.winner)} won` : 'A draw'}
          {state.over.reason === 'life' ? ': a life total reached zero.' : state.over.reason === 'drewFromEmpty' ? ': a draw from an empty library.' : state.over.reason === 'conceded' ? ': a concession.' : '.'}
          {' '}<button className="btn btn--sm" onClick={newGame}>New game</button>
        </div>
      )}

      <details className="panel practice__details">
        <summary>What happened, step by step</summary>
        <ol className="practice__log tiny">{run.journal.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}</ol>
      </details>

      <p className="faint tiny m0">
        {hotseat ? 'Two people at one screen. ' : `Practice opponent: ${policyFor(scenario.opponent).description} `}
        Practice decks of thirty cards from the practice pool, not legal decks for any format. Card names and rules text are the property of
        Wizards of the Coast, shown under the Fan Content Policy. Unofficial, and not endorsed by Wizards.
      </p>

      <CardZoom card={inspecting ? cardOf(state.cards[inspecting]) : null} open={!!inspecting} onClose={() => setInspecting(null)} />
    </div>
  )
}
