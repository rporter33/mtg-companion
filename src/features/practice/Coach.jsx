/**
 * The coach: what to do now, why the last thing was refused, the goals,
 * a hint on request, and the why-question at the end. A refusal is shown
 * in the model's own words; the coach never invents a rule.
 */
export default function Coach({ scenario, step, refusal, progress, hints, onHint, explain, explained, onExplain, onRetryExplain, over }) {
  const nextHint = (scenario.hints ?? []).find((h) => !hints.includes(h.id))
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
    </section>
  )
}
