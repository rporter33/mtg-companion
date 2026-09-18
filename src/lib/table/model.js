/**
 * The practice table's state, and the questions asked of it.
 *
 * Everything the screen shows is derived from this object; nothing the
 * screen does changes it except through the reducer. Card instances have an
 * identity of their own (`instanceId`), separate from the card record they
 * are a copy of (`cardId`), because two Forests are two objects: one can be
 * tapped while the other is not.
 *
 * Zones hold instance ids in order. A card is in exactly one zone, checked
 * by `invariants`. Damage, effects and tapped state live on the instance
 * and are cleared by the rules that clear them, never by the screen.
 */
import { COLORS, parseManaCost, classifySymbol } from '../mana.js'
import { practiceCard } from '../../data/practice-cards.js'
import { unsupportedReason } from './mechanics.js'

export const PLAYERS = ['you', 'foe']
export const other = (player) => (player === 'you' ? 'foe' : 'you')

/** The steps of a turn, in order. Priority is given in all but untap and cleanup (502.4, 514.3). */
export const STEPS = [
  'untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup',
]
export const STEP_LABELS = {
  untap: 'Untap step', upkeep: 'Upkeep', draw: 'Draw step', main1: 'Main phase',
  beginCombat: 'Beginning of combat', declareAttackers: 'Declare attackers', declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage', endCombat: 'End of combat', main2: 'Second main phase', end: 'End step', cleanup: 'Cleanup',
}
export const MAIN_STEPS = ['main1', 'main2']
export const COMBAT_STEPS = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat']

export const emptyPool = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
export const POOL_KEYS = [...COLORS, 'C']

let nextInstance = 1

/** A fresh instance of a card, in the zone given, owned and controlled by `owner`. */
export function makeInstance(cardId, owner, zone, { id } = {}) {
  const card = practiceCard(cardId)
  if (!card) throw new Error(`No practice card "${cardId}"`)
  const why = unsupportedReason(card)
  if (why) throw new Error(`${card.name} ${why}`)
  return {
    instanceId: id ?? `${cardId}#${nextInstance++}`,
    cardId,
    owner,
    controller: owner,
    zone,
    tapped: false,
    sick: false,
    damage: 0,
    effects: [],
    attacking: null,
    blocking: null,
  }
}

/**
 * A state from a scenario's setup. Instance ids are numbered per card so
 * two runs of the same scenario have the same ids, which is what makes a
 * saved action log replayable.
 */
export function createState(scenario) {
  const setup = scenario.setup
  const cards = {}
  const counters = {}
  const zones = {
    library: { you: [], foe: [] }, hand: { you: [], foe: [] }, battlefield: [], graveyard: { you: [], foe: [] }, exile: [],
  }
  const place = (player, zone, list = []) => {
    for (const entry of list) {
      const cardId = typeof entry === 'string' ? entry : entry.cardId
      counters[cardId] = (counters[cardId] ?? 0) + 1
      const instance = makeInstance(cardId, player, zone, { id: `${cardId}#${counters[cardId]}` })
      if (typeof entry === 'object') Object.assign(instance, { tapped: !!entry.tapped, sick: !!entry.sick })
      cards[instance.instanceId] = instance
      if (zone === 'battlefield') zones.battlefield.push(instance.instanceId)
      else zones[zone][player].push(instance.instanceId)
    }
  }
  for (const player of PLAYERS) {
    const side = setup[player] ?? {}
    place(player, 'battlefield', side.battlefield)
    place(player, 'hand', side.hand)
    place(player, 'library', side.library)
    place(player, 'graveyard', side.graveyard)
  }
  return {
    version: 1,
    scenarioId: scenario.id,
    seed: setup.seed ?? 0,
    turn: setup.turn ?? 1,
    turnsBy: { you: 0, foe: 0, ...(setup.turnsBy ?? {}) },
    active: setup.active ?? 'you',
    step: setup.step ?? 'main1',
    priority: setup.priority ?? setup.active ?? 'you',
    passes: 0,
    firstPlayer: setup.firstPlayer ?? 'you',
    life: { you: 20, foe: 20, ...(setup.life ?? {}) },
    landsPlayed: { you: 0, foe: 0, ...(setup.landsPlayed ?? {}) },
    pool: { you: emptyPool(), foe: emptyPool() },
    cards,
    zones,
    stack: [],
    casting: null,
    attackers: [],
    blocks: {},
    over: null,
    seq: 0,
    events: [],
    mulligans: { you: 0, foe: 0 },
    // A game starts with both players deciding their opening hand, first player first (103.5).
    awaiting: setup.mulligan ? { kind: 'mulligan', player: setup.firstPlayer ?? 'you' } : null,
  }
}

// --- questions -------------------------------------------------------------

export const cardOf = (instance) => practiceCard(instance.cardId)
export const instance = (state, id) => state.cards[id] ?? null
export const isCreature = (inst) => cardOf(inst).rules.kind === 'creature'
export const isLand = (inst) => cardOf(inst).rules.kind === 'land'
export const hasKeyword = (inst, keyword) => (cardOf(inst).rules.keywords ?? []).includes(keyword)

export function battlefield(state, player = null) {
  return state.zones.battlefield.map((id) => state.cards[id]).filter((c) => !player || c.controller === player)
}
export const hand = (state, player) => state.zones.hand[player].map((id) => state.cards[id])
export const graveyard = (state, player) => state.zones.graveyard[player].map((id) => state.cards[id])
export const librarySize = (state, player) => state.zones.library[player].length

/** Current power and toughness, with pump effects and nothing else. */
export function stats(inst) {
  const card = cardOf(inst)
  if (card.power == null) return null
  let power = Number(card.power)
  let toughness = Number(card.toughness)
  for (const effect of inst.effects) { power += effect.power ?? 0; toughness += effect.toughness ?? 0 }
  return { power, toughness, damage: inst.damage, printed: { power: Number(card.power), toughness: Number(card.toughness) } }
}

/** Mana abilities a permanent could activate now: untapped, and not sick if it is a creature. */
export function manaAbilities(inst) {
  const abilities = cardOf(inst).rules.mana ?? []
  if (!abilities.length || inst.tapped || inst.zone !== 'battlefield') return []
  if (isCreature(inst) && inst.sick && !hasKeyword(inst, 'haste')) return []
  return abilities
}

export const poolTotal = (pool) => POOL_KEYS.reduce((n, k) => n + pool[k], 0)

/** The cost of a card as symbol descriptors: [{ symbol, kind, colors, generic }]. */
export function costOf(card) {
  return parseManaCost(card.mana_cost).map((symbol) => ({ symbol, ...classifySymbol(symbol) }))
}

/**
 * One way to pay a cost from a pool, or null. Coloured symbols take their
 * colour; generic takes whatever is left, colourless included. The
 * assignment is a list of { symbol, from } in cost order, with a generic
 * symbol of {2} appearing as two entries. Hybrid, phyrexian and variable
 * symbols are outside the table's pool and are refused by `mechanics`.
 */
export function payFromPool(cost, pool) {
  const left = { ...pool }
  const assignment = []
  for (const part of cost) {
    if (part.kind === 'colored') {
      const colour = part.colors[0]
      if (left[colour] < 1) return null
      left[colour] -= 1
      assignment.push({ symbol: part.symbol, from: colour })
    } else if (part.kind === 'colorless') {
      if (left.C < 1) return null
      left.C -= 1
      assignment.push({ symbol: part.symbol, from: 'C' })
    } else if (part.kind !== 'generic') return null
  }
  // Generic last, so colour is never spent on it while a pip still needs it.
  for (const part of cost) {
    if (part.kind !== 'generic') continue
    for (let i = 0; i < part.generic; i++) {
      const from = POOL_KEYS.find((k) => left[k] > 0)
      if (!from) return null
      left[from] -= 1
      assignment.push({ symbol: part.symbol, from })
    }
  }
  return assignment
}

/** Whether a set of sources, tapped together, could pay a cost: the question the coach asks before any tapping. */
export function couldPay(cost, sources) {
  const pool = emptyPool()
  for (const inst of sources) for (const ability of manaAbilities(inst)) pool[ability.produces[0]] += 1
  return payFromPool(cost, pool) !== null
}

/** Whether a spell of this kind may be cast by `player` right now (117.1, 307.1, 304.1). */
export function timingAllows(state, player, kind) {
  if (state.over) return { ok: false, code: 'gameOver', message: 'The game is over.' }
  if (state.priority !== player) return { ok: false, code: 'noPriority', message: 'You do not have priority right now.' }
  if (kind === 'instant') return { ok: true }
  if (state.active !== player) return { ok: false, code: 'notYourTurn', message: `Only instants can be cast on someone else’s turn. A ${kind} needs your own main phase.` }
  if (!MAIN_STEPS.includes(state.step)) return { ok: false, code: 'notMainPhase', message: `A ${kind} can only be cast in a main phase. This is the ${STEP_LABELS[state.step].toLowerCase()}.` }
  if (state.stack.length) return { ok: false, code: 'stackNotEmpty', message: `A ${kind} needs an empty stack. Something is still waiting to resolve.` }
  return { ok: true }
}

/** Legal targets for an effect, as instances and players. */
export function legalTargets(state, effect) {
  const creatures = battlefield(state).filter(isCreature).map((c) => ({ kind: 'creature', id: c.instanceId }))
  if (effect.target === 'creature') return creatures
  return [...creatures, ...PLAYERS.map((p) => ({ kind: 'player', id: p }))]
}

/**
 * Things that must always hold. Checked in tests after every action; a
 * failure here is a bug in the reducer, not a rule the learner broke.
 */
export function invariants(state) {
  const problems = []
  const seen = new Map()
  const note = (id, zone) => {
    if (seen.has(id)) problems.push(`${id} is in ${seen.get(id)} and ${zone}`)
    seen.set(id, zone)
    if (!state.cards[id]) problems.push(`${zone} lists unknown ${id}`)
    else if (state.cards[id].zone !== zone) problems.push(`${id} says ${state.cards[id].zone} but sits in ${zone}`)
  }
  for (const id of state.zones.battlefield) note(id, 'battlefield')
  for (const id of state.zones.exile) note(id, 'exile')
  for (const player of PLAYERS) {
    for (const id of state.zones.library[player]) note(id, 'library')
    for (const id of state.zones.hand[player]) note(id, 'hand')
    for (const id of state.zones.graveyard[player]) note(id, 'graveyard')
    for (const key of POOL_KEYS) if (state.pool[player][key] < 0) problems.push(`${player} has negative ${key} mana`)
  }
  for (const item of state.stack) note(item.instanceId, 'stack')
  for (const id of Object.keys(state.cards)) if (!seen.has(id)) problems.push(`${id} is in no zone`)
  for (const inst of Object.values(state.cards)) {
    if (inst.damage < 0) problems.push(`${inst.instanceId} has negative damage`)
    if (inst.zone !== 'battlefield' && (inst.tapped || inst.damage || inst.effects.length || inst.attacking || inst.blocking)) {
      problems.push(`${inst.instanceId} carries battlefield state in the ${inst.zone}`)
    }
  }
  if (!STEPS.includes(state.step)) problems.push(`unknown step ${state.step}`)
  if (!PLAYERS.includes(state.priority)) problems.push(`priority with ${state.priority}`)
  return problems
}
