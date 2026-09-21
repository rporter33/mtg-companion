#!/usr/bin/env node
// Plays one game through the engine process from the command line and prints
// what the wire carried: a smoke test for scripts/engine-build.sh, and the
// quickest way to see the protocol in engine/README.md do something.
//
//   ENGINE_CMD=../argentum/companion/build/install/companion/bin/companion node scripts/engine-play.mjs
import { findEngine, startEngine } from './engine-bridge.mjs'

const command = findEngine()
if (!command) {
  console.error('No engine found. Run scripts/engine-build.sh first, or set ENGINE_CMD.')
  process.exit(2)
}

const spawned = Date.now()
const engine = startEngine({ command, onStderr: (line) => console.error(`  [engine] ${line}`) })
// Portal goblins: creatures to attack with and a burn spell that needs a target,
// the same deck the first measurements were taken with, so the figures compare.
const deck = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

// The first answer waits on the whole corpus loading, so it gets the long allowance.
const hello = await engine.call('hello', {}, { timeoutMs: 120_000 })
const firstAnswer = Date.now() - spawned
const sets = Array.isArray(hello.sets) ? hello.sets : []
console.log(`engine ${hello.engine}, protocol ${hello.protocol}, ${hello.cards} cards a deck may hold, ${sets.length} sets (${sets.filter((s) => s.incomplete).length} marked incomplete)`)
if (hello.load) console.log(`first answer ${firstAnswer} ms after starting; the corpus loaded in ${hello.load.ms} ms and holds ${hello.load.heapMb} MB of a ${hello.load.maxHeapMb} MB ceiling`)

let status = await engine.call('new', {
  players: [
    { name: 'You', deck, autoPass: true },
    { name: 'Bot', deck, ai: 'heuristic' },
  ],
})
console.log(`seats: ${status.seats.map((s) => `${s.name} (${s.id}${s.ai ? `, ${s.ai}` : ''})`).join(', ')}`)
const you = status.seats[0].id

let stops = 0
let passedFor = 0
let bytes = { full: 0, deltas: [] }
const t0 = Date.now()
while (!status.over && stops < 400) {
  passedFor += status.autoPassed
  if (status.decided.length) console.log(`  decided for you: ${status.decided.map((d) => `${d.type} (${d.prompt})`).join('; ')}`)
  const view = await engine.call('view', { viewer: you, delta: stops > 0 })
  const size = JSON.stringify(view.state ?? view.delta).length
  if (view.state) bytes.full = size; else bytes.deltas.push(size)

  if (status.waiting === 'decision') {
    const d = status.decision
    console.log(`  turn ${status.turn} ${status.step}: decision ${d.type} — ${d.prompt}`)
    if (d.type === 'ChooseTargets') {
      const targets = Object.fromEntries(d.requirements.map((r) => [r.index, r.legal.slice(0, Math.max(r.min, 1))]))
      status = await engine.call('decide', { targets })
    } else if (d.type === 'YesNo') status = await engine.call('decide', { yes: true })
    else if (d.type === 'ChooseOption') status = await engine.call('decide', { option: 0 })
    else status = await engine.call('decide', { auto: true })
  } else if (status.waiting === 'action') {
    // The plainest possible player: the first affordable thing that is not
    // passing, else pass. It is enough to see lands hit the table and
    // creatures attack.
    const pick = status.actions.find((a) => a.meaningful && a.affordable && !a.requiresTargets)
      ?? status.actions.find((a) => a.type === 'PassPriority')
    console.log(`  turn ${status.turn} ${status.step}: ${status.actions.length} actions on offer → ${pick.description}`)
    status = await engine.call('act', { index: pick.index })
  } else {
    status = await engine.call('turn')
  }
  stops++
}
const ms = Date.now() - t0
console.log(`\n${status.over ? `game over, winner ${status.winner ?? 'nobody'}` : 'stopped'} after ${stops} stops in ${ms} ms`)
console.log(`passed for you at ${passedFor} windows with nothing affordable (Law 1)`)
const med = (xs) => xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0
console.log(`view: full ${bytes.full} B, deltas median ${med(bytes.deltas)} B over ${bytes.deltas.length}`)
await engine.close()
