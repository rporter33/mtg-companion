import { PHASES, STEPS } from '../../data/turn-structure.js'

/**
 * Where you are in the turn.
 *
 * A turn is five phases and thirteen steps, and almost nothing in a card game
 * makes sense until you know which one you are in: when a land may be played,
 * when a creature may attack, when nobody may do anything at all. New players
 * are told this once and then left to guess, which is why the same three
 * questions come up every game.
 *
 * So this walks `src/data/turn-structure.js` and says, for the step you are
 * in: what happens in it, whether anyone gets priority there, and whether a
 * sorcery or a land may be played. It resolves nothing on your behalf — it is
 * a tracker, not a judge, and it is the free table's counterpart to the
 * practice engine, which does enforce all of this over the cards it knows.
 *
 * Rule numbers are shown because they are how you settle an argument at a
 * real table, and because citing them is the difference between the app
 * telling you something and the app showing you where it comes from.
 */
export default function TurnTracker({ board, hasFirstStrike = false, onStep, onJump, open, onToggle }) {
  const current = STEPS.find((step) => step.id === board.step) ?? STEPS[0]

  return (
    <section className="pile turns" aria-label="Where you are in the turn">
      <h2 className="pile__title">
        {current.phaseName}
        <span className="chip tiny">{current.name}</span>
        <button className="btn btn--ghost btn--sm" onClick={onToggle} aria-expanded={open}>
          {open ? 'Close' : 'The whole turn'}
        </button>
      </h2>

      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={() => onStep({ hasFirstStrike })}>Next step</button>
        <span className="chip tiny">{current.rule}</span>
        {current.sorcerySpeed && <span className="chip tiny turns__can">A land and sorceries may be played here</span>}
        {!current.priority && <span className="chip tiny turns__quiet">Nobody gets priority in this step</span>}
      </div>

      {current.does.length > 0 && (
        <ol className="turns__does">
          {current.does.map((line) => (
            <li key={line.rule}>
              {line.text} <span className="faint tiny">({line.rule})</span>
            </li>
          ))}
        </ol>
      )}
      {current.note && <p className="faint tiny">{current.note}</p>}

      {open && (
        <div className="turns__all">
          {PHASES.map((phase) => (
            <div className="turns__phase" key={phase.id}>
              <h3 className="turns__phasename">
                {phase.name} <span className="faint tiny">{phase.rule}</span>
              </h3>
              <ul className="turns__steps" role="list">
                {phase.steps.map((step) => (
                  <li key={step.id}>
                    <button
                      className={`turns__step${step.id === current.id ? ' turns__step--here' : ''}`}
                      onClick={() => onJump(step.id)}
                      aria-current={step.id === current.id ? 'step' : undefined}
                    >
                      {step.name}
                      <span className="faint tiny">
                        {step.rule}
                        {step.optional ? ' · only with first strike' : ''}
                        {!step.priority ? ' · no priority' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="faint tiny">
            Adapted from the Comprehensive Rules in the table form devised by April King and published by
            BoiledOwlbear. This table follows the turn; it does not enforce it.
          </p>
        </div>
      )}
    </section>
  )
}
