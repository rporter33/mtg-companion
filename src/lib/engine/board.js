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
  }
  return board
}

/**
 * What changed between two views, as events the game log already reads:
 * a turn beginning, a step passed, and whatever the engine said happened.
 * `you` is the viewing seat, because the engine phrases its lines for it.
 */
export function eventsBetween(prevView, view, { seq = 0 } = {}) {
  const out = []
  let n = seq
  const turn = view.turnNumber ?? 1
  if (!prevView || prevView.turnNumber !== turn) {
    out.push({ type: 'turnBegan', seq: ++n, turn, active: view.activePlayerId, player: view.activePlayerId })
  }
  const step = stepIdOf(view.currentStep)
  if (!prevView || stepIdOf(prevView.currentStep) !== step || prevView.turnNumber !== turn) {
    out.push({ type: 'stepped', seq: ++n, turn, to: step, player: view.activePlayerId })
  }
  const before = prevView?.log?.length ?? 0
  for (const line of (view.log ?? []).slice(before)) {
    if (!line?.description) continue
    out.push({ type: 'said', seq: ++n, turn, text: line.description, player: line.playerId ?? view.activePlayerId, engine: line.type ?? null })
  }
  return out
}
