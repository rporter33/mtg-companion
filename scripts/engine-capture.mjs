#!/usr/bin/env node
/**
 * Captures a real game off the engine into `tests/fixtures/engine-views.json`,
 * so the adapter's tests run against what the wire actually carries and not
 * against a hand-written idea of it.
 *
 *   bash scripts/engine-build.sh          # once, if there is no engine yet
 *   node scripts/engine-capture.mjs       # ~40 s: the corpus loads, then a game
 *
 * It deals a paced table (engine/README.md, "Pacing, and `continue`") from a
 * fixed seed, plays the human's side with the plainest possible policy, and at
 * every stop — the player's, and each of the engine's own plays — records the
 * view twice: the `delta` since the last one, and, at the moments worth
 * pinning, the whole `state` the engine would have sent instead. That pairing
 * is the point. `tests/engine-delta.test.js` walks the run applying deltas and
 * holds the result against the engine's own full view at each of those
 * moments, so `applyDelta` is checked against Argentum's `StateDiffCalculator`
 * rather than against this app's reading of it.
 *
 * The whole game is played, and then the stretch of it worth keeping is cut
 * out: the earliest window of `--views` stops holding the most of what M2
 * asked for — the engine's turn caught mid-flight, a combat, the offer to
 * block it, windows passed on the player's behalf. Every delta is against the
 * full state of the stop before it, which is what makes a window a fixture on
 * its own.
 *
 * `seats` and `shots` are the first capture's (2026-09-21) and are kept as
 * they are: `tests/engine-board.test.js` holds them to exact life totals,
 * lanes and card ids, and `tests/fixtures/fake-engine.mjs` answers the relay's
 * tests out of them. Pass `--shots` to re-take those too, and expect to rewrite
 * those numbers by hand afterwards.
 *
 * Options: `--seed N`, `--views N` (how many views the window keeps),
 * `--stops N` (how much of the game to play), `--out PATH`, `--shots`.
 *
 * What this capture could not reach, and why (2026-09-22): a view where
 * blockers have been *declared*. Combat resolves between two stops — the
 * engine's blocks are not a play it pauses for, and after the player declares
 * theirs nothing is affordable, so the table runs on to the next turn. What
 * the window holds instead is the attack and the offer to block it, which is
 * what the board has to draw. Nor a `ChooseTargets` decision: the process
 * builds a `CastSpell` with no targets, so Argentum refuses a targeted spell
 * with "No valid targets available" before any decision is raised. That is a
 * gap in `act` (engine/src/main/kotlin/companion/Server.kt fills in
 * `attackers` and `blockers` but not `targets`), not in this capture.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEngine, startEngine } from './engine-bridge.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}
const here = fileURLToPath(new URL('..', import.meta.url))
const asked = flag('out', 'tests/fixtures/engine-views.json')
const OUT = isAbsolute(asked) ? asked : resolve(here, asked)
// A seed makes the game the same on every machine, which is the whole point of
// a fixture: this one was kept because its window holds the engine's turn
// mid-flight and a combat within the first twenty stops.
const SEED = Number(flag('seed', 20260922))
const VIEWS = Number(flag('views', 20))
const STOPS = Number(flag('stops', 120))
const RETAKE_SHOTS = args.includes('--shots')
// Portal goblins on both sides, the deck every other measurement here was
// taken with: creatures to attack and block with, and a burn spell that wants
// a target.
const DECK = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

const command = findEngine()
if (!command) {
  console.error('No engine found. Run scripts/engine-build.sh first, or set ENGINE_CMD.')
  process.exit(2)
}

const engine = startEngine({ command, onStderr: (line) => console.error(`  [engine] ${line}`) })
const hello = await engine.call('hello', {}, { timeoutMs: 120_000 })
if ((hello.protocol ?? 0) < 3) {
  console.error(`This engine speaks protocol ${hello.protocol}: it has no pace and no continue. Rebuild it.`)
  await engine.close()
  process.exit(2)
}

let status = await engine.call('new', {
  players: [
    { name: 'You', deck: DECK, autoPass: true },
    { name: 'Bot', deck: DECK, ai: 'heuristic' },
  ],
  seed: SEED,
  pace: true,
})
if (status.paced !== true) {
  console.error('The engine did not take the pace, so its own turn cannot be caught mid-flight.')
  await engine.close()
  process.exit(2)
}
const seats = status.seats.map((s) => ({ id: s.id, name: s.name, ai: s.ai ?? null, autoPass: s.autoPass ?? null }))
const you = seats[0].id

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
 * What each stop is worth keeping for, the three M2 asked for and combat
 * itself. `blocks` is blockers actually declared on the board; `blockable` is
 * only the offer to declare them, which is a different thing and named
 * differently, so that what the run says it holds is what it holds.
 */
const marks = (entry) => {
  const out = []
  const combat = entry.state?.combat
  if (entry.status.waiting === 'engine') out.push('engine')
  if (entry.status.waiting === 'decision') out.push('decision')
  if ((entry.status.decided ?? []).length) out.push('decided')
  if (combat?.attackers?.length) out.push('combat')
  if (combat?.attackers?.some((a) => (a.blockedBy ?? a.blockers ?? []).length)) out.push('blocks')
  if ((entry.status.actions ?? []).some((a) => a.type === 'DeclareBlockers' && a.meaningful)) out.push('blockable')
  if ((entry.status.autoPassed ?? 0) > 0) out.push('passed')
  return new Set(out)
}

/**
 * The first of these the engine accepts. A refusal is the engine's word that
 * an offer could not be taken after all (a spell with nothing to point at, a
 * cost that cannot be paid), and it leaves the table where it was, so the next
 * one can simply be tried.
 */
const tryEach = async (actions) => {
  for (const a of actions) {
    try { return await engine.call('act', { index: a.index }) } catch (e) {
      if (!e.refused) throw e
      console.error(`  refused: ${a.description} — ${e.message}${a.requiresTargets ? ` (${a.validTargets?.length ?? 0} valid targets offered)` : ''}`)
    }
  }
  throw new Error('Nothing on offer could be taken, not even passing.')
}

let stops = 0
while (!status.over && stops < STOPS) {
  await record()

  if (status.waiting === 'engine') {
    status = await engine.call('continue')
  } else if (status.waiting === 'decision') {
    const d = status.decision
    if (d.type === 'ChooseTargets') {
      status = await engine.call('decide', { targets: Object.fromEntries(d.requirements.map((r) => [r.index, r.legal.slice(0, Math.max(r.min, 1))])) })
    } else if (d.type === 'YesNo') status = await engine.call('decide', { yes: true })
    else if (d.type === 'ChooseOption') status = await engine.call('decide', { option: 0 })
    else status = await engine.call('decide', { auto: true })
  } else if (status.waiting === 'action') {
    const attack = status.actions.find((a) => a.type === 'DeclareAttackers' && a.meaningful)
    const block = status.actions.find((a) => a.type === 'DeclareBlockers' && a.meaningful)
    if (attack) {
      // Everything attacks: the quickest road to a combat the engine blocks.
      const target = attack.validAttackTargets?.[0]
      status = await engine.call('act', { index: attack.index, attackers: Object.fromEntries((attack.validAttackers ?? []).map((id) => [id, target])) })
    } else if (block) {
      // Everything blocks the first attacker, so a view carries blockers.
      const first = block.validAttackers?.[0] ?? status.decision?.attackers?.[0]
      const blockers = first ? Object.fromEntries((block.validBlockers ?? []).map((id) => [id, [first]])) : {}
      status = await engine.call('act', { index: block.index, blockers })
    } else {
      // The plainest player there is: the first thing worth doing, else pass.
      // A spell that wants a target is tried first rather than avoided,
      // because the decision it raises is one of the three things this capture
      // is for — and an offer the engine then refuses ("no valid targets") is
      // taken as a no and the next thing tried, which is what a player would do.
      const worth = (a) => a.meaningful && a.affordable
      const aimed = (a) => a.requiresTargets && (a.validTargets?.length ?? 0) > 0
      status = await tryEach([
        ...status.actions.filter((a) => worth(a) && aimed(a)),
        ...status.actions.filter((a) => worth(a) && !a.requiresTargets),
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
 * the rest follow from it. The window chosen is the earliest one holding the
 * most of what M2 asked for — the engine's turn caught mid-flight, a combat,
 * the offer to block it, a decision — because a whole game of full states
 * would be a megabyte of repetition and most of it is the same land played
 * again.
 */
let best = { from: 0, score: -1, found: new Set() }
for (let from = 0; from + 1 < taken.length; from++) {
  const window = taken.slice(from, from + VIEWS)
  const found = new Set(window.flatMap((e) => [...marks(e)]))
  // Earliest wins a tie: the opening of a game is worth more to a reader than
  // its twentieth land.
  if (found.size > best.score) best = { from, score: found.size, found }
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
    captured: new Date().toISOString().slice(0, 10),
    seed: SEED, protocol: hello.protocol, you, deck: DECK,
    from: best.from, of: taken.length, held: [...best.found].sort(),
    views,
  },
}
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)

console.log(`${stops} stops played; kept ${views.length} of them from ${best.from} (${views.filter((v) => v.state).length} whole), seed ${SEED}`)
console.log(`the window holds: ${[...best.found].sort().join(', ') || 'nothing of note'}`)
console.log(`written to ${OUT} (${Math.round(JSON.stringify(out).length / 1024)} kB)`)
// Every one of the things M2 asked the capture for. `decision` and `blocks`
// are both out of reach today for reasons written at the head of this file, so
// a run that says so is a run saying the gap is still open rather than one
// quietly reporting success with it in.
for (const want of ['engine', 'combat', 'blockable', 'blocks', 'decision']) {
  if (!best.found.has(want)) console.error(`no "${want}" anywhere in this game: try another --seed.`)
}
