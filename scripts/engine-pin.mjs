#!/usr/bin/env node
/**
 * Moving the engine's pin, as the weekly workflow does it
 * (.github/workflows/engine-pin.yml; HANDOFF.md §3 item 12): upstream Argentum's
 * `main` is built with engine/, the live suite and the engine's browser specs are
 * run against it, and only where every one of them passed is a pull request
 * opened moving ENGINE_REV to it. The owner merges it; nothing here does.
 *
 *   node scripts/engine-pin.mjs specs
 *       the engine's browser specs, for `browser-suite.mjs --only=`
 *   gh pr list --json number,headRefName,isCrossRepository,author | node scripts/engine-pin.mjs offers [--head <branch>]
 *       of those pull requests, the ones this workflow opened, as `#1, #2`
 *   node scripts/engine-pin.mjs hello <file> --rev <commit> [--date <when>] [--built <seconds> | --restored]
 *       asks the engine findEngine finds what it holds, and keeps the answer
 *   node scripts/engine-pin.mjs body <dir> [--offer] [--repo <url>] [--run <url>] [--status <s>] [--ahead <n>]
 *       the pull request's body, or the run's summary, from what a run kept in <dir>
 *   node scripts/engine-pin.mjs move <from> <to>
 *       moves ENGINE_REV in scripts/engine-build.sh, and nothing else
 *
 * <dir> holds what the run kept: pin.json and next.json (`hello`), live.json
 * (vitest's JSON reporter over tests/engine-live.test.js) and browser.json
 * (`browser-suite.mjs --record=`). Every one is read forgivingly — a file that is
 * missing, or that an older run wrote in another shape, says less rather than
 * throws — and `--offer` writes no body unless every test in them is there and
 * passed, so the workflow's "only if they pass" holds in the data as well as in
 * the order of its jobs.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { findEngine, startEngine } from './engine-bridge.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The browser specs that drive the real engine. The workflow runs these alone
 * against upstream (`specs` prints them for the runner), and the verdict asks
 * each to have been run and passed, so the list is kept here once.
 */
export const ENGINE_SPECS = ['tests/browser/game-engine.spec.mjs', 'tests/browser/engine-restart.spec.mjs']
const LIVE = 'tests/engine-live.test.js'

const COMMIT = /^[0-9a-f]{40}$/
const shortOf = (rev) => (typeof rev === 'string' && COMMIT.test(rev) ? rev.slice(0, 7) : null)
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const count = (n) => n.toLocaleString('en-GB')
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`
const dayOf = (when) => (typeof when === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(when)?.[0] ?? null : null)

/**
 * Text that did not come from this repository — a set's name as upstream spells
 * it — made to read as text in Markdown: no line breaks, no table cells split by
 * a bar, no link, heading, emphasis, @-mention or #-reference made of it.
 */
export function md(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\`*_[\]<>|#~@]/g, '\\$&')
    .trim()
}

/**
 * The same for text set in a code span, where a backslash is shown rather than
 * read: only a bar is escaped, which GitHub's tables read even in code, and a
 * backtick, which would end the span, becomes a quote.
 */
export function code(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/`/g, "'")
    .replace(/\|/g, '\\|')
    .trim()
}

/** A JSON file, or null where there is none or it is not JSON. */
export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * The sets a `hello` says it holds, by code, in the order it gives them (release
 * order). An entry with no code is dropped; a field it lacks is null. Null where
 * there is no list at all, which is "unknown", not "none".
 */
export function setsOf(hello) {
  if (!Array.isArray(hello?.sets)) return null
  const sets = new Map()
  for (const entry of hello.sets) {
    const code = typeof entry?.code === 'string' ? entry.code.trim() : ''
    if (!code || sets.has(code.toUpperCase())) continue
    sets.set(code.toUpperCase(), {
      code,
      name: typeof entry.name === 'string' ? entry.name : null,
      released: typeof entry.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.released) ? entry.released : null,
      incomplete: typeof entry.incomplete === 'boolean' ? entry.incomplete : null,
    })
  }
  return sets
}

/**
 * What changed in the sets between the pin's `hello` and upstream's: the sets
 * added (in upstream's order), the sets gone, and those whose own "incomplete"
 * mark Argentum took off or put on. Null where either side's list is unknown.
 */
export function setsSince(pinHello, nextHello) {
  const before = setsOf(pinHello)
  const after = setsOf(nextHello)
  if (!before || !after) return null
  const was = (set) => before.get(set.code.toUpperCase())
  return {
    before: before.size,
    after: after.size,
    added: [...after.values()].filter((set) => !was(set)),
    gone: [...before.values()].filter((set) => !after.has(set.code.toUpperCase())),
    completed: [...after.values()].filter((set) => was(set)?.incomplete === true && set.incomplete === false),
    unfinished: [...after.values()].filter((set) => was(set)?.incomplete === false && set.incomplete === true),
  }
}

/**
 * The live suite's results from vitest's JSON reporter: how many ran, passed,
 * failed and were skipped, how long it took, and the names of the tests that
 * failed. Null where there is no report.
 */
export function liveOf(report) {
  if (!report || typeof report !== 'object') return null
  const results = Array.isArray(report.testResults) ? report.testResults : []
  const ends = results.map((r) => num(r?.endTime)).filter((t) => t !== null)
  const start = num(report.startTime)
  const failures = results.flatMap((r) => (Array.isArray(r?.assertionResults) ? r.assertionResults : []))
    .filter((a) => a?.status === 'failed')
    .map((a) => String(a.fullName ?? a.title ?? 'a test with no name'))
  return {
    total: num(report.numTotalTests),
    passed: num(report.numPassedTests),
    failed: num(report.numFailedTests),
    skipped: (num(report.numPendingTests) ?? 0) + (num(report.numTodoTests) ?? 0),
    success: report.success === true,
    ms: start !== null && ends.length ? Math.max(...ends) - start : null,
    failures,
  }
}

/** The engine's browser specs as `browser-suite.mjs --record=` kept them. Null where there is no record. */
export function browserOf(record) {
  if (!record || typeof record !== 'object' || !Array.isArray(record.specs)) return null
  return {
    total: num(record.total),
    passed: record.passed === true,
    specs: record.specs.filter((s) => typeof s?.spec === 'string').map((s) => ({
      spec: s.spec,
      passed: num(s.passed),
      failed: num(s.failed),
      note: typeof s.note === 'string' ? s.note : null,
      fault: typeof s.fault === 'string' ? s.fault : null,
      // A record from before the runner kept them says none.
      failures: Array.isArray(s.failures) ? s.failures.filter((f) => typeof f === 'string') : [],
      ms: num(s.ms),
    })),
  }
}

/**
 * Why the run may not offer upstream as the pin: an empty list where every test
 * is there and passed and both engines said what they hold. Anything unread or
 * unrun is a reason, never a pass.
 */
export function verdictOf({ pin, next, live, browser }) {
  const why = []
  if (!pin?.hello) why.push("the pin's engine was not built, or said nothing readable to `hello`, so what is new since it is unknown")
  if (!next?.hello) why.push("upstream's engine was not built, or said nothing readable to `hello`")
  if (!shortOf(next?.rev)) why.push('which upstream commit was built is not recorded')
  if (!live) why.push(`${LIVE} left no results`)
  else {
    if ((live.failed ?? 0) > 0) why.push(`${LIVE}: ${live.failed} of ${live.total ?? '?'} failed`)
    if (!live.total) why.push(`${LIVE} ran no tests`)
    if (live.skipped > 0) why.push(`${LIVE}: ${live.skipped} skipped, so not run against upstream`)
    if (live.total && live.passed !== live.total && !(live.failed > 0)) why.push(`${LIVE}: ${live.passed ?? 0} of ${live.total} passed`)
    if (!live.success && !why.some((w) => w.startsWith(LIVE))) why.push(`${LIVE} did not succeed`)
  }
  if (!browser) why.push("the engine's browser specs left no record")
  else {
    for (const spec of ENGINE_SPECS) {
      const run = browser.specs.find((s) => s.spec === spec)
      if (!run) why.push(`${spec} was not run`)
      else if (run.fault) why.push(`${spec}: ${run.fault}`)
      else if (/skipped/i.test(run.note ?? '')) why.push(`${spec} ended skipped (${run.note})`)
      else if ((run.failed ?? 0) > 0 || !run.passed) why.push(`${spec}: ${run.passed ?? 0} passed, ${run.failed ?? '?'} failed`)
    }
  }
  return why
}

// GitHub Actions as `gh pr list --json author` names it: `app/github-actions`,
// gh's spelling for an app, where the web and the REST API say
// `github-actions[bot]`; either is read.
const ACTIONS = /^(?:app\/)?github-actions(?:\[bot\])?$/

/**
 * The pull requests this workflow opened, of those `gh pr list --json
 * number,headRefName,isCrossRepository,author` gave, as `#<number>`: from a
 * branch of this repository named `engine-pin/…` (or `head`, where one is
 * named), and opened by GitHub Actions. A fork's pull request from a branch of
 * the same name is somebody else's, and neither holds back an offer nor says
 * the owner turned one down. Read forgivingly: an entry that does not say it is
 * from this repository, or who opened it, is not counted as the workflow's.
 */
export function offersOf(prs, head = null) {
  if (!Array.isArray(prs)) return []
  return prs.filter((pr) => Number.isInteger(pr?.number)
    && typeof pr.headRefName === 'string'
    && (head ? pr.headRefName === head : pr.headRefName.startsWith('engine-pin/'))
    && pr.isCrossRepository === false
    && ACTIONS.test(typeof pr.author?.login === 'string' ? pr.author.login : ''))
    .map((pr) => `#${pr.number}`)
}

/** Where upstream is, as a web address to link to; null where it is not a GitHub repository. */
export function webOf(repo) {
  const said = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(repo ?? '').trim())
  return said ? `https://github.com/${said[1]}/${said[2]}` : null
}

/**
 * The files that name the old pin by its short form, besides the build script
 * the pull request moves, as `path: count`. Null where git could not say.
 */
export function mentionsOf(short, cwd = root) {
  if (!short) return null
  try {
    const out = execFileSync('git', ['grep', '-c', '-I', '-F', short, '--', '.', ':(exclude)scripts/engine-build.sh'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split(/\r?\n/).filter(Boolean).map((line) => {
      const at = line.lastIndexOf(':')
      return { path: line.slice(0, at), count: Number(line.slice(at + 1)) || 1 }
    })
  } catch (error) {
    // git grep says 1, and nothing, where nothing matches.
    return error?.status === 1 ? [] : null
  }
}

function setRow(set, mark) {
  return `| \`${code(set.code)}\` | ${md(set.name) || '—'} | ${set.released ?? '—'} | ${mark(set)} |`
}

/**
 * The pull request's body (`offer`), or the run's summary where it may not be
 * offered: what upstream is against the pin, the sets new since it, what was
 * measured, and what was tested. Everything in it is from the run's own files
 * and says so; nothing in it is written by hand.
 */
export function bodyOf({ pin, next, live, browser, offer = false, repo = null, runUrl = null, status = null, ahead = null, mentions = null }) {
  const from = shortOf(pin?.rev)
  const to = shortOf(next?.rev)
  const web = webOf(repo)
  const lines = []
  const on = num(Number(ahead))
  const day = dayOf(next?.date)
  const changes = web && from && to ? ` ([the changes](${web}/compare/${from}...${to}))` : ''
  const far = status === 'diverged'
    ? ", on a history that no longer holds the pin (GitHub's comparison says the two have diverged)"
    : on && on > 0 ? `, ${count(on)} commit${on === 1 ? '' : 's'} on` : ''
  lines.push(offer
    ? `Moves the engine's pin, \`ENGINE_REV\` in \`scripts/engine-build.sh\`, from Argentum \`${from ?? '?'}\` to \`${to ?? '?'}\`: upstream \`main\`${day ? ` as committed on ${day}` : ''}${far}${changes}.`
    : `Upstream Argentum \`main\` at \`${to ?? '?'}\`${day ? `, committed on ${day}` : ''}${far}, tried against the pin, \`${from ?? '?'}\`${changes}.`)
  lines.push('')
  const run = runUrl ? `[this run](${runUrl})` : 'this run'
  lines.push(offer
    ? `Opened by the weekly workflow \`.github/workflows/engine-pin.yml\` (HANDOFF.md §3 item 12), which built upstream \`main\` with this repository's \`engine/\`, ran the live suite and the engine's browser specs against it, and opens a pull request only where every one of them passed. Everything below was measured or read by ${run}; none of it is written by hand. It is the owner's to merge.`
    : `Written by \`.github/workflows/engine-pin.yml\` (HANDOFF.md §3 item 12) from what ${run} kept. It opens a pull request moving the pin only where every test below passed.`)
  lines.push('')

  if (!offer) {
    const why = verdictOf({ pin, next, live, browser })
    // The reasons are this repository's own words: the suites' names, the runner's faults.
    if (why.length) lines.push('**Not offered**, because:', '', ...why.map((w) => `- ${w}`))
    // The verdict, not the outcome: the pull request is the `offer` job's to
    // open, and it can still fail there (the repository's setting still off, say),
    // which its own summary says.
    else lines.push("**Every test passed**, so the `offer` job moves the pin and opens the pull request; its own summary says whether it did.")
    lines.push('')
  }

  lines.push('### Sets new since the pin', '')
  const sets = setsSince(pin?.hello, next?.hello)
  if (!sets) lines.push("Unknown: an engine's `hello` gave no list of sets to compare.")
  else {
    lines.push("From each engine's `hello.sets`, every set Argentum registers, in its release order.", '')
    if (sets.added.length) {
      lines.push('| Code | Set | Released | Argentum\'s own mark |', '| --- | --- | --- | --- |')
      for (const set of sets.added) lines.push(setRow(set, (s) => (s.incomplete === true ? 'incomplete' : s.incomplete === false ? '—' : 'not said')))
    } else lines.push(`None: upstream registers the same ${count(sets.after)} sets as the pin.`)
    const listed = (list) => list.map((s) => `\`${code(s.code)}\` ${md(s.name)}`.trim()).join(', ')
    if (sets.gone.length) lines.push('', `Gone since the pin: ${listed(sets.gone)}.`)
    if (sets.completed.length) lines.push('', `No longer marked incomplete by Argentum: ${listed(sets.completed)}.`)
    if (sets.unfinished.length) lines.push('', `Marked incomplete by Argentum since the pin: ${listed(sets.unfinished)}.`)
  }
  lines.push('')

  lines.push('### Measured on this run\'s runner', '')
  const a = pin?.hello ?? {}
  const b = next?.hello ?? {}
  const cell = (value, say) => (value === null ? 'not said' : say(value))
  const row = (label, get, say) => `| ${label} | ${cell(get(a), say)} | ${cell(get(b), say)} |`
  lines.push(`| | The pin, \`${from ?? '?'}\` | Upstream, \`${to ?? '?'}\` |`, '| --- | ---: | ---: |')
  lines.push(row('Protocol (`hello.protocol`)', (h) => num(h.protocol), String))
  lines.push(row('Card names a deck may hold (`hello.cards`)', (h) => num(h.cards), count))
  lines.push(row('Sets (`hello.sets`)', (h) => (Array.isArray(h.sets) ? setsOf(h).size : null), count))
  lines.push(row('Loading the corpus, the first answer (`hello.load.ms`)', (h) => num(h.load?.ms), secs))
  lines.push(row('Heap once loaded (`hello.load.heapMb`)', (h) => num(h.load?.heapMb), (v) => `${count(v)} MB`))
  lines.push(row('Heap ceiling (`hello.load.maxHeapMb`)', (h) => num(h.load?.maxHeapMb), (v) => `${count(v)} MB`))
  const built = (k) => (k?.restored === true ? "restored from `deploy.yml`'s cache"
    : num(k?.builtSeconds) === null ? 'not timed' : `${count(k.builtSeconds)} s, fetched and built`)
  lines.push(`| The build | ${built(pin)} | ${built(next)} |`)
  lines.push('', 'One sample of each, on a shared runner: the load and the heap move a little from run to run.')
  // Said because it makes upstream's build look cheaper than a cold one: the
  // two share a job, and so Gradle's own cache.
  if (num(pin?.builtSeconds) !== null && pin?.restored !== true && num(next?.builtSeconds) !== null) {
    lines.push("Upstream's build came after the pin's in the same job, with Gradle's cache warm from it.")
  }
  lines.push('')

  lines.push('### Tests against upstream `main`', '')
  lines.push('| Suite | Result | Time |', '| --- | --- | ---: |')
  if (!live) lines.push(`| \`${LIVE}\` | no results | — |`)
  else {
    const said = live.total === null ? 'no count' : `${count(live.passed ?? 0)} of ${count(live.total)} passed${live.failed ? `, ${count(live.failed)} failed` : ''}${live.skipped ? `, ${count(live.skipped)} skipped` : ''}`
    lines.push(`| \`${LIVE}\` | ${said} | ${live.ms === null ? '—' : secs(live.ms)} |`)
  }
  for (const spec of ENGINE_SPECS) {
    const ran = browser?.specs.find((s) => s.spec === spec)
    const said = !ran ? 'not run' : ran.fault ? `**Failed:** ${md(ran.fault)}` : `${count(ran.passed ?? 0)} passed, ${count(ran.failed ?? 0)} failed${ran.note ? ` (${md(ran.note)})` : ''}`
    lines.push(`| \`${spec}\` | ${said} | ${ran?.ms == null ? '—' : secs(ran.ms)} |`)
  }
  const failed = (where, names) => {
    if (!names?.length) return
    lines.push('', `Failed in \`${where}\`:`, '')
    for (const name of names.slice(0, 20)) lines.push(`- ${md(name)}`)
    if (names.length > 20) lines.push(`- and ${count(names.length - 20)} more`)
  }
  failed(LIVE, live?.failures)
  for (const spec of ENGINE_SPECS) failed(spec, browser?.specs.find((s) => s.spec === spec)?.failures)
  lines.push('')

  if (offer) {
    lines.push('### Before merging', '')
    lines.push("- This repository's own checks, the whole unit and browser suites with the engine built, wait for approval on a pull request a workflow opened (GitHub's rule for its `GITHUB_TOKEN`): **Approve workflows to run**, in the merge box, starts them. They share `deploy.yml`'s one concurrency group, so starting them cancels a run on `main` still going (HANDOFF.md §6).")
    if (mentions?.length) {
      lines.push(`- Still naming the old pin, \`${from}\`, to be measured again or left as the dated records they are: ${mentions.map((m) => `\`${code(m.path)}\` (${count(m.count)})`).join(', ')}.`)
    } else if (mentions) lines.push(`- Nothing else in the repository names the old pin, \`${from}\`.`)
    lines.push("- A pin moved is a deliberate commit, with the first compile and a game measured again (`engine/README.md`): the numbers above are GitHub's runner's, not the owner's machine's.")
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * The build script with ENGINE_REV moved from one commit to another. It holds
 * the pin on one line, `rev=${ENGINE_REV:-<commit>}`; anything else — no such
 * line, two, or one naming another commit than the one being moved from — is
 * refused rather than guessed at, so the pull request moves exactly the pin the
 * run measured against.
 */
export function moved(script, from, to) {
  if (!COMMIT.test(from ?? '') || !COMMIT.test(to ?? '')) throw new Error(`a pin is a commit's 40 hex digits; was given "${from}" and "${to}"`)
  const pinned = /^rev=\$\{ENGINE_REV:-([0-9a-f]{40})\}\r?$/
  const lines = String(script).split('\n')
  const at = lines.flatMap((line, i) => (pinned.test(line) ? [i] : []))
  if (at.length !== 1) throw new Error(`scripts/engine-build.sh has ${at.length} lines of the form rev=\${ENGINE_REV:-<commit>}, not one`)
  const was = pinned.exec(lines[at[0]])[1]
  if (was !== from) throw new Error(`scripts/engine-build.sh pins ${was}, not ${from}`)
  lines[at[0]] = lines[at[0]].replace(from, to)
  return lines.join('\n')
}

async function hello(file, { rev, date, built, restored }) {
  const command = findEngine()
  if (!command) throw new Error('There is no engine where findEngine looks (scripts/engine-build.sh builds one).')
  // The first answer waits on the whole corpus loading: the relay allows two
  // minutes (engine/README.md), and a shared runner is given a little more.
  const engine = startEngine({ command, timeoutMs: 180_000, onStderr: (line) => process.stderr.write(`${line}\n`) })
  try {
    const said = await engine.call('hello')
    const builtSeconds = built === undefined || built === '' ? null : Number(built)
    const record = { rev: rev ?? null, date: date || null, builtSeconds: Number.isFinite(builtSeconds) ? builtSeconds : null, restored: restored === true, hello: said }
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`${shortOf(rev) ?? 'engine'}: protocol ${said.protocol}, ${said.cards} card names, ${Array.isArray(said.sets) ? said.sets.length : '?'} sets, corpus loaded in ${said.load?.ms} ms, ${said.load?.heapMb} MB of ${said.load?.maxHeapMb} MB`)
  } finally {
    await engine.close()
  }
}

async function main(argv) {
  const [what, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      rev: { type: 'string' }, date: { type: 'string' }, built: { type: 'string' }, restored: { type: 'boolean' },
      offer: { type: 'boolean' }, repo: { type: 'string' }, run: { type: 'string' }, status: { type: 'string' }, ahead: { type: 'string' },
      head: { type: 'string' },
    },
  })
  if (what === 'specs') {
    console.log(ENGINE_SPECS.join(','))
  } else if (what === 'offers') {
    // gh's answer on stdin. Anything but a list of pull requests is none, and
    // gh failing is the workflow's to see: its step runs with pipefail.
    let prs = null
    try { prs = JSON.parse(readFileSync(0, 'utf8')) } catch { prs = null }
    console.log(offersOf(prs, values.head || null).join(', '))
  } else if (what === 'hello' && positionals[0]) {
    await hello(positionals[0], values)
  } else if (what === 'body' && positionals[0]) {
    const dir = positionals[0]
    const kept = {
      pin: readJson(join(dir, 'pin.json')),
      next: readJson(join(dir, 'next.json')),
      live: liveOf(readJson(join(dir, 'live.json'))),
      browser: browserOf(readJson(join(dir, 'browser.json'))),
    }
    if (values.offer) {
      const why = verdictOf(kept)
      if (why.length) {
        console.error(`Not offered: ${why.join('; ')}.`)
        process.exitCode = 1
        return
      }
    }
    process.stdout.write(bodyOf({
      ...kept,
      offer: values.offer === true,
      repo: values.repo ?? null,
      runUrl: values.run ?? null,
      status: values.status || null,
      ahead: values.ahead || null,
      mentions: values.offer ? mentionsOf(shortOf(kept.pin?.rev)) : null,
    }))
  } else if (what === 'move' && positionals.length === 2) {
    const file = resolve(root, 'scripts', 'engine-build.sh')
    writeFileSync(file, moved(readFileSync(file, 'utf8'), positionals[0], positionals[1]))
    console.log(`scripts/engine-build.sh: ENGINE_REV moved from ${positionals[0]} to ${positionals[1]}`)
  } else {
    console.error('usage: engine-pin.mjs specs | offers [--head <branch>] | hello <file> --rev <commit> | body <dir> [--offer] | move <from> <to>')
    process.exitCode = 2
  }
}

// Run as a program, not imported by a test; both sides through realpath, as
// browser-suite.mjs does, so a checkout reached through a link still runs.
const sameFile = (a, b) => {
  try {
    const [x, y] = [realpathSync(a), realpathSync(b)]
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
  } catch {
    return false
  }
}
if (process.argv[1] && sameFile(fileURLToPath(import.meta.url), process.argv[1])) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
