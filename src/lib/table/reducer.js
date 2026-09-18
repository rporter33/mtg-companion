/**
 * The practice table's rules: one pure function from a state and an action
 * to the next state and the events that happened, or a refusal with a
 * reason a coach can read out.
 *
 *   const result = applyAction(state, action)
 *   // { ok: false, reason: { code, message } }
 *   // { ok: true, state, events }
 *
 * Nothing here reads a clock, a random number or the DOM. The opponent is a
 * player like any other and its choices arrive as actions. Motion on the
 * screen is derived from `events` afterwards; skipping the motion changes
 * nothing here.
 *
 * Section numbers are the Comprehensive Rules. Where the table narrows a
 * rule (no tapped lands, no mana burn, no discard choice beyond the active
 * player's own), the narrowing is stated at the point it happens.
 */
import {
  PLAYERS, STEPS, STEP_LABELS, MAIN_STEPS, POOL_KEYS, other, emptyPool,
  cardOf, isCreature, isLand, hasKeyword, manaAbilities, costOf, payFromPool, stats, timingAllows, legalTargets, battlefield,
} from './model.js'
import { unsupportedReason } from './mechanics.js'

const refuse = (code, message, extra = {}) => ({ ok: false, reason: { code, message, ...extra } })
const clone = (state) => (typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state)))

/** Names for the coach: a card's name, or "you"/"your opponent". */
export const nameOf = (state, id) => (PLAYERS.includes(id) ? (id === 'you' ? 'you' : 'your opponent') : cardOf(state.cards[id]).name)

export function applyAction(state, action) {
  if (!action || typeof action.type !== 'string') return refuse('badAction', 'That is not an action the table knows.')
  const handler = HANDLERS[action.type]
  if (!handler) return refuse('unknownAction', `The table has no action called "${action.type}".`)
  if (state.over && action.type !== 'concede') return refuse('gameOver', 'The game is over.')
  const next = clone(state)
  next.events = []
  const problem = handler(next, action)
  if (problem) return problem
  next.seq += 1
  const events = next.events
  next.events = []
  return { ok: true, state: next, events }
}

// --- helpers that change state --------------------------------------------

const emit = (state, event) => { state.events.push({ ...event, seq: state.seq + 1 }) }

function moveTo(state, id, zone, player = null) {
  const inst = state.cards[id]
  const from = inst.zone
  const remove = (list) => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1) }
  if (from === 'battlefield') remove(state.zones.battlefield)
  else if (from === 'exile') remove(state.zones.exile)
  else if (from === 'stack') { const i = state.stack.findIndex((s) => s.instanceId === id); if (i >= 0) state.stack.splice(i, 1) }
  else remove(state.zones[from][inst.owner])
  inst.zone = zone
  // Leaving the battlefield forgets everything that only means something there (400.7).
  if (zone !== 'battlefield') Object.assign(inst, { tapped: false, damage: 0, effects: [], attacking: null, blocking: null, sick: false })
  if (zone === 'battlefield') state.zones.battlefield.push(id)
  else if (zone === 'exile') state.zones.exile.push(id)
  else if (zone !== 'stack') state.zones[zone][player ?? inst.owner].push(id)
}

function emptyPools(state) {
  for (const player of PLAYERS) {
    const had = POOL_KEYS.reduce((n, k) => n + state.pool[player][k], 0)
    if (had) emit(state, { type: 'poolEmptied', player, amount: had })
    state.pool[player] = emptyPool()
  }
}

function draw(state, player, count = 1) {
  for (let i = 0; i < count; i++) {
    const id = state.zones.library[player].shift()
    if (!id) { state.drewFromEmpty = { ...(state.drewFromEmpty ?? {}), [player]: true }; emit(state, { type: 'drewFromEmpty', player }); return }
    state.cards[id].zone = 'hand'
    state.zones.hand[player].push(id)
    emit(state, { type: 'drew', player, instanceId: id })
  }
}

/** State-based actions (704): checked whenever a player would receive priority. */
function stateBased(state) {
  let again = true
  while (again) {
    again = false
    for (const id of [...state.zones.battlefield]) {
      const inst = state.cards[id]
      if (!isCreature(inst)) continue
      const s = stats(inst)
      if (s.toughness <= 0) { moveTo(state, id, 'graveyard'); emit(state, { type: 'creatureDied', instanceId: id, why: 'toughness' }); again = true }
      else if (inst.damage >= s.toughness) { moveTo(state, id, 'graveyard'); emit(state, { type: 'creatureDied', instanceId: id, why: 'damage' }); again = true }
    }
  }
  if (state.over) return
  const losers = PLAYERS.filter((p) => state.life[p] <= 0 || state.drewFromEmpty?.[p])
  if (losers.length) {
    const winner = losers.length === 2 ? null : other(losers[0])
    const reason = state.drewFromEmpty?.[losers[0]] ? 'drewFromEmpty' : 'life'
    state.over = { winner, losers, reason }
    emit(state, { type: 'gameOver', winner, losers, reason })
  }
}

function givePriority(state, player) {
  stateBased(state)
  if (state.over) return
  state.priority = player
  state.passes = 0
}

/** Turn-based actions on entering a step (500.1, 502–514), then priority where the step gives it. */
function enterStep(state, step) {
  state.step = step
  emit(state, { type: 'stepBegan', step, turn: state.turn, active: state.active })
  const active = state.active
  if (step === 'untap') {
    for (const inst of battlefield(state, active)) {
      if (inst.tapped) { inst.tapped = false; emit(state, { type: 'untapped', instanceId: inst.instanceId }) }
      inst.sick = false // under this player's control since this turn began (302.6)
    }
    return enterStep(state, 'upkeep')
  }
  if (step === 'draw') {
    const firstTurn = state.turn === 1 && active === state.firstPlayer
    if (!firstTurn) draw(state, active) // 103.8a: the first player skips their first draw
  }
  if (step === 'declareAttackers') {
    const able = battlefield(state, active).filter((c) => isCreature(c) && !c.tapped && (!c.sick || hasKeyword(c, 'haste')))
    if (!able.length) { state.attackers = []; return enterStep(state, 'endCombat') } // 508.8
    state.awaiting = { kind: 'attackers', player: active }
    return
  }
  if (step === 'declareBlockers') {
    if (!state.attackers.length) return enterStep(state, 'endCombat')
    state.awaiting = { kind: 'blockers', player: other(active) }
    return
  }
  if (step === 'combatDamage') {
    dealCombatDamage(state)
  }
  if (step === 'endCombat') {
    for (const id of state.attackers) if (state.cards[id].zone === 'battlefield') state.cards[id].attacking = null
    for (const inst of battlefield(state)) inst.blocking = null
    state.attackers = []
    state.blocks = {}
  }
  if (step === 'cleanup') {
    const handSize = state.zones.hand[active].length
    if (handSize > 7) { state.awaiting = { kind: 'discard', player: active, count: handSize - 7 }; return }
    return finishCleanup(state)
  }
  givePriority(state, active)
}

function finishCleanup(state) {
  // 514.2: damage is removed and "until end of turn" effects end, at the same time.
  for (const inst of battlefield(state)) {
    if (inst.damage) { inst.damage = 0; emit(state, { type: 'damageRemoved', instanceId: inst.instanceId }) }
    if (inst.effects.length) { inst.effects = []; emit(state, { type: 'effectsEnded', instanceId: inst.instanceId }) }
  }
  emptyPools(state)
  // Next turn (500.1): the other player's, from the untap step.
  state.turn += 1
  state.active = other(state.active)
  state.turnsBy[state.active] += 1
  state.landsPlayed[state.active] = 0
  emit(state, { type: 'turnBegan', turn: state.turn, active: state.active, ordinal: state.turnsBy[state.active] })
  enterStep(state, 'untap')
}

function nextStep(state) {
  emptyPools(state) // 500.4
  const i = STEPS.indexOf(state.step)
  enterStep(state, STEPS[i + 1])
}

function dealCombatDamage(state) {
  // 510.1–510.2: all combat damage at once, in the ordinary case with no first strike.
  const defender = other(state.active)
  const dealt = []
  for (const attackerId of state.attackers) {
    const attacker = state.cards[attackerId]
    if (attacker.zone !== 'battlefield') continue
    const blockers = Object.entries(state.blocks).filter(([, a]) => a === attackerId).map(([b]) => b).filter((b) => state.cards[b].zone === 'battlefield')
    const power = stats(attacker).power
    if (!blockers.length) {
      if (attacker.attacking === 'blocked') continue // its blocker died: blocked creature deals no damage (509.1h, 510.1c)
      dealt.push({ source: attackerId, target: defender, amount: power })
    } else {
      // The table's narrowing: one blocker per attacker in the scenarios it ships, so all damage goes to the first.
      dealt.push({ source: attackerId, target: blockers[0], amount: power })
      for (const b of blockers) dealt.push({ source: b, target: attackerId, amount: stats(state.cards[b]).power })
    }
  }
  for (const { source, target, amount } of dealt) {
    if (amount <= 0) continue
    if (PLAYERS.includes(target)) state.life[target] -= amount
    else state.cards[target].damage += amount
    emit(state, { type: 'damageDealt', source, target, amount })
  }
}

// --- the actions ------------------------------------------------------------

const HANDLERS = {
  playLand(state, { player, instanceId }) {
    const inst = state.cards[instanceId]
    if (!inst || inst.zone !== 'hand' || inst.owner !== player) return refuse('notInHand', 'That card is not in your hand.')
    if (!isLand(inst)) return refuse('notALand', `${cardOf(inst).name} is not a land. Cast it instead.`)
    if (state.awaiting) return refuse('awaiting', 'A declaration is needed first.')
    if (state.priority !== player) return refuse('noPriority', 'You do not have priority right now.')
    if (state.active !== player) return refuse('notYourTurn', 'You can only play a land on your own turn.')
    if (!MAIN_STEPS.includes(state.step)) return refuse('notMainPhase', `A land can only be played in a main phase. This is the ${STEP_LABELS[state.step].toLowerCase()}.`)
    if (state.stack.length) return refuse('stackNotEmpty', 'A land can only be played while the stack is empty.')
    if (state.landsPlayed[player] >= 1) return refuse('landAlready', 'You have already played a land this turn. One per turn, no matter how many you are holding.')
    moveTo(state, instanceId, 'battlefield')
    state.landsPlayed[player] += 1
    emit(state, { type: 'landPlayed', player, instanceId })
    return null
  },

  tapForMana(state, { player, instanceId, colour }) {
    const inst = state.cards[instanceId]
    if (!inst || inst.zone !== 'battlefield') return refuse('notOnBattlefield', 'That is not on the battlefield.')
    if (inst.controller !== player) return refuse('notYours', 'You can only tap your own permanents.')
    const abilities = cardOf(inst).rules.mana ?? []
    if (!abilities.length) return refuse('noManaAbility', `${cardOf(inst).name} does not make mana.`)
    if (inst.tapped) return refuse('alreadyTapped', `${cardOf(inst).name} is already tapped. A tapped source makes no more mana until it untaps.`)
    if (isCreature(inst) && inst.sick && !hasKeyword(inst, 'haste')) return refuse('summoningSick', `${cardOf(inst).name} is summoning sick: it cannot use an ability with {T} in its cost until your next turn begins.`)
    const canNow = state.priority === player || state.casting?.player === player
    if (!canNow) return refuse('noPriority', 'You can make mana when you have priority or while paying for a spell.')
    const produces = abilities[0].produces
    const made = produces.includes(colour) ? colour : produces[0]
    inst.tapped = true
    state.pool[player][made] += 1
    emit(state, { type: 'manaProduced', player, instanceId, colour: made })
    return null
  },

  beginCast(state, { player, instanceId }) {
    const inst = state.cards[instanceId]
    if (!inst || inst.zone !== 'hand' || inst.owner !== player) return refuse('notInHand', 'That card is not in your hand.')
    const card = cardOf(inst)
    if (isLand(inst)) return refuse('isALand', `${card.name} is a land. Lands are played, not cast: no cost, no stack.`)
    const why = unsupportedReason(card)
    if (why) return refuse('unsupported', `${card.name} ${why}.`)
    if (state.awaiting) return refuse('awaiting', 'A declaration is needed first.')
    if (state.casting) return refuse('alreadyCasting', 'You are already in the middle of casting something. Finish or cancel that first.')
    const timing = timingAllows(state, player, card.rules.kind)
    if (!timing.ok) return refuse(timing.code, timing.message)
    const effect = card.rules.effect
    if (effect?.target && !legalTargets(state, effect).length) return refuse('noTargets', `${card.name} needs a target and there is nothing it could target.`)
    state.casting = { player, instanceId, cost: costOf(card), assigned: [], targets: [], needsTarget: effect?.target ?? null }
    return null
  },

  chooseTarget(state, { player, target }) {
    const casting = state.casting
    if (!casting || casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    if (!casting.needsTarget) return refuse('noTargetNeeded', `${cardOf(state.cards[casting.instanceId]).name} does not target anything.`)
    const legal = legalTargets(state, cardOf(state.cards[casting.instanceId]).rules.effect)
    if (!legal.some((t) => t.kind === target?.kind && t.id === target?.id)) {
      return refuse('illegalTarget', casting.needsTarget === 'creature' ? 'That is not a creature on the battlefield.' : 'That cannot be targeted.')
    }
    casting.targets = [target]
    return null
  },

  assign(state, { player, part, from }) {
    const casting = state.casting
    if (!casting || casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    const symbol = casting.cost[part]
    if (!symbol) return refuse('noSuchPart', 'That is not part of the cost.')
    if (!POOL_KEYS.includes(from)) return refuse('noSuchMana', 'That is not a kind of mana.')
    const needed = symbol.kind === 'generic' ? symbol.generic : 1
    const have = casting.assigned.filter((a) => a.part === part).length
    if (have >= needed) return refuse('partPaid', 'That part of the cost is already paid.')
    if (symbol.kind === 'colored' && from !== symbol.colors[0]) return refuse('wrongColour', `{${symbol.symbol}} can only be paid with ${colourName(symbol.colors[0])} mana; ${colourName(from)} does not pay it.`)
    if (symbol.kind === 'colorless' && from !== 'C') return refuse('wrongColour', '{C} can only be paid with colourless mana, not with coloured mana. Generic costs take anything; colourless does not.')
    const reserved = casting.assigned.filter((a) => a.from === from).length
    if (reserved >= state.pool[player][from]) return refuse('notEnoughMana', `You have no ${colourName(from)} mana left in your pool. Tap a source that makes it.`)
    casting.assigned.push({ part, from })
    return null
  },

  unassign(state, { player, part }) {
    const casting = state.casting
    if (!casting || casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    const i = casting.assigned.map((a) => a.part).lastIndexOf(part)
    if (i < 0) return refuse('nothingAssigned', 'Nothing is assigned to that part.')
    casting.assigned.splice(i, 1)
    return null
  },

  autoPay(state, { player }) {
    const casting = state.casting
    if (!casting || casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    const assignment = payFromPool(casting.cost, state.pool[player])
    if (!assignment) return refuse('notEnoughMana', shortfallMessage(casting.cost, state.pool[player]))
    // Map the flat assignment back onto cost parts in order.
    const assigned = []
    const counts = casting.cost.map(() => 0)
    for (const entry of assignment) {
      const part = casting.cost.findIndex((c, i) => c.symbol === entry.symbol && counts[i] < (c.kind === 'generic' ? c.generic : 1))
      counts[part] += 1
      assigned.push({ part, from: entry.from })
    }
    casting.assigned = assigned
    return null
  },

  commitCast(state, { player }) {
    const casting = state.casting
    if (!casting || casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    const inst = state.cards[casting.instanceId]
    const card = cardOf(inst)
    for (let i = 0; i < casting.cost.length; i++) {
      const needed = casting.cost[i].kind === 'generic' ? casting.cost[i].generic : 1
      const have = casting.assigned.filter((a) => a.part === i).length
      if (have < needed) return refuse('costUnpaid', `{${casting.cost[i].symbol}} is not paid yet.`)
    }
    if (casting.needsTarget && !casting.targets.length) return refuse('noTarget', `${card.name} needs a target.`)
    if (casting.needsTarget) {
      const legal = legalTargets(state, card.rules.effect)
      const t = casting.targets[0]
      if (!legal.some((l) => l.kind === t.kind && l.id === t.id)) return refuse('illegalTarget', 'The chosen target is no longer legal.')
    }
    const timing = timingAllows(state, player, card.rules.kind)
    if (!timing.ok) return refuse(timing.code, timing.message)
    // Pay: every reservation must still be in the pool (a pool cannot go negative).
    const spend = emptyPool()
    for (const a of casting.assigned) spend[a.from] += 1
    for (const k of POOL_KEYS) if (spend[k] > state.pool[player][k]) return refuse('notEnoughMana', `You no longer have enough ${colourName(k)} mana in your pool.`)
    for (const k of POOL_KEYS) state.pool[player][k] -= spend[k]
    moveTo(state, casting.instanceId, 'stack')
    state.stack.push({ instanceId: casting.instanceId, controller: player, targets: casting.targets, paid: casting.assigned })
    emit(state, { type: 'manaSpent', player, spent: spend })
    emit(state, { type: 'spellCast', player, instanceId: casting.instanceId, targets: casting.targets })
    state.casting = null
    givePriority(state, player) // 117.3c: the caster receives priority after casting
    return null
  },

  cancelCast(state, { player }) {
    if (!state.casting || state.casting.player !== player) return refuse('notCasting', 'You are not casting anything.')
    // Mana already made stays in the pool: a mana ability, once activated, is not undone (605.3c). It empties with the step.
    state.casting = null
    return null
  },

  pass(state, { player }) {
    if (state.awaiting) return refuse('awaiting', `${state.awaiting.player === player ? 'You' : 'Your opponent'} must declare ${state.awaiting.kind} first.`)
    if (state.priority !== player) return refuse('noPriority', 'You do not have priority right now.')
    if (state.casting?.player === player) return refuse('midCast', 'Finish or cancel the spell you are casting first.')
    state.passes += 1
    emit(state, { type: 'passed', player })
    if (state.passes < PLAYERS.length) { state.priority = other(player); return null }
    // Both passed in succession (117.4).
    state.passes = 0
    if (state.stack.length) { resolveTop(state); return null }
    nextStep(state)
    return null
  },

  declareAttackers(state, { player, attackers = [] }) {
    const awaiting = state.awaiting
    if (!awaiting || awaiting.kind !== 'attackers') return refuse('notDeclaring', 'It is not time to declare attackers.')
    if (awaiting.player !== player) return refuse('notYours', 'It is not your declaration.')
    for (const id of attackers) {
      const inst = state.cards[id]
      if (!inst || inst.zone !== 'battlefield' || inst.controller !== player) return refuse('notYours', 'That is not a creature you control.')
      if (!isCreature(inst)) return refuse('notACreature', `${cardOf(inst).name} is not a creature.`)
      if (inst.tapped) return refuse('tapped', `${cardOf(inst).name} is tapped and cannot attack.`)
      if (inst.sick && !hasKeyword(inst, 'haste')) return refuse('summoningSick', `${cardOf(inst).name} is summoning sick: it has not been under your control since this turn began.`)
    }
    for (const id of attackers) {
      state.cards[id].attacking = 'player'
      state.cards[id].tapped = true // 508.1f: attacking taps, without vigilance
    }
    state.attackers = [...attackers]
    state.awaiting = null
    emit(state, { type: 'attackersDeclared', player, attackers: [...attackers] })
    givePriority(state, state.active)
    return null
  },

  declareBlockers(state, { player, blocks = {} }) {
    const awaiting = state.awaiting
    if (!awaiting || awaiting.kind !== 'blockers') return refuse('notDeclaring', 'It is not time to declare blockers.')
    if (awaiting.player !== player) return refuse('notYours', 'It is not your declaration.')
    for (const [blockerId, attackerId] of Object.entries(blocks)) {
      const blocker = state.cards[blockerId]
      if (!blocker || blocker.zone !== 'battlefield' || blocker.controller !== player) return refuse('notYours', 'That is not a creature you control.')
      if (!isCreature(blocker)) return refuse('notACreature', `${cardOf(blocker).name} is not a creature.`)
      if (blocker.tapped) return refuse('tapped', `${cardOf(blocker).name} is tapped and cannot block.`)
      if (!state.attackers.includes(attackerId)) return refuse('notAttacking', 'That creature is not attacking.')
    }
    for (const [blockerId, attackerId] of Object.entries(blocks)) {
      state.cards[blockerId].blocking = attackerId // 509.1: blocking does not tap
      state.cards[attackerId].attacking = 'blocked'
    }
    state.blocks = { ...blocks }
    state.awaiting = null
    emit(state, { type: 'blockersDeclared', player, blocks: { ...blocks } })
    givePriority(state, state.active)
    return null
  },

  discard(state, { player, instanceIds = [] }) {
    const awaiting = state.awaiting
    if (!awaiting || awaiting.kind !== 'discard' || awaiting.player !== player) return refuse('notDiscarding', 'Nothing to discard right now.')
    if (instanceIds.length !== awaiting.count) return refuse('wrongCount', `Discard exactly ${awaiting.count}.`)
    for (const id of instanceIds) if (state.cards[id]?.zone !== 'hand' || state.cards[id].owner !== player) return refuse('notInHand', 'That card is not in your hand.')
    for (const id of instanceIds) { moveTo(state, id, 'graveyard'); emit(state, { type: 'discarded', player, instanceId: id }) }
    state.awaiting = null
    finishCleanup(state)
    return null
  },

  concede(state, { player }) {
    if (state.over) return refuse('gameOver', 'The game is over.')
    state.over = { winner: other(player), losers: [player], reason: 'conceded' }
    emit(state, { type: 'gameOver', winner: other(player), losers: [player], reason: 'conceded' })
    return null
  },
}

/** Resolves the top of the stack (608), then gives the active player priority (117.3b). */
function resolveTop(state) {
  const item = state.stack[state.stack.length - 1]
  const inst = state.cards[item.instanceId]
  const card = cardOf(inst)
  const rules = card.rules
  if (rules.effect?.target) {
    const legal = legalTargets(state, rules.effect)
    const t = item.targets[0]
    if (!t || !legal.some((l) => l.kind === t.kind && l.id === t.id)) {
      // 608.2b: every target illegal, the spell does not resolve.
      moveTo(state, item.instanceId, 'graveyard')
      emit(state, { type: 'spellFizzled', instanceId: item.instanceId, target: t ?? null })
      givePriority(state, state.active)
      return
    }
  }
  if (rules.kind === 'creature') {
    moveTo(state, item.instanceId, 'battlefield')
    inst.controller = item.controller
    inst.sick = !hasKeyword(inst, 'haste')
    emit(state, { type: 'spellResolved', instanceId: item.instanceId })
    emit(state, { type: 'permanentEntered', instanceId: item.instanceId, controller: item.controller })
  } else {
    const t = item.targets[0]
    if (rules.effect.kind === 'pump') {
      state.cards[t.id].effects.push({ power: rules.effect.power, toughness: rules.effect.toughness, until: 'endOfTurn', source: item.instanceId })
      emit(state, { type: 'pumped', instanceId: t.id, power: rules.effect.power, toughness: rules.effect.toughness, source: item.instanceId })
    } else if (rules.effect.kind === 'damage') {
      if (t.kind === 'player') state.life[t.id] -= rules.effect.amount
      else state.cards[t.id].damage += rules.effect.amount
      emit(state, { type: 'damageDealt', source: item.instanceId, target: t.id, amount: rules.effect.amount })
    }
    moveTo(state, item.instanceId, 'graveyard')
    emit(state, { type: 'spellResolved', instanceId: item.instanceId })
  }
  givePriority(state, state.active)
}

const COLOUR_WORDS = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' }
export const colourName = (k) => COLOUR_WORDS[k] ?? k

/** Why a cost cannot be paid from a pool, in the coach's words. */
export function shortfallMessage(cost, pool) {
  const left = { ...pool }
  const missing = []
  for (const part of cost) {
    if (part.kind === 'colored') { if (left[part.colors[0]] > 0) left[part.colors[0]] -= 1; else missing.push(colourName(part.colors[0])) }
    if (part.kind === 'colorless') { if (left.C > 0) left.C -= 1; else missing.push('colourless') }
  }
  const generic = cost.filter((p) => p.kind === 'generic').reduce((n, p) => n + p.generic, 0)
  const spare = POOL_KEYS.reduce((n, k) => n + left[k], 0)
  if (missing.length) return `You are short of ${missing.join(' and ')} mana: the pool has none to pay it with, and mana of another colour cannot stand in for a coloured symbol.`
  if (generic > spare) return `You are ${generic - spare} mana short. The coloured symbols are covered; the generic part still needs ${generic - spare} more of any kind.`
  return 'That cost cannot be paid from your pool.'
}
