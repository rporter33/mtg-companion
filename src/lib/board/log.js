/**
 * The game log: what happened, in order, in words.
 *
 * The table already emits an event for everything it does. What it has never
 * had is a way to read them back, and at a real table you do not need one —
 * you were there, and the cards in front of you are the record. On a screen
 * they are not: a card moves, an animation ends, and thirty seconds later you
 * cannot remember whether you drew that land or played it.
 *
 * Two things make a log readable rather than a wall of lines, and both are
 * borrowed from Moxgate (`docs/MOXGATE_STUDY.md`):
 *
 * - It is grouped by turn, newest first, so the shape of the game is visible
 *   before any of the detail is.
 * - The steps nobody did anything in are collapsed into one quiet line —
 *   `untap → upkeep` — rather than each getting an entry of its own. The log
 *   then says where the game went as well as what was done in it, which is
 *   the part a player loses track of.
 *
 * This knows nothing about what cards do. It reads zones and names, which is
 * all the board holds, so it works for any card ever printed.
 */
import { ZONE_LABELS } from './model.js'
import { FIRST_STEP } from '../../data/turn-structure.js'

/** Events that are bookkeeping rather than anything a player would recount. */
const SILENT = new Set(['slid', 'noted', 'turnSet', 'reprinted', 'arrowDrawn', 'arrowRemoved', 'arrowsCleared'])

/**
 * Where a card went, said the way a player would say it.
 *
 * Deliberately physical: "put onto the battlefield", never "cast". Casting is
 * a rules concept and this table does not have one — a card on the stack got
 * there because somebody moved it there.
 */
function movement(from, to) {
  if (to === 'battlefield') return from === 'stack' ? 'resolved {card} onto the battlefield' : 'put {card} onto the battlefield'
  if (to === 'stack') return 'put {card} on the stack'
  if (to === 'graveyard') return from === 'stack' ? 'resolved {card} into the graveyard' : 'put {card} into the graveyard'
  if (to === 'exile') return 'exiled {card}'
  if (to === 'hand') return from === 'library' ? 'drew {card}' : 'returned {card} to hand'
  if (to === 'library') return 'put {card} into the library'
  if (to === 'command') return 'moved {card} to the command zone'
  return `moved {card} to the ${ZONE_LABELS[to] ?? to}`
}

/** One event as a sentence, or null for the ones not worth a line. */
function phrase(event, name) {
  const card = name ?? 'a card'
  switch (event.type) {
    // A line the engine wrote, already phrased for the viewer: it is said as it came.
    case 'said': return event.text
    case 'seated': return `sat down with ${event.count} cards`
    case 'drew': return `drew ${card}`
    case 'moved': return movement(event.from, event.to).replace('{card}', card)
    case 'tapped': return `tapped ${card}`
    case 'untapped': return `untapped ${card}`
    case 'untappedAll': return event.count ? `untapped everything — ${event.count} card${event.count === 1 ? '' : 's'}` : 'untapped everything'
    case 'turnedDown': return `turned ${card} face down`
    case 'turnedUp': return `turned ${card} face up`
    case 'finished': return `changed ${card} to ${event.value}`
    case 'countered': return event.value
      ? `${card} now has ${event.value} ${event.name}`
      : `took the last ${event.name} counter off ${card}`
    case 'playerCountered': return event.value ? `now has ${event.value} ${event.name}` : `has no ${event.name} left`
    case 'life': return `went to ${event.value} life`
    case 'shuffled': return `shuffled the ${ZONE_LABELS[event.zone] ?? event.zone}`
    case 'fromTop': return `looked at ${event.count} from the top`
    case 'revealed': return `revealed ${card}`
    case 'hidden': return `hid ${card} again`
    case 'tokenMade': return `made a ${card} token`
    case 'tokenGone': return `the ${card} token is gone`
    case 'attached': return `attached ${card}`
    case 'detached': return `unattached ${card}`
    case 'rolled': return `rolled ${event.value} on a d${event.sides}${event.label ? ` for ${event.label}` : ''}`
    case 'tidied': return `tidied the battlefield`
    case 'guided': return event.value ? 'turned the playmat on' : 'turned the playmat off'
    case 'libraryEmpty': return 'has nothing left to draw'
    default: return null
  }
}

/**
 * The subject of the sentence. Only the seat you are sitting in is "You";
 * at a shared table the other seats are called by name, given a `who` that
 * knows them, and by their seat id otherwise.
 */
const speaker = (player, you, who = null) => (player === you ? 'You' : (player ? (who?.(player) ?? player) : 'Someone'))

/**
 * Reads the events back as turns.
 *
 * Newest first, because the thing you want is nearly always the last thing
 * that happened. Within a turn the entries stay in the order they occurred,
 * because a turn read backwards is nonsense.
 *
 * Returns `[{ turn, active, items }]` where an item is one of:
 *
 * - `{ kind: 'step', step, passed }` — a divider for the step the entries
 *   under it happened in, with `passed` the steps gone through since the
 *   last divider with nothing done in them, to be listed faintly beneath;
 * - `{ kind: 'entry', text, cardId, who, hidden }` — something done;
 * - `{ kind: 'passed', steps }` — steps gone through with nothing after them
 *   yet: the quiet end of a turn, or where the game is right now.
 *
 * `hidden` marks an entry about a card the viewer is not entitled to see —
 * another seat drawing, or moving a card between their hand and library.
 * The board holds every card, so the name is known; the log declines to say
 * it, and the screen shows the line greyed with no thumbnail. The log never
 * pretends to know what it could not see across a real table.
 */
export function readLog(events = [], board = null, { you = 'you', who = null } = {}) {
  const cards = board?.cards ?? {}
  const revealed = new Set(board?.revealed ?? [])
  const turns = []
  let current = null

  const settle = (group) => {
    if (group?.pending.length) group.items.push({ kind: 'passed', steps: group.pending })
    if (group) group.pending = []
  }

  const open = (turn, active) => {
    if (current && current.turn === turn) return current
    settle(current)
    current = { turn, active, items: [], step: FIRST_STEP, pending: [], divided: null }
    turns.push(current)
    return current
  }

  for (const event of events) {
    if (SILENT.has(event.type)) continue
    const turn = event.turn ?? current?.turn ?? 1
    const inst = event.instanceId ? cards[event.instanceId] : null
    const player = event.player ?? inst?.owner ?? current?.active ?? you
    const group = open(turn, event.type === 'turnBegan' ? event.active : (current?.active ?? player))

    if (event.type === 'turnBegan') {
      group.active = event.active
      continue
    }

    if (event.type === 'stepped') {
      group.step = event.to
      group.pending.push(event.to)
      continue
    }

    // The card's name is filled in later by `readLogNamed`: `event.name` on a
    // counter event is the counter's name, not a card's.
    const said = phrase(event, null)
    if (!said) continue
    // Something happened here: the step gets its divider, carrying whatever
    // was passed through to reach it. Not for a turn's opening step when
    // nothing was passed to reach it — the turn header already says where
    // the turn began, and "your untap" above the deal would be noise.
    const opening = group.divided === null && group.step === FIRST_STEP && !group.pending.length
    if (group.divided !== group.step && !opening) {
      group.items.push({ kind: 'step', step: group.step, passed: group.pending.filter((id) => id !== group.step) })
      group.divided = group.step
      group.pending = []
    }
    group.items.push({
      kind: 'entry',
      who: event.type === 'said' ? null : speaker(player, you, who),
      text: said,
      cardId: inst?.cardId ?? null,
      instanceId: event.instanceId ?? null,
      seq: event.seq,
      hidden: isHidden(event, player, you, inst, revealed),
    })
  }
  settle(current)

  for (const group of turns) { delete group.step; delete group.pending; delete group.divided }
  return turns.reverse()
}

/**
 * Whether an entry is about something the viewer could not have seen: a
 * card another seat drew, or moved between their hand and their library.
 * Their battlefield, graveyard and exile are public, as is anything they
 * chose to reveal.
 */
const PRIVATE = new Set(['hand', 'library'])
function isHidden(event, player, you, inst, revealed) {
  if (player === you) return false
  if (inst && revealed.has(inst.id)) return false
  if (event.type === 'drew') return true
  if (event.type === 'moved') return PRIVATE.has(event.from) && PRIVATE.has(event.to)
  return false
}

/**
 * The same, with card names filled in.
 *
 * Names live in the Scryfall cache rather than on the board, so they arrive
 * separately and later. Splitting it this way keeps `readLog` testable
 * without any card data at all.
 */
export function readLogNamed(events, board, nameFor, options) {
  const turns = readLog(events, board, options)
  if (!nameFor) return turns
  const cards = board?.cards ?? {}
  for (const turn of turns) {
    for (const item of turn.items) {
      // A hidden card stays "a card": the name is known here and withheld.
      if (item.kind !== 'entry' || !item.instanceId || item.hidden) continue
      const name = nameFor(cards[item.instanceId]?.cardId)
      if (name) item.text = item.text.replace('a card', name)
    }
  }
  return turns
}
