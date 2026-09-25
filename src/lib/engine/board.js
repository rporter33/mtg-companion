/**
 * The engine's state, laid on the table.
 *
 * The rules-enforced table does not get a screen of its own. The engine
 * (engine/README.md) sends each seat a `ClientGameState` — every card that
 * seat may see, the zones, the players, the step — and this turns it into
 * the board the existing table already knows how to draw: the same
 * instances, zones, lanes and positions as the unenforced table, so the
 * tiles, the fan, the plates and the log are one component with two
 * authorities behind it.
 *
 * Three things are decided here and nowhere else:
 *
 * - **Positions are the table's, not the engine's.** The engine has no
 *   notion of where a permanent sits. A card keeps the spot it had in the
 *   previous board; a card arriving on the battlefield takes the first free
 *   spot along its lane, exactly as a one-tap play does at the solo table.
 * - **What the seat may not see is drawn as a back.** The engine sends an
 *   opponent's hand as a count with no ids, and a library as ids with no
 *   names. Each becomes a face-down placeholder, so the strip of backs and
 *   the pile counts read the same as at a shared table.
 * - **A card is its Scryfall printing.** The engine's image link carries the
 *   printing's id, so an instance's `cardId` is the same Scryfall id the
 *   rest of the app uses, and the table can fetch art crops, printings and
 *   rulings for it the ordinary way. Until it has, `standIn()` is a card
 *   object good enough to draw a printed face from.
 */
import { createBoard, makeInstance } from '../board/model.js'
import { laneFor, snapToLane } from '../board/placement.js'
import { freeAlong } from '../board/geometry.js'
import { FIRST_STEP } from '../../data/turn-structure.js'

/**
 * What the table says while the engine is playing its own turn.
 *
 * A paced table stops after each of the engine's plays and says
 * `waiting: "engine"` with `actor` the seat that made it (engine/README.md,
 * "Pacing, and `continue`"). Moxgate's table says the opponent is thinking
 * and asks the player for nothing meanwhile, and this says the same in
 * words, on the plate of the seat it is waiting on — not in a colour and not
 * in a spinner, so it is there to be read whether or not anything moves.
 */
export const THINKING = 'The engine is thinking…'
export const thinkingAt = (status, seat) =>
  Boolean(seat) && status?.waiting === 'engine' && status?.actor === seat && !status?.over

/** The engine's steps, by the names this app's turn structure uses. */
export const STEP_IDS = {
  UNTAP: 'untap', UPKEEP: 'upkeep', DRAW: 'draw',
  PRECOMBAT_MAIN: 'main1',
  BEGIN_COMBAT: 'beginCombat', DECLARE_ATTACKERS: 'attackers', DECLARE_BLOCKERS: 'blockers',
  FIRST_STRIKE_COMBAT_DAMAGE: 'firstStrike', COMBAT_DAMAGE: 'damage', END_COMBAT: 'endCombat',
  POSTCOMBAT_MAIN: 'main2',
  END: 'end', CLEANUP: 'cleanup',
}
export const stepIdOf = (engineStep) => STEP_IDS[engineStep] ?? FIRST_STEP

const ZONE_IDS = {
  Library: 'library', Hand: 'hand', Battlefield: 'battlefield', Stack: 'stack',
  Graveyard: 'graveyard', Exile: 'exile', Command: 'command',
}

/** The engine's counter names, as this table already labels them. */
const COUNTER_NAMES = { PLUS_ONE_PLUS_ONE: '+1/+1', MINUS_ONE_MINUS_ONE: '-1/-1', LOYALTY: 'loyalty', CHARGE: 'charge' }
const counterName = (key) => COUNTER_NAMES[key] ?? String(key).toLowerCase().replace(/_/g, ' ')

const COLOURS = { WHITE: 'W', BLUE: 'U', BLACK: 'B', RED: 'R', GREEN: 'G' }

/** The Scryfall id in one of Scryfall's own image links, or null. */
export function scryfallIdOf(clientCard) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpg|png)/i.exec(clientCard?.imageUri ?? '')
  return m ? m[1].toLowerCase() : null
}

/**
 * A card object in the shape the table's components read, built from what
 * the engine said about it. Enough to draw the printed face, name it, put
 * it in a lane and show its cost; not a Scryfall record, and never cached
 * as one. `id` is the Scryfall id when the engine gave an image link, else
 * the engine's own id, so the table can always look it up by something.
 */
export function standIn(clientCard) {
  const id = scryfallIdOf(clientCard) ?? `engine:${clientCard.id}`
  return {
    object: 'card',
    id,
    name: clientCard.name,
    type_line: clientCard.typeLine ?? '',
    mana_cost: clientCard.manaCost ?? '',
    cmc: clientCard.manaValue ?? 0,
    oracle_text: clientCard.oracleText ?? '',
    power: clientCard.power == null ? undefined : String(clientCard.power),
    toughness: clientCard.toughness == null ? undefined : String(clientCard.toughness),
    colors: (clientCard.colors ?? []).map((c) => COLOURS[c] ?? c).filter((c) => c.length === 1),
    keywords: clientCard.keywords ?? [],
    image_uris: clientCard.imageUri ? { normal: clientCard.imageUri, large: clientCard.imageUri, small: clientCard.imageUri } : undefined,
    standIn: true,
  }
}

/** A placeholder for a card the seat may not see: a back with an owner. */
const hiddenInstance = (id, owner, zone) => ({
  ...makeInstance({ id, cardId: null, owner, zone }),
  faceDown: true,
  lane: null,
})

/** A zone is named by whose it is and which it is; nothing else identifies it. */
const zoneKey = (id) => (id?.ownerId && id?.zoneType ? `${id.ownerId}:${id.zoneType}` : null)
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
/** A scalar the delta left out is one that did not change (StateDelta's own rule). */
const kept = (next, was) => (next == null ? was : next)

/**
 * A view moved on by one of the engine's `StateDelta`s.
 *
 * The engine answers `view { delta: true }` with Argentum's own DTO
 * (`rules-engine/…/view/StateDelta.kt`), and this is that DTO's contract
 * written in JavaScript, nothing more: a null field means unchanged, a
 * changed card arrives whole, a changed zone replaces the one with its
 * key, `players` always arrive whole, and combat that has ended is said
 * with `combatCleared` rather than by absence. The hijack fields overwrite
 * rather than merge, because a hijack that ends is said by its absence.
 *
 * The log is the exception, and the reason for `log`. `StateDelta` carries
 * its own `newLogEntries`, which this engine never fills — the process keeps
 * each seat's log itself so it can mask and phrase it, and sends the new
 * lines beside the delta instead (engine/README.md, "The log"). Both are
 * appended, in that order, so whichever way the lines travel they arrive
 * once and in order.
 *
 * Two of `ClientGameState`'s fields have no way to travel in a delta at all:
 * `voidActive` and `activeYields` are declared on the state and on no
 * `StateDelta`, and `StateDiffCalculator` never diffs them. So a delta-fed
 * view keeps the last whole view's word for them, which is what Argentum's
 * own client does with them and what the spread below does here. Nothing in
 * this app reads either today; a screen that wanted one would need a field on
 * Argentum's `StateDelta`, or a whole view at the moment it changed.
 *
 * Pure, and forgiving: given a delta it cannot make sense of — no players,
 * a card map that is not a map, a zone with no name — it returns null, and
 * the caller asks for the table whole rather than draw a board built on a
 * guess.
 */
export function applyDelta(view, delta, { log = null } = {}) {
  if (!isMap(view) || !isMap(delta)) return null
  // Always whole, so a delta without them is not one.
  if (!Array.isArray(delta.players)) return null
  if (delta.addedCards != null && !isMap(delta.addedCards)) return null
  if (delta.updatedCards != null && !isMap(delta.updatedCards)) return null
  if (delta.removedCardIds != null && !Array.isArray(delta.removedCardIds)) return null
  if (delta.updatedZones != null && !Array.isArray(delta.updatedZones)) return null

  // A card is diffed whole: added, replaced, or gone from sight.
  const cards = { ...(view.cards ?? {}) }
  for (const [id, card] of Object.entries(delta.addedCards ?? {})) cards[id] = card
  for (const [id, card] of Object.entries(delta.updatedCards ?? {})) cards[id] = card
  for (const id of delta.removedCardIds ?? []) delete cards[id]

  // A zone is diffed whole too, and stands in for the one with its key; a
  // zone the view had not got yet joins the end.
  const zones = [...(view.zones ?? [])]
  for (const zone of delta.updatedZones ?? []) {
    const key = zoneKey(zone?.zoneId)
    if (!key) return null
    const at = zones.findIndex((z) => zoneKey(z?.zoneId) === key)
    if (at >= 0) zones[at] = zone
    else zones.push(zone)
  }

  const lines = [
    ...(Array.isArray(delta.newLogEntries) ? delta.newLogEntries : []),
    ...(Array.isArray(log) ? log : []),
  ]

  return {
    ...view,
    cards,
    zones,
    players: delta.players,
    currentPhase: kept(delta.currentPhase, view.currentPhase),
    currentStep: kept(delta.currentStep, view.currentStep),
    activePlayerId: kept(delta.activePlayerId, view.activePlayerId),
    priorityPlayerId: kept(delta.priorityPlayerId, view.priorityPlayerId),
    turnNumber: kept(delta.turnNumber, view.turnNumber),
    isGameOver: kept(delta.isGameOver, view.isGameOver),
    winnerId: kept(delta.winnerId, view.winnerId),
    dayNight: kept(delta.dayNight, view.dayNight),
    // Present means changed; cleared is said, because a combat that ended
    // would otherwise be indistinguishable from one that did not change.
    combat: delta.combatCleared === true ? null : kept(delta.combat, view.combat),
    // These overwrite: the DTO sends them every time, and a Mindslaver turn
    // that ends says so by leaving them out.
    youAreHijacking: delta.youAreHijacking ?? null,
    youAreHijackedBy: delta.youAreHijackedBy ?? null,
    // Whole-game and never changing mid-game, so an engine that left it out
    // is better believed to have meant the last word than to have cleared it.
    hotseat: delta.hotseat ?? view.hotseat ?? false,
    deck: kept(delta.deck, view.deck),
    log: [...(view.log ?? []), ...lines],
  }
}

/**
 * The board for one view.
 *
 * `prev` is the board this replaces, for positions and arrival turns;
 * `seats` is the room's seating, so the players are listed in seat order
 * whether or not the engine mentions every one of them.
 */
export function boardFromView(view, { prev = null, seats = null } = {}) {
  const players = (seats?.length ? seats.map((s) => s.id ?? s) : view.players.map((p) => p.playerId))
  const board = createBoard({
    players,
    turn: view.turnNumber ?? 1,
    active: view.activePlayerId ?? players[0],
    step: stepIdOf(view.currentStep),
  })
  board.seq = (prev?.seq ?? 0) + 1
  board.engine = {
    priority: view.priorityPlayerId ?? null,
    phase: view.currentPhase ?? null,
    over: Boolean(view.isGameOver),
    winner: view.winnerId ?? null,
  }

  for (const p of view.players ?? []) {
    if (!(p.playerId in board.life)) continue
    board.life[p.playerId] = p.life
    const counters = {}
    if (p.poisonCounters) counters.poison = p.poisonCounters
    board.counters[p.playerId] = counters
  }

  // Every card the seat may see, in the zone the engine says it is in.
  const known = view.cards ?? {}
  const arrivals = []
  for (const zone of view.zones ?? []) {
    const player = zone.zoneId?.ownerId
    const zoneId = ZONE_IDS[zone.zoneId?.zoneType]
    if (!zoneId || !board.zones[player]) continue
    const list = board.zones[player][zoneId]
    const ids = zone.cardIds?.length ? zone.cardIds : Array.from({ length: zone.size ?? 0 }, (_, i) => `${player}:${zoneId}:${i}`)
    for (const id of ids) {
      const card = known[id]
      if (!card) {
        board.cards[id] = hiddenInstance(id, player, zoneId)
        list.push(id)
        continue
      }
      const was = prev?.cards?.[id]
      const stand = standIn(card)
      const inst = {
        ...makeInstance({ id, cardId: stand.id, owner: card.ownerId ?? player, zone: zoneId, token: Boolean(card.isToken) }),
        controller: card.controllerId ?? player,
        tapped: Boolean(card.isTapped),
        faceDown: Boolean(card.isFaceDown),
        attachedTo: card.attachedTo ?? null,
        counters: Object.fromEntries(Object.entries(card.counters ?? {}).filter(([, n]) => n).map(([k, n]) => [counterName(k), n])),
        lane: zoneId === 'battlefield' ? (was?.lane ?? laneFor(stand) ?? 'other') : null,
        x: was?.x ?? 0.5,
        y: was?.y ?? 0.5,
        z: was?.z ?? 0,
        enteredOnTurn: was?.zone === 'battlefield' ? was.enteredOnTurn : (view.turnNumber ?? 1),
        sick: Boolean(card.hasSummoningSickness),
      }
      board.cards[id] = inst
      list.push(id)
      if (zoneId === 'battlefield' && was?.zone !== 'battlefield') arrivals.push(inst)
    }
  }

  // A new arrival takes the first free spot along its lane, beside what is
  // already there, so nothing lands on top of anything.
  for (const inst of arrivals) {
    const y = snapToLane(inst.lane).y
    const taken = board.zones[inst.controller]?.battlefield
      .map((id) => board.cards[id]).filter((c) => c !== inst && c.zone === 'battlefield') ?? []
    const spot = freeAlong(y, taken)
    inst.x = spot.x; inst.y = spot.y
    inst.z = board.nextZ++
  }
  board.nextZ = Math.max(board.nextZ, ...Object.values(board.cards).map((c) => (c.z ?? 0) + 1))

  // Combat as arrows, from each attacker to what it attacks.
  if (view.combat?.attackers?.length) {
    for (const a of view.combat.attackers) {
      const to = a.attackingTarget?.playerId ?? a.attackingTarget?.permanentId ?? a.attackingTarget?.id ?? view.combat.defendingPlayerId
      board.arrows.push({ id: `attack:${a.creatureId}`, from: a.creatureId, to, kind: 'attack' })
    }
    // And from each blocker to the attacker it blocks, drawn as a block being
    // declared at this table is drawn (Table.jsx). No view carried declared
    // blockers until M4, when the engine's own blocks became a stop of a paced
    // table; the log says each one in words ("… blocked …"), and this is the
    // picture beside it. Read forgivingly: a blocker naming no creature, or no
    // attacker, is left undrawn rather than drawn from nowhere.
    for (const b of Array.isArray(view.combat.blockers) ? view.combat.blockers : []) {
      if (typeof b?.creatureId !== 'string' || typeof b.blockingAttacker !== 'string') continue
      board.arrows.push({ id: `block:${b.creatureId}:${b.blockingAttacker}`, from: b.creatureId, to: b.blockingAttacker, kind: 'target' })
    }
  }
  return board
}

/**
 * What changed between two views, as events the game log already reads:
 * a turn beginning, a step passed, and whatever the engine said happened.
 * `you` is the viewing seat, because the engine phrases its lines for it.
 *
 * A view arrives only where somebody stops, so it says little about when
 * its lines happened; the lines say it themselves. The engine marks each turn
 * in its log, and that mark becomes this table's own turn header rather than
 * a line, with what follows filed under the turn it names. Each line also
 * names the step it happened in (the process adds it), and a line in a new
 * step brings that step's divider with it. So a turn the engine played
 * between two views reads as that turn, its draw in its draw step.
 */
export function eventsBetween(prevView, view, { seq = 0 } = {}) {
  const out = []
  let n = seq
  const turn = view.turnNumber ?? 1
  // The deal's lines carry no mark, so the first view's turn is theirs.
  let at = prevView ? (prevView.turnNumber ?? 1) : turn
  let active = prevView?.activePlayerId ?? view.activePlayerId
  let stepAt = prevView ? stepIdOf(prevView.currentStep) : null
  const began = (t, who) => { at = t; active = who; stepAt = null; out.push({ type: 'turnBegan', seq: ++n, turn: t, active: who, player: who }) }
  const stepped = (to) => { stepAt = to; out.push({ type: 'stepped', seq: ++n, turn: at, to, player: active }) }

  if (!prevView) began(turn, view.activePlayerId)
  const before = prevView?.log?.length ?? 0
  for (const line of (view.log ?? []).slice(before)) {
    if (line?.type === 'turnChanged' && Number.isInteger(line.turnNumber)) {
      if (line.turnNumber !== at) began(line.turnNumber, line.activePlayerId ?? null)
      continue
    }
    if (!line?.description) continue
    if (typeof line.step === 'string' && stepIdOf(line.step) !== stepAt) stepped(stepIdOf(line.step))
    out.push({ type: 'said', seq: ++n, turn: at, text: line.description, player: line.playerId ?? view.activePlayerId, engine: line.type ?? null })
  }
  if (at !== turn) began(turn, view.activePlayerId)
  const step = stepIdOf(view.currentStep)
  if (step !== stepAt) stepped(step)
  return out
}
