/**
 * What glows at the engine's table, and what each glow says in words.
 *
 * Moxgate outlines the cards in hand that can be cast (TARGET.md §11), and
 * the Grok preview named the other half: while a target is being chosen, the
 * legal ones glow (SOURCES.md, "The Grok preview"; HANDOFF.md, M1b). Both need
 * the engine, which is why the table played by hand has neither: `board/`
 * never reads what a card does, and a glow worked out from a count of
 * untapped lands would be the guess `board/mana.js` is careful to label as
 * one. Here nothing is guessed. Every glow is read off what the engine is
 * offering or asking this seat at this moment, so a card glows exactly when a
 * tap on it does something the engine will take.
 *
 * Which is why an offer the table cannot carry out does not glow as playable,
 * for either of two reasons (`heldBack`). A spell or ability that needs a
 * target, where this seat's `act` cannot carry one: Argentum refuses such a
 * cast before it would ask (PLAN.md, M2). And one whose cost has a choice in it
 * — Flamecache Gecko's "Discard a card" — where this seat cannot pay that kind
 * of cost with a choice: Argentum refuses it with "Must choose 1 card(s) to
 * discard" (PLAN.md, M3). A glow on either would be the table promising a play
 * it cannot make. Since M4 an engine at protocol 5 takes both with the play,
 * and the room says so seat by seat (`choices`, src/lib/engine/choose.js): there
 * such an offer glows like any other, and a tap on it begins choosing. A seat
 * told nothing — an older relay, an older engine — holds them back as before.
 * An engine from before the offer named its cost sends no word of one, and
 * there the Gecko glows as it did.
 *
 * A glow is a picture, and a picture says nothing to somebody who cannot see
 * it, so every glow comes with its words: `says` is added to the card's spoken
 * label, and the prompt panel says in text what the glowing cards are for.
 *
 * Pure. The status is read forgivingly, as everything from the wire is: an
 * older engine, a missing list or a decision of a kind this does not know
 * glows nothing rather than throwing.
 */

import { heldBackBy, NO_CHOICES, pickable, stepOf } from './choose.js'

/** The words each glow adds to a card's spoken label. */
export const GLOW_SAYS = {
  play: 'playable now',
  command: 'can be cast from the command zone now',
  ability: 'an ability can be used now',
  target: 'a legal target',
  targeted: 'chosen as a target',
  attacker: 'can attack',
  attacking: 'attacking',
  blocker: 'can block',
  blocking: 'blocking',
  payable: 'can pay the cost',
  paying: 'chosen to pay the cost',
  choosable: 'can be chosen',
  picked: 'chosen',
  source: 'can pay mana',
  sourcing: 'chosen to pay mana',
  bottomable: 'can go on the bottom',
  bottomed: 'chosen for the bottom',
}

/** What a card in each kind of step says it is: one that may be picked, and one that has been. */
const STEP_SAYS = {
  targets: [GLOW_SAYS.target, GLOW_SAYS.targeted],
  cost: [GLOW_SAYS.payable, GLOW_SAYS.paying],
  cards: [GLOW_SAYS.choosable, GLOW_SAYS.picked],
  sources: [GLOW_SAYS.source, GLOW_SAYS.sourcing],
  bottom: [GLOW_SAYS.bottomable, GLOW_SAYS.bottomed],
}

const lit = (kind, says) => ({ kind, says })
const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])

/**
 * Why a tap cannot carry an offer out at this seat: `'target'` when it needs a
 * target the seat cannot send, `'cost'` when its cost has a choice in it the
 * seat cannot make, or null when nothing holds it back. `can` is what the room
 * said this seat may choose (`choicesFrom`); left out, it is nothing, which is
 * every table before M4. Sacrificing the source itself and paying life need
 * nothing chosen (Argentum's `CostHandler`), and hold nothing back. Read
 * forgivingly: an offer from an engine that names no cost is not held back for
 * one.
 */
export function heldBack(a, can = NO_CHOICES) {
  return heldBackBy(a, can)
}

/**
 * @param {object} options
 * @param {object|null} options.status the engine's status for this seat (engine/README.md)
 * @param {string} options.me this seat's id
 * @param {(id: string) => string|undefined} [options.zoneOf] where a card is on the board
 * @param {Set<string>} [options.chosen] attackers gathered so far
 * @param {Record<string, string[]>} [options.blocks] blocks declared so far, blocker to attackers
 * @param {string|null} [options.blocker] a blocker picked and waiting for its attacker
 * @param {object} [options.can] what this seat may choose (`choicesFrom`)
 * @param {object|null} [options.choosing] a choice in progress (`beginPlay`, `beginDecision`, `beginBottom`)
 * @returns {Map<string, {kind: 'playable'|'target'|'chosen', says: string}>} by card or player id
 */
export function glowsAt({ status, me, zoneOf = () => undefined, chosen = new Set(), blocks = {}, blocker = null, can = NO_CHOICES, choosing = null }) {
  const glows = new Map()
  if (!status || status.over || !me || status.actor !== me) return glows

  // Something being chosen, a step at a time: what may be picked now glows,
  // and what has been picked for this step or an earlier one stays lit, more
  // heavily, saying what it was chosen for.
  const step = stepOf(choosing)
  if (step) {
    for (const s of choosing.steps.slice(0, choosing.at + 1)) {
      const says = STEP_SAYS[s.kind]
      if (says) for (const id of s.picked ?? []) glows.set(id, lit('chosen', says[1]))
    }
    const says = STEP_SAYS[step.kind]
    if (says) for (const id of pickable(choosing)) if (!glows.has(id)) glows.set(id, lit('target', says[0]))
    return glows
  }

  // A target being chosen: every legal one, card or player, across every
  // requirement the decision holds.
  if (status.waiting === 'decision') {
    const d = status.decision
    if (d?.type !== 'ChooseTargets' || !Array.isArray(d.requirements)) return glows
    for (const req of d.requirements) for (const id of ids(req?.legal)) glows.set(id, lit('target', GLOW_SAYS.target))
    return glows
  }
  if (status.waiting !== 'action' || !Array.isArray(status.actions)) return glows
  const offers = status.actions.filter((a) => a && typeof a === 'object')

  // Combat is declared by tapping, so the creatures that may be tapped for it
  // glow, and the ones already gathered stay lit — more strongly, and saying
  // so — rather than going dark once chosen. Only the engine's own lists are
  // read: which attacker a blocker could legally block is not something the
  // offer says, so no attacker glows as blockable.
  const declaring = offers.find((a) => a.type === 'DeclareAttackers' && a.meaningful)
  if (declaring) {
    for (const id of ids(declaring.validAttackers)) {
      glows.set(id, chosen.has(id) ? lit('chosen', GLOW_SAYS.attacking) : lit('target', GLOW_SAYS.attacker))
    }
    return glows
  }
  const blocking = offers.find((a) => a.type === 'DeclareBlockers' && a.meaningful)
  if (blocking) {
    const placed = new Set([...Object.keys(blocks ?? {}), ...(blocker ? [blocker] : [])])
    for (const id of ids(blocking.validBlockers)) {
      glows.set(id, placed.has(id) ? lit('chosen', GLOW_SAYS.blocking) : lit('target', GLOW_SAYS.blocker))
    }
    return glows
  }

  // A play: a card in hand with a meaningful offer it can afford, or a
  // permanent with an ability that is not a mana ability — the two things one
  // tap on a card does at this table (Table.jsx, `touchHeld`) — and, at a
  // Commander table (M6), a commander that can be cast from the command zone,
  // which a tap on that zone casts. A card in any other zone with an offer — a
  // flashback in the graveyard — is played from the actions panel, and the
  // prompt says so (`offeredElsewhere`).
  for (const a of offers) {
    if (typeof a.card !== 'string' || !a.affordable || a.mana || heldBack(a, can)) continue
    const zone = zoneOf(a.card)
    if (zone === 'hand' && a.meaningful) glows.set(a.card, lit('playable', GLOW_SAYS.play))
    else if (zone === 'command' && a.meaningful && a.type === 'CastSpell') glows.set(a.card, lit('playable', GLOW_SAYS.command))
    else if (zone === 'battlefield' && a.type === 'ActivateAbility' && !glows.has(a.card)) glows.set(a.card, lit('playable', GLOW_SAYS.ability))
  }
  return glows
}

/** What the engine stopped this seat for: every meaningful offer it can afford that is not a mana ability. */
const worthStopping = (status) => (!status || status.waiting !== 'action' || !Array.isArray(status.actions)
  ? []
  : status.actions.filter((a) => a && typeof a === 'object' && a.meaningful && a.affordable && !a.mana))

/**
 * The offers the engine stopped for that this seat cannot carry out because
 * they need a target it cannot send. The prompt names their cards, so a stop
 * with nothing glowing still says why it is a stop.
 */
export function unaimed(status, can = NO_CHOICES) {
  return worthStopping(status).filter((a) => heldBack(a, can) === 'target')
}

/** The same, for offers whose cost has a choice in it the seat cannot make. */
export function unpaid(status, can = NO_CHOICES) {
  return worthStopping(status).filter((a) => heldBack(a, can) === 'cost')
}

/**
 * What a pile holds that is part of what the engine asks now, for its tile to
 * wear and say, since the cards inside glow only once it is opened: `'target'`
 * a legal target, `'choice'` a card something else being chosen can take — a
 * cost exiling from the graveyard, cards to select — `'cast'` a commander that
 * a tap on the command zone casts (M6), `'play'` or `'use'` a card with a play
 * offered from the pile (`offeredElsewhere`), or null. A target is said as one
 * only where it is one: the words differ, the edge not.
 */
export function pileHolding(ids, glows, elsewhere = []) {
  const lit = ids.map((id) => glows.get(id)).filter((g) => g?.kind === 'target')
  if (lit.some((g) => g.says === GLOW_SAYS.target)) return 'target'
  if (lit.length) return 'choice'
  if (ids.some((id) => glows.get(id)?.says === GLOW_SAYS.command)) return 'cast'
  const here = elsewhere.filter(({ offer }) => ids.includes(offer.card))
  if (!here.length) return null
  return here.some(({ offer }) => offer.type !== 'ActivateAbility') ? 'play' : 'use'
}

/**
 * The plays the engine offers for a card neither in hand nor on the
 * battlefield — a flashback in the graveyard, a card cast from exile — which
 * the table can carry out but no tap on the table reaches: they are in the
 * actions panel, and the prompt names them with where they are. `zone` is the
 * board's word for where the card is, or undefined where the board cannot say.
 */
export function offeredElsewhere(status, zoneOf = () => undefined, can = NO_CHOICES) {
  const seen = new Set()
  const out = []
  for (const a of worthStopping(status)) {
    if (typeof a.card !== 'string' || heldBack(a, can)) continue
    const zone = zoneOf(a.card)
    if (zone === 'hand' || zone === 'battlefield') continue
    // A commander from the command zone is cast by a tap on that zone, and glows (M6).
    if (zone === 'command' && a.type === 'CastSpell') continue
    const key = `${a.card}:${a.type === 'ActivateAbility' ? 'use' : 'play'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ offer: a, zone })
  }
  return out
}
