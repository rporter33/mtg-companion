import ManaCost from '../../components/ManaCost.jsx'
import { cardOf, POOL_KEYS } from '../../lib/table/model.js'
import { colourName } from '../../lib/table/reducer.js'

/**
 * The casting transaction, visible: the cost as symbols, what is assigned
 * to each, the pool to pay from, and one button that commits. Nothing here
 * is paid until Cast is pressed, and a refused assignment says why.
 */
export default function CastPanel({ state, highlight, onAssign, onUnassign, onAutoPay, onCommit, onCancel }) {
  const casting = state.casting
  const card = cardOf(state.cards[casting.instanceId])
  const pool = state.pool.you
  const reservedOf = (k) => casting.assigned.filter((a) => a.from === k).length
  const paid = casting.cost.every((part, i) => casting.assigned.filter((a) => a.part === i).length >= (part.kind === 'generic' ? part.generic : 1))
  const needsTarget = casting.needsTarget && !casting.targets.length

  return (
    <section className="panel stack stack--snug cast" aria-label={`Casting ${card.name}`}>
      <div className="row row--wrap row--middle">
        <strong>Casting {card.name}</strong>
        <ManaCost cost={card.mana_cost} />
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
      </div>

      {needsTarget && (
        <p className="tiny m0 banner banner--info">
          Choose a target: {casting.needsTarget === 'creature' ? 'a creature on the battlefield' : 'a creature, you, or your opponent'}.
        </p>
      )}
      {casting.targets.length > 0 && (
        <p className="tiny m0">Target: <strong>{targetName(state, casting.targets[0])}</strong></p>
      )}

      <div className="stack stack--tight" role="group" aria-label="Paying the cost">
        {casting.cost.map((part, i) => {
          const needed = part.kind === 'generic' ? part.generic : 1
          const have = casting.assigned.filter((a) => a.part === i)
          const able = POOL_KEYS.filter((k) => pool[k] - reservedOf(k) > 0)
          return (
            <div className="cast__part row row--wrap row--middle" key={i}>
              <span className="cast__symbol" aria-label={`Cost part ${i + 1}: ${part.symbol}`}><ManaCost cost={`{${part.symbol}}`} /></span>
              <span className="tiny muted">
                {part.kind === 'generic' ? `any ${needed} mana` : part.kind === 'colorless' ? 'colourless only' : `${colourName(part.colors[0])} only`}
              </span>
              <span className="cast__assigned">
                {have.map((a, j) => (
                  <button key={j} type="button" className="chip tiny chip--active" onClick={() => onUnassign(i)} data-mana={a.from}
                    aria-label={`${colourName(a.from)} mana on ${part.symbol}; press to take it back`}>
                    {colourName(a.from)} ✕
                  </button>
                ))}
              </span>
              {have.length < needed && able.map((k) => (
                <button key={k} type="button" className="chip tiny" onClick={() => onAssign(i, k)} data-mana={k}
                  aria-label={`Pay ${part.symbol} with ${colourName(k)} mana`}>
                  + {colourName(k)}
                </button>
              ))}
              {have.length < needed && !able.length && <span className="faint tiny">nothing in the pool: tap a source</span>}
            </div>
          )
        })}
      </div>

      <div className="row row--wrap">
        <button className={`btn btn--sm ${highlight === 'pay' ? 'practice__wanted' : ''}`} onClick={onAutoPay} data-wanted={highlight === 'pay' || undefined}>
          Pay from pool
        </button>
        <button className={`btn btn--primary ${highlight === 'commit' ? 'practice__wanted' : ''}`} onClick={onCommit}
          disabled={!paid || needsTarget} data-wanted={highlight === 'commit' || undefined}>
          Cast
        </button>
        <span className="faint tiny">{paid ? 'Paid. Casting puts it on the stack.' : 'Tap sources for mana, then put mana on each part of the cost.'}</span>
      </div>
    </section>
  )
}

function targetName(state, target) {
  if (target.kind === 'player') return target.id === 'you' ? 'you' : 'your opponent'
  return cardOf(state.cards[target.id]).name
}
