#!/usr/bin/env node
/**
 * What the engine decides for a person, and what it asks them instead since
 * protocol 5 (HANDOFF.md, M4; the numbers are in PLAN.md, "M4, the first half: the decisions").
 *
 *   bash scripts/engine-build.sh                 # once, if there is no engine yet
 *   node scripts/engine-decisions.mjs            # every deck, 20 seeds each
 *   node scripts/engine-decisions.mjs --games 5 --decks burn
 *
 * Every game is played twice from one seed against the engine at intermediate:
 * once with a person's seat whose client said nothing — every client before
 * protocol 5 — and once with one that said it can show every decision this
 * app's table can (`answers`). The person is the plainest player there is: the
 * first worthwhile play, targets and all, chosen by the engine for them
 * (`auto`), else a pass; and every decision put to them is answered by the
 * engine's own choice too (`decide` with `auto`). So the two games are the same
 * game — the same responder answers the same questions either way, asked or
 * not — and the script says so if they are not. What differs is only who was
 * asked: the first game's `decided` is what the engine answered for the person
 * without a word to them, the second's decisions are what they were asked, and
 * its `decided` is what is still answered for them.
 *
 * It also counts the stops where a play the table held back until M4 — one
 * needing a target, or a choice in its cost — was among the plays worth
 * making: plays the table can make now and could not.
 *
 * Options:
 *   --games N     seeds per deck (default 20), from --seed (default 20260924).
 *   --decks a,b   goblins (Portal, as every measurement here has used), burn
 *                 (Magma Jet, Arc Lightning, Blaze, Tormenting Voice and Hill
 *                 Giants) and green (tramplers, Giant Growth), the last two chosen
 *                 to raise what M4 asks. Default all three.
 */
import { findEngine, startEngine } from './engine-bridge.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const GAMES = Number(flag('games', 20))
const SEED = Number(flag('seed', 20260924))
const DECKS = {
  goblins: { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 },
  burn: { Mountain: 24, 'Magma Jet': 4, 'Arc Lightning': 4, Blaze: 4, 'Tormenting Voice': 4, 'Hill Giant': 8, 'Raging Goblin': 12 },
  green: { Forest: 22, 'Llanowar Elves': 8, 'Colossal Dreadmaw': 6, 'Crash of Rhinos': 4, 'Giant Growth': 8, 'Grizzly Bears': 12 },
}
const chosenDecks = flag('decks', 'goblins,burn,green').split(',').filter((d) => d in DECKS)
// Every decision this app's table can show (src/lib/engine/choose.js, ANSWERS).
const ANSWERS = ['SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo']

const command = findEngine()
if (!command) { console.log('No engine is built here (scripts/engine-build.sh).'); process.exit(1) }
const engine = startEngine({ command, timeoutMs: 120_000 })
const hello = await engine.call('hello')
if (hello.protocol < 5) { console.log(`This engine speaks protocol ${hello.protocol}; choosing came with 5.`); process.exit(1) }

/** Plays one game and says what was asked, what was decided, and the course of it. */
async function play(deck, seed, answers) {
  let status = await engine.call('new', {
    players: [{ name: 'You', deck, autoPass: true, ...(answers ? { answers } : {}) }, { name: 'Bot', deck, ai: 'heuristic', level: 'intermediate' }],
    seed,
  })
  const asked = {}
  const decided = {}
  const course = []
  let heldBackBefore = 0
  const tally = (into, type) => { into[type] = (into[type] ?? 0) + 1 }
  for (let steps = 0; !status.over && steps < 2000; steps++) {
    for (const d of status.decided ?? []) tally(decided, d.type)
    if (status.waiting === 'decision') {
      tally(asked, status.decision.type)
      course.push(`${status.turn} ${status.step}: asked ${status.decision.type}`)
      status = await engine.call('decide', { auto: true })
    } else if (status.waiting === 'action') {
      const worth = status.actions.filter((a) => a.meaningful && a.affordable && !a.mana)
      if (worth.some((a) => a.requiresTargets || a.costChoice)) heldBackBefore++
      const pick = worth[0] ?? status.actions.find((a) => a.type === 'PassPriority') ?? status.actions[0]
      course.push(`${status.turn} ${status.step}: ${pick.description}`)
      status = await engine.call('act', { index: pick.index, auto: true })
    } else break
  }
  for (const d of status.decided ?? []) tally(decided, d.type)
  course.push(`over ${status.over} turn ${status.turn} won by ${status.winner}`)
  return { asked, decided, course, heldBackBefore }
}

const sum = (into, from) => { for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n }
const line = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'
for (const name of chosenDecks) {
  const unasked = {}
  const asked = {}
  const stillDecided = {}
  let same = 0
  let heldBack = 0
  let games = 0
  for (let i = 0; i < GAMES; i++) {
    const seed = SEED + i
    const before = await play(DECKS[name], seed, null)
    const after = await play(DECKS[name], seed, ANSWERS)
    sum(unasked, before.decided)
    sum(asked, after.asked)
    sum(stillDecided, after.decided)
    if (JSON.stringify(before.course.filter((c) => !/asked/.test(c))) === JSON.stringify(after.course.filter((c) => !/asked/.test(c)))) same++
    heldBack += after.heldBackBefore
    games++
  }
  console.log(`\n${name}, ${games} games from seed ${SEED}, against intermediate`)
  console.log(`  answered for a person whose client said nothing: ${line(unasked)}`)
  console.log(`  asked of a person whose client can show them:   ${line(asked)}`)
  console.log(`  still answered for that person:                   ${line(stillDecided)}`)
  console.log(`  the same game both ways: ${same} of ${games}`)
  console.log(`  stops where a play worth making needed a target or a chosen cost: ${heldBack}`)
}
await engine.close()
