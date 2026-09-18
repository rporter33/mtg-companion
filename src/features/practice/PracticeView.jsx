import { useReducer, useState, useMemo } from 'react'
import { navigate } from '../../lib/router.js'
import { LESSONS, scenarioById } from '../../lib/table/scenarios/index.js'
import { start, act, passUntil } from '../../lib/table/runner.js'
import { evaluate } from '../../lib/table/objectives.js'
import { cardOf, STEP_LABELS } from '../../lib/table/model.js'
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
              return (
                <button key={id} className="lesson-row" onClick={() => navigate({ scenarioId: id })}>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {s.title}
                    <span className="faint tiny"> · {s.variant}</span>
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

function initial(scenario) {
  const begun = start(scenario)
  return {
    state: begun.state,
    events: begun.events,
    log: begun.actions,
    history: [],
    refusal: null,
    hints: [],
    explained: null,
    selected: null,
  }
}

function reduce(run, action) {
  switch (action.type) {
    case 'act': {
      const result = act(run.state, { player: 'you', ...action.action }, action.scenario)
      if (!result.ok) return { ...run, refusal: { ...result.reason, action: action.action } }
      return {
        ...run,
        state: result.state,
        events: [...run.events, ...result.events],
        log: [...run.log, ...result.actions],
        history: [...run.history.slice(-40), { state: run.state, events: run.events, log: run.log }],
        refusal: null,
        selected: null,
      }
    }
    case 'passUntil': {
      const result = passUntil(run.state, action.scenario, action.until)
      return {
        ...run,
        state: result.state,
        events: [...run.events, ...result.events],
        log: [...run.log, ...result.actions],
        history: [...run.history.slice(-40), { state: run.state, events: run.events, log: run.log }],
        refusal: null,
        selected: null,
      }
    }
    case 'undo': {
      const last = run.history[run.history.length - 1]
      if (!last) return run
      return { ...run, ...last, history: run.history.slice(0, -1), refusal: null, selected: null }
    }
    case 'reset': return initial(action.scenario)
    case 'select': return { ...run, selected: action.instanceId, refusal: null }
    case 'hint': return run.hints.includes(action.id) ? run : { ...run, hints: [...run.hints, action.id] }
    case 'explain': {
      const option = action.scenario.explain.options[action.index]
      const event = { type: 'explained', questionId: action.scenario.explain.id, correct: !!option.correct, index: action.index }
      return { ...run, events: [...run.events, event], explained: { index: action.index, correct: !!option.correct } }
    }
    case 'retryExplain': return { ...run, explained: null }
    default: return run
  }
}

function Scenario({ scenario, onOpenCard }) {
  const [run, dispatch] = useReducer(reduce, scenario, initial)
  const [inspecting, setInspecting] = useState(null)
  const { state } = run
  const progress = useMemo(() => evaluate(scenario, state, run.events), [scenario, state, run.events])
  const doAction = (action) => dispatch({ type: 'act', action, scenario })

  const step = scenario.coach.steps.find((s) => s.when(state)) ?? null
  const yourPriority = state.priority === 'you' && !state.awaiting && !state.over
  const askExplain = scenario.explain && !run.explained?.correct
    && progress.goals.filter((g) => !g.id.startsWith('explained:')).every((g) => g.done)

  return (
    <div className="stack practice">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'undo' })} disabled={!run.history.length}
          aria-label="Undo the last action (practice only)">Undo</button>
        <button className="btn btn--ghost btn--sm" onClick={() => dispatch({ type: 'reset', scenario })}>Reset</button>
      </div>

      <div>
        <h1 className="m0">{scenario.title}</h1>
        <p className="faint tiny m0" aria-live="polite">
          {state.active === 'you' ? 'Your' : 'Their'} turn {state.turnsBy[state.active]} · {STEP_LABELS[state.step]}
          {' · '}{state.over ? 'Game over' : state.awaiting ? `Waiting on ${state.awaiting.player === 'you' ? 'you' : 'your opponent'} to declare ${state.awaiting.kind}` : `${state.priority === 'you' ? 'You have' : 'Your opponent has'} priority`}
        </p>
      </div>

      <Table
        state={state}
        highlight={step?.highlight ?? null}
        selected={run.selected}
        casting={state.casting}
        onSelectHand={(id) => dispatch({ type: 'select', instanceId: run.selected === id ? null : id })}
        onPermanent={(inst) => {
          if (state.casting?.needsTarget && !state.casting.targets.length) return doAction({ type: 'chooseTarget', target: { kind: 'creature', id: inst.instanceId } })
          if (inst.controller === 'you' && (cardOf(inst).rules.mana ?? []).length) return doAction({ type: 'tapForMana', instanceId: inst.instanceId })
          setInspecting(inst.instanceId)
        }}
        onPlayer={(player) => {
          if (state.casting?.needsTarget === 'any' && !state.casting.targets.length) doAction({ type: 'chooseTarget', target: { kind: 'player', id: player } })
        }}
        onInspect={setInspecting}
      />

      {run.selected && !state.casting && (
        <HandChoice
          inst={state.cards[run.selected]}
          onCast={() => doAction({ type: 'beginCast', instanceId: run.selected })}
          onPlay={() => doAction({ type: 'playLand', instanceId: run.selected })}
          onInspect={() => setInspecting(run.selected)}
          onCancel={() => dispatch({ type: 'select', instanceId: null })}
        />
      )}

      {state.casting && (
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

      {!state.casting && !state.over && (
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
        step={step}
        refusal={run.refusal}
        progress={progress}
        hints={run.hints}
        onHint={(id) => dispatch({ type: 'hint', id })}
        explain={askExplain ? scenario.explain : null}
        explained={run.explained}
        onExplain={(index) => dispatch({ type: 'explain', index, scenario })}
        onRetryExplain={() => dispatch({ type: 'retryExplain' })}
        over={state.over}
      />

      <p className="faint tiny m0">
        Card names and rules text are the property of Wizards of the Coast, shown under the Fan Content Policy.
        Unofficial, and not endorsed by Wizards. Undo is a practice tool: there are no takebacks in a real game.
      </p>

      <CardZoom
        card={inspecting ? cardOf(state.cards[inspecting]) : null}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
      />
    </div>
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
