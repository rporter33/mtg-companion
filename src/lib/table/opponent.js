/**
 * The practice opponent: a player whose choices are written down.
 *
 * It is not a strategy engine. Each scenario names a policy, and the
 * policy is a few stated rules the screen can show ("plays a land, casts
 * the biggest creature it can afford, attacks when the attacker would
 * survive, blocks when the block kills or must"). The default passes on
 * everything and declares nothing, which is what a mana lesson needs.
 */
import { battlefield, hand, isCreature, isLand, hasKeyword, stats, manaAbilities, costOf, couldPay, MAIN_STEPS } from './model.js'
import { cardOf } from './model.js'

/** Does nothing but pass, and never attacks or blocks. */
export const PASSIVE = {
  id: 'passive',
  description: 'Passes on everything. Never attacks, never blocks.',
  decide(state) {
    if (state.awaiting?.player === 'foe') {
      if (state.awaiting.kind === 'attackers') return { type: 'declareAttackers', player: 'foe', attackers: [] }
      if (state.awaiting.kind === 'blockers') return { type: 'declareBlockers', player: 'foe', blocks: {} }
      if (state.awaiting.kind === 'discard') return { type: 'discard', player: 'foe', instanceIds: state.zones.hand.foe.slice(0, state.awaiting.count) }
    }
    if (state.priority === 'foe') return { type: 'pass', player: 'foe' }
    return null
  },
}

/**
 * Plays simply and legally: a land if it has one, the biggest creature it
 * can pay for, attacks with creatures that would survive any single block
 * or when the defender has no untapped creatures, blocks when the block
 * kills the attacker and the blocker survives, or when the damage would be
 * lethal. Burn goes at the biggest creature it can kill, else at the face
 * when that is lethal. Written so a learner can read it and predict it.
 */
export const SIMPLE = {
  id: 'simple',
  description: 'Plays a land, casts the biggest creature it can afford, attacks when the attacker would survive a block, blocks when the block kills or the hit would be lethal.',
  decide(state) {
    const me = 'foe'
    const them = 'you'
    if (state.awaiting?.player === me) {
      if (state.awaiting.kind === 'attackers') {
        const mine = battlefield(state, me).filter((c) => isCreature(c) && !c.tapped && (!c.sick || hasKeyword(c, 'haste')))
        const theirs = battlefield(state, them).filter((c) => isCreature(c) && !c.tapped)
        const biggestBlockerPower = Math.max(0, ...theirs.map((c) => stats(c).power))
        const attackers = mine.filter((c) => !theirs.length || stats(c).toughness > biggestBlockerPower || stats(c).power >= state.life[them])
        return { type: 'declareAttackers', player: me, attackers: attackers.map((c) => c.instanceId) }
      }
      if (state.awaiting.kind === 'blockers') {
        const blocks = {}
        const free = battlefield(state, me).filter((c) => isCreature(c) && !c.tapped)
        const incoming = state.attackers.map((id) => state.cards[id]).reduce((n, a) => n + stats(a).power, 0)
        for (const attackerId of state.attackers) {
          const attacker = state.cards[attackerId]
          const a = stats(attacker)
          const killer = free.find((b) => !blocks[b.instanceId] && stats(b).power >= a.toughness - a.damage && stats(b).toughness > a.power)
          const chump = incoming >= state.life[me] ? free.find((b) => !blocks[b.instanceId]) : null
          const chosen = killer ?? chump
          if (chosen) blocks[chosen.instanceId] = attackerId
        }
        return { type: 'declareBlockers', player: me, blocks }
      }
      if (state.awaiting.kind === 'discard') return { type: 'discard', player: me, instanceIds: state.zones.hand[me].slice(0, state.awaiting.count) }
    }
    if (state.priority !== me) return null
    if (state.casting?.player === me) return { type: 'commitCast', player: me }
    const myHand = hand(state, me)
    const sorcerySpeed = state.active === me && MAIN_STEPS.includes(state.step) && !state.stack.length
    if (sorcerySpeed && state.landsPlayed[me] < 1) {
      const land = myHand.find(isLand)
      if (land) return { type: 'playLand', player: me, instanceId: land.instanceId }
    }
    if (sorcerySpeed) {
      const sources = battlefield(state, me).filter((c) => manaAbilities(c).length)
      const castable = myHand.filter((c) => cardOf(c).rules.kind === 'creature' && couldPay(costOf(cardOf(c)), sources))
        .sort((a, b) => cardOf(b).cmc - cardOf(a).cmc)
      const pick = castable[0]
      if (pick) return { type: 'castWith', player: me, instanceId: pick.instanceId, sources: sources.map((s) => s.instanceId) }
      const burn = myHand.filter((c) => cardOf(c).rules.effect?.kind === 'damage' && couldPay(costOf(cardOf(c)), sources))[0]
      if (burn) {
        const amount = cardOf(burn).rules.effect.amount
        const victims = battlefield(state, them).filter((c) => isCreature(c) && stats(c).toughness - c.damage <= amount).sort((a, b) => stats(b).power - stats(a).power)
        if (victims[0]) return { type: 'castWith', player: me, instanceId: burn.instanceId, sources: sources.map((s) => s.instanceId), target: { kind: 'creature', id: victims[0].instanceId } }
        if (state.life[them] <= amount) return { type: 'castWith', player: me, instanceId: burn.instanceId, sources: sources.map((s) => s.instanceId), target: { kind: 'player', id: them } }
      }
    }
    return { type: 'pass', player: me }
  },
}

/**
 * Blocks whenever it can: each attacker gets one untapped creature, in
 * order. Never attacks. The opponent a blocking lesson wants, and it says
 * so on the screen.
 */
export const BLOCKER = {
  id: 'blocker',
  description: 'Blocks every attacker it can with one untapped creature each. Never attacks.',
  decide(state) {
    if (state.awaiting?.player === 'foe' && state.awaiting.kind === 'blockers') {
      const free = battlefield(state, 'foe').filter((c) => isCreature(c) && !c.tapped)
      const blocks = {}
      for (const attackerId of state.attackers) {
        const blocker = free.find((b) => !blocks[b.instanceId])
        if (blocker) blocks[blocker.instanceId] = attackerId
      }
      return { type: 'declareBlockers', player: 'foe', blocks }
    }
    return PASSIVE.decide(state)
  },
}

/**
 * A scripted opponent: a list of rules tried in order, each a function of
 * the state returning an action or null, falling back to the passive
 * policy. Scenarios use it to make the opponent do one specific thing, such
 * as cast Shock at a creature on its own turn.
 */
export function scripted(id, description, rules) {
  return {
    id,
    description,
    decide(state) {
      for (const rule of rules) {
        const action = rule(state)
        if (action) return action
      }
      return PASSIVE.decide(state)
    },
  }
}

export const POLICIES = { passive: PASSIVE, simple: SIMPLE, blocker: BLOCKER }

/** A scenario's opponent: a policy id, or a policy object of its own. */
export function policyFor(opponent) {
  if (opponent && typeof opponent === 'object' && typeof opponent.decide === 'function') return opponent
  return POLICIES[opponent] ?? PASSIVE
}
export const policyById = policyFor
