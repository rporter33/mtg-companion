#!/usr/bin/env node
/**
 * What a hundred-card Commander game costs against the engine, beside a
 * sixty-card one (HANDOFF.md, M6; the numbers are in PLAN.md, "M6: Commander").
 *
 *   bash scripts/engine-build.sh                 # once, if there is no engine yet
 *   node scripts/engine-commander.mjs            # 10 games of each kind, 12 turns each
 *   node scripts/engine-commander.mjs --games 3 --turns 6 --kinds commander
 *   node scripts/engine-commander.mjs --kinds duel,brawl   # HANDOFF.md §3 item 20
 *
 * Three kinds of game, each dealt paced, as a room deals one, with the engine's
 * seat at intermediate, the first level a person meets:
 *
 *   goblins    the Portal goblin deck against a copy of it: every measurement
 *              before this one was taken with it, so it is the baseline
 *   modern     a Modern deck of the engine's own against another: sixty cards
 *              each, of the kind a person brings
 *   commander  a Commander deck of the engine's own against another, commander
 *              and all, by Argentum's own Format.Commander: a hundred cards each
 *   brawl      a Brawl deck of the engine's own against another, dealt as a Brawl
 *              game (protocol 10, §3 item 20): 25 life, a hundred cards each
 *   duel       a Commander deck of the engine's own, dealt as a Duel Commander
 *              game (protocol 10): 20 life, the engine's seat the copy, since
 *              Argentum has no Duel Commander card pool to build one from
 *
 * The person's deck in the last two is one the engine built for a seat in a
 * game dealt only to read it (`decklist`), so both seats hold real decks of the
 * size measured without anybody choosing a card. The person plays as plainly as
 * the other scripts here play one: the first play worth making, chosen whole by
 * the engine for them (`auto`), else a pass, and every question answered by the
 * engine's own choice — the same game from the same seed every time.
 *
 * What is measured, per kind:
 *   deal       the `new` request, wall clock: the deal, and for a deck of the
 *              engine's own, building it
 *   step       each `continue` of a paced table: the engine choosing and making
 *              one play worth watching, what a person waits on besides the pace
 *   turn       the engine's turns, the sum of their steps, and how many steps
 *              each took — the room waits its pace (600 ms) before each
 *   view       the person's view: whole, and a delta against the view before
 *              it, with the log lines that go with each, in bytes of JSON as the
 *              relay would put them on the wire
 *
 * Options:
 *   --games N     games per kind (default 10), seeds from --seed (default 20260925)
 *   --turns N     turns each game is played to, at most (default 12)
 *   --kinds a,b   goblins, modern, commander, brawl, duel (default the first three)
 *   --level L     the engine's level (default intermediate)
 */
import { findEngine, startEngine } from './engine-bridge.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const GAMES = Number(flag('games', 10))
const TURNS = Number(flag('turns', 12))
const SEED = Number(flag('seed', 20260925))
const LEVEL = flag('level', 'intermediate')
const KINDS = flag('kinds', 'goblins,modern,commander').split(',').filter((k) => ['goblins', 'modern', 'commander', 'brawl', 'duel'].includes(k))
/** The game a kind is dealt as, and the format its decks are built to: a Duel Commander deck is a Commander one, there being no Duel pool. */
const GAME = { goblins: null, modern: null, commander: 'commander', brawl: 'brawl', duel: 'duel' }
const BUILT = { modern: 'modern', commander: 'commander', brawl: 'brawl', duel: 'commander' }
const GOBLINS = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

const command = findEngine()
if (!command) { console.log('No engine is built here (scripts/engine-build.sh).'); process.exit(1) }
const engine = startEngine({ command, timeoutMs: 180_000 })
const hello = await engine.call('hello')
if (hello.protocol < 8) { console.log(`This engine speaks protocol ${hello.protocol}; Commander came with 8.`); process.exit(1) }
if (KINDS.some((k) => k === 'brawl' || k === 'duel') && hello.protocol < 10) { console.log(`This engine speaks protocol ${hello.protocol}; Duel Commander and Brawl came with 10.`); process.exit(1) }
console.log(`engine: protocol ${hello.protocol}, ${hello.cards} cards, loaded in ${hello.load.ms} ms, ${hello.load.heapMb} MB`)

const bytes = (o) => Buffer.byteLength(JSON.stringify(o))
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const stats = (xs) => {
  if (!xs.length) return 'none'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `median ${Math.round(at(0.5))}, p90 ${Math.round(at(0.9))}, max ${Math.round(s[s.length - 1])} (n ${s.length})`
}

/** The deck an engine's seat was built for this kind from this seed, as a person would bring it by name. */
async function builtDeck(kind, seed) {
  const own = { format: BUILT[kind] }
  const game = BUILT[kind] === 'modern' ? null : BUILT[kind]
  const dealt = await engine.call('new', {
    ...(game ? { format: game } : {}),
    players: [{ name: 'Bot', ai: 'heuristic', deck: 'own', ...own }, { name: 'Other', ai: 'heuristic', deck: 'own', ...own }],
    seed,
  })
  const list = await engine.call('decklist', { seat: dealt.seats[0].id })
  return { deck: list.deck, commander: list.commander ?? null }
}

/** One game of a kind, played to TURNS turns or its end; what it cost. */
async function play(kind, seed, out) {
  const mine = kind === 'goblins' ? { deck: GOBLINS, commander: null } : await builtDeck(kind, seed + 1_000_000)
  const bot = kind === 'goblins' || kind === 'duel' ? { deck: 'mirror' } : { deck: 'own', format: BUILT[kind] }
  const started = now()
  let s = await engine.call('new', {
    ...(GAME[kind] ? { format: GAME[kind] } : {}),
    players: [
      { name: 'You', deck: mine.deck, ...(mine.commander ? { commander: mine.commander } : {}), autoPass: true },
      { name: 'Bot', ai: 'heuristic', level: LEVEL, ...bot },
    ],
    seed,
    pace: true,
  })
  out.deal.push(now() - started)
  const you = s.seats[0].id
  out.life.add((await engine.call('view', { viewer: you })).state.players.map((p) => p.life).join('/'))
  const view = async (delta) => {
    const v = await engine.call('view', { viewer: you, delta })
    const body = v.state ? { state: v.state } : { delta: v.delta }
    return { whole: Boolean(v.state), size: bytes({ ...body, log: v.log ?? [] }) }
  }
  const first = await view(false)
  out.whole.push(first.size)
  let stops = 0
  let turnSteps = null
  for (let guard = 0; guard < 5000 && !s.over && s.turn <= TURNS; guard++) {
    stops++
    // A delta at each stop, as a room sends one; the table whole every tenth, as a
    // client that missed one is sent it, which is also what a whole view costs by then.
    const v = await view(stops % 10 !== 0)
    ;(v.whole ? out.whole : out.delta).push(v.size)
    if (s.waiting === 'engine') {
      const t0 = now()
      const turn = s.turn
      s = await engine.call('continue')
      const ms = now() - t0
      out.step.push(ms)
      if (!turnSteps || turnSteps.turn !== turn) { if (turnSteps) out.turns.push(turnSteps); turnSteps = { turn, ms: 0, steps: 0 } }
      turnSteps.ms += ms; turnSteps.steps++
      continue
    }
    if (turnSteps) { out.turns.push(turnSteps); turnSteps = null }
    if (s.waiting === 'decision') { s = await engine.call('decide', { auto: true }); continue }
    if (s.waiting !== 'action') break
    const play = s.actions.find((a) => a.meaningful && a.affordable && !a.mana && a.type !== 'PassPriority' && !['DeclareAttackers', 'DeclareBlockers'].includes(a.type))
    const pass = s.actions.find((a) => a.type === 'PassPriority') ?? s.actions.find((a) => a.type === 'DeclareAttackers' || a.type === 'DeclareBlockers')
    const passing = () => engine.call('act', { index: pass.index, ...(pass.type === 'DeclareAttackers' ? { attackers: {} } : pass.type === 'DeclareBlockers' ? { blockers: {} } : {}) })
    if (!play) { s = await passing(); continue }
    // A play the engine refuses when it chooses it for the person is counted and
    // passed over, rather than end the game being measured: it is said at the end.
    try { s = await engine.call('act', { index: play.index, auto: true }) } catch (e) { out.refused.push(`${play.description}: ${e.message}`); s = await passing() }
  }
  if (turnSteps) out.turns.push(turnSteps)
  out.stops.push(stops)
}

for (const kind of KINDS) {
  const out = { deal: [], step: [], turns: [], whole: [], delta: [], stops: [], refused: [], life: new Set() }
  for (let g = 0; g < GAMES; g++) {
    try { await play(kind, SEED + g, out) } catch (e) { console.log(`${kind} seed ${SEED + g}: ${e.message}`) }
  }
  console.log(`\n${kind} (${GAMES} games, to turn ${TURNS}, the engine at ${LEVEL})`)
  console.log(`  deal, ms:              ${stats(out.deal)}`)
  console.log(`  step, ms:              ${stats(out.step)}`)
  console.log(`  engine's turn, ms:     ${stats(out.turns.map((t) => t.ms))}`)
  console.log(`  steps in its turn:     ${stats(out.turns.map((t) => t.steps))}`)
  console.log(`  whole view, bytes:     ${stats(out.whole)}`)
  console.log(`  delta, bytes:          ${stats(out.delta)}`)
  console.log(`  stops a game:          ${stats(out.stops)}`)
  console.log(`  life at the deal:      ${[...out.life].join(', ')}`)
  for (const r of new Set(out.refused)) console.log(`  refused, when the engine chose for the person: ${r}`)
}
await engine.close()
