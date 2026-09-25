#!/usr/bin/env node
/**
 * Measures the engine's levels against each other, through the process itself
 * (HANDOFF.md, M3; the numbers are in PLAN.md, "M3: easy, intermediate, hard").
 *
 *   bash scripts/engine-build.sh                                  # once, if there is no engine yet
 *   node scripts/engine-levels.mjs                                # every pairing, both decks
 *   node scripts/engine-levels.mjs --match easy:hard --pairs 10   # one pairing
 *   node scripts/engine-levels.mjs --match profile:v0:profile:production --decks boros
 *
 * Both seats are the engine's own, so a whole game is played inside one `new`
 * and nobody waits on a pace. Each game is played twice from the same seed,
 * the second time with the two players' seats swapped, so a good deal or going
 * first is had by both: that is a pair, and a pair is what is counted, the way
 * Argentum's own arena counts (docs/ai/measurement.md upstream). A pair scores
 * 1, ½ or 0 for the second player named; the share and its 95% interval are
 * over pairs. A game that the engine gave up on (its 10,000-step guard) or that
 * ended in a draw is half a win each, and said.
 *
 * After every game the process is asked for its `clock`: how long each seat
 * took over every choice it made. The medians and 90th percentiles below are
 * over the choices where there was something to choose between — an
 * affordable play the engine calls worth making, or a decision — because most
 * windows offer only a pass and would bury the rest. They are wall-clock time
 * on this machine, and with `--workers` above one the processes share it, so
 * timing is measured with one worker (`--workers 1`, the default) and strength
 * may be measured with more.
 *
 * With `--watch N` it measures something else instead: what a person waits
 * for. N games per level per deck of a person's seat — played by the plainest
 * player there is, the first worthwhile thing needing no target, else a pass —
 * against the engine at that level, on a paced table as the relay deals one.
 * Timed at the wire, from the request to the reply: each `continue`, which is
 * the engine making its next play while the plate says it is thinking (the
 * room's pace comes on top), and each `act`, which is the player's own play and
 * everything the engine does before the table next stops.
 *
 * Options:
 *   --watch N         the person's-seat measurement above, N games a level a deck.
 *   --match A:B       a pairing; repeat for several. An agent is a level word
 *                     (easy, intermediate, hard) or profile:<Argentum id>.
 *                     Default: easy:intermediate, intermediate:hard, easy:hard.
 *   --decks a,b       goblins (Portal, every measurement here so far) and/or
 *                     boros (a Bloomburrow deck put together for this). Default both.
 *   --pairs N         pairs per pairing per deck (default 10).
 *   --seed N          the first seed; pair i plays seed + i (default 20260924).
 *   --workers N       engine processes at once (default 1).
 *   --out PATH        where the raw results go (default: the system's temp folder).
 *   --from PATH       summarise a saved run instead of playing; repeat to put
 *                     runs over different seeds together.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { findEngine, startEngine } from './engine-bridge.mjs'

const args = process.argv.slice(2)
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []))
const flag = (name, fallback) => all(name).at(-1) ?? fallback

const DECKS = {
  // Portal goblins: the deck every other measurement here was taken with.
  goblins: { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 },
  // A sixty-card Boros deck of Bloomburrow cards, put together for this
  // measurement by this app (it is nobody's published list): one- and two-drops,
  // tricks, and removal that needs a target, so the levels have choices to
  // differ over. Bloomburrow because it is the set Argentum's own arena
  // measures its profiles on, and the one its card advisors know.
  boros: {
    Plains: 11, Mountain: 11,
    'Heartfire Hero': 4, 'Seasoned Warrenguard': 4, 'Brightblade Stoat': 4, 'Nettle Guard': 4,
    'Flamecache Gecko': 4, 'Steampath Charger': 2, 'Intrepid Rabbit': 4,
    'Might of the Meek': 4, 'Rabid Gnaw': 4, 'Sonar Strike': 2, 'Agate Assault': 2,
  },
}

const matches = (all('match').length ? all('match') : ['easy:intermediate', 'intermediate:hard', 'easy:hard']).map((m) => {
  // "profile:v0:hard" is profile v0 against level hard; split on the colon
  // that does not belong to a "profile:" prefix.
  const parts = m.split(':')
  const agents = []
  for (let i = 0; i < parts.length; i++) agents.push(parts[i] === 'profile' ? `profile:${parts[++i]}` : parts[i])
  if (agents.length !== 2) throw new Error(`Not a pairing: ${m}`)
  return agents
})
const decks = flag('decks', 'goblins,boros').split(',').map((d) => d.trim()).filter(Boolean)
for (const d of decks) if (!DECKS[d]) throw new Error(`No deck "${d}"; these are: ${Object.keys(DECKS).join(', ')}`)
const PAIRS = Number(flag('pairs', 10))
const SEED = Number(flag('seed', 20260924))
const WORKERS = Math.max(1, Math.min(Number(flag('workers', 1)), cpus().length))
const OUT = flag('out', join(tmpdir(), `engine-levels-${Date.now()}.json`))
const FROM = all('from')

const command = findEngine()
if (!command && !FROM.length) {
  console.error('No engine found. Run scripts/engine-build.sh first, or set ENGINE_CMD.')
  process.exit(2)
}

/** A player for `new`: an engine seat at a level, or at an Argentum profile by id. */
const seatFor = (agent, name, deck) => ({
  name, deck, ai: 'heuristic',
  ...(agent.startsWith('profile:') ? { profile: agent.slice('profile:'.length) } : { level: agent }),
})

// Every game to play: each pair is one seed, played with the agents one way
// round and then the other.
const WATCH = Number(flag('watch', 0))

const quantile = (xs, q) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]
}

if (WATCH > 0) {
  // One engine, one table at a time, so the times are this machine's alone.
  const engine = startEngine({ command, timeoutMs: 10 * 60_000, onStderr: (line) => { if (!/SLF4J/.test(line)) console.error(`  [engine] ${line}`) } })
  await engine.call('hello', {}, { timeoutMs: 180_000 })
  const levels = [...new Set(matches.flat())].filter((a) => !a.startsWith('profile:'))
  // The plainest player's choices, best first. An offer the engine then refuses
  // is taken as a no and the next one tried, which is what a player would do:
  // an ability whose cost has its own choice to make (a card to discard) is
  // offered, and `act` has no way yet to make that choice (PLAN.md, M3).
  const choices = (status) => [
    ...status.actions.filter((a) => a.meaningful && a.affordable && !a.requiresTargets),
    ...status.actions.filter((a) => a.type === 'PassPriority'),
  ]
  let refusals = 0
  const play = async (status) => {
    for (const a of choices(status)) {
      const at = performance.now()
      try { return { status: await engine.call('act', { index: a.index }), ms: performance.now() - at } } catch (e) {
        if (!e.refused) throw e
        refusals++
      }
    }
    throw new Error('Nothing on offer could be taken, not even passing.')
  }
  const watched = []
  for (const deck of decks) {
    for (const level of levels) {
      const continues = []
      const acts = []
      for (let i = 0; i < WATCH; i++) {
        let status = await engine.call('new', {
          players: [{ name: 'You', deck: DECKS[deck], autoPass: true }, { name: 'Bot', deck: DECKS[deck], ai: 'heuristic', level }],
          seed: SEED + i,
          pace: true,
        })
        for (let steps = 0; !status.over && steps < 2000; steps++) {
          const at = performance.now()
          if (status.waiting === 'engine') { status = await engine.call('continue'); continues.push(performance.now() - at) }
          else if (status.waiting === 'decision') status = await engine.call('decide', { auto: true })
          else if (status.waiting === 'action') { const played = await play(status); status = played.status; acts.push(played.ms) }
          else break
        }
      }
      const line = (xs) => `median ${quantile(xs, 0.5)?.toFixed(0)}, p90 ${quantile(xs, 0.9)?.toFixed(0)}, max ${quantile(xs, 1)?.toFixed(0)} ms over ${xs.length}`
      console.log(`  ${deck.padEnd(7)} ${level.padEnd(12)} each continue: ${line(continues)}; each act: ${line(acts)}`)
      watched.push({ deck, level, continues, acts })
    }
  }
  await engine.close()
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), seed: SEED, watch: WATCH, refusals, watched }, null, 1))
  console.log(`${refusals} offer${refusals === 1 ? ' was' : 's were'} refused by the engine and the next tried. Raw results: ${OUT}`)
  process.exit(0)
}

const games = []
for (const deck of FROM.length ? [] : decks) {
  for (const [a, b] of matches) {
    for (let i = 0; i < PAIRS; i++) {
      const seed = SEED + i
      games.push({ deck, a, b, seed, first: a })
      games.push({ deck, a, b, seed, first: b })
    }
  }
}

// Saved runs read back rather than played, so two runs over different seeds
// are summarised as one: the pairings and decks are theirs, in their order.
const results = FROM.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).results ?? [])
if (FROM.length) {
  matches.length = 0
  for (const r of results) if (!matches.some(([a, b]) => a === r.a && b === r.b)) matches.push([r.a, r.b])
  decks.length = 0
  for (const r of results) if (!decks.includes(r.deck)) decks.push(r.deck)
}
let done = 0
const started = Date.now()

const worker = async (n) => {
  const engine = startEngine({ command, timeoutMs: 30 * 60_000, onStderr: (line) => { if (!/SLF4J/.test(line)) console.error(`  [engine ${n}] ${line}`) } })
  const hello = await engine.call('hello', {}, { timeoutMs: 180_000 })
  if ((hello.protocol ?? 0) < 4) {
    await engine.close()
    throw new Error(`This engine speaks protocol ${hello.protocol}, which has no levels. Rebuild it.`)
  }
  if (n === 0) console.log(`engine: protocol ${hello.protocol}, levels ${JSON.stringify(hello.levels)}`)
  try {
    while (games.length) {
      const g = games.shift()
      const second = g.first === g.a ? g.b : g.a
      const at = Date.now()
      const reply = await engine.call('new', {
        players: [seatFor(g.first, 'first', DECKS[g.deck]), seatFor(second, 'second', DECKS[g.deck])],
        seed: g.seed,
      })
      const wallMs = Date.now() - at
      const clock = await engine.call('clock')
      const [s0, s1] = reply.seats
      // What each seat really played with, from the engine's own reply, so a
      // level the engine did not take is not counted as that level.
      const agentOf = { [s0.id]: g.first, [s1.id]: second }
      const played = { [g.first]: s0.profile, [second]: s1.profile }
      const winner = reply.over && reply.winner ? agentOf[reply.winner] ?? null : null
      const choices = {}
      for (const s of clock.seats ?? []) choices[agentOf[s.id]] = s.choices ?? []
      results.push({ ...g, second, played, over: reply.over, winner, turn: reply.turn, wallMs, choices })
      done++
      const total = done + games.length
      console.log(`  ${String(done).padStart(4)}/${total}  ${g.deck.padEnd(7)} ${g.first} v ${second}, seed ${g.seed}: ${winner ? `${winner} won` : reply.over ? 'a draw' : 'unfinished'} on turn ${reply.turn} (${(wallMs / 1000).toFixed(1)} s)`)
    }
  } finally {
    await engine.close()
  }
}

if (!FROM.length) {
  await Promise.all(Array.from({ length: WORKERS }, (_, n) => worker(n)))
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), seed: SEED, pairs: PAIRS, workers: WORKERS, decks: Object.fromEntries(decks.map((d) => [d, DECKS[d]])), results }, null, 1))
}

// --- the summary -------------------------------------------------------------

const pct = (x) => `${(100 * x).toFixed(1)}%`

console.log(FROM.length
  ? `\n${results.length} games, read from ${FROM.join(', ')}.`
  : `\n${results.length} games in ${((Date.now() - started) / 1000).toFixed(0)} s, ${WORKERS} worker${WORKERS === 1 ? '' : 's'}. Raw results: ${OUT}`)
console.log('\nStrength: the share of each pair won by the second agent named, over pairs (one seed, both ways round).')
for (const deck of decks) {
  for (const [a, b] of matches) {
    const rows = results.filter((r) => r.deck === deck && r.a === a && r.b === b)
    const bySeed = new Map()
    for (const r of rows) bySeed.set(r.seed, [...(bySeed.get(r.seed) ?? []), r])
    // One pair's score for b: a win is 1, a draw or an unfinished game ½.
    const scores = [...bySeed.values()].filter((p) => p.length === 2).map((p) => p.reduce((sum, r) => sum + (r.winner === b ? 1 : r.winner === a ? 0 : 0.5), 0) / 2)
    const n = scores.length
    const mean = n ? scores.reduce((x, y) => x + y, 0) / n : 0
    const sd = n > 1 ? Math.sqrt(scores.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1)) : 0
    const half = n > 1 ? 1.96 * sd / Math.sqrt(n) : 0
    const wins = rows.filter((r) => r.winner === b).length
    const losses = rows.filter((r) => r.winner === a).length
    const drawn = rows.length - wins - losses
    const split = [1, 0.5, 0].map((s) => scores.filter((x) => x === s).length)
    console.log(`  ${deck.padEnd(7)} ${a} v ${b}: ${b} ${pct(mean)} [${pct(Math.max(0, mean - half))}, ${pct(Math.min(1, mean + half))}] over ${n} pairs; games ${wins}-${losses}${drawn ? `-${drawn} drawn or unfinished` : ''}; pairs 2-0 ${split[0]}, 1-1 ${split[1]}, 0-2 ${split[2]}; median turn ${quantile(rows.map((r) => r.turn), 0.5)}`)
  }
}

console.log('\nTime to choose, per agent and deck: the choices with something to choose between (and every choice), in ms.')
const agents = [...new Set(matches.flat())]
for (const deck of decks) {
  for (const agent of agents) {
    const rows = results.filter((r) => r.deck === deck && r.choices[agent])
    if (!rows.length) continue
    const every = rows.flatMap((r) => r.choices[agent])
    const real = every.filter((c) => c.meaningful || c.decision).map((c) => c.ms)
    const perGame = rows.map((r) => r.choices[agent].reduce((sum, c) => sum + c.ms, 0) / 1000)
    const profile = [...new Set(rows.map((r) => r.played[agent]))].join('/')
    console.log(`  ${deck.padEnd(7)} ${agent} (${profile}): median ${quantile(real, 0.5)}, p90 ${quantile(real, 0.9)}, max ${quantile(real, 1)} over ${real.length} choices in ${rows.length} games`
      + ` (all ${every.length}: median ${quantile(every.map((c) => c.ms), 0.5)}, p90 ${quantile(every.map((c) => c.ms), 0.9)}); per game ${quantile(perGame, 0.5)?.toFixed(1)} s median, ${quantile(perGame, 0.9)?.toFixed(1)} s p90`)
  }
}
