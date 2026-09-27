#!/usr/bin/env node
/**
 * What one engine process costs the machine it runs on (HANDOFF.md, M8): the
 * memory the operating system gives the JVM, not the heap Java reports, while it
 * loads the card corpus and plays the heaviest game the table deals.
 *
 *   node scripts/engine-memory.mjs                                   # the launcher's own options
 *   COMPANION_OPTS="-Xmx384m -XX:+UseSerialGC" node scripts/engine-memory.mjs
 *   node scripts/engine-memory.mjs --engines 2 --turns 12           # two at once, as a relay coming back starts them
 *   node scripts/engine-memory.mjs --game goblins                   # the sixty-card baseline every earlier number used
 *   node scripts/engine-memory.mjs --level hard --turns 60          # the engine at hard, whose rollouts look further ahead
 *
 * The heap itself, as the collector sees it, is for the JVM to log: put
 * `-Xlog:gc:file=gc-%p.log` in COMPANION_OPTS (a relative file: -Xlog's option is
 * split at its colons, and a Windows drive has one) and the file lands where this is
 * run, one for each JVM.
 *
 * The heaviest game is a Commander game with an example deck: the Commodore Guff
 * deck (src/data/example-decks.js) as the table deals it at the pin — the cards the
 * engine knows, led by Narset, Enlightened Master as a stand-in (HANDOFF.md §3 item
 * 19), since the engine does not know Guff — against a hundred-card Commander deck
 * the engine builds for itself from the whole format, which is the most the
 * engine's seat is ever asked to build and hold. The person plays as the other
 * scripts here play one: the first play worth making, chosen whole by the engine
 * (`auto`), else a pass; every question answered by the engine's own choice.
 *
 * JVM options travel as the launcher reads them, in COMPANION_OPTS, which this
 * passes on untouched; the launcher's own default (-Xmx2g, engine/build.gradle.kts)
 * comes first and a later -Xmx wins. The memory is sampled from outside the JVM
 * every half second: on Windows the working set and private bytes of the java.exe
 * the launcher started (the .bat runs Java as a child of cmd.exe), and on Linux the
 * resident set of the process itself, which the POSIX launcher execs into Java.
 * What the JVM says of its own heap is `hello`'s load.heapMb.
 *
 * Prints one JSON line per engine and a summary. Nothing here goes anywhere but
 * the engine on this machine.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findEngine, startEngine } from './engine-bridge.mjs'
import { EXAMPLE_DECKS } from '../src/data/example-decks.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const ENGINES = Math.max(1, Number(flag('engines', 1)))
const TURNS = Number(flag('turns', 12))
const SEED = Number(flag('seed', 20260926))
const GAME = flag('game', 'commander')
const LEVEL = flag('level', 'intermediate')
// How long a quitting engine is given before it is ended. The bridge's own two
// seconds are plenty for a quit; a JVM writing a class-data archive as it exits
// (-XX:ArchiveClassesAtExit, a training run) needs longer, or it is killed mid-write.
const GRACE_MS = Number(flag('grace', 2000))
const MB = 1024 * 1024

// The Guff deck as the engine knows it at the pin: the fixture the live suite holds
// to the engine names the cards it does not (tests/fixtures/example-guff.json).
const STAND_IN = 'Narset, Enlightened Master'
const guffDeck = () => {
  const unknown = new Set(JSON.parse(readFileSync(new URL('../tests/fixtures/example-guff.json', import.meta.url), 'utf8')).unknown)
  const guff = EXAMPLE_DECKS.find((d) => d.commanders.includes('Commodore Guff'))
  const deck = {}
  for (const { name, quantity } of guff.main) if (!unknown.has(name) && name !== STAND_IN) deck[name] = quantity
  return deck
}
const GOBLINS = { Mountain: 14, 'Raging Goblin': 6, 'Goblin Bully': 4, 'Hulking Goblin': 4, 'Volcanic Hammer': 4, 'Lava Axe': 2 }

/** The JVM's pid: the child itself on POSIX (the launcher execs Java), java.exe under cmd.exe on Windows. */
const jvmOf = async (pid) => {
  if (process.platform !== 'win32') return pid
  for (let i = 0; i < 50; i++) {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid} AND Name='java.exe'").ProcessId`], { encoding: 'utf8' }).trim()
    if (/^\d+$/.test(out)) return Number(out)
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

/** Samples a process's memory every half second until told to stop; the largest seen and the last. */
const sampler = (pid) => {
  const seen = { ws: 0, peakWs: 0, priv: 0, wsPrivate: 0, last: null, samples: 0 }
  const take = (ws, peakWs, priv, wsPrivate = 0) => {
    seen.samples++
    seen.ws = Math.max(seen.ws, ws); seen.peakWs = Math.max(seen.peakWs, peakWs); seen.priv = Math.max(seen.priv, priv); seen.wsPrivate = Math.max(seen.wsPrivate, wsPrivate)
    seen.last = { ws, priv }
  }
  if (process.platform === 'win32') {
    const ps = spawn('powershell', ['-NoProfile', '-Command',
      `while ($p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { $w = (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=${pid}").WorkingSetPrivate; '{0} {1} {2} {3}' -f $p.WorkingSet64, $p.PeakWorkingSet64, $p.PrivateMemorySize64, $w; Start-Sleep -Milliseconds 500 }`],
    { stdio: ['ignore', 'pipe', 'ignore'] })
    let buffer = ''
    ps.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      for (const line of lines) { const [a, b, c, d] = line.trim().split(' ').map(Number); if (Number.isFinite(a)) take(a, b, c, Number.isFinite(d) ? d : 0) }
    })
    return { seen, stop: () => ps.kill() }
  }
  const timer = setInterval(() => {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8')
      const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1] ?? 0) * 1024
      take(kb('VmRSS'), kb('VmHWM'), kb('RssAnon'), kb('RssAnon'))
    } catch { /* gone */ }
  }, 500)
  return { seen, stop: () => clearInterval(timer) }
}

/** One engine: started, its corpus loaded, one game played; what it cost. */
async function run(n) {
  const command = findEngine()
  const t0 = Date.now()
  const engine = startEngine({ command, timeoutMs: 180_000, onStderr: (line) => { if (!/^\s*$/.test(line)) process.stderr.write(`[engine ${n}] ${line}\n`) } })
  const jvm = await jvmOf(engine.pid)
  const watch = jvm ? sampler(jvm) : null
  const out = { engine: n, opts: process.env.COMPANION_OPTS ?? '', game: GAME }
  try {
    const hello = await engine.call('hello', {}, { timeoutMs: 180_000 })
    out.helloMs = Date.now() - t0
    out.loadMs = hello.load?.ms ?? null
    out.heapMb = hello.load?.heapMb ?? null
    out.protocol = hello.protocol
    out.afterLoadMb = watch?.seen.last ? Math.round(watch.seen.last.ws / MB) : null
    const mine = GAME === 'goblins' ? { deck: GOBLINS } : { deck: guffDeck(), commander: STAND_IN }
    const bot = GAME === 'goblins' ? { deck: 'mirror' } : { deck: 'own', format: 'commander' }
    const g0 = Date.now()
    let s = await engine.call('new', {
      ...(GAME === 'goblins' ? {} : { format: 'commander' }),
      players: [{ name: 'You', ...mine, autoPass: true }, { name: 'Bot', ai: 'heuristic', level: LEVEL, ...bot }],
      seed: SEED + n, pace: true,
    })
    out.dealtAs = s.format ?? 'standard'
    // The profile the engine's seat took, as the reply names it: a level it does not
    // know would be played some other way, and the run would measure that instead.
    out.profile = s.seats?.find((x) => x.ai)?.profile ?? null
    let steps = 0
    let slowest = 0
    for (let guard = 0; guard < 5000 && !s.over && s.turn <= TURNS; guard++) {
      steps++
      const a = Date.now()
      if (s.waiting === 'engine') s = await engine.call('continue')
      else if (s.waiting === 'decision') s = await engine.call('decide', { auto: true })
      else if (s.waiting === 'action') {
        const play = s.actions.find((x) => x.meaningful && x.affordable && !x.mana && x.type !== 'PassPriority' && !['DeclareAttackers', 'DeclareBlockers'].includes(x.type))
        const pass = s.actions.find((x) => x.type === 'PassPriority') ?? s.actions.find((x) => x.type === 'DeclareAttackers' || x.type === 'DeclareBlockers')
        const passing = () => engine.call('act', { index: pass.index, ...(pass.type === 'DeclareAttackers' ? { attackers: {} } : pass.type === 'DeclareBlockers' ? { blockers: {} } : {}) })
        if (!play) s = await passing()
        else { try { s = await engine.call('act', { index: play.index, auto: true }) } catch { s = await passing() } }
      } else break
      slowest = Math.max(slowest, Date.now() - a)
    }
    out.turn = s.turn
    out.over = Boolean(s.over)
    out.finished = Boolean(s.over) || s.turn > TURNS
    out.steps = steps
    out.gameMs = Date.now() - g0
    out.slowestStepMs = slowest
  } catch (e) {
    out.error = e.message
    out.finished = false
  }
  // A last sample after the game, then the process let go.
  await new Promise((r) => setTimeout(r, 1200))
  if (watch) {
    watch.stop()
    out.peakWorkingSetMb = Math.round(Math.max(watch.seen.ws, watch.seen.peakWs) / MB)
    out.peakPrivateMb = Math.round(watch.seen.priv / MB)
    // The part of the working set no other process shares: on Windows the performance counter's, on Linux RssAnon.
    out.peakPrivateWorkingSetMb = Math.round(watch.seen.wsPrivate / MB)
    out.endWorkingSetMb = watch.seen.last ? Math.round(watch.seen.last.ws / MB) : null
    out.samples = watch.seen.samples
  }
  const q0 = Date.now()
  await engine.close({ graceMs: GRACE_MS })
  out.quitMs = Date.now() - q0
  return out
}

const results = await Promise.all(Array.from({ length: ENGINES }, (_, i) => run(i + 1)))
for (const r of results) console.log(JSON.stringify(r))
const sum = (k) => results.reduce((n, r) => n + (r[k] ?? 0), 0)
console.log(`\n${ENGINES} engine(s), ${GAME}, COMPANION_OPTS "${process.env.COMPANION_OPTS ?? ''}": `
  + `corpus loaded in ${results.map((r) => r.loadMs).join(', ')} ms (first answer ${results.map((r) => r.helloMs).join(', ')} ms); `
  + `peak working set ${results.map((r) => r.peakWorkingSetMb).join(', ')} MB (together ${sum('peakWorkingSetMb')}), `
  + `peak private ${results.map((r) => r.peakPrivateMb).join(', ')} MB, of it in the working set ${results.map((r) => r.peakPrivateWorkingSetMb).join(', ')} MB (together ${sum('peakPrivateWorkingSetMb')}); `
  + `games ${results.map((r) => (r.finished ? `finished (turn ${r.turn}${r.over ? ', over' : ''})` : `did not finish: ${r.error ?? 'stopped'}`)).join('; ')}`)
process.exitCode = results.every((r) => r.finished) ? 0 : 1
