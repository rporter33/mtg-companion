/**
 * The quiet coach.
 *
 * The board enforces nothing, so this is the only thing that ever says a
 * word about the rules, and it never blocks and never guesses. What makes
 * it more useful than it sounds is that most of what a new player forgets
 * needs no understanding of a card at all. Whether a card is a land, what
 * a land produces, what a spell costs, whether a creature arrived this
 * turn: all of that is in Scryfall's own fields, for every card ever
 * printed. So these notes work for a whole deck, not just for cards some
 * engine has been taught.
 *
 * Where it cannot tell, it says nothing. A note is an observation the
 * player can dismiss, never a refusal, and one switch silences the lot.
 */
import { typeLineOf } from '../formats.js'
import { parseManaCost, classifySymbol, COLORS } from '../mana.js'
import { battlefield, handOf, ZONES } from './model.js'

const isLandCard = (card) => /\bLand\b/.test(typeLineOf(card ?? {}))
const isCreatureCard = (card) => /\bCreature\b/.test(typeLineOf(card ?? {}))
const note = (id, text, { severity = 'info' } = {}) => ({ id, text, severity })

/** What the untapped permanents on a player's battlefield could produce, as a count per colour plus a total. */
export function manaAvailable(board, player, lookup) {
  const pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  let sources = 0
  for (const inst of battlefield(board, player)) {
    if (inst.tapped || inst.faceDown) continue
    const card = lookup?.(inst.cardId)
    const produced = card?.produced_mana ?? []
    if (!produced.length) continue
    sources += 1
    for (const colour of produced) if (pool[colour] !== undefined) pool[colour] += 1
  }
  return { ...pool, sources }
}

/**
 * Could this cost be paid from what is untapped? Deliberately generous:
 * it counts sources rather than solving the assignment, because a wrong
 * "you cannot cast this" is far worse than a missed note. Hybrid and
 * phyrexian symbols count as satisfiable, since they usually are.
 */
export function looksCastable(card, available) {
  const parts = parseManaCost(card?.mana_cost ?? '').map((symbol) => ({ symbol, ...classifySymbol(symbol) }))
  if (!parts.length) return available.sources >= 0
  let needed = 0
  const wants = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  for (const part of parts) {
    if (part.kind === 'generic') { needed += part.generic; continue }
    if (part.kind === 'variable') continue
    needed += 1
    if (part.kind === 'colored') wants[part.colors[0]] += 1
    else if (part.kind === 'colorless') wants.C += 1
    // hybrid, phyrexian and the rest count toward the total but demand no colour
  }
  if (available.sources < needed) return false
  for (const colour of [...COLORS, 'C']) if (wants[colour] > available[colour]) return false
  return true
}

/**
 * What the coach notices right now. `events` is the log since the board
 * was made, used only to count what has happened this turn.
 */
export function notesFor(board, events, lookup, { player = 'you' } = {}) {
  const out = []
  const card = (inst) => (inst.custom ? null : lookup?.(inst.cardId))

  // A land drop is a card with Land in its type line moving from a hand to a
  // battlefield. The board does not police it, so this is the only warning.
  const landsThisTurn = events.filter((e) => {
    if (e.type !== 'moved' || e.from !== 'hand' || e.to !== 'battlefield' || e.player !== player) return false
    if (e.turn !== undefined && e.turn !== board.turn) return false
    return isLandCard(lookup?.(board.cards[e.instanceId]?.cardId))
  }).length
  if (landsThisTurn > 1) {
    out.push(note('lands', `That is ${landsThisTurn} lands this turn. One a turn is the usual rule, unless something on the table says otherwise.`, { severity: 'warn' }))
  }

  // Summoning sickness: a creature that arrived this turn and is now tapped
  // or pointed at something. Haste is the common exception, so the note says so.
  for (const inst of battlefield(board, player)) {
    const c = card(inst)
    if (!c || !isCreatureCard(c)) continue
    if (inst.enteredOnTurn !== board.turn) continue
    const attacking = board.arrows.some((a) => a.from === inst.id)
    if (!inst.tapped && !attacking) continue
    if (/\bHaste\b/i.test(c.oracle_text ?? '')) continue
    out.push(note(`sick:${inst.id}`, `${c.name} arrived this turn. A creature cannot attack or use an ability with {T} in its cost unless it has haste.`, { severity: 'warn' }))
  }

  // Mana left untapped, which almost always means a forgotten land.
  const available = manaAvailable(board, player, lookup)
  const hand = handOf(board, player)
  const castable = hand.map(card).filter(Boolean).filter((c) => !isLandCard(c) && looksCastable(c, available))
  if (available.sources > 0 && castable.length > 0) {
    const names = castable.slice(0, 3).map((c) => c.name).join(', ')
    out.push(note('castable', `${available.sources} untapped source${available.sources === 1 ? '' : 's'}, and you are holding something you could pay for: ${names}${castable.length > 3 ? ' and more' : ''}.`))
  }

  if (hand.length > 7) {
    out.push(note('handsize', `${hand.length} cards in hand. You discard down to seven when your turn ends.`))
  }

  const tapped = battlefield(board, player).filter((i) => i.tapped).length
  if (board.active === player && tapped > 0 && board.turn > 1) {
    out.push(note('untap', `${tapped} of your permanents ${tapped === 1 ? 'is' : 'are'} tapped. Everything you control untaps at the start of your turn.`))
  }

  const empty = (board.zones[player]?.library ?? []).length
  if (empty === 0) out.push(note('library', 'Your library is empty. Drawing from an empty library loses the game.', { severity: 'warn' }))
  else if (empty <= 3) out.push(note('library', `${empty} card${empty === 1 ? '' : 's'} left in your library.`))

  return out
}

export { ZONES }
