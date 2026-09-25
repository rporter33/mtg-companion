/**
 * What a person chooses at the engine's table before anything is sent.
 *
 * Until M4 a tap on a card sent its offer bare, and the engine refused any play
 * that needed a target or a choice in its cost, because this table had no way
 * to say one (PLAN.md, M2 and M3). An engine at protocol 5 takes them with the
 * play (engine/README.md), and the room says, seat by seat, what that seat's
 * `act` may carry and which decisions it will be asked (`seated.choices`,
 * scripts/relay-engine.mjs). This module is the table's side of it: what a
 * play needs chosen, a choice in progress, and the answer it becomes.
 *
 * A play is chosen in the order Argentum's own client asks for it
 * (web-client `pipelinePhases.ts`): its X, then what its cost takes, then its
 * targets requirement by requirement, then how its damage is divided among
 * them. The same steps serve the decisions whose answer is picked on the
 * table rather than in the prompt — the targets of a triggered ability, cards
 * to select, the mana sources to pay with — so the glow, the tap and the words are
 * the same whatever is being chosen. And the cards put on the bottom after a
 * mulligan (protocol 6), which Argentum drives as an offer rather than a
 * decision, but which are picked on the table all the same (`beginBottom`).
 *
 * Pure, and read forgivingly: whatever the wire carried, a step that makes no
 * sense is left out rather than thrown on.
 */

/** The decisions every engine has asked, and every client since the first could show. */
export const ALWAYS_ASKED = ['ChooseTargets', 'YesNo', 'ChooseOption']

/**
 * The decisions this build can put on screen, sent with the sit so the engine
 * asks them rather than answers them (Server.kt, `ASKABLE`). Each is asked in
 * `EnginePrompt.jsx`: cards to select and mana to pay with are picked on the
 * table through `ChoosingPrompt` (`beginDecision` below), the rest answered in
 * the prompt itself by `DecisionPrompt`; and every one keeps "Let the engine
 * choose", or for mana "Let the engine pay".
 */
export const ANSWERS = [
  'SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution',
  'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo',
]

/** What a seat may choose where nobody has said: nothing but what every engine asks. */
export const NO_CHOICES = Object.freeze({ act: new Set(), costs: new Set(), decisions: new Set(ALWAYS_ASKED) })

const words = (list) => (Array.isArray(list) ? list.filter((w) => typeof w === 'string') : [])
const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => typeof id === 'string'))] : [])
const whole = (n, fallback = 0) => (Number.isInteger(n) ? n : fallback)

/**
 * What the room said this seat may choose, from a `seated` message: what its
 * `act` may carry beyond an index, the costs it can pay with a choice, and the
 * decisions it will be asked. A relay or an engine from before choices says
 * nothing, and nothing is what is read.
 */
export function choicesFrom(seated) {
  const c = seated?.choices
  if (!c || typeof c !== 'object' || Array.isArray(c)) return NO_CHOICES
  return {
    act: new Set(words(c.act)),
    costs: new Set(words(c.costs)),
    decisions: new Set([...ALWAYS_ASKED, ...words(c.decisions)]),
  }
}

/** An offer's target requirements, in order, from what the process sends (Server.kt, `describe`). */
export function requirementsOf(offer) {
  if (!offer?.requiresTargets) return []
  const listed = Array.isArray(offer.targetRequirements) ? offer.targetRequirements : null
  const reqs = listed ?? [{ index: 0, description: offer.targetDescription, min: offer.minTargets, max: offer.targetCount, legal: offer.validTargets }]
  // A requirement's place in the list stands in for an index it does not say.
  return reqs
    .map((r, i) => (r && typeof r === 'object' ? { r, i } : null))
    .filter(Boolean)
    .map(({ r, i }) => ({
      index: whole(r.index, i),
      description: typeof r.description === 'string' ? r.description : '',
      min: Math.max(0, whole(r.min, 1)),
      max: Math.max(1, whole(r.max, 1)),
      legal: ids(r.legal),
      distinct: r.distinct === true,
    }))
}

/**
 * Whether this seat can carry an offer out, and if not, why not: `'target'`
 * when it needs a target the seat cannot send, `'cost'` when its cost has a
 * choice in it the seat cannot make, or null. A cost with nothing to choose —
 * sacrificing the source itself, paying life — holds nothing back; neither
 * does an X, which an engine that cannot take one reads as nought, as it
 * always has.
 */
export function heldBackBy(offer, can = NO_CHOICES) {
  if (!offer || typeof offer !== 'object') return null
  if (offer.requiresTargets && !(can.act.has('targets') && requirementsOf(offer).length)) return 'target'
  if (offer.requiresForage === true) return 'cost'
  if (typeof offer.additionalCost === 'string' && !CHOICELESS_COSTS.has(offer.additionalCost)) {
    if (!(can.act.has('cost') && can.costs.has(offer.additionalCost) && costOf(offer))) return 'cost'
  }
  if (offer.divide && offer.requiresTargets && !can.act.has('damage')) return 'target'
  return null
}

/**
 * The costs Argentum pays with nothing to choose, read in its `CostHandler`:
 * sacrificing the source itself, and paying life. Every other kind it names
 * asks which card, which creature or how many.
 */
export const CHOICELESS_COSTS = new Set(['SacrificeSelf', 'PayLife'])

/** What an offer's cost takes, where the process says it can be paid with a choice. */
function costOf(offer) {
  const c = offer?.costChoice
  if (!c || typeof c !== 'object') return null
  const legal = ids(c.candidates)
  const max = Math.max(0, whole(c.max))
  if (!max || !legal.length) return null
  return { min: Math.min(Math.max(0, whole(c.min, max)), max), max, legal }
}

/**
 * The steps a play needs chosen before it is sent, or an empty list when it
 * needs none and a tap sends it as it is.
 */
export function stepsFor(offer, can = NO_CHOICES) {
  if (!offer || heldBackBy(offer, can)) return []
  const steps = []
  const x = offer.x
  if (x && typeof x === 'object' && can.act.has('x')) {
    const min = Math.max(0, whole(x.min))
    const max = Math.max(min, whole(x.max, min))
    steps.push({ kind: 'x', min, max, value: max })
  }
  const cost = typeof offer.additionalCost === 'string' && !CHOICELESS_COSTS.has(offer.additionalCost) ? costOf(offer) : null
  if (cost) steps.push({ kind: 'cost', ...cost, text: typeof offer.additionalCostText === 'string' ? offer.additionalCostText : '', picked: [] })
  if (offer.requiresTargets) {
    for (const r of requirementsOf(offer)) steps.push({ kind: 'targets', ...r, picked: [] })
  }
  const divide = offer.divide
  if (divide && typeof divide === 'object' && offer.requiresTargets && Number.isInteger(divide.total) && divide.total > 0) {
    steps.push({ kind: 'divide', total: divide.total, min: Math.max(0, whole(divide.min, 1)), amounts: {} })
  }
  return steps
}

/**
 * A play being chosen, begun by the tap that found its offer; null when the
 * offer needs nothing chosen.
 */
export function beginPlay(offer, can = NO_CHOICES, source = null) {
  if (offer?.type === 'BottomCards') return bottomChoice(offer)
  const steps = stepsFor(offer, can)
  if (!steps.length) return null
  return settle({ from: 'play', offer, source: source ?? offer.card ?? null, steps, at: 0 })
}

/**
 * A decision whose answer is picked on the table: a targets decision, cards to
 * select, or the mana sources to pay with. Null for every other kind, whose
 * prompt holds its own answer, and for one that is not this seat's.
 */
export function beginDecision(status, me) {
  const d = status?.decision
  if (!d || status.waiting !== 'decision' || status.actor !== me || status.over) return null
  const base = { from: 'decision', id: d.id ?? null, type: d.type, at: 0 }
  if (d.type === 'ChooseTargets' && Array.isArray(d.requirements)) {
    const steps = d.requirements
      .map((r, i) => (r && typeof r === 'object' ? { r, i } : null))
      .filter(Boolean)
      .map(({ r, i }) => ({
        kind: 'targets', index: whole(r.index, i), description: typeof r.description === 'string' ? r.description : '',
        min: Math.max(0, whole(r.min, 1)), max: Math.max(1, whole(r.max, 1)), legal: ids(r.legal), picked: [],
      }))
    return steps.length ? settle({ ...base, steps }) : null
  }
  if (d.type === 'SelectCards') {
    const legal = ids(d.options)
    const max = Math.min(Math.max(0, whole(d.max, legal.length)), legal.length)
    const min = Math.min(Math.max(0, whole(d.min)), max)
    return { ...base, steps: [{ kind: 'cards', min, max, legal, picked: [] }] }
  }
  if (d.type === 'SelectManaSources') {
    const legal = ids((Array.isArray(d.sources) ? d.sources : []).map((s) => s?.id))
    return { ...base, steps: [{ kind: 'sources', min: 0, max: legal.length, legal, picked: ids(d.suggested).filter((id) => legal.includes(id)) }] }
  }
  return null
}

/**
 * The cards put on the bottom of the library after keeping a hand with
 * mulligans taken, begun by the stop that asks for them (Server.kt, protocol
 * 6): as many as the engine says are owed, from the hand it names. Argentum
 * drives its mulligan beside its decisions rather than as one, so this is an
 * offer sent with the offer's `act`, but it is chosen on the table as cards to
 * select are. Null for any other stop, and for one that is not this seat's.
 */
export function beginBottom(status, me) {
  if (!status || status.over || status.waiting !== 'action' || status.actor !== me || !Array.isArray(status.actions)) return null
  const offer = status.actions.find((a) => a && typeof a === 'object' && a.type === 'BottomCards')
  return offer ? bottomChoice(offer) : null
}

/** An offer to put cards on the bottom, as a choice of one step; null where it names nothing to choose from. */
function bottomChoice(offer) {
  const legal = ids(offer.candidates)
  const owed = Math.min(Math.max(0, whole(offer.bottom)), legal.length)
  if (!owed) return null
  return { from: 'bottom', offer, source: null, at: 0, steps: [{ kind: 'bottom', min: owed, max: owed, legal, picked: [] }] }
}

/** The step being chosen now. */
export const stepOf = (ch) => ch?.steps?.[ch.at] ?? null

/** What has been chosen for earlier steps, which a later requirement that must differ leaves out. */
const earlier = (ch) => new Set(ch.steps.slice(0, ch.at).flatMap((s) => s.picked ?? []))

/**
 * The ids a tap may pick now: the current step's legal ones, less those an
 * earlier step already took where this one must differ, and less the spell
 * being cast, which cannot pay its own cost. Argentum lists every card in hand
 * as able to pay a discard, the spell among them. An ability is another
 * matter: its source is a permanent that may well pay its cost — tap three
 * untapped creatures, this one among them — or be its target, and Argentum
 * leaves the source out of a cost's candidates itself wherever the card says
 * "another" (`excludeSelf` in its `ActivatedAbilityEnumerator`), so an
 * ability's lists are taken as they come.
 */
export function pickable(ch) {
  const step = stepOf(ch)
  if (!step?.legal) return []
  const before = step.distinct || step.kind === 'cost' ? earlier(ch) : new Set()
  const cast = ch.from === 'play' && ch.offer?.type === 'CastSpell'
  return step.legal.filter((id) => !before.has(id) && !(cast && step.kind === 'cost' && id === ch.source))
}

/** Picks or unpicks one id in the current step; at the most it takes, one more replaces the last. */
export function toggle(ch, id) {
  const step = stepOf(ch)
  if (!step?.legal || !pickable(ch).includes(id)) return ch
  const picked = step.picked.includes(id)
    ? step.picked.filter((x) => x !== id)
    : step.picked.length >= step.max ? [...step.picked.slice(0, step.max - 1), id] : [...step.picked, id]
  return withStep(ch, { ...step, picked })
}

export const setX = (ch, value) => {
  const step = stepOf(ch)
  if (step?.kind !== 'x') return ch
  return withStep(ch, { ...step, value: Math.min(step.max, Math.max(step.min, whole(value, step.value))) })
}

export const setAmount = (ch, id, value) => {
  const step = stepOf(ch)
  if (step?.kind !== 'divide' || !(id in step.amounts)) return ch
  return withStep(ch, { ...step, amounts: { ...step.amounts, [id]: Math.max(step.min, whole(value, step.amounts[id])) } })
}

const withStep = (ch, step) => ({ ...ch, steps: ch.steps.map((s, i) => (i === ch.at ? step : s)) })

/** Whether the current step may be left: enough picked, the division adds up, X in range. */
export function ready(ch) {
  const step = stepOf(ch)
  if (!step) return false
  if (step.kind === 'x') return step.value >= step.min && step.value <= step.max
  if (step.kind === 'divide') {
    const amounts = Object.values(step.amounts)
    return amounts.reduce((a, b) => a + b, 0) === step.total && amounts.every((n) => n >= step.min)
  }
  return step.picked.length >= step.min && step.picked.length <= step.max
}

/**
 * Whether a tap has finished the current step, so the next begins without a
 * press: a step that takes one thing and has it. A step that takes several
 * waits for "Done", since one more might be wanted; so does mana, where the
 * engine's own suggestion is already picked.
 */
export function complete(ch) {
  const step = stepOf(ch)
  return Boolean(step && (step.kind === 'targets' || step.kind === 'cost' || step.kind === 'cards' || step.kind === 'bottom') && step.max === 1 && step.picked.length === 1)
}

/**
 * The next step, or `{ done: true }` once there is none. A division comes
 * ready-made — shared out as evenly as the minimum allows, the first targets
 * taking what is left over — and is skipped where one target takes it all.
 */
export function advance(ch) {
  if (!ready(ch)) return { ch, done: false }
  const next = settle({ ...ch, at: ch.at + 1 })
  return next.at >= next.steps.length ? { ch: next, done: true } : { ch: next, done: false }
}

/** Steps that need nothing from the person are passed over: a division of damage among one target. */
function settle(ch) {
  let at = ch.at
  let steps = ch.steps
  while (at < steps.length) {
    const step = steps[at]
    if (step.kind !== 'divide') break
    const among = steps.filter((s) => s.kind === 'targets').flatMap((s) => s.picked)
    if (among.length <= 1) { at++; continue }
    if (!Object.keys(step.amounts).length) {
      const share = Math.max(step.min, Math.floor(step.total / among.length))
      let left = step.total - share * among.length
      const amounts = Object.fromEntries(among.map((id) => [id, share + (left-- > 0 ? 1 : 0)]))
      steps = steps.map((s, i) => (i === at ? { ...s, amounts } : s))
    }
    break
  }
  return { ...ch, at, steps }
}

/**
 * What a finished choice is sent as: a play's `act` parameters, or a
 * decision's `decide` ones, in the shapes Server.kt reads. The cards put on
 * the bottom go as `act`'s `cards`, the shape a decision's cards take.
 */
export function answerOf(ch) {
  const out = {}
  for (const step of ch.steps) {
    if (step.kind === 'x') out.x = step.value
    else if (step.kind === 'cost') out.cost = [...step.picked]
    else if (step.kind === 'targets') out.targets = { ...(out.targets ?? {}), [step.index]: [...step.picked] }
    else if (step.kind === 'divide' && Object.keys(step.amounts).length) out.damage = { ...step.amounts }
    else if (step.kind === 'cards' || step.kind === 'bottom') out.cards = [...step.picked]
    else if (step.kind === 'sources') out.sources = [...step.picked]
  }
  return out
}
