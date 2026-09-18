import { battlefield, isCreature, hasKeyword, stats, cardOf } from '../../lib/table/model.js'

/**
 * Choosing attackers or blockers. Creatures on the table are toggled by
 * selecting them; this panel lists the same choices as buttons, so the
 * declaration can be made without touching the cards, and says why a
 * creature cannot be chosen before the model has to refuse it.
 */
export default function Declare({ kind, state, player = 'you', chosen, blocks, highlight, onToggle, onBlock, onDeclare, onNone }) {
  const mine = battlefield(state, player).filter(isCreature)
  if (kind === 'attackers') {
    return (
      <section className="panel stack stack--snug declare" aria-label="Choose attackers">
        <strong>Declare attackers</strong>
        <div className="stack stack--tight">
          {mine.map((c) => {
            const why = c.tapped ? 'tapped' : c.sick && !hasKeyword(c, 'haste') ? 'summoning sick' : null
            return (
              <button key={c.instanceId} type="button" className={`chip ${chosen.includes(c.instanceId) ? 'chip--active' : ''}`}
                aria-pressed={chosen.includes(c.instanceId)} onClick={() => onToggle(c.instanceId)}>
                {cardOf(c).name} {stats(c) ? `${stats(c).power}/${stats(c).toughness}` : ''}{why ? ` · ${why}` : ''}
              </button>
            )
          })}
          {mine.length === 0 && <span className="faint tiny">No creatures.</span>}
        </div>
        <div className="row row--wrap">
          <button className={`btn btn--primary ${highlight === 'attack' ? 'practice__wanted' : ''}`} onClick={onDeclare} disabled={!chosen.length} data-wanted={highlight === 'attack' || undefined}>
            Attack with {chosen.length || 'these'}
          </button>
          <button className="btn btn--sm" onClick={onNone}>No attackers</button>
          <span className="faint tiny">Attacking taps the creature. Choosing a creature that cannot attack is refused with the reason.</span>
        </div>
      </section>
    )
  }
  const attackers = state.attackers.map((id) => state.cards[id])
  return (
    <section className="panel stack stack--snug declare" aria-label="Choose blockers">
      <strong>Declare blockers</strong>
      <p className="tiny muted m0">Attacking you: {attackers.map((a) => `${cardOf(a).name} ${stats(a).power}/${stats(a).toughness}`).join(', ')}.</p>
      <div className="stack stack--tight">
        {mine.map((c) => (
          <div key={c.instanceId} className="row row--wrap row--middle">
            <span className="tiny">{cardOf(c).name} {stats(c).power}/{stats(c).toughness}{c.tapped ? ' · tapped' : ''}</span>
            {!c.tapped && attackers.map((a) => (
              <button key={a.instanceId} type="button" className={`chip tiny ${blocks[c.instanceId] === a.instanceId ? 'chip--active' : ''}`}
                aria-pressed={blocks[c.instanceId] === a.instanceId}
                onClick={() => onBlock(c.instanceId, blocks[c.instanceId] === a.instanceId ? null : a.instanceId)}>
                block {cardOf(a).name}
              </button>
            ))}
          </div>
        ))}
        {mine.length === 0 && <span className="faint tiny">No creatures to block with.</span>}
      </div>
      <div className="row row--wrap">
        <button className={`btn btn--primary ${highlight === 'block' ? 'practice__wanted' : ''}`} onClick={onDeclare} disabled={!Object.keys(blocks).length} data-wanted={highlight === 'block' || undefined}>
          Declare blocks
        </button>
        <button className="btn btn--sm" onClick={onNone}>No blocks</button>
        <span className="faint tiny">Blocking does not tap. A summoning-sick creature can block.</span>
      </div>
    </section>
  )
}

