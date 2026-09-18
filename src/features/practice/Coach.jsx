/**
 * The coach: what to do now, why the last thing was refused, the goals,
 * a hint on request, and the why-question at the end. A refusal is shown
 * in the model's own words; the coach never invents a rule.
 */
import { policyFor } from '../../lib/table/opponent.js'

export default function Coach({ scenario, step, refusal, progress, hints, onHint, explain, explained, onExplain, onRetryExplain, predictions = [], answered = {}, allPredictions = [], onPredict, opponent, over }) {
  const nextHint = (scenario.hints ?? []).find((h) => !hints.includes(h.id))
  const policy = policyFor(opponent)
  const lastAnswered = allPredictions.filter((q) => answered[q.id]).slice(-1)[0] ?? null
  return (
    <section className="coach stack stack--snug" aria-label="Coach">
      {refusal && (
        <div className="banner banner--warn" role="status">
          <strong>Not allowed.</strong> {refusal.message}
        </div>
      )}
      {over && (
        <div className="banner banner--info" role="status">
          <strong>Game over.</strong> {over.winner === 'you' ? 'You won' : over.winner === 'foe' ? 'Your opponent won' : 'A draw'}
          {over.reason === 'life' ? ': a life total reached zero.' : over.reason === 'drewFromEmpty' ? ': a draw from an empty library.' : over.reason === 'conceded' ? ': a concession.' : '.'}
        </div>
      )}
      <p className="coach__text" aria-live="polite">{step?.say ?? scenario.coach.intro}</p>

      {predictions.map((q) => (
        <div key={q.id} className="stack stack--snug coach__predict" role="group" aria-label="Predict">
          <strong>Before you act: {q.question}</strong>
          {q.options.map((option, i) => (
            <button key={i} className="quiz-option" onClick={() => onPredict(q, i)}>
              <span className="quiz-option__mark" />
              <span>{option.text}</span>
            </button>
          ))}
          <p className="faint tiny m0">One answer per run. A prediction made after the result is not a prediction.</p>
        </div>
      ))}
      {lastAnswered && !predictions.length && (
        <div className={`banner banner--${answered[lastAnswered.id].correct ? 'info' : 'warn'}`}>
          <strong>{answered[lastAnswered.id].correct ? 'Your prediction was right.' : 'Not quite.'}</strong>{' '}
          {lastAnswered.options[answered[lastAnswered.id].index].why}
          {!answered[lastAnswered.id].correct && ' Watch what the table does, then reset and predict again.'}
        </div>
      )}

      {explain && (
        <div className="stack stack--snug" role="group" aria-label="Check yourself">
          <strong>{explain.question}</strong>
          {explain.options.map((option, i) => {
            const chosen = explained?.index === i
            const state = explained == null ? '' : option.correct ? 'quiz-option--correct' : chosen ? 'quiz-option--wrong' : 'quiz-option--muted'
            return (
              <button key={i} className={`quiz-option ${state}`} onClick={() => { if (explained == null) onExplain(i) }} disabled={explained != null}>
                <span className="quiz-option__mark">{explained == null ? '' : option.correct ? '✓' : chosen ? '✕' : ''}</span>
                <span>{option.text}</span>
              </button>
            )
          })}
          {explained && (
            <div className={`banner banner--${explained.correct ? 'info' : 'warn'}`}>
              <strong>{explained.correct ? 'Right.' : 'Not quite.'}</strong> {explain.options[explained.index].why}
              {!explained.correct && <div className="mt2"><button className="btn btn--sm" onClick={onRetryExplain}>Try again</button></div>}
            </div>
          )}
        </div>
      )}

      <div className="row row--wrap row--middle">
        <ul className="coach__goals" aria-label="Goals">
          {progress.goals.map((g) => (
            <li key={g.id} className={g.done ? 'coach__goal coach__goal--done' : 'coach__goal'}>
              <span aria-hidden="true">{g.done ? '✓' : '○'}</span> {g.label}
            </li>
          ))}
        </ul>
        <span className="spacer" />
        {nextHint && !progress.complete && (
          <button className="btn btn--ghost btn--sm" onClick={() => onHint(nextHint.id)}>Show a hint</button>
        )}
      </div>
      {hints.map((id) => {
        const hint = scenario.hints.find((h) => h.id === id)
        return hint ? <p key={id} className="tiny muted m0 coach__hint">Hint: {hint.say}</p> : null
      })}
      {progress.complete && (
        <div className="banner banner--info" role="status">
          <strong>Done.</strong> Every goal is met. Reset to try it again, or go back for the next exercise.
        </div>
      )}
      <p className="faint tiny m0">Practice opponent: {policy.description}</p>
    </section>
  )
}
