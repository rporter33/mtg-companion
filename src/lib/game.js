// Play companion state.
//
// Modelled as an event log rather than as mutable totals: every change appends
// an entry, and life is derived by folding the log. Undo is then just dropping
// the last entry, and "how did I get to 3 life" is answerable — which is the
// thing people actually argue about at a table.

import { getFormat } from './formats.js'

/*
 * The counters a player can have, as opposed to the ones a card can have.
 *
 * One list, shared by the play companion and the table, so the two screens
 * never disagree about what a player can be keeping track of. Poison is the
 * only one that ends a game, which is why it is the only one with a number
 * against it.
 */
export const COUNTER_TYPES = [
  { id: 'poison', label: 'Poison', max: 10, lethal: 10, hint: 'Ten poison counters and you lose.' },
  { id: 'energy', label: 'Energy', max: null },
  { id: 'experience', label: 'Experience', max: null },
  { id: 'rad', label: 'Rad', max: null },
  { id: 'storm', label: 'Storm', max: null, hint: 'How many spells have been cast this turn.' },
  { id: 'ticket', label: 'Ticket', max: null },
  { id: 'speed', label: 'Speed', max: 4, hint: 'Start your engines: speed goes up to four and never comes down.' },
]

const PLAYER_COLORS = ['U', 'R', 'G', 'W', 'B', 'C']

export function createGame({ formatId = 'commander', playerCount = 4, names = [] } = {}) {
  const format = getFormat(formatId)
  const startingLife = format?.startingLife ?? 20

  return {
    id: `game_${Date.now().toString(36)}`,
    formatId,
    startingLife,
    commanderDamageThreshold: format?.commanderDamage || null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    turn: 1,
    activePlayer: 0,
    phase: 0,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: i,
      name: names[i] ?? `Player ${i + 1}`,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      conceded: false,
    })),
    log: [],
  }
}

export const PHASES = [
  { id: 'untap', label: 'Untap', term: 'untapStep' },
  { id: 'upkeep', label: 'Upkeep', term: 'upkeep' },
  { id: 'draw', label: 'Draw', term: 'drawStep' },
  { id: 'main1', label: 'Main 1', term: 'mainPhase' },
  { id: 'combat', label: 'Combat', term: 'combat' },
  { id: 'main2', label: 'Main 2', term: 'mainPhase' },
  { id: 'end', label: 'End', term: 'endStep' },
]

// --- log entries ----------------------------------------------------------

export function logLife(game, playerId, delta) {
  return append(game, { kind: 'life', playerId, delta })
}

export function logCommanderDamage(game, playerId, sourceId, delta) {
  // Commander damage is also life loss. Recording it as one entry keeps the two
  // from drifting apart, which is the classic way this gets miscounted in paper.
  return append(game, { kind: 'commanderDamage', playerId, sourceId, delta })
}

export function logCounter(game, playerId, counter, delta) {
  return append(game, { kind: 'counter', playerId, counter, delta })
}

export function logConcede(game, playerId) {
  return append(game, { kind: 'concede', playerId })
}

function append(game, entry) {
  return {
    ...game,
    log: [...game.log, { ...entry, at: Date.now(), turn: game.turn, seq: game.log.length }],
  }
}

export function undo(game) {
  if (!game.log.length) return game
  return { ...game, log: game.log.slice(0, -1) }
}

// --- derived state --------------------------------------------------------

/** Folds the log into current totals. The log is the truth; this is a view. */
export function deriveState(game) {
  const players = game.players.map((player) => ({
    ...player,
    life: game.startingLife,
    counters: {},
    commanderDamage: {},
    conceded: false,
  }))

  for (const entry of game.log) {
    const player = players[entry.playerId]
    if (!player) continue
    switch (entry.kind) {
      case 'life':
        player.life += entry.delta
        break
      case 'commanderDamage':
        player.life -= entry.delta
        player.commanderDamage[entry.sourceId] =
          (player.commanderDamage[entry.sourceId] ?? 0) + entry.delta
        break
      case 'counter':
        player.counters[entry.counter] = Math.max(0, (player.counters[entry.counter] ?? 0) + entry.delta)
        break
      case 'concede':
        player.conceded = true
        break
      default:
        break
    }
  }

  for (const player of players) {
    player.out = loseReason(player, game)
  }
  return players
}

/** Why this player has lost, or null. Mirrors the actual loss conditions. */
export function loseReason(player, game) {
  if (player.conceded) return 'Conceded'
  if (player.life <= 0) return 'At 0 life'
  if ((player.counters.poison ?? 0) >= 10) return '10 poison counters'
  if (game.commanderDamageThreshold) {
    const worst = Math.max(0, ...Object.values(player.commanderDamage))
    if (worst >= game.commanderDamageThreshold) {
      return `${game.commanderDamageThreshold} commander damage`
    }
  }
  return null
}

export function advanceTurn(game) {
  const alive = deriveState(game).filter((p) => !p.out)
  if (alive.length <= 1) return game

  // Skip players who are out when passing the turn.
  let next = game.activePlayer
  for (let i = 0; i < game.players.length; i++) {
    next = (next + 1) % game.players.length
    if (alive.some((p) => p.id === next)) break
  }
  const wrapped = next <= game.activePlayer
  return { ...game, activePlayer: next, phase: 0, turn: wrapped ? game.turn + 1 : game.turn }
}

export function setPhase(game, phase) {
  return { ...game, phase: Math.max(0, Math.min(PHASES.length - 1, phase)) }
}

export function nextPhase(game) {
  if (game.phase >= PHASES.length - 1) return advanceTurn(game)
  return setPhase(game, game.phase + 1)
}

export function renamePlayer(game, playerId, name) {
  return {
    ...game,
    players: game.players.map((p) => (p.id === playerId ? { ...p, name } : p)),
  }
}

/** A readable history for the log panel, most recent first. */
export function describeLog(game) {
  const name = (id) => game.players[id]?.name ?? `Player ${id + 1}`
  return [...game.log].reverse().map((entry) => {
    switch (entry.kind) {
      case 'life':
        return { ...entry, text: `${name(entry.playerId)} ${entry.delta > 0 ? 'gained' : 'lost'} ${Math.abs(entry.delta)} life` }
      case 'commanderDamage':
        return { ...entry, text: `${name(entry.playerId)} took ${entry.delta} commander damage from ${name(entry.sourceId)}` }
      case 'counter':
        return { ...entry, text: `${name(entry.playerId)} ${entry.delta > 0 ? 'gained' : 'lost'} ${Math.abs(entry.delta)} ${entry.counter}` }
      case 'concede':
        return { ...entry, text: `${name(entry.playerId)} conceded` }
      default:
        return { ...entry, text: 'Unknown event' }
    }
  })
}

export function gameIsOver(game) {
  const alive = deriveState(game).filter((p) => !p.out)
  return alive.length <= 1 && game.players.length > 1
}

export function winnerOf(game) {
  const alive = deriveState(game).filter((p) => !p.out)
  return alive.length === 1 ? alive[0] : null
}
