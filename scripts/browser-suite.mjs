#!/usr/bin/env node
/**
 * The browser suite as `npm run test:browser` runs it — one spec after another,
 * each given the same arguments, stopping at the first that fails — with how
 * long each took said as it goes and set out together at the end.
 *
 *   node scripts/browser-suite.mjs http://localhost:4173/
 *   node scripts/browser-suite.mjs --only=game-engine.spec.mjs,engine-restart.spec.mjs --record=run.json http://localhost:4173/
 *
 * The specs are package.json's own `test:browser` chain, read rather than
 * copied, so a spec added there (HANDOFF.md §0) runs here with no second edit.
 * CI runs the suite through this (HANDOFF.md M9) for two things the chain
 * cannot do: say each spec's time, so the engine's specs are watched against
 * their budget, and, where ENGINE_REQUIRED says the engine was built for this
 * run, fail a spec that ended skipped rather than count it passed having driven
 * nothing. In a GitHub Actions step (GITHUB_STEP_SUMMARY set) the times also go
 * into the job's summary.
 *
 * Two arguments are the runner's own and go to no spec. `--only=` runs the named
 * specs of the chain alone, in the chain's order: the weekly offer to move the
 * engine's pin (HANDOFF.md §3 item 12) runs the engine's two against upstream.
 * `--record=` writes what each spec did as JSON, for that offer's pull request.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineRequired } from './engine-bridge.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The specs a `test:browser` chain runs, in order. The chain is only ever
 * `node <spec>.spec.mjs` joined by `&&`; anything else in it is refused rather
 * than guessed at, since a step this cannot read would otherwise not be run.
 */
export function specsOf(chain) {
  return String(chain ?? '').split('&&').map((part) => {
    const said = part.trim()
    const spec = /^node\s+(\S+\.spec\.mjs)$/.exec(said)?.[1]
    if (!spec) throw new Error(`test:browser holds "${said}", which is not "node <file>.spec.mjs", so scripts/browser-suite.mjs cannot run it as the chain would`)
    return spec
  })
}

/**
 * The runner's own arguments taken out of those every spec is given: `--only=`
 * (names, comma-separated, and it may be given more than once) and `--record=`
 * (a file). The rest go to each spec as they came, the address first.
 */
export function optionsOf(argv) {
  const only = []
  let record = null
  const args = []
  for (const arg of argv ?? []) {
    const named = /^--only=(.*)$/.exec(arg)
    const kept = /^--record=(.*)$/.exec(arg)
    if (named) only.push(...named[1].split(',').map((name) => name.trim()).filter(Boolean))
    else if (kept) record = kept[1] || null
    else args.push(arg)
  }
  return { only, record, args }
}

/**
 * The specs of the chain that `only` names, in the chain's order, or the whole
 * chain where it names none. A name is a spec's path as the chain has it or its
 * file name alone, and must be exactly one spec of the chain: a misspelt one
 * would otherwise run nothing, and nothing run is not a pass.
 */
export function pick(specs, only) {
  if (!only?.length) return specs
  const wanted = new Set()
  for (const name of only) {
    const said = name.replace(/\\/g, '/').replace(/^\.\//, '')
    const found = specs.filter((spec) => spec === said || spec.split('/').at(-1) === said)
    if (found.length !== 1) throw new Error(`--only names "${name}", which is ${found.length ? 'more than one spec' : 'no spec'} of test:browser`)
    wanted.add(found[0])
  }
  return specs.filter((spec) => wanted.has(spec))
}

/**
 * What a run did, as `--record=` writes it: every spec run with its checks,
 * why it failed if it did, the checks it said failed, and its time; `passed`
 * only where every spec picked was run and none failed, and never where none was.
 */
export function recordOf(runs, total = runs.length) {
  return {
    total,
    passed: total > 0 && runs.length === total && !runs.some((r) => r.fault),
    specs: runs.map((r) => ({
      spec: r.spec,
      passed: r.tally?.passed ?? null,
      failed: r.tally?.failed ?? null,
      note: r.tally?.note ?? null,
      fault: r.fault ?? null,
      failures: r.failures ?? [],
      ms: Math.round(r.ms),
    })),
  }
}

/**
 * A spec's last word: every spec ends with `N passed, M failed`, and one that
 * skipped says why in brackets after it. Null where the last line is not that.
 */
export function tallyOf(output) {
  const last = String(output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? ''
  const said = /^(\d+) passed, (\d+) failed(?: \((.+)\))?$/.exec(last)
  return said ? { passed: Number(said[1]), failed: Number(said[2]), note: said[3] ?? null } : null
}

/** Why a spec's run does not count as passed, or null where it does. */
export function faultOf({ code, tally, required }) {
  if (!tally) return code === 0 ? 'ended without its "N passed, M failed" line' : `exited with ${code} before its "N passed, M failed" line`
  if (tally.failed > 0) return `${tally.failed} failed${tally.note ? ` (${tally.note})` : ''}`
  if (code !== 0) return `exited with ${code} after ${tally.passed} passed`
  if (required && /skipped/i.test(tally.note ?? '')) {
    return `ended skipped (${tally.note}), in a run ENGINE_REQUIRED says has the engine built for it`
  }
  return null
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/**
 * The times as a Markdown table for the job's summary: one row per spec run,
 * the one that stopped the suite saying why, and the whole at the foot.
 */
export function summaryOf(runs, total = runs.length) {
  const rows = runs.map((r) => {
    const checks = r.tally ? `${r.tally.passed} passed, ${r.tally.failed} failed${r.tally.note ? ` (${r.tally.note})` : ''}` : '—'
    return `| \`${r.spec}\` | ${r.fault ? `**Failed:** ${r.fault}` : checks} | ${seconds(r.ms)} |`
  })
  const passed = runs.reduce((n, r) => n + (r.tally?.passed ?? 0), 0)
  const ms = runs.reduce((n, r) => n + r.ms, 0)
  const stopped = runs.length < total || runs.some((r) => r.fault)
  const foot = `| **${runs.length} of ${total} specs run** | ${passed.toLocaleString('en-GB')} checks passed${stopped ? ', and the suite stopped at the failure' : ''} | ${seconds(ms)} |`
  return ['### Browser suite, spec by spec', '', '| Spec | Checks | Time |', '| --- | --- | ---: |', ...rows, foot, ''].join('\n')
}

/**
 * The checks a spec's output says failed: every spec's `check` prints a failure
 * as `  FAIL  <what was checked>`. Kept for the record, so a run's summary can
 * name what failed without its log being opened.
 */
export function failuresOf(output) {
  return String(output ?? '').split(/\r?\n/).flatMap((line) => {
    const said = /^ {2}FAIL {2}(.+)$/.exec(line)
    return said ? [said[1].trim()] : []
  })
}

// One spec, its output passed straight through; the tail is kept only to read
// the spec's last line, and the lines that say a check failed, the first twenty.
function run(spec, args) {
  return new Promise((done) => {
    const started = performance.now()
    const child = spawn(process.execPath, [spec, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
    let tail = ''
    let partial = ''
    const failures = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      tail = (tail + chunk).slice(-4096)
      const lines = (partial + chunk).split('\n')
      partial = lines.pop()
      if (failures.length < 20) failures.push(...failuresOf(lines.join('\n')).slice(0, 20 - failures.length))
    })
    child.on('error', (error) => { tail += `\n${error.message}` })
    child.on('close', (code, signal) => done({ code: code ?? (signal ? `signal ${signal}` : 1), tail, failures, ms: performance.now() - started }))
  })
}

async function main(argv) {
  const { only, record, args } = optionsOf(argv)
  const chain = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts?.['test:browser']
  const specs = pick(specsOf(chain), only)
  const required = engineRequired()
  const runs = []
  for (const spec of specs) {
    const { code, tail, failures, ms } = await run(spec, args)
    const tally = tallyOf(tail)
    const fault = faultOf({ code, tally, required })
    runs.push({ spec, tally, fault, failures, ms })
    console.log(`-- ${spec}: ${fault ? `FAILED, ${fault}` : `${tally.passed} passed, ${tally.failed} failed`}, in ${seconds(ms)}\n`)
    if (fault) break
  }
  const summary = summaryOf(runs, specs.length)
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  if (record) writeFileSync(record, `${JSON.stringify(recordOf(runs, specs.length), null, 2)}\n`)
  const failed = runs.some((r) => r.fault)
  console.log(failed ? 'The browser suite failed.' : `The browser suite passed: ${runs.length} specs.`)
  // exitCode rather than exit(): stdout into a pipe is written asynchronously on
  // POSIX (Linux, where CI runs), and exit() there can cut off the summary above
  // before it is out. On Windows a pipe is written synchronously.
  process.exitCode = failed ? 1 : 0
}

// Run as a program, not imported by a test. Both sides through realpath: Node
// names this module by its real path and argv[1] as typed, so a checkout reached
// through a link would compare unequal, run nothing and exit 0 — a suite passing
// having driven nothing.
const sameFile = (a, b) => {
  try {
    const [x, y] = [realpathSync(a), realpathSync(b)]
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
  } catch {
    return false
  }
}
if (process.argv[1] && sameFile(fileURLToPath(import.meta.url), process.argv[1])) await main(process.argv.slice(2))
