#!/usr/bin/env node
/**
 * What keeping a game costs, and whether a game taken back is the same game
 * (HANDOFF.md, M7; the numbers are in PLAN.md, "M7: a room that survives the
 * relay").
 *
 *   bash scripts/engine-build.sh                 # once, if there is no engine yet
 *   node scripts/engine-restore.mjs              # 8 games of each kind, to turn 14
 *   node scripts/engine-restore.mjs --games 4 --kinds goblins
 *
 * Two processes. The first plays games as a room deals them — paced, with the
 * hands to keep, the engine's seat at intermediate — and is asked for a
 * snapshot at every stop, the engine's own included, as a room asks. The person
 * plays plainly, as the other scripts here play one: every hand kept, the first
 * play worth making chosen whole by the engine for them (`auto`), else a pass,
 * and every question the engine's choice. Their client says it can show every
 * decision the engine can ask, as the app's does, so a question can be in
 * flight at a stop.
 *
 * At one stop a game, the snapshot is taken back by the second process
 * (`restore`, with `replace` after its first, so the corpus loads once). What it
 * answers is held against the first's status there and each seat's whole view,
 * and then both play on in step, the same player choosing the same offer in
 * each, until the game ends or the turn limit: every status on the way must be
 * the same, and so must the views at the end. Which stop is kept goes round the
 * four kinds a room can be caught at:
 *
 *   opening   the hand to keep, before anybody has; the person then takes a
 *             mulligan in both, so the seven drawn again are the RNG's word
 *   engine    one of the engine's own paced stops, from turn 4, so what is
 *             taken back is a turn half watched, and `continue` takes it on
 *   decision  a question put to the person, the first one asked; where none is
 *             asked by turn 6, a person's stop from there, and it says so. The
 *             sixty-card games kept here play Sparkmage Apprentices, whose
 *             arrival asks for a target, since the goblin deck asks nothing
 *   action    a person's stop with plays offered, from turn 6
 *
 * Measured, per kind of deck:
 *   snapshot  the text in bytes, the same text gzipped, and as the relay writes it
 *             into the room's file (gzipped, then base64), and the call's wall clock
 *   parts     of a snapshot at the first stop and the last: the game state, the
 *             logs, and the rest
 *   restore   the call's wall clock, in a process already loaded
 *   same      whether the stop taken back and every stop after it agree
 *
 * Options:
 *   --games N     games per kind (default 8), seeds from --seed (default 20260925)
 *   --turns N     turns each game is played to, at most (default 14)
 *   --kinds a,b   goblins, commander (default both)
 *   --level L     the engine's level (default intermediate)
 */
import { gzipSync } from 'node:zlib'
import { findEngine, startEngine } from './engine-bridge.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const GAMES = Number(flag('games', 8))
const TURNS = Number(flag('turns', 14))
const SEED = Number(flag('seed', 20260925))
const LEVEL = flag('level', 'intermediate')
const KINDS = flag('kinds', 'goblins,commander').split(',').filter((k) => ['goblins', 'commander'].includes(k))
const CAUGHT = ['opening', 'engine', 'decision', 'action']
const GOBLINS = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }
// The goblin deck asks its person nothing: every play is chosen whole with the
// cast. Sparkmage Apprentice's arrival asks for a target (the engine spec's
// "Sparks" deck), so the sixty-card games kept at a question play this one.
const SPARKS = { Mountain: 14, 'Sparkmage Apprentice': 12, 'Raging Goblin': 8 }

const command = findEngine()
if (!command) { console.log('No engine is built here (scripts/engine-build.sh).'); process.exit(1) }
const first = startEngine({ command, timeoutMs: 180_000 })
const second = startEngine({ command, timeoutMs: 180_000 })
const [hello] = await Promise.all([first.call('hello'), second.call('hello')])
if (hello.protocol < 9) { console.log(`This engine speaks protocol ${hello.protocol}; keeping a game came with 9.`); process.exit(1) }
console.log(`engine: protocol ${hello.protocol}, ${hello.cards} cards, loaded in ${hello.load.ms} ms, ${hello.load.heapMb} MB`)

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000
const stats = (xs) => {
  if (!xs.length) return 'none'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `median ${Math.round(at(0.5))}, p90 ${Math.round(at(0.9))}, max ${Math.round(s[s.length - 1])} (n ${s.length})`
}
const kb = (n) => Math.round(n / 100) / 10
/** A status as two processes at one stop must agree on it: what the person would report of the table. */
const same = (s) => JSON.stringify({ over: s.over, winner: s.winner, turn: s.turn, phase: s.phase, step: s.step, actor: s.actor, waiting: s.waiting, actions: s.actions ?? null, decision: s.decision ?? null })
/** What a snapshot is made of, in bytes of its own JSON. */
const parts = (text) => {
  const doc = JSON.parse(text)
  const state = JSON.stringify(doc.state).length
  const logs = JSON.stringify(doc.logs).length
  return { state, logs, rest: text.length - state - logs }
}

/** The deck an engine's seat was built for this kind from this seed, as a person would bring it by name. */
async function builtDeck(seed) {
  const dealt = await first.call('new', {
    format: 'commander',
    players: [{ name: 'Bot', ai: 'heuristic', deck: 'own', format: 'commander' }, { name: 'Other', ai: 'heuristic', deck: 'own', format: 'commander' }],
    seed,
  })
  const list = await first.call('decklist', { seat: dealt.seats[0].id })
  return { deck: list.deck, commander: list.commander }
}

/** The person's choice at a stop, the same in both processes: the index, and what goes with it. */
const choose = (status, mulligan) => {
  if (status.waiting === 'engine') return { op: 'continue' }
  if (status.waiting === 'decision') return { op: 'decide', auto: true }
  const offers = status.actions ?? []
  const take = mulligan && offers.find((a) => a.type === 'TakeMulligan')
  if (take) return { op: 'act', index: take.index }
  const keep = offers.find((a) => a.type === 'KeepHand')
  if (keep) return { op: 'act', index: keep.index }
  const bottom = offers.find((a) => a.type === 'BottomCards')
  if (bottom) return { op: 'act', index: bottom.index, auto: true }
  const play = offers.find((a) => a.meaningful && a.affordable && !a.mana)
  if (play) return { op: 'act', index: play.index, auto: true }
  const pass = offers.find((a) => a.type === 'PassPriority') ?? offers[0]
  return { op: 'act', index: pass.index }
}
const call = (engine, choice) => { const { op, ...params } = choice; return engine.call(op, params) }

const results = []
let restoredOnce = false
for (const kind of KINDS) {
  const snaps = { bytes: [], gz: [], disk: [], ms: [] }
  const restores = []
  const partsSeen = []
  for (let g = 0; g < GAMES; g++) {
    const seed = SEED + g
    const caught = CAUGHT[g % CAUGHT.length]
    const led = kind === 'commander' ? await builtDeck(seed + 1000) : null
    const deck = led ? led.deck : caught === 'decision' ? SPARKS : GOBLINS
    const person = { name: 'You', deck, autoPass: true, answers: hello.choices.decisions, ...(led ? { commander: led.commander } : {}) }
    const bot = { name: 'Bot', ai: 'heuristic', level: LEVEL, deck: 'mirror' }
    let status = await first.call('new', { players: [person, bot], seed, pace: true, mulligans: true, ...(led ? { format: 'commander' } : {}) })
    const seats = status.seats.map((s) => s.id)
    /** Every seat's whole view, as the process holding the game gives it now. */
    const viewsOf = async (engine) => JSON.stringify(await Promise.all(seats.map((seat) => engine.call('view', { viewer: seat }))))
    // The course of the game as it was played without being taken back: every
    // status, in order, and each seat's whole view at the stop kept and at the end.
    const course = []
    let kept = null
    let fallback = null
    let lastText = null
    let stops = 0
    for (; !status.over && status.turn <= TURNS && stops < 2000; stops++) {
      course.push(same(status))
      const t0 = now()
      const snap = await first.call('snapshot')
      snaps.ms.push(now() - t0)
      snaps.bytes.push(snap.bytes)
      snaps.gz.push(gzipSync(snap.snapshot).length)
      // As the relay writes it into the room's file: gzipped, then base64 (relay-server.mjs, `packed`).
      snaps.disk.push(gzipSync(snap.snapshot).toString('base64').length)
      if (stops === 0) partsSeen.push({ at: 'first', ...parts(snap.snapshot) })
      lastText = snap.snapshot
      const person = status.actor === seats[0]
      const here = !kept && (
        (caught === 'opening' && stops === 0)
        || (caught === 'engine' && status.waiting === 'engine' && status.turn >= 4)
        || (caught === 'decision' && status.waiting === 'decision' && person)
        || (caught === 'action' && status.waiting === 'action' && person && status.turn >= 6 && (status.actions ?? []).some((a) => a.meaningful))
      )
      // A game that asks the person nothing by turn 6 is kept at their next stop
      // instead, and the report says so, rather than keeping nothing.
      if (!kept && !fallback && caught === 'decision' && status.waiting === 'action' && person && status.turn >= 6) fallback = { text: snap.snapshot, status, stops, views: await viewsOf(first) }
      if (here) kept = { text: snap.snapshot, status, stops, views: await viewsOf(first) }
      status = await call(first, choose(status, caught === 'opening' && stops === 0))
    }
    course.push(same(status))
    const endViews = await viewsOf(first)
    partsSeen.push({ at: 'last', ...parts(lastText) })
    const taken = kept ?? fallback
    if (!taken) { results.push({ kind, seed, caught, at: 'nothing kept: the game ended first' }); continue }

    // Taken back by the other process, and played on from the same stop by the
    // same player: every status must be the one the game had without it.
    const t0 = now()
    let b = await second.call('restore', { snapshot: taken.text, ...(restoredOnce ? { replace: true } : {}) })
    restores.push(now() - t0)
    restoredOnce = true
    const sameAtStop = same(b) === course[taken.stops] && (await viewsOf(second)) === taken.views
    let steps = 0
    let diverged = null
    for (let n = taken.stops; ; n++) {
      if (same(b) !== course[n]) { diverged = `stop ${n}, turn ${b.turn} ${b.step}: ${b.waiting} where it was ${JSON.parse(course[n] ?? '{}').waiting ?? 'over'}`; break }
      if (b.over || b.turn > TURNS || n >= course.length - 1) break
      b = await call(second, choose(b, caught === 'opening' && n === 0))
      steps++
    }
    const sameAfter = !diverged && steps === course.length - 1 - taken.stops && (await viewsOf(second)) === endViews
    results.push({
      kind, seed, caught: taken === fallback ? 'action (no question asked)' : caught,
      at: `turn ${taken.status.turn} ${taken.status.step}, ${taken.status.waiting}`,
      restoreMs: Math.round(restores.at(-1)), sameAtStop, steps, sameAfter, ...(diverged ? { diverged } : {}),
    })
  }
  console.log(`\n${kind}`)
  console.log(`  snapshot, bytes:          ${stats(snaps.bytes)}`)
  console.log(`  snapshot, gzipped bytes:  ${stats(snaps.gz)}`)
  console.log(`  in the room's file, bytes: ${stats(snaps.disk)}`)
  console.log(`  snapshot, ms:             ${stats(snaps.ms)}`)
  console.log(`  restore, ms:              ${stats(restores)}`)
  const byAt = (at) => partsSeen.filter((p) => p.at === at)
  for (const at of ['first', 'last']) {
    const ps = byAt(at)
    console.log(`  parts at the ${at} stop, kB (median of ${ps.length}): state ${kb(ps.map((p) => p.state).sort((x, y) => x - y)[Math.floor(ps.length / 2)])}, logs ${kb(ps.map((p) => p.logs).sort((x, y) => x - y)[Math.floor(ps.length / 2)])}, the rest ${kb(ps.map((p) => p.rest).sort((x, y) => x - y)[Math.floor(ps.length / 2)])}`)
  }
}
console.log('\nper game')
console.table(results)
const bad = results.filter((r) => r.sameAtStop === false || r.sameAfter === false)
console.log(bad.length ? `${bad.length} of ${results.length} games came back as another game.` : `All ${results.length} games came back as the same game.`)
await Promise.all([first.close(), second.close()])
process.exit(bad.length ? 1 : 0)
