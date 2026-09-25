import { useState } from 'react'
import { ZONE_LABELS } from '../../lib/board/model.js'
import { nameList } from '../../lib/engine/deck.js'
import { heldBack, unaimed, unpaid, GLOW_SAYS } from '../../lib/engine/glow.js'
import { NO_CHOICES, advance, beginBottom, beginDecision, pickable, ready, setAmount, setX, stepOf } from '../../lib/engine/choose.js'
import { commanderZoneRule, taxWords } from '../../lib/engine/commander.js'

/*
 * The prompt panel at the engine's table, out of Table.jsx since M4 made it
 * most of that file: the opening hand, the stop, the attack and the block, a
 * play being chosen a step at a time, and every decision the engine can put to
 * a person. Table.jsx
 * owns what the prompt changes — the choice in progress, the socket — and this
 * file only says and asks.
 */

const NO_GLOW = new Map()

/**
 * Where a card is, as the end of a sentence: "in your graveyard", "in exile",
 * "on the stack". Null for the hand and the battlefield, where a glowing card is
 * already in sight, and for a card the board cannot place.
 */
export function placeWords(place, me, nameOfSeat = () => null) {
  if (!place?.zone || place.zone === 'hand' || place.zone === 'battlefield') return null
  const whose = place.owner === me ? 'your' : `${(nameOfSeat(place.owner) ?? 'their').replace(/^The engine$/, 'the engine')}'s`
  if (place.zone === 'stack') return 'on the stack'
  if (place.zone === 'exile') return 'in exile'
  if (place.zone === 'command') return 'in the command zone'
  return `in ${whose} ${ZONE_LABELS[place.zone]?.toLowerCase() ?? place.zone}`
}

/**
 * The prompt panel at the engine's table, after Moxgate's (TARGET.md §8):
 * where the game stands and what is asked, with every button saying what
 * pressing it does. It appears only when there is something to answer or
 * a pass to make; the engine never stops the player where there is
 * nothing to do, so a quiet table is one where it is not their stop.
 *
 * A paced table stops after each of the engine's own plays, and those stops
 * name the engine's seat as the actor, so this says nothing through the whole
 * of the engine's turn — Moxgate's own behaviour. What is happening is on the
 * engine's plate, and what happened is in the log.
 *
 * Drawn by Table.jsx, and rendered by its tests against statuses the engine sent.
 * `glows` is the table's (lib/engine/glow.js); `elsewhere` the plays offered
 * for cards in a pile (`offeredElsewhere`); `placeOf` says where a card is and
 * whose, so a sentence about a target or a play can say where to find it.
 * `handSize` and `active` — the cards in this seat's hand, and the seat that
 * plays first — are for the opening hand, which is weighed with both.
 */
export function EnginePrompt({
  status, me, step, chosen = new Set(), blocks = {}, blocker = null, declaring = null, blocking = null,
  glows = NO_GLOW, elsewhere = [], placeOf = () => null, players = [], nameOf, nameOfSeat, can = NO_CHOICES,
  choosing = null, onPick = () => {}, onChange = () => {}, onDone = () => {}, onChooseForMe = null, onLetGo = () => {},
  handSize = null, active = null, onAct, onDecide,
}) {
  if (status.over) {
    return (
      <div className="prompt" role="status" aria-label="Game over">
        <div className="prompt__lead">
          <strong className="prompt__title">Game over</strong>
          <span className="prompt__sub">{status.winner === me ? 'You won.' : status.winner ? 'The engine won.' : 'A draw.'}</span>
        </div>
      </div>
    )
  }
  if (status.actor !== me) return null
  const words = { players, placeOf, me, nameOf, nameOfSeat }
  // Something being chosen a step at a time: a play the player began, or a
  // decision whose answer is picked on the table. Rendered on its own, as the
  // table does, from the status where nothing is passed in.
  const d = status.waiting === 'decision' ? status.decision ?? null : null
  const ch = choosing ?? (d ? beginDecision(status, me) : beginBottom(status, me))
  if (ch && stepOf(ch)) {
    return (
      <ChoosingPrompt
        ch={ch} decision={d} {...words}
        onPick={onPick} onChange={onChange} onDone={onDone} onLetGo={onLetGo}
        onChooseForMe={onChooseForMe ?? (() => (ch.from === 'play' || ch.from === 'bottom' ? onAct(ch.offer.index, { auto: true }) : onDecide({ auto: true })))}
        onDecide={onDecide}
      />
    )
  }
  if (d) return <DecisionPrompt key={d.id ?? d.type} decision={d} {...words} onDecide={onDecide} />
  if (status.waiting !== 'action') return null
  const keep = (status.actions ?? []).find((a) => a?.type === 'KeepHand')
  if (keep) {
    return (
      <OpeningHandPrompt
        keep={keep} take={(status.actions ?? []).find((a) => a?.type === 'TakeMulligan') ?? null}
        handSize={handSize} first={active === me ? 'you' : active && nameOfSeat ? capital(seatWords(active, me, nameOfSeat)) : null}
        seats={players.length} onAct={onAct}
      />
    )
  }
  if (declaring) {
    const target = declaring.validAttackTargets?.[0]
    const attackers = Object.fromEntries([...chosen].map((id) => [id, target]))
    return (
      <div className="prompt" role="group" aria-label="Your attack">
        <div className="prompt__lead">
          <strong className="prompt__title">Your attack</strong>
          <span className="prompt__sub">{chosen.size ? [...chosen].map(nameOf).join(', ') : 'Tap the creatures that attack.'}</span>
        </div>
        <button className="btn btn--primary btn--sm prompt__btn" disabled={!chosen.size} onClick={() => onAct(declaring.index, { attackers })}>
          Attack with {chosen.size} →
        </button>
        <button className="btn btn--sm prompt__btn" onClick={() => onAct(declaring.index, { attackers: {} })}>No attack</button>
      </div>
    )
  }
  if (blocking) {
    const n = Object.keys(blocks).length
    return (
      <div className="prompt" role="group" aria-label="Their attack">
        <div className="prompt__lead">
          <strong className="prompt__title">Their attack</strong>
          <span className="prompt__sub">{blocker ? `${nameOf(blocker)} blocks — tap the attacker.` : n ? `${n} block${n === 1 ? '' : 's'} declared.` : 'Tap a blocker, then the attacker it blocks.'}</span>
        </div>
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onAct(blocking.index, { blockers: blocks })}>
          {n ? `Block with ${n} →` : 'No blocks →'}
        </button>
      </div>
    )
  }
  const pass = (status.actions ?? []).find((a) => a.type === 'PassPriority')
  const sub = stopLine({ status, me, glows, elsewhere, placeOf, nameOf, nameOfSeat, can })
  return (
    <div className="prompt" role="group" aria-label="Your stop">
      <div className="prompt__lead">
        <strong className="prompt__title">{step.name}</strong>
        <span className="prompt__sub">{sub}</span>
      </div>
      {pass && (
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onAct(pass.index)} aria-keyshortcuts="Space">
          Pass →
          {/* Said once, here, rather than on every button that passes. */}
          <span className="prompt__hint prompt__key">or press Space</span>
        </button>
      )}
    </div>
  )
}

/** A seat named as the object of a sentence: "the engine", "yourself", or its name. */
const seatWords = (p, me, nameOfSeat) => (p === me ? 'yourself' : (nameOfSeat?.(p) ?? 'them').replace(/^The engine$/, 'the engine'))

/**
 * Where the cards a step may take are, as the end of a sentence about them.
 * On the battlefield and in hand they glow in sight; in a pile or on the stack
 * they glow only once the pile is opened or the stack read, so the sentence
 * says where they are rather than promising a glow nobody can see (found in
 * M3's review: a trigger aimed at a card in a graveyard said "the legal targets
 * glow" over a table where nothing did). Cards the table cannot show at all —
 * a library's, looked at — are offered by name instead, and said to be.
 */
function whereTheyAre(ids, { players, placeOf, me, nameOfSeat }, { glow, listed = false }) {
  const cards = ids.filter((id) => !players.includes(id))
  const away = [...new Set(cards.map((id) => placeWords(placeOf(id), me, nameOfSeat)).filter(Boolean))]
  const inSight = ids.some((id) => players.includes(id)) || cards.some((id) => !placeWords(placeOf(id), me, nameOfSeat))
  if (listed) return `${glow[0].toUpperCase()}${glow.slice(1)} are named below.`
  const piles = away.filter((w) => w !== 'on the stack')
  const reach = piles.length ? `open ${piles.length === 1 ? 'it' : 'them'} to tap one` : 'tap one there'
  if (!away.length) return `${glow[0].toUpperCase()}${glow.slice(1)} glow.`
  return inSight
    ? `${glow[0].toUpperCase()}${glow.slice(1)} glow, and some are ${nameList(away, Infinity)} — ${reach}.`
    : `${glow[0].toUpperCase()}${glow.slice(1)} are ${nameList(away, Infinity)} — ${reach}.`
}

/**
 * The prompt while something is being chosen a step at a time
 * (lib/engine/choose.js): what the step is for, in words; what may be picked
 * glows on the table, a seat is offered here by name because a plate is not a
 * card to tap, and a card the table cannot show — one looked at in a library —
 * is offered here by name too; an X or a division of damage is set here. Every
 * step can be handed to the engine, and a play can be let go before anything
 * is sent.
 */
function ChoosingPrompt({ ch, decision, players, placeOf, me, nameOf, nameOfSeat, onPick, onChange, onDone, onChooseForMe, onLetGo, onDecide }) {
  const step = stepOf(ch)
  const words = { players, placeOf, me, nameOfSeat }
  const play = ch.from === 'play'
  // The cards put on the bottom after a mulligan: an offer of the engine's, in its words.
  const bottoming = ch.from === 'bottom'
  const source = play ? nameOf(ch.source) : decision?.source || null
  const title = play || bottoming ? ch.offer.description : decision?.prompt ?? 'The engine asks'
  const open = pickable(ch)
  const picked = step.picked ?? []
  // Cards named by the decision because the table has no face for them.
  const shown = decision?.cards && typeof decision.cards === 'object' ? decision.cards : {}
  const nameIn = (id) => (players.includes(id) ? seatWords(id, me, nameOfSeat) : shown[id]?.name ?? nameOf(id))
  const offTable = (step.legal ?? []).filter((id) => !players.includes(id) && !placeOf(id))
  const several = step.max > 1
  const count = `${picked.length} of ${step.min === step.max ? step.max : `up to ${step.max}`} chosen.`
  const targetSteps = ch.steps.filter((s) => s.kind === 'targets').length
  let sub
  if (step.kind === 'targets') {
    const aim = `Tap what ${source || 'it'} is aimed at`
    const which = step.description && (targetSteps > 1 || several) ? ` (${step.description})` : ''
    const where = whereTheyAre(step.legal, words, { glow: 'the legal targets', listed: offTable.length > 0 && offTable.length === step.legal.length })
    sub = `${aim}${which}: ${where.charAt(0).toLowerCase()}${where.slice(1)}${several ? ` ${count}` : ''}`
  } else if (step.kind === 'cost') {
    const what = step.text ? `${step.text.charAt(0).toUpperCase()}${step.text.slice(1)}` : 'Its cost takes a choice'
    sub = `${what}: tap ${step.max === 1 ? 'the card' : 'the cards'} to pay with. ${whereTheyAre(step.legal, words, { glow: 'the ones that can pay' })}${several ? ` ${count}` : ''}`
  } else if (step.kind === 'cards') {
    const labels = decision?.selectedLabel ? ` Chosen: ${decision.selectedLabel.toLowerCase()}${decision.remainderLabel ? `; the rest: ${decision.remainderLabel.toLowerCase()}` : ''}.` : ''
    sub = `Tap ${step.max === 1 ? 'the card' : 'the cards'} to choose. ${whereTheyAre(step.legal, words, { glow: 'the ones that can be chosen', listed: offTable.length > 0 })} ${count}${labels}`
  } else if (step.kind === 'bottom') {
    // Counted down, since the engine takes exactly as many as are owed.
    const taken = Number.isInteger(ch.offer?.mulligans) && ch.offer.mulligans > 0 ? ch.offer.mulligans : null
    const left = step.max - picked.length
    const why = taken ? `, for the ${taken === 1 ? 'mulligan' : `${taken} mulligans`} you took` : ''
    sub = `Tap ${step.max === 1 ? 'the card' : `the ${step.max} cards`} to put on the bottom of your library${why}. ${whereTheyAre(step.legal, words, { glow: 'the cards in your hand' })} ${left ? `${left} more to choose.` : 'All chosen.'}`
  } else if (step.kind === 'sources') {
    // Sources, not lands: Argentum offers every untapped permanent with a mana
    // ability, a creature such as Llanowar Elves among them (`ManaSolver`).
    sub = `Pay ${decision?.cost ?? 'the cost'}: the sources chosen to pay with are lit, the engine's own choice to begin with. Tap one to change it.`
  } else if (step.kind === 'x') {
    sub = `Choose X for ${source || 'it'}: from ${step.min} to ${step.max}, which is all this seat's mana can pay for.`
  } else {
    const sum = Object.values(step.amounts).reduce((a, b) => a + b, 0)
    sub = `Divide ${step.total} damage among the targets${step.min > 0 ? `, at least ${step.min} each` : ''}: ${sum} of ${step.total} divided.`
  }
  // "Let the engine choose" on a play makes every choice of it, and those made
  // here already are not kept (Server.kt, `auto`), so once one is made it says so.
  const madeAny = ch.at > 0 || picked.length > 0
  // A step that takes one thing is finished by the tap that picks it; any
  // other waits for Done, which says whether it can be pressed yet.
  const needsDone = step.kind === 'x' || step.kind === 'divide' || step.kind === 'sources' || several || step.min === 0
  // Done where pressing it sends the choice, Next where another step follows:
  // a division among one target is passed over, so it is not a step to come.
  const last = ch.at === ch.steps.length - 1 || (ready(ch) && advance(ch).done)
  const seats = step.kind === 'targets' ? players.filter((p) => open.includes(p) || picked.includes(p)) : []
  const listed = step.kind === 'cards' || step.kind === 'cost' || step.kind === 'targets' ? offTable : []
  return (
    <div className="prompt prompt--choosing" role="group" aria-label={play ? `Choosing for ${source || 'a play'}` : bottoming ? 'Your opening hand' : 'The engine asks'}>
      <div className="prompt__lead">
        <strong className="prompt__title">{title}</strong>
        <span className="prompt__sub">{sub}</span>
      </div>
      {seats.map((p) => (
        <button key={p} className="btn btn--sm prompt__btn" aria-pressed={several ? picked.includes(p) : undefined} onClick={() => onPick(p)}>
          {p === me ? 'Aim at yourself' : `Aim at ${seatWords(p, me, nameOfSeat)}`}
        </button>
      ))}
      {listed.length > 0 && (
        <div className="prompt__body" role="group" aria-label="Cards to choose from">
          {listed.map((id) => (
            <button key={id} className="btn btn--sm" aria-pressed={picked.includes(id)} onClick={() => onPick(id)}>{nameIn(id)}</button>
          ))}
        </div>
      )}
      {step.kind === 'x' && (
        <Stepper label="X" value={step.value} min={step.min} max={step.max} onChange={(n) => onChange(setX(ch, n))} />
      )}
      {step.kind === 'divide' && (
        <div className="prompt__body prompt__rows" role="group" aria-label="Damage to each target">
          {Object.entries(step.amounts).map(([id, n]) => (
            <Stepper key={id} label={capital(nameIn(id))} spoken={nameIn(id)} value={n} min={step.min} max={step.total} unit="damage" onChange={(v) => onChange(setAmount(ch, id, v))} />
          ))}
        </div>
      )}
      {needsDone && (
        <button className="btn btn--primary btn--sm prompt__btn" disabled={!ready(ch)} onClick={() => onDone()}>
          {step.kind === 'sources' ? 'Pay with these →' : step.kind === 'x' ? `X is ${step.value} →` : step.kind === 'bottom' ? `Put ${picked.length === 1 ? 'it' : 'them'} on the bottom →` : last ? 'Done →' : 'Next →'}
        </button>
      )}
      {step.kind === 'sources' ? (
        <>
          <button className="btn btn--sm prompt__btn" onClick={() => onDecide({ autoPay: true })}>
            Let the engine pay
            <span className="prompt__hint">It picks what pays</span>
          </button>
          {decision?.canDecline && <button className="btn btn--ghost btn--sm prompt__btn" onClick={() => onDecide({ decline: true })}>Do not pay</button>}
        </>
      ) : (
        <button className="btn btn--ghost btn--sm prompt__btn" onClick={onChooseForMe}>
          Let the engine choose
          <span className="prompt__hint">{play ? `It makes every choice for this play${madeAny ? ', redoing yours' : ''}` : bottoming ? 'It picks which go to the bottom' : 'It will say what it chose'}</span>
        </button>
      )}
      {play && <button className="btn btn--ghost btn--sm prompt__btn" onClick={onLetGo}>Never mind</button>}
    </div>
  )
}

/**
 * A number set with a button either side, each saying what it does. The
 * output carries its own label, so a screen reader reads the value with what
 * it is the value of. Three ways of saying it: a number on its own ("X is 3",
 * "Lower X"); an amount of something going to each ("2 damage to Raging
 * Goblin", "More damage to …"), with `unit`; and a count going to each where
 * the thing counted has no name of its own, a division of whatever Argentum is
 * dividing, with `to` ("2 to the engine", "One fewer to …"). The visible name
 * is hidden from a screen reader, so these labels are all it hears.
 */
function Stepper({ label, spoken = label, value, min, max, unit = null, to = false, onChange }) {
  const [less, is, more] = unit
    ? [`Less ${unit} to ${spoken}`, `${value} ${unit} to ${spoken}`, `More ${unit} to ${spoken}`]
    : to
      ? [`One fewer to ${spoken}`, `${value} to ${spoken}`, `One more to ${spoken}`]
      : [`Lower ${spoken}`, `${spoken} is ${value}`, `Raise ${spoken}`]
  return (
    <span className="stepper">
      <span className="stepper__label" aria-hidden="true">{label}</span>
      <button className="btn btn--sm stepper__btn" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={less}>−</button>
      <output className="stepper__value" aria-label={is}>{value}</output>
      <button className="btn btn--sm stepper__btn" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={more}>+</button>
    </span>
  )
}

/**
 * The opening hand at the engine's table (protocol 6): keep it, or take a
 * mulligan. The engine deals by the London mulligan as Argentum implements it
 * (103.5), and every number here is the engine's, read off its offers — the
 * mulligans taken, the hand drawn again, how many keeping puts on the bottom —
 * rather than worked out on this side, so the prompt cannot say one thing
 * while the engine does another. Not a dialog, as the hand-played table's is
 * not: the hand is right there to look at while deciding. Who plays first is
 * said as well, because a hand is weighed partly on whether it draws first:
 * in a two-player game the player who plays first skips their first draw
 * (103.8a, docs/TURN_STRUCTURE.md). That rule is for two players alone, and
 * Argentum skips the draw only in a game of two (`DrawPhaseManager`), so at a
 * table of more — `seats`, the players at it — or where the count is not
 * known, only who plays first is said.
 */
function OpeningHandPrompt({ keep, take, handSize, first, seats = 0, onAct }) {
  const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
  const taken = count(keep.mulligans) ?? 0
  const bottomNow = count(keep.bottom) ?? 0
  const draws = count(take?.draws)
  const bottomNext = count(take?.bottom)
  const cards = count(handSize)
  const lines = [
    `${cards === null ? 'Your hand' : `${cards} card${cards === 1 ? '' : 's'}`}${taken ? `, after ${taken} mulligan${taken === 1 ? '' : 's'}` : ''}${bottomNow ? `: keeping ${cards === 1 ? 'it' : 'them'} puts ${bottomNow} on the bottom of your library` : ''}.`,
  ]
  // `first` is "you", or the seat that plays first by name.
  if (first === 'you') lines.push(seats === 2 ? 'You play first, so you skip your first draw (103.8a).' : 'You play first.')
  else if (first) lines.push(`${first} plays first.`)
  lines.push(take
    ? `Or take a mulligan: the hand goes back, your library is shuffled and you draw ${draws ?? 'a new hand'}${bottomNext ? `, then put ${bottomNext} on the bottom once you keep` : ''}. This is the London mulligan (103.5).`
    : 'Another mulligan would leave no hand, so the engine offers only keeping this one (103.5).')
  return (
    <div className="prompt" role="group" aria-label="Your opening hand">
      <div className="prompt__lead">
        <strong className="prompt__title">Your opening hand</strong>
        <span className="prompt__sub">{lines.join(' ')}</span>
      </div>
      {take && (
        <button className="btn btn--sm prompt__btn" onClick={() => onAct(take.index)}>
          Mulligan
          <span className="prompt__hint">{draws === null ? 'A new hand' : `Draw ${draws}`}{bottomNext ? ` · put ${bottomNext} on the bottom` : ''}</span>
        </button>
      )}
      <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onAct(keep.index)}>
        Keep this hand →
        {bottomNow > 0 && <span className="prompt__hint">Then put {bottomNow} on the bottom</span>}
      </button>
    </div>
  )
}

/** A word as the first of a line. */
const capital = (w) => (w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w)

/**
 * What the order of cards going to a library means, which Argentum asks for
 * cards going to the bottom as well as the top (Server.kt, `placement` and
 * `library`): on top, the first is the top card; on the bottom, the last is
 * the bottom card. Either way the first ends up highest, which is all that is
 * said where an engine from before the placement says neither.
 */
function libraryOrder(d, me, nameOfSeat) {
  const owner = typeof d.library === 'string' ? d.library : null
  const named = owner && owner !== me ? nameOfSeat?.(owner) : null
  const whose = owner === null ? 'the' : owner === me ? 'your' : named ? `${named.replace(/^The engine$/, 'the engine')}'s` : 'their'
  if (d.placement === 'top') return `The first is the top of ${whose} library.`
  if (d.placement === 'bottom') return `The last is the bottom of ${whose} library.`
  return 'The first ends up highest in the library.'
}

/** Argentum's colours by their own names, as the wire sends them, and as this app says them. */
const COLOUR_WORDS = { WHITE: 'White', BLUE: 'Blue', BLACK: 'Black', RED: 'Red', GREEN: 'Green' }

/**
 * A decision answered in the prompt itself rather than on the table: a yes or
 * no, an option, an order, a division, combat damage, a number, a colour,
 * modes, and a yes or no for several at once (Server.kt, `describe`). What is
 * being set is held here until it is sent, keyed on the decision so a new one
 * starts afresh. A kind this build does not know is still answerable: the
 * engine chooses, and says so.
 */
function DecisionPrompt({ decision: d, players, me, nameOf, nameOfSeat, onDecide }) {
  const shown = d.cards && typeof d.cards === 'object' ? d.cards : {}
  // A card or a seat as it is said inside a sentence, and as it starts a line.
  const spokenIn = (id) => (players.includes(id) ? seatWords(id, me, nameOfSeat) : shown[id]?.name ?? nameOf(id))
  const nameIn = (id) => capital(spokenIn(id))
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  const initial = () => {
    if (d.type === 'OrderObjects' || d.type === 'ReorderLibrary') return list(d.objects)
    if (d.type === 'Distribute') {
      const targets = list(d.targets)
      const min = Number.isInteger(d.minPer) ? d.minPer : 0
      const total = Number.isInteger(d.total) ? d.total : 0
      let left = total - min * targets.length
      return Object.fromEntries(targets.map((id, i) => [id, min + (i === 0 ? Math.max(0, left) : 0)]))
    }
    if (d.type === 'CombatResolution') return Object.fromEntries((Array.isArray(d.edges) ? d.edges : []).filter((e) => e?.mine && typeof e.id === 'string').map((e) => [e.id, Number.isInteger(e.amount) ? e.amount : 0]))
    if (d.type === 'ChooseNumber') return Number.isInteger(d.min) ? d.min : 0
    if (d.type === 'ChooseMode') return []
    return null
  }
  const [value, setValue] = useState(initial)
  const letItChoose = (
    <button className="btn btn--ghost btn--sm prompt__btn" onClick={() => onDecide({ auto: true })}>
      Let the engine choose
      <span className="prompt__hint">It will say what it chose</span>
    </button>
  )
  const lead = (sub) => (
    <div className="prompt__lead">
      <strong className="prompt__title">{d.prompt}</strong>
      <span className="prompt__sub">{sub}</span>
    </div>
  )
  const from = d.source ? `From ${d.source}.` : 'The engine is asking.'

  if (d.type === 'YesNo') {
    // The question of the command zone at a Commander table (M6), said with the
    // rule that asks it, by where the commander is (Server.kt, `commanderZone`).
    const rule = commanderZoneRule(d.commanderZone)
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead([from, d.hint, rule].filter(Boolean).join(' '))}
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onDecide({ yes: true })}>{d.yesText ?? 'Yes'}</button>
        <button className="btn btn--sm prompt__btn" onClick={() => onDecide({ yes: false })}>{d.noText ?? 'No'}</button>
      </div>
    )
  }
  if (d.type === 'ChooseOption') {
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(from)}
        {(d.options ?? []).map((option, i) => (
          <button key={`${i}:${option}`} className="btn btn--sm prompt__btn" onClick={() => onDecide({ option: i })}>{option}</button>
        ))}
      </div>
    )
  }
  if (d.type === 'BatchYesNo') {
    const n = Number.isInteger(d.count) ? d.count : 2
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`${from} The same question is asked for ${n} of them at once: answer all ${n}, or this one and be asked again for the rest.`)}
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onDecide({ yes: true, all: true })}>{d.yesText ?? 'Yes'} to all {n}</button>
        <button className="btn btn--sm prompt__btn" onClick={() => onDecide({ yes: false, all: true })}>{d.noText ?? 'No'} to all {n}</button>
        <button className="btn btn--sm prompt__btn" onClick={() => onDecide({ yes: true, all: false })}>{d.yesText ?? 'Yes'}, this one</button>
        <button className="btn btn--sm prompt__btn" onClick={() => onDecide({ yes: false, all: false })}>{d.noText ?? 'No'}, this one</button>
        {letItChoose}
      </div>
    )
  }
  if ((d.type === 'OrderObjects' || d.type === 'ReorderLibrary') && Array.isArray(value)) {
    const move = (i, by) => setValue((was) => {
      const next = [...was]
      const [it] = next.splice(i, 1)
      next.splice(i + by, 0, it)
      return next
    })
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`${from} ${d.type === 'ReorderLibrary' ? libraryOrder(d, me, nameOfSeat) : 'The first is first.'} Move each with its buttons, then press Done.`)}
        <ol className="prompt__body prompt__rows" aria-label="The order">
          {value.map((id, i) => (
            <li key={id} className="prompt__row">
              <span className="prompt__rowname">{i + 1}. {nameIn(id)}</span>
              <button className="btn btn--sm stepper__btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${nameIn(id)} up`}>↑</button>
              <button className="btn btn--sm stepper__btn" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${nameIn(id)} down`}>↓</button>
            </li>
          ))}
        </ol>
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onDecide({ order: value })}>Done →</button>
        {letItChoose}
      </div>
    )
  }
  if (d.type === 'Distribute' && value && typeof value === 'object') {
    const total = Number.isInteger(d.total) ? d.total : 0
    const min = Number.isInteger(d.minPer) ? d.minPer : 0
    const most = (id) => (Number.isInteger(d.maxPer?.[id]) ? d.maxPer[id] : total)
    const sum = Object.values(value).reduce((a, b) => a + b, 0)
    const fine = (d.allowPartial ? sum <= total : sum === total) && Object.entries(value).every(([id, n]) => n >= min && n <= most(id))
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {/* Argentum's least each is 0 unless a card says otherwise, and "at least 0" says nothing. */}
        {lead(`${from} Divide ${total} among them${min > 0 ? `, at least ${min} each` : ''}: ${sum} of ${total} divided.`)}
        <div className="prompt__body prompt__rows" role="group" aria-label="Each one's share">
          {Object.entries(value).map(([id, n]) => (
            <Stepper key={id} label={nameIn(id)} spoken={spokenIn(id)} value={n} min={min} max={most(id)} to onChange={(v) => setValue((was) => ({ ...was, [id]: v }))} />
          ))}
        </div>
        <button className="btn btn--primary btn--sm prompt__btn" disabled={!fine} onClick={() => onDecide({ distribution: value })}>Done →</button>
        {letItChoose}
      </div>
    )
  }
  if (d.type === 'CombatResolution' && value && typeof value === 'object') {
    // The whole combat damage step at once (510.1c–d): each of this seat's
    // creatures and what it deals to each creature or player in its combat,
    // the engine's own suggestion already in place. Argentum checks the rest —
    // at most one blocker left short of lethal, trample only past lethal.
    const edges = (Array.isArray(d.edges) ? d.edges : []).filter((e) => e?.mine && e.id in value)
    const nameOfNode = (id) => (players.includes(id) ? spokenIn(id) : [...(d.attackers ?? []), ...(d.blockers ?? [])].find((x) => x?.id === id)?.name ?? nameOf(id))
    const sources = [...new Set(edges.map((e) => e.source))]
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`Assign each creature's combat damage. The engine's own split is already set; change it with the buttons, then press Done.`)}
        <div className="prompt__body prompt__rows" role="group" aria-label="Combat damage">
          {sources.map((src) => {
            const mine = edges.filter((e) => e.source === src)
            const dealt = mine.reduce((a, e) => a + value[e.id], 0)
            const power = d.attackers?.find((a) => a?.id === src)?.power
            return (
              <div key={src} className="prompt__group" role="group" aria-label={`${nameOfNode(src)}'s damage`}>
                <span className="prompt__rowname">{nameOfNode(src)}: {dealt}{Number.isInteger(power) ? ` of ${power}` : ''} dealt</span>
                {mine.map((e) => (
                  <Stepper key={e.id} label={capital(`${nameOfNode(e.target)}${e.trample ? ', past its blockers' : Number.isInteger(e.lethal) ? `, lethal ${e.lethal}` : ''}`)}
                    spoken={`${nameOfNode(e.target)}${e.trample ? ', past its blockers' : Number.isInteger(e.lethal) ? `, lethal ${e.lethal}` : ''}`}
                    value={value[e.id]} min={0} max={Number.isInteger(e.maximum) ? e.maximum : 0} unit="damage"
                    onChange={(v) => setValue((was) => ({ ...was, [e.id]: v }))} />
                ))}
              </div>
            )
          })}
        </div>
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onDecide({ edges: value })}>Done →</button>
        {letItChoose}
      </div>
    )
  }
  if (d.type === 'ChooseNumber' && Number.isInteger(value)) {
    const min = Number.isInteger(d.min) ? d.min : 0
    const max = Number.isInteger(d.max) ? d.max : min
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`${from} From ${min} to ${max}.`)}
        <Stepper label="the number" value={value} min={min} max={max} onChange={(v) => setValue(Math.min(max, Math.max(min, v)))} />
        <button className="btn btn--primary btn--sm prompt__btn" onClick={() => onDecide({ number: value })}>Choose {value} →</button>
        {letItChoose}
      </div>
    )
  }
  if (d.type === 'ChooseColor') {
    const colours = list(d.colors).filter((c) => c in COLOUR_WORDS)
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`${from} Choose a colour.`)}
        {colours.map((c) => <button key={c} className="btn btn--sm prompt__btn" onClick={() => onDecide({ color: c })}>{COLOUR_WORDS[c]}</button>)}
        {letItChoose}
      </div>
    )
  }
  if (d.type === 'ChooseMode' && Array.isArray(value)) {
    const modes = (Array.isArray(d.modes) ? d.modes : []).filter((m) => m && Number.isInteger(m.index))
    const min = Number.isInteger(d.min) ? d.min : 1
    const max = Number.isInteger(d.max) ? d.max : 1
    // One mode of several is one press; more are gathered and sent with Done.
    if (max === 1) {
      return (
        <div className="prompt" role="group" aria-label="The engine asks">
          {lead(`${from} Choose one.`)}
          {modes.map((m) => (
            <button key={m.index} className="btn btn--sm prompt__btn" disabled={m.available === false} title={m.available === false ? 'Not possible now' : undefined} onClick={() => onDecide({ modes: [m.index] })}>
              {m.text}{m.available === false ? ' (not possible now)' : ''}
            </button>
          ))}
          {letItChoose}
        </div>
      )
    }
    const flip = (i) => setValue((was) => (was.includes(i) ? was.filter((x) => x !== i) : [...was, i]))
    return (
      <div className="prompt" role="group" aria-label="The engine asks">
        {lead(`${from} Choose ${min === max ? max : `from ${min} to ${max}`}: ${value.length} chosen.`)}
        <div className="prompt__body" role="group" aria-label="The modes">
          {modes.map((m) => (
            <button key={m.index} className="btn btn--sm" aria-pressed={value.includes(m.index)} disabled={m.available === false || (!value.includes(m.index) && value.length >= max)} onClick={() => flip(m.index)}>
              {m.text}{m.available === false ? ' (not possible now)' : ''}
            </button>
          ))}
        </div>
        <button className="btn btn--primary btn--sm prompt__btn" disabled={value.length < min || value.length > max} onClick={() => onDecide({ modes: value })}>Done →</button>
        {letItChoose}
      </div>
    )
  }
  // A kind this build cannot show: the engine answers it, asked to by the player.
  return (
    <div className="prompt" role="group" aria-label="The engine asks">
      {lead(from)}
      {letItChoose}
    </div>
  )
}

/**
 * What a stop of the player's is for, in words, so the glow is not the only
 * thing saying it (HANDOFF.md, M1b). Every kind of reason the engine stopped
 * is said as what it is: a card in hand that can be played, and a permanent
 * whose ability can be used, which is not a card being played —
 * docs/TURN_STRUCTURE.md keeps casting a spell, playing a land and activating
 * an ability apart (117.4, 305.2, 505.6a–b); a commander that can be cast
 * from the command zone, reached by a tap on that zone, with what the commander
 * tax adds to its cost (903.8, M6); a play offered for a card in a
 * pile, which no tap on the table reaches and the actions panel does; and,
 * where nothing else is offered, the plays this seat cannot carry out with the
 * reason for each, so a stop made for one of those alone still says why it is
 * a stop at all. `can` is what the seat may choose (lib/engine/choose.js).
 *
 * Pure, and exported for its tests.
 */
export function stopLine({ status, me, glows = NO_GLOW, elsewhere = [], placeOf = () => null, nameOf = (id) => id, nameOfSeat, can = NO_CHOICES }) {
  const lit = [...glows.values()].filter((g) => g?.kind === 'playable')
  // A commander that can be cast from the command zone (M6) is said on its own:
  // it is reached by a tap on that zone, and its cost says the commander tax.
  const commanded = (status?.actions ?? []).filter((a) => a && typeof a.card === 'string' && a.type === 'CastSpell' && glows.get(a.card)?.says === GLOW_SAYS.command)
    .filter((a, i, all) => all.findIndex((b) => b.card === a.card) === i)
  const onTable = lit.filter((g) => g.says !== GLOW_SAYS.command)
  const plays = onTable.filter((g) => g.says === GLOW_SAYS.play).length
  const uses = onTable.length - plays
  const named = (list) => [...new Set(list.map((a) => (a.card ? nameOf(a.card) : a.description)).filter(Boolean))]
  const lines = []

  if (onTable.length) {
    const parts = []
    if (plays) parts.push(plays === 1 ? 'the card you can play' : `the ${plays} cards you can play`)
    if (uses) parts.push(uses === 1 ? 'the permanent with an ability you can use' : `the ${uses} permanents with abilities you can use`)
    const said = parts.join(' and ')
    lines.push(`${said.charAt(0).toUpperCase()}${said.slice(1)} ${onTable.length === 1 ? 'glows' : 'glow'}. Tap ${onTable.length === 1 ? 'it' : 'one'}${commanded.length ? '' : ', or pass'}.`)
  }
  for (const a of commanded) {
    const tax = taxWords(a)
    const cost = typeof a.manaCost === 'string' && a.manaCost ? ` for ${a.manaCost}` : ''
    lines.push(`Your commander, ${nameOf(a.card)}, can be cast from the command zone${cost}${tax ? `: ${tax}` : ''}. Tap the command zone to cast it, or pass.`)
  }

  if (elsewhere.length) {
    const items = [...new Set(elsewhere.map(({ offer }) => {
      const name = nameOf(offer.card)
      const what = offer.type === 'ActivateAbility' ? `use an ability of ${name}` : `play ${name}`
      const where = placeWords(placeOf(offer.card), me, nameOfSeat)
      return where ? `${what} ${where.replace(/^(in|on) /, 'from ')}` : what
    }))]
    const them = elsewhere.length === 1 ? 'it' : 'them'
    lines.push(lit.length || commanded.length
      ? `You can also ${nameList(items, Infinity)}: find ${them} under Actions.`
      : `You can ${nameList(items, Infinity)}: find ${them} under Actions, or pass.`)
  }
  if (lines.length) return lines.join(' ')

  const aimless = named(unaimed(status, can))
  const costly = named(unpaid(status, can))
  if (aimless.length || costly.length) {
    if (aimless.length) lines.push(`${nameList(aimless, Infinity)} ${aimless.length === 1 ? 'needs' : 'need'} a target, which this table cannot choose yet.`)
    if (costly.length) lines.push(`${nameList(costly, Infinity)} ${costly.length === 1 ? 'needs a choice made for its cost' : 'need a choice made for their costs'}, which this table cannot make yet.`)
    return `${lines.join(' ')} Pass to go on.`
  }
  // Anything else the engine counts as a play and no card carries.
  const loose = (status?.actions ?? []).some((a) => a && a.meaningful && a.affordable && !a.mana && !a.card && !heldBack(a, can) && a.type !== 'PassPriority')
  return loose ? 'Something is offered under Actions, or pass.' : 'Nothing to do here but pass.'
}
