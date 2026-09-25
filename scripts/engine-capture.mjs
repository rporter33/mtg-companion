#!/usr/bin/env node
/**
 * Captures a real game off the engine into `tests/fixtures/engine-views.json`,
 * so the adapter's tests run against what the wire actually carries and not
 * against a hand-written idea of it.
 *
 *   bash scripts/engine-build.sh          # once, if there is no engine yet
 *   node scripts/engine-capture.mjs       # ~25 s: the corpus loads, then a game
 *
 * It deals a paced table (engine/README.md, "Pacing, and `continue`") from a
 * fixed seed, with the hands to keep (protocol 6), and plays the person's side
 * with the plainest possible policy: one mulligan taken and the next seven
 * kept, so the window can hold all three of the phase's offers; then the first
 * thing worth doing, its targets the engine first where it is one of them; an
 * attack with everything, a block of the first attacker with everything; and
 * a pass. At every stop — the person's, and each of the engine's own plays —
 * it records the view twice: the `delta` since the last one, and, at the
 * moments worth pinning, the whole `state` the engine would have sent instead.
 * That pairing is the point. `tests/engine-delta.test.js` walks the run
 * applying deltas and holds the result against the engine's own full view at
 * each of those moments, so `applyDelta` is checked against Argentum's
 * `StateDiffCalculator` rather than against this app's reading of it.
 *
 * The whole game is played, and then the stretch of it worth keeping is cut
 * out: the earliest window of `--views` stops holding every mark in `WANTED`,
 * and of those the one holding most of `ALSO`. Every delta is against the full
 * state of the stop before it, which is what makes a window a fixture on its
 * own.
 *
 * `seats` and `shots` are the first capture's (2026-09-21) and are kept as
 * they are: `tests/engine-board.test.js` holds them to exact life totals,
 * lanes and card ids, and `tests/fixtures/fake-engine.mjs` answers the relay's
 * tests out of them. Pass `--shots` to re-take those too, and expect to rewrite
 * those numbers by hand afterwards.
 *
 * Options: `--seed N`, `--views N` (how many views the window keeps),
 * `--stops N` (how much of the game to play), `--mulligans N` (how many the
 * person takes before keeping), `--out PATH`, `--shots`, `--date YYYY-MM-DD`
 * (the day to stamp it with; the local day by default).
 *
 * What it reaches, and how (2026-09-24, M4). M2's capture (2026-09-22) could
 * reach neither declared blockers nor a decision, and said so on every run.
 * Declared blockers were out of reach because the engine's blocks were no stop
 * of a paced table: the process matched the engine's filled-in choice to the
 * bare offer by equality, which a declaration with blockers in it never equals,
 * so no view was sent between the engine's blocks and the damage. Matched by
 * what it is (`worthWatching` in Server.kt), a block is a stop, and the view
 * there carries it. A decision was out of reach of the table: `act`
 * sent no targets, so Argentum refused a targeted spell before asking. Since
 * protocol 5 a spell's targets go with its cast, so casting Volcanic Hammer
 * raises no decision either — which is why the deck now holds Sparkmage
 * Apprentice, whose arrival asks its controller for a target: the one decision
 * a person is put that this deck can raise (the same card the engine's
 * browser spec aims). A run that reaches any of `WANTED` nowhere says so on
 * the way out, rather than reporting success with the gap in.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEngine, startEngine } from './engine-bridge.mjs'
import { ANSWERS } from '../src/lib/engine/choose.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}
const here = fileURLToPath(new URL('..', import.meta.url))
const asked = flag('out', 'tests/fixtures/engine-views.json')
const OUT = isAbsolute(asked) ? asked : resolve(here, asked)
// A seed makes the game the same on every machine, which is the whole point of
// a fixture. This one was kept (2026-09-24) because a window from the deal
// holds every mark in WANTED and both of the opening hand's, in 27 stops: of
// 37 seeds tried from 20260924, the shortest such window by six.
const SEED = Number(flag('seed', 20260941))
const VIEWS = Number(flag('views', 30))
const STOPS = Number(flag('stops', 160))
const MULLIGANS = Number(flag('mulligans', 1))
const RETAKE_SHOTS = args.includes('--shots')
// The day the capture was taken, as the calendar on this machine has it, which
// is the day the write-ups date it by. The ISO string is the UTC day: a
// capture taken in the evening west of Greenwich was stamped with tomorrow's
// (found in M4's review: 2026-09-25 on a run of 2026-09-24). `--date` names it.
const today = new Date()
const CAPTURED = flag('date', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
// Portal goblins on both sides, the deck every other measurement here was
// taken with — creatures to attack and block with, and a burn spell that wants
// a target — with Sparkmage Apprentice in place of two Goblin Bullies and two
// Hulking Goblins, for the decision its arrival raises (above).
const DECK = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 2, 'Hulking Goblin': 2, 'Sparkmage Apprentice': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

/**
 * What the window must hold, each for a test that reads it: the engine's turn
 * caught mid-flight, a combat, the offer to block it and blockers declared on
 * the board (M2's brief), a decision put to the person, windows passed on the
 * person's behalf (`tests/engine-room.test.jsx`), and a stop made for a spell
 * that needs a target and nothing else (`tests/engine-glow.test.js` and
 * `tests/engine-prompt.test.jsx` hold what a seat that cannot aim says there).
 */
const WANTED = ['engine', 'combat', 'blockable', 'blocks', 'decision', 'passed', 'aimed only']
/** Worth holding where the window can: the opening hand's offers, and a decision answered for the person. */
const ALSO = ['mulligan', 'bottom', 'decided']

const command = findEngine()
if (!command) {
  console.error('No engine found. Run scripts/engine-build.sh first, or set ENGINE_CMD.')
  process.exit(2)
}

const engine = startEngine({ command, onStderr: (line) => console.error(`  [engine] ${line}`) })
const hello = await engine.call('hello', {}, { timeoutMs: 120_000 })
// The pace came with protocol 3, a play's targets with 5, the hands to keep with 6.
if ((hello.protocol ?? 0) < 6) {
  console.error(`This engine speaks protocol ${hello.protocol}: it cannot deal the hands to keep, nor take a play's targets. Rebuild it.`)
  await engine.close()
  process.exit(2)
}

let status = await engine.call('new', {
  players: [
    // The person's seat as this app's own client sits it: every decision it can show.
    { name: 'You', deck: DECK, autoPass: true, answers: ANSWERS },
    { name: 'Bot', deck: DECK, ai: 'heuristic' },
  ],
  seed: SEED,
  pace: true,
  mulligans: true,
})
if (status.paced !== true || status.mulligans !== true) {
  console.error('The engine did not take the pace or the hands to keep, so the capture cannot hold what it is for.')
  await engine.close()
  process.exit(2)
}
const seats = status.seats.map((s) => ({ id: s.id, name: s.name, ai: s.ai ?? null, autoPass: s.autoPass ?? null }))
const you = seats[0].id
const them = seats[1].id

const taken = []

/**
 * One stop, taken down whole and in part.
 *
 * The delta is asked for first and the full state after it, because a full
 * view is what the engine diffs the next delta against: asked the other way
 * round, every delta would be empty. Asked in this order the run is a chain
 * that can be cut anywhere — the delta at each stop is against the full state
 * of the one before it — which is what lets the window below be chosen after
 * the game rather than guessed at before it.
 */
const record = async () => {
  const d = await engine.call('view', { viewer: you, delta: true })
  const full = d.state ? d : await engine.call('view', { viewer: you })
  const { seats: _seats, seed: _seed, ok: _ok, ...stopped } = status
  taken.push({
    at: taken.length,
    status: stopped,
    delta: d.delta ?? null,
    log: d.log ?? [],
    state: full.state ?? null,
    fullLog: full.log ?? [],
  })
}

/**
 * What each stop is worth keeping for. `blocks` is blockers actually declared
 * on the board; `blockable` is only the offer to declare them, which is a
 * different thing and named differently, so that what the run says it holds
 * is what it holds. `aimed only` is a stop of the person's made for plays that
 * all need a target; `decided`, a decision the engine answered for the person.
 */
const OPENING = ['KeepHand', 'TakeMulligan']
const marks = (entry) => {
  const out = []
  const combat = entry.state?.combat
  const actions = entry.status.actions ?? []
  const worth = actions.filter((a) => a.meaningful && a.affordable && !a.mana)
  if (entry.status.waiting === 'engine') out.push('engine')
  if (entry.status.waiting === 'decision') out.push('decision')
  if ((entry.status.decided ?? []).length) out.push('decided')
  if (combat?.attackers?.length) out.push('combat')
  if (combat?.attackers?.some((a) => (a.blockedBy ?? []).length)) out.push('blocks')
  if (actions.some((a) => a.type === 'DeclareBlockers' && a.meaningful)) out.push('blockable')
  if ((entry.status.autoPassed ?? 0) > 0) out.push('passed')
  if (worth.length && worth.every((a) => a.requiresTargets)) out.push('aimed only')
  if (actions.some((a) => OPENING.includes(a.type))) out.push('mulligan')
  if (actions.some((a) => a.type === 'BottomCards')) out.push('bottom')
  return new Set(out)
}

/** The legal ids with the engine's own seat first, where it is one: the plainest aim there is. */
const aimAt = (legal) => [...(legal ?? [])].sort((a, b) => Number(b === them) - Number(a === them))

/**
 * What the plainest person chooses for a play: its targets, requirement by
 * requirement, the engine first; the most X it can pay; the first cards its
 * cost can take. A division of damage is left to the engine (`auto`).
 */
const chosenFor = (offer) => {
  if (offer.divide) return { auto: true }
  const out = {}
  const reqs = Array.isArray(offer.targetRequirements) ? offer.targetRequirements : []
  if (reqs.length) out.targets = Object.fromEntries(reqs.map((r) => [r.index, aimAt(r.legal).slice(0, Math.max(r.min, 1))]))
  if (offer.x) out.x = offer.x.max
  if (offer.costChoice) out.cost = offer.costChoice.candidates.slice(0, offer.costChoice.min || offer.costChoice.max)
  return out
}

/**
 * The first of these the engine accepts. A refusal is the engine's word that
 * an offer could not be taken after all, and it leaves the table where it
 * was, so the next one can simply be tried.
 */
const tryEach = async (actions) => {
  for (const a of actions) {
    try { return await engine.call('act', { index: a.index, ...chosenFor(a) }) } catch (e) {
      if (!e.refused) throw e
      console.error(`  refused: ${a.description} — ${e.message}`)
    }
  }
  throw new Error('Nothing on offer could be taken, not even passing.')
}

let stops = 0
let mulliganed = 0
while (!status.over && stops < STOPS) {
  await record()

  if (status.waiting === 'engine') {
    status = await engine.call('continue')
  } else if (status.waiting === 'decision') {
    const d = status.decision
    if (d.type === 'ChooseTargets') {
      status = await engine.call('decide', { targets: Object.fromEntries(d.requirements.map((r) => [r.index, aimAt(r.legal).slice(0, Math.max(r.min, 1))])) })
    } else if (d.type === 'YesNo') status = await engine.call('decide', { yes: true })
    else if (d.type === 'ChooseOption') status = await engine.call('decide', { option: 0 })
    else status = await engine.call('decide', { auto: true })
  } else if (status.waiting === 'action') {
    const find = (type) => status.actions.find((a) => a.type === type)
    const attack = status.actions.find((a) => a.type === 'DeclareAttackers' && a.meaningful)
    const block = status.actions.find((a) => a.type === 'DeclareBlockers' && a.meaningful)
    if (find('KeepHand')) {
      // The opening hand: sent back as many times as asked, then kept.
      const again = mulliganed < MULLIGANS ? find('TakeMulligan') : null
      if (again) mulliganed++
      status = await engine.call('act', { index: (again ?? find('KeepHand')).index })
    } else if (find('BottomCards')) {
      const offer = find('BottomCards')
      status = await engine.call('act', { index: offer.index, cards: offer.candidates.slice(0, offer.bottom) })
    } else if (attack) {
      // Everything attacks: the quickest road to a combat the engine blocks.
      const target = attack.validAttackTargets?.[0]
      status = await engine.call('act', { index: attack.index, attackers: Object.fromEntries((attack.validAttackers ?? []).map((id) => [id, target])) })
    } else if (block) {
      // Everything blocks the first attacker.
      const first = block.validAttackers?.[0] ?? status.decision?.attackers?.[0]
      const blockers = first ? Object.fromEntries((block.validBlockers ?? []).map((id) => [id, [first]])) : {}
      status = await engine.call('act', { index: block.index, blockers })
    } else {
      // The first thing worth doing, its choices made plainly, else a pass.
      status = await tryEach([
        ...status.actions.filter((a) => a.meaningful && a.affordable && !a.mana),
        ...status.actions.filter((a) => a.type === 'PassPriority'),
      ])
    }
  } else {
    status = await engine.call('turn')
  }
  stops++
}
// The last word: wherever the run ended, so the deltas have something to be
// held to at the far end.
await record()
await engine.close()

/**
 * The stretch worth keeping.
 *
 * Every delta is against the full state of the stop before it, so any window
 * of the run is a fixture on its own: the first stop in it is kept whole and
 * the rest follow from it. The window chosen holds every mark in WANTED if any
 * window of this length does, then as many of ALSO as it can, and of those the
 * earliest — the opening of a game is worth more to a reader than its
 * twentieth land, and a whole game of full states would be a megabyte of
 * repetition.
 */
let best = { from: 0, score: -1, found: new Set() }
for (let from = 0; from + 1 < taken.length; from++) {
  const window = taken.slice(from, from + VIEWS)
  const found = new Set(window.flatMap((e) => [...marks(e)]))
  const score = WANTED.filter((m) => found.has(m)).length * 100 + ALSO.filter((m) => found.has(m)).length
  if (score > best.score) best = { from, score, found }
}
const window = taken.slice(best.from, best.from + VIEWS)
const wholeAt = new Set([0, window.length - 1])
// A whole state beside the delta the first time each thing happens, which is
// what the adapter's test holds the applied deltas to.
const already = new Set()
window.forEach((e, i) => {
  for (const mark of marks(e)) if (!already.has(mark)) { already.add(mark); wholeAt.add(i) }
})
const views = window.map((e, i) => {
  const why = i === 0 ? 'first' : i === window.length - 1 ? 'last' : [...marks(e)].join(' ') || null
  const kept = { at: i, why, status: e.status }
  // The window's first view is the table whole; a delta there would be against
  // a stop that is not in the fixture.
  if (i > 0) { kept.delta = e.delta; kept.log = e.log }
  if (wholeAt.has(i)) { kept.state = e.state; kept.fullLog = e.fullLog }
  return kept
})

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const out = {
  seats: RETAKE_SHOTS || !existing.shots ? seats : existing.seats ?? seats,
  // Kept from the first capture unless asked for: the tests hold them to
  // exact numbers, and the fake engine answers the relay's tests out of them.
  shots: RETAKE_SHOTS || !existing.shots
    ? views.filter((v) => v.state && v.status.waiting === 'action').slice(0, 2).map((v) => ({ at: v.at, status: v.status, view: v.state }))
    : existing.shots,
  run: {
    captured: CAPTURED,
    seed: SEED, protocol: hello.protocol, you, deck: DECK, mulligans: MULLIGANS,
    from: best.from, of: taken.length, held: [...best.found].sort(),
    views,
  },
}
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)

console.log(`${stops} stops played; kept ${views.length} of them from ${best.from} (${views.filter((v) => v.state).length} whole), seed ${SEED}`)
console.log(`the window holds: ${[...best.found].sort().join(', ') || 'nothing of note'}`)
console.log(`written to ${OUT} (${Math.round(JSON.stringify(out).length / 1024)} kB)`)
// Every one of the things the window is for. A run that says so is a run
// saying the gap is open rather than one quietly reporting success with it in.
for (const want of WANTED) {
  if (!best.found.has(want)) console.error(`no "${want}" in any window of ${VIEWS} stops of this game: try another --seed, or a longer --views.`)
}
