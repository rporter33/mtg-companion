import { useReducer, useState, useMemo, useEffect, useRef } from 'react'
import { navigate } from '../../lib/router.js'
import { LESSONS, scenarioById } from '../../lib/table/scenarios/index.js'
import { start, act, passUntil, replay } from '../../lib/table/runner.js'
import { evaluate } from '../../lib/table/objectives.js'
import { cardOf, STEP_LABELS } from '../../lib/table/model.js'
import { narrateAll, cuesFrom, CUE_MS, prefersReducedMotion } from '../../lib/table/motion.js'
import {
  getPractice, savePracticeRun, clearPracticeRun, markPaperPractice, recordEvidence, getPrefs, setPref, lastSaveSucceeded,
} from '../../lib/storage.js'
import Table from './Table.jsx'
import CastPanel from './CastPanel.jsx'
import Coach from './Coach.jsx'
import CardZoom from '../../components/CardZoom.jsx'
import './practice.css'

/**
 * The practice table.
 *
 * Reached at #/practice and #/practice/<scenario>. Nothing links here yet:
 * it is being built beside the Learn tab and will replace the scripted game
 * once the lessons are done. Everything on this screen is derived from the
 * model's state; the screen never decides a rule.
 *
 * What is saved is the action log, which replays to the same state, so a
 * reload resumes at the last committed action and undo is a step back
 * through the same log. Motion is derived from the model's events and can
 * be turned off without changing anything the screen says.
 */
export default function PracticeView({ route, onOpenCard }) {
  const scenario = route.scenarioId ? scenarioById(route.scenarioId) : null
  if (route.scenarioId && !scenario) {
    return (
      <div className="stack">
        <button className="btn btn--ghost btn--sm self-start" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
        <div className="banner banner--warn">There is no exercise at this address.</div>
      </div>
    )
  }
  if (!scenario) return <PracticeHome />
  return <Scenario key={scenario.id} scenario={scenario} onOpenCard={onOpenCard} />
}

function PracticeHome() {
  const practice = getPractice()
  return (
    <div className="stack">
      <div>
        <h1>Practice</h1>
        <p className="muted">A table that plays by the rules, one decision at a time. Nothing here is saved to your decks.</p>
      </div>
      {LESSONS.map((lesson) => (
        <section className="panel stack stack--snug" key={lesson.id}>
          <h2 className="m0">{lesson.title}</h2>
          <p className="muted tiny m0">{lesson.skill} · about {lesson.minutes} minutes</p>
          <div className="stack stack--tight">
            {lesson.scenarios.map((id) => {
              const s = scenarioById(id)
              const saved = practice.runs[id]
              return (
                <button key={id} className="lesson-row" onClick={() => navigate({ scenarioId: id })}>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {s.title}
                    <span className="faint tiny"> · {s.variant}{saved ? ' · in progress' : ''}{practice.paper[id] ? ' · done with cards' : ''}</span>
                    <br />
                    <span className="muted tiny">{s.summary}</span>
                  </span>
                  <span className="faint">›</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

// --- the runner ------------------------------------------------------------

function fresh(scenario) {
  const begun = start(scenario)
  return {
    state: begun.state,
    events: begun.events,
    log: begun.actions,
    journal: narrateAll(begun.events, begun.state),
    history: [],
    refusal: null,
    hints: [],
    explained: null,
    selected: null,
    lastEvents: [],
    seq: 0,
    restored: false,
  }
}

/** A saved run comes back by replaying its log; a log that no longer applies in full is dropped. */
function initial(scenario) {
  const saved = getPractice().runs[scenario.id]
  if (!saved || saved.version !== (scenario.version ?? 1) || !Array.isArray(saved.log) || !saved.log.length) return fresh(scenario)
  const rebuilt = replay(scenario, saved.log)
  if (rebuilt.applied !== saved.log.length) return fresh(scenario)
  const events = [...rebuilt.events]
  if (saved.explained) events.push({ type: 'explained', questionId: scenario.explain?.id, correct: !!saved.explained.correct, index: saved.explained.index })
  return {
    ...fresh(scenario),
    state: rebuilt.state,
    events,
    log: saved.log,
    journal: narrateAll(rebuilt.events, rebuilt.state),
    hints: saved.hints ?? [],
    explained: saved.explained ?? null,
    restored: true,
  }
}

function committed(run, result) {
  return {
    ...run,
    state: result.state,
    events: [...run.events, ...result.events],
    log: [...run.log, ...result.actions],
    journal: [...run.journal, ...narrateAll(result.events, result.state)],
    history: [...run.history.slice(-40), { state: run.state, events: run.events, log: run.log, journal: run.journal }],
    refusal: null,
    selected: null,
    lastEvents: result.events,
    seq: run.seq + 1,
    restored: false,
  }
}

function reduce(run, action) {
  switch (action.type) {
    case 'act': {
      const result = act(run.state, { player: 'you', ...action.action }, action.scenario)
      if (!result.ok) return { ...run, refusal: { ...result.reason, action: action.action } }
      return committed(run, result)
    }
    case 'passUntil': return committed(run, passUntil(run.state, action.scenario, action.until))
    case 'undo': {
      const last = run.history[run.history.length - 1]
      if (!last) return run
      return { ...run, ...last, history: run.history.slice(0, -1), refusal: null, selected: null, lastEvents: [], seq: run.seq + 1 }
    }
    case 'reset': return fresh(action.scenario)
    case 'select': return { ...run, selected: action.instanceId, refusal: null }
    case 'hint': return run.hints.includes(action.id) ? run : { ...run, hints: [...run.hints, action.id] }
    case 'explain': {
      const option = action.scenario.explain.options[action.index]
      const event = { type: 'explained', questionId: action.scenario.explain.id, correct: !!option.correct, index: action.index }
      return { ...run, events: [...run.events, event], journal: [...run.journal, ...narrateAll([event], run.state)], explained: { index: action.index, correct: !!option.correct } }
    }
    case 'retryExplain': return { ...run, explained: null }
    default: return run
  }
}

function Scenario({ scenario, onOpenCard }) {
  const [run, dispatch] = useReducer(reduce, scenario, initial)
  const [inspecting, setInspecting] = useState(null)
  const [viewing, setViewing] = useState(null) // replay position, or null for the live table
  const [cues, setCues] = useState({})
  const [motionPref, setMotionPref] = useState(() => getPrefs().reduceMotion ?? null)
  const [paperDone, setPaperDone] = useState(() => Boolean(getPractice().paper[scenario.id]))
  const [saveOk, setSaveOk] = useState(true)
  const reduced = prefersReducedMotion(motionPref)
  const { state } = run
  const progress = useMemo(() => evaluate(scenario, state, run.events), [scenario, state, run.events])
  const doAction = (action) => dispatch({ type: 'act', action, scenario })

  // Evidence: viewing is recorded on arrival, practising when every goal is met.
  useEffect(() => { recordEvidence(scenario.lessonId, 'viewed', { scenarioId: scenario.id }) }, [scenario])
  useEffect(() => {
    if (progress.complete) recordEvidence(scenario.lessonId, 'practiced', { scenarioId: scenario.id, hints: run.hints.length })
  }, [progress.complete, scenario, run.hints.length])

  // The saved run is the log, written after every committed action; a fresh reset clears it.
  const firstSave = useRef(true)
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; if (run.restored) return }
    if (!run.log.length && !run.hints.length && !run.explained) { clearPracticeRun(scenario.id); return }
    savePracticeRun(scenario.id, { version: scenario.version ?? 1, log: run.log, hints: run.hints, explained: run.explained })
    setSaveOk(lastSaveSucceeded())
  }, [run.log, run.hints, run.explained, run.restored, scenario])

  // Cues from the last committed events, shown for a moment; none with motion reduced.
  useEffect(() => {
    if (reduced || !run.lastEvents.length) { setCues({}); return undefined }
    const next = {}
    for (const cue of cuesFrom(run.lastEvents)) next[cue.id] = cue.kind
    setCues(next)
    const timer = setTimeout(() => setCues({}), CUE_MS)
    return () => clearTimeout(timer)
  }, [run.seq, run.lastEvents, reduced])

  const step = scenario.coach.steps.find((s) => s.when(state)) ?? null
  const yourPriority = state.priority === 'you' && !state.awaiting && !state.over
  const askExplain = scenario.explain && !run.explained?.correct
    && progress.goals.filter((g) => !g.id.startsWith('explained:')).every((g) => g.done)

  const shown = viewing == null ? state : replay(scenario, run.log.slice(0, viewing)).state
  const shownJournal = viewing == null ? run.journal : narrateAll(replay(scenario, run.log.slice(0, viewing)).events, shown)
  const recent = run.journal.slice(-4)

  const toggleMotion = () => {
    const next = !reduced
    setMotionPref(next)
    setPref('reduceMotion', next)
  }

  return (
    <div className={`stack practice ${reduced ? 'practice--still' : ''}`}>
      <div className="row row--wrap">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
        <span className="spacer" />
        <button className="chip tiny" type="button" onClick={toggleMotion} aria-pressed={reduced}
          aria-label={reduced ? 'Motion reduced; press to allow motion' : 'Motion on; press to reduce motion'}>
          {reduced ? 'Motion: reduced' : 'Motion: on'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'undo' })} disabled={!run.history.length || viewing != null}
          aria-label="Undo the last action (practice only)">Undo</button>
        <button className="btn btn--ghost btn--sm" onClick={() => { setViewing(null); dispatch({ type: 'reset', scenario }) }}>Reset</button>
      </div>

      <div>
        <h1 className="m0">{scenario.title}</h1>
        <p className="faint tiny m0">
          {shown.active === 'you' ? 'Your' : 'Their'} turn {shown.turnsBy[shown.active]} · {STEP_LABELS[shown.step]}
          {' · '}{shown.over ? 'Game over' : shown.awaiting ? `Waiting on ${shown.awaiting.player === 'you' ? 'you' : 'your opponent'} to declare ${shown.awaiting.kind}` : `${shown.priority === 'you' ? 'You have' : 'Your opponent has'} priority`}
          {viewing != null && ' · replay'}
        </p>
        {run.restored && <p className="tiny muted m0" role="status">Picked up where you left off.</p>}
        {!saveOk && <p className="tiny m0 banner banner--warn" role="status">Progress could not be saved. You can keep going; this run may not survive a reload.</p>}
      </div>

      {viewing != null && (
        <div className="row row--wrap practice__replay" role="group" aria-label="Replay">
          <button className="btn btn--sm" onClick={() => setViewing(Math.max(0, viewing - 1))} disabled={viewing === 0}>← Earlier</button>
          <span className="tiny muted">Action {viewing} of {run.log.length}</span>
          <button className="btn btn--sm" onClick={() => setViewing(Math.min(run.log.length, viewing + 1))} disabled={viewing >= run.log.length}>Later →</button>
          <span className="spacer" />
          <button className="btn btn--primary btn--sm" onClick={() => setViewing(null)}>Back to the table</button>
        </div>
      )}

      <Table
        state={shown}
        cues={cues}
        highlight={viewing == null ? step?.highlight ?? null : null}
        selected={viewing == null ? run.selected : null}
        casting={viewing == null ? state.casting : null}
        onSelectHand={(id) => { if (viewing == null) dispatch({ type: 'select', instanceId: run.selected === id ? null : id }) }}
        onPermanent={(inst) => {
          if (viewing != null) return setInspecting(inst.instanceId)
          if (state.casting?.needsTarget && !state.casting.targets.length) return doAction({ type: 'chooseTarget', target: { kind: 'creature', id: inst.instanceId } })
          if (inst.controller === 'you' && (cardOf(inst).rules.mana ?? []).length) return doAction({ type: 'tapForMana', instanceId: inst.instanceId })
          setInspecting(inst.instanceId)
        }}
        onPlayer={(player) => {
          if (viewing == null && state.casting?.needsTarget === 'any' && !state.casting.targets.length) doAction({ type: 'chooseTarget', target: { kind: 'player', id: player } })
        }}
        onInspect={setInspecting}
      />

      <div className="practice__journal" aria-live="polite" aria-atomic="false" aria-label="What just happened">
        {(viewing == null ? recent : shownJournal.slice(-4)).map((line, i) => <p key={`${i}-${line}`} className="tiny muted m0">{line}</p>)}
      </div>

      {viewing == null && run.selected && !state.casting && (
        <HandChoice
          inst={state.cards[run.selected]}
          onCast={() => doAction({ type: 'beginCast', instanceId: run.selected })}
          onPlay={() => doAction({ type: 'playLand', instanceId: run.selected })}
          onInspect={() => setInspecting(run.selected)}
          onCancel={() => dispatch({ type: 'select', instanceId: null })}
        />
      )}

      {viewing == null && state.casting && (
        <CastPanel
          state={state}
          highlight={step?.highlight?.kind === 'control' ? step.highlight.id : null}
          onAssign={(part, from) => doAction({ type: 'assign', part, from })}
          onUnassign={(part) => doAction({ type: 'unassign', part })}
          onAutoPay={() => doAction({ type: 'autoPay' })}
          onCommit={() => doAction({ type: 'commitCast' })}
          onCancel={() => doAction({ type: 'cancelCast' })}
        />
      )}

      {viewing == null && !state.casting && !state.over && (
        <div className="row row--wrap practice__priority">
          <button
            className={`btn ${step?.highlight?.id === 'pass' ? 'btn--primary practice__wanted' : ''}`}
            onClick={() => doAction({ type: 'pass' })}
            disabled={!yourPriority}
            data-wanted={step?.highlight?.id === 'pass' || undefined}
          >
            Pass priority
          </button>
          {state.stack.length === 0 && (
            <button className="btn btn--sm" onClick={() => dispatch({ type: 'passUntil', scenario, until: (s) => s.active !== state.active || s.turn !== state.turn })} disabled={!yourPriority}>
              End the turn
            </button>
          )}
          <span className="faint tiny">
            {state.stack.length ? `${state.stack.length} on the stack: passing lets it resolve if your opponent passes too.` : 'Passing with an empty stack moves to the next step.'}
          </span>
        </div>
      )}

      <Coach
        scenario={scenario}
        step={viewing == null ? step : null}
        refusal={viewing == null ? run.refusal : null}
        progress={progress}
        hints={run.hints}
        onHint={(id) => dispatch({ type: 'hint', id })}
        explain={viewing == null && askExplain ? scenario.explain : null}
        explained={run.explained}
        onExplain={(index) => dispatch({ type: 'explain', index, scenario })}
        onRetryExplain={() => dispatch({ type: 'retryExplain' })}
        over={shown.over}
      />

      <details className="panel practice__details">
        <summary>What happened, step by step</summary>
        <ol className="practice__log tiny">
          {run.journal.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
        </ol>
        {run.log.length > 0 && viewing == null && (
          <button className="btn btn--sm" onClick={() => setViewing(run.log.length)}>Step through it</button>
        )}
        <p className="faint tiny m0">A replay shows the table as it was. It cannot change the game or earn progress.</p>
      </details>

      {scenario.paper && (
        <Paper paper={scenario.paper} done={paperDone} onDone={(done) => { markPaperPractice(scenario.id, done); setPaperDone(done) }} />
      )}

      <p className="faint tiny m0">
        Card names and rules text are the property of Wizards of the Coast, shown under the Fan Content Policy.
        Unofficial, and not endorsed by Wizards. Undo is a practice tool: there are no takebacks in a real game.
      </p>

      <CardZoom
        card={inspecting ? cardOf(shown.cards[inspecting]) : null}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
      />
    </div>
  )
}

function Paper({ paper, done, onDone }) {
  return (
    <details className="panel practice__details practice__paper">
      <summary>Now with real cards</summary>
      <div className="stack stack--snug">
        <div>
          <strong className="tiny">You need</strong>
          <ul className="tiny m0">{paper.needs.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <div>
          <strong className="tiny">Do this</strong>
          <ol className="tiny m0">{paper.steps.map((n) => <li key={n}>{n}</li>)}</ol>
        </div>
        <div>
          <strong className="tiny">Say this</strong>
          <ul className="tiny m0">{paper.say.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <p className="tiny m0"><strong>Check:</strong> {paper.check}</p>
        <label className="row tiny">
          <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} />
          I did this with real cards
        </label>
        <p className="faint tiny m0">Recorded as what you told us. Only the table can record a demonstration.</p>
      </div>
    </details>
  )
}

function HandChoice({ inst, onCast, onPlay, onInspect, onCancel }) {
  const card = cardOf(inst)
  const land = card.rules.kind === 'land'
  return (
    <div className="panel row row--wrap row--middle practice__choice" role="group" aria-label={`${card.name}, in your hand`}>
      <strong>{card.name}</strong>
      {!land && <span className="faint tiny">{card.mana_cost || 'no cost'}</span>}
      <span className="spacer" />
      {land
        ? <button className="btn btn--primary btn--sm" onClick={onPlay}>Play</button>
        : <button className="btn btn--primary btn--sm" onClick={onCast}>Cast</button>}
      <button className="btn btn--sm" onClick={onInspect}>Look closely</button>
      <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
    </div>
  )
}
