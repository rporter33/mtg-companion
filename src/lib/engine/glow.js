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
 * Which is why an offer the table cannot yet carry out does not glow as
 * playable, for either of two reasons (`heldBack`). A spell or ability that
 * needs a target: the engine offers one, but `act` sends no targets with it
 * and Argentum refuses the cast before it would ask (PLAN.md, M2, "Not done").
 * And one whose cost has a choice in it — Flamecache Gecko's "Discard a card":
 * `act` carries no payment either, and Argentum refuses it with "Must choose 1
 * card(s) to discard" (PLAN.md, M3). A glow on either would be the table
 * promising a play it cannot make. When targets and costs can be chosen here
 * (HANDOFF.md, M4), these join the others. An engine from before the offer
 * named its cost sends no word of one, and there the Gecko glows as it did.
 *
 * A glow is a picture, and a picture says nothing to somebody who cannot see
 * it, so every glow comes with its words: `says` is added to the card's spoken
 * label, and the prompt panel says in text what the glowing cards are for.
 *
 * Pure. The status is read forgivingly, as everything from the wire is: an
 * older engine, a missing list or a decision of a kind this does not know
 * glows nothing rather than throwing.
 */

/** The words each glow adds to a card's spoken label. */
export const GLOW_SAYS = {
  play: 'playable now',
  ability: 'an ability can be used now',
  target: 'a legal target',
  attacker: 'can attack',
  attacking: 'attacking',
  blocker: 'can block',
  blocking: 'blocking',
}

const lit = (kind, says) => ({ kind, says })
const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])

/**
 * The costs Argentum pays with nothing to choose, read in its `CostHandler`:
 * sacrificing the source itself, and paying life. Every other kind it names
 * (`additionalCost`, Argentum's own `costType`) asks which card, which
 * creature or how many, and an offer sent bare with one is refused or has the
 * choice made by the engine's responder rather than the player.
 */
const CHOICELESS_COSTS = new Set(['SacrificeSelf', 'PayLife'])

/**
 * Why a tap cannot carry an offer out yet: `'target'` when it needs a target,
 * `'cost'` when its cost has a choice in it, or null when neither holds it
 * back. Read forgivingly: an offer from an engine that names no cost is not
 * held back for one.
 */
export function heldBack(a) {
  if (!a || typeof a !== 'object') return null
  if (a.requiresTargets) return 'target'
  if (a.requiresForage === true || (typeof a.additionalCost === 'string' && !CHOICELESS_COSTS.has(a.additionalCost))) return 'cost'
  return null
}

/**
 * @param {object} options
 * @param {object|null} options.status the engine's status for this seat (engine/README.md)
 * @param {string} options.me this seat's id
 * @param {(id: string) => string|undefined} [options.zoneOf] where a card is on the board
 * @param {Set<string>} [options.chosen] attackers gathered so far
 * @param {Record<string, string[]>} [options.blocks] blocks declared so far, blocker to attackers
 * @param {string|null} [options.blocker] a blocker picked and waiting for its attacker
 * @returns {Map<string, {kind: 'playable'|'target'|'chosen', says: string}>} by card or player id
 */
export function glowsAt({ status, me, zoneOf = () => undefined, chosen = new Set(), blocks = {}, blocker = null }) {
  const glows = new Map()
  if (!status || status.over || !me || status.actor !== me) return glows

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
  // tap on a card does at this table (Table.jsx, `touchHeld`). A card in any
  // other zone with an offer — a flashback in the graveyard — is played from
  // the actions panel, and the prompt says so (`offeredElsewhere`).
  for (const a of offers) {
    if (typeof a.card !== 'string' || !a.affordable || a.mana || heldBack(a)) continue
    const zone = zoneOf(a.card)
    if (zone === 'hand' && a.meaningful) glows.set(a.card, lit('playable', GLOW_SAYS.play))
    else if (zone === 'battlefield' && a.type === 'ActivateAbility' && !glows.has(a.card)) glows.set(a.card, lit('playable', GLOW_SAYS.ability))
  }
  return glows
}

/** What the engine stopped this seat for: every meaningful offer it can afford that is not a mana ability. */
const worthStopping = (status) => (!status || status.waiting !== 'action' || !Array.isArray(status.actions)
  ? []
  : status.actions.filter((a) => a && typeof a === 'object' && a.meaningful && a.affordable && !a.mana))

/**
 * The offers the engine stopped for that this table cannot carry out yet
 * because they need a target the table does not send. The prompt names their
 * cards, so a stop with nothing glowing still says why it is a stop.
 */
export function unaimed(status) {
  return worthStopping(status).filter((a) => heldBack(a) === 'target')
}

/** The same, for offers whose cost has a choice in it the table cannot make yet. */
export function unpaid(status) {
  return worthStopping(status).filter((a) => heldBack(a) === 'cost')
}

/**
 * The plays the engine offers for a card neither in hand nor on the
 * battlefield — a flashback in the graveyard, a card cast from exile — which
 * the table can carry out but no tap on the table reaches: they are in the
 * actions panel, and the prompt names them with where they are. `zone` is the
 * board's word for where the card is, or undefined where the board cannot say.
 */
export function offeredElsewhere(status, zoneOf = () => undefined) {
  const seen = new Set()
  const out = []
  for (const a of worthStopping(status)) {
    if (typeof a.card !== 'string' || heldBack(a)) continue
    const zone = zoneOf(a.card)
    if (zone === 'hand' || zone === 'battlefield') continue
    const key = `${a.card}:${a.type === 'ActivateAbility' ? 'use' : 'play'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ offer: a, zone })
  }
  return out
}
