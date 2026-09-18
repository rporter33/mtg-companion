import CardFace from '../../components/CardFace.jsx'
import Term from '../../components/Term.jsx'
import { battlefield, hand, graveyard, librarySize, cardOf, isLand, isCreature, stats, POOL_KEYS } from '../../lib/table/model.js'
import { colourName } from '../../lib/table/reducer.js'

/**
 * The board, drawn from state alone: opponent strip and battlefield, the
 * stack, your battlefield, your strip, your hand. Every card is a real
 * button; tapped, sick, attacking and blocking are classes and words, never
 * only a rotation.
 */
export default function Table({ state, cues = {}, highlight, selected, casting, onSelectHand, onPermanent, onPlayer, onInspect }) {
  const targeting = casting?.needsTarget && !casting.targets.length
  return (
    <div className="table">
      <Strip state={state} player="foe" label="Opponent" targeting={targeting === 'any'} onPlayer={onPlayer} cue={cues.foe} />
      <Zone state={state} player="foe" targeting={targeting} onPermanent={onPermanent} onInspect={onInspect} highlight={null} cues={cues} />
      <Stack state={state} cues={cues} />
      <Zone state={state} player="you" targeting={targeting} onPermanent={onPermanent} onInspect={onInspect} highlight={highlight?.kind === 'battlefield' ? highlight.cardId : null} cues={cues} />
      <Strip state={state} player="you" label="You" targeting={targeting === 'any'} onPlayer={onPlayer} cue={cues.you} />
      <Pool pool={state.pool.you} />
      <Hand state={state} selected={selected} highlight={highlight?.kind === 'hand' ? highlight.cardId : null} onSelect={onSelectHand} onInspect={onInspect} disabled={!!casting} />
    </div>
  )
}

function Strip({ state, player, label, targeting, onPlayer, cue }) {
  const life = state.life[player]
  const active = state.active === player
  const cueClass = cue ? ` strip--cue-${cue}` : ''
  const inner = (
    <>
      <span className="strip__label">{label}</span>
      {state.priority === player && !state.over && <span className="chip tiny">priority</span>}
      <span className="spacer" />
      <span className={`strip__life ${life <= 5 ? 'strip__life--low' : ''}`} aria-label={`${label}: ${life} life`}>{life}</span>
      <span className="strip__counts">
        <Term id="library" as="span"><span className="chip tiny">{librarySize(state, player)} in library</span></Term>
        <Term id="hand" as="span"><span className="chip tiny">{state.zones.hand[player].length} in hand</span></Term>
        <Term id="graveyard" as="span"><span className="chip tiny">{graveyard(state, player).length} in graveyard</span></Term>
      </span>
    </>
  )
  if (targeting) {
    return (
      <button type="button" className={`strip strip--target ${active ? 'strip--active' : ''}${cueClass}`} onClick={() => onPlayer(player)} aria-label={`Target ${label.toLowerCase()}`}>
        {inner}
      </button>
    )
  }
  return <div className={`strip ${active ? 'strip--active' : ''}${cueClass}`}>{inner}</div>
}

function Stack({ state, cues = {} }) {
  if (!state.stack.length) return <div className="table__stack table__stack--empty" aria-label="The stack is empty">The stack is empty</div>
  return (
    <div className="table__stack" role="list" aria-label="The stack, top first">
      {[...state.stack].reverse().map((item, i) => {
        const inst = state.cards[item.instanceId]
        const card = cardOf(inst)
        const target = item.targets[0]
        const targetName = target ? (target.kind === 'player' ? (target.id === 'you' ? 'you' : 'your opponent') : cardOf(state.cards[target.id]).name) : null
        return (
          <div className={`table__spell ${cues[item.instanceId] ? `table__spell--cue-${cues[item.instanceId]}` : ''}`} role="listitem" key={item.instanceId}>
            <span className="chip tiny">{i === 0 ? 'top' : `${i + 1}`}</span>
            <strong>{card.name}</strong>
            <span className="faint tiny">{item.controller === 'you' ? 'yours' : 'theirs'}{targetName ? ` · targeting ${targetName}` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function Zone({ state, player, targeting, onPermanent, onInspect, highlight, cues = {} }) {
  const all = battlefield(state, player)
  const lands = all.filter(isLand)
  const others = all.filter((c) => !isLand(c))
  if (!all.length) return <div className={`zone zone--${player} zone--empty`}>Nothing on the battlefield</div>
  return (
    <div className={`zone zone--${player}`} aria-label={`${player === 'you' ? 'Your' : 'Their'} battlefield`}>
      {others.map((inst) => (
        <Permanent key={inst.instanceId} inst={inst} targeting={targeting && isCreature(inst)} cue={cues[inst.instanceId]}
          highlight={highlight === inst.cardId} onClick={() => onPermanent(inst)} onInspect={() => onInspect(inst.instanceId)} />
      ))}
      {lands.length > 0 && (
        <div className="zone__lands">
          {lands.map((inst) => (
            <Permanent key={inst.instanceId} inst={inst} small highlight={highlight === inst.cardId && !inst.tapped} cue={cues[inst.instanceId]}
              onClick={() => onPermanent(inst)} onInspect={() => onInspect(inst.instanceId)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Permanent({ inst, small, targeting, highlight, onClick, onInspect, cue }) {
  const card = cardOf(inst)
  const s = stats(inst)
  const words = [
    inst.tapped ? 'tapped' : '',
    inst.sick && isCreature(inst) ? 'summoning sick' : '',
    inst.attacking ? 'attacking' : '',
    inst.blocking ? 'blocking' : '',
    s && inst.damage ? `${inst.damage} damage marked` : '',
    s && inst.effects.length ? `${s.power}/${s.toughness} until end of turn` : '',
  ].filter(Boolean)
  return (
    <div
      className={[
        'permanent',
        small ? 'permanent--land' : '',
        inst.tapped ? 'permanent--tapped' : '',
        inst.sick && isCreature(inst) ? 'permanent--sick' : '',
        inst.attacking ? 'permanent--attacking' : '',
        inst.blocking ? 'permanent--blocking' : '',
        highlight ? 'permanent--wanted' : '',
        targeting ? 'permanent--target' : '',
        cue ? `permanent--cue-${cue}` : '',
      ].filter(Boolean).join(' ')}
      data-instance={inst.instanceId}
    >
      <CardFace card={card} size={small ? 'sm' : 'md'} onClick={onClick} />
      {words.length > 0 && <span className="sr-only">{card.name}: {words.join(', ')}</span>}
      {!small && <InspectButton name={card.name} onClick={onInspect} />}
      {s && inst.effects.length > 0 && <span className="permanent__buff">{s.power}/{s.toughness}</span>}
      {s && inst.damage > 0 && <span className="permanent__tag permanent__tag--attack">{inst.damage} dmg</span>}
      {inst.sick && isCreature(inst) && <span className="permanent__tag" title="Summoning sick — can block, but cannot attack or tap yet">zzz</span>}
      {inst.attacking && <span className="permanent__tag permanent__tag--attack">attacking</span>}
      {inst.blocking && <span className="permanent__tag">blocking</span>}
      {inst.tapped && <span className="permanent__tag">tapped</span>}
    </div>
  )
}

function Pool({ pool }) {
  const parts = POOL_KEYS.filter((k) => pool[k] > 0)
  return (
    <div className="row row--wrap practice__pool" aria-live="polite" aria-label="Your mana pool">
      <span className="faint tiny">Mana pool</span>
      {parts.length === 0 && <span className="chip tiny">empty</span>}
      {parts.map((k) => <span key={k} className="chip tiny" data-mana={k}>{pool[k]} {colourName(k)}</span>)}
    </div>
  )
}

function Hand({ state, selected, highlight, onSelect, onInspect, disabled }) {
  const cards = hand(state, 'you')
  return (
    <div className="hand">
      <div className="hand__label faint tiny">Your hand{cards.length === 0 ? ': empty' : ''}</div>
      {cards.length > 0 && (
        <div className="hand__cards">
          {cards.map((inst) => {
            const card = cardOf(inst)
            const wanted = highlight === inst.cardId
            return (
              <div key={inst.instanceId} className={`hand__card ${wanted ? 'hand__card--wanted' : ''} ${selected === inst.instanceId ? 'hand__card--selected' : ''}`} data-instance={inst.instanceId}>
                <CardFace card={card} size="md" onClick={disabled ? undefined : () => onSelect(inst.instanceId)} />
                <InspectButton name={card.name} onClick={() => onInspect(inst.instanceId)} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InspectButton({ onClick, name }) {
  return (
    <button type="button" className="inspect" onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={`Look closely at ${name}`} title={`Look closely at ${name}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.2-4.2" />
      </svg>
    </button>
  )
}
