// @vitest-environment node
/**
 * The weekly offer to move the engine's pin (scripts/engine-pin.mjs,
 * .github/workflows/engine-pin.yml; HANDOFF.md §3 item 12): that it says the
 * sets new since the pin from each engine's `hello`, offers only where every
 * test ran and passed, counts only its own pull requests as offers open or
 * turned down, reads what an older run kept without throwing, keeps
 * upstream's words from being read as Markdown, and moves the pin and nothing
 * else.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ENGINE_SPECS, md, code, setsOf, setsSince, liveOf, browserOf, verdictOf, webOf, mentionsOf, bodyOf, moved, offersOf,
} from '../scripts/engine-pin.mjs'
import { specsOf } from '../scripts/browser-suite.mjs'

const root = process.cwd()
const PIN = 'a'.repeat(40)
const NEXT = 'b'.repeat(40)

const set = (code, name, released, incomplete) => ({ code, name, released, incomplete })
const helloOf = (sets, { cards = 13_242, ms = 18_675, heapMb = 127 } = {}) => ({
  engine: 'argentum', protocol: 10, cards, sets, load: { ms, legalitiesMs: 600, heapMb, maxHeapMb: 2048 },
})
const pinSets = [set('POR', 'Portal', '1997-05-01', false), set('WHO', 'Doctor Who', '2023-10-13', false), set('BLB', 'Bloomburrow', '2024-08-02', true)]
const nextSets = [
  set('POR', 'Portal', '1997-05-01', false),
  set('NEC', 'Neon Dynasty Commander', '2022-02-18', false),
  set('BLB', 'Bloomburrow', '2024-08-02', false),
  set('EOC', 'Edge of Eternities Commander', '2025-08-01', true),
]
// What vitest's JSON reporter writes, as much of it as is read.
const liveReport = (failed = 0, pending = 0) => ({
  numTotalTests: 69, numPassedTests: 69 - failed - pending, numFailedTests: failed, numPendingTests: pending, numTodoTests: 0,
  startTime: 1_000, success: failed === 0,
  testResults: [{
    endTime: 77_670,
    assertionResults: [
      { fullName: 'the engine on the wire plays a game', status: failed ? 'failed' : 'passed' },
      { fullName: 'the engine on the wire says who it is', status: 'passed' },
    ],
  }],
})
const browserRecord = (over = {}) => ({
  total: 2,
  passed: true,
  specs: [
    { spec: ENGINE_SPECS[0], passed: 212, failed: 0, note: null, fault: null, ms: 239_000, ...over },
    { spec: ENGINE_SPECS[1], passed: 41, failed: 0, note: null, fault: null, ms: 88_000 },
  ],
})
const kept = (over = {}) => ({
  pin: { rev: PIN, restored: true, hello: helloOf(pinSets) },
  next: { rev: NEXT, date: '2026-09-22T08:16:20-04:00', builtSeconds: 302, hello: helloOf(nextSets, { cards: 13_274, ms: 18_409, heapMb: 128 }) },
  live: liveOf(liveReport()),
  browser: browserOf(browserRecord()),
  ...over,
})

describe('offering to move the engine\'s pin', () => {
  it('runs the engine\'s browser specs, each one the chain runs', () => {
    const chain = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts['test:browser']
    for (const spec of ENGINE_SPECS) expect(specsOf(chain)).toContain(spec)
  })

  it('says the sets new since the pin, those gone, and those whose own mark changed', () => {
    const since = setsSince(helloOf(pinSets), helloOf(nextSets))
    expect(since.before).toBe(3)
    expect(since.after).toBe(4)
    expect(since.added.map((s) => s.code)).toEqual(['NEC', 'EOC'])
    expect(since.gone.map((s) => s.code)).toEqual(['WHO'])
    expect(since.completed.map((s) => s.code)).toEqual(['BLB'])
    expect(setsSince(helloOf(nextSets), helloOf(pinSets)).unfinished.map((s) => s.code)).toEqual(['BLB'])
    // No list on either side is unknown, not "none new".
    expect(setsSince(helloOf(pinSets), { protocol: 10 })).toBeNull()
    expect(setsSince(null, helloOf(nextSets))).toBeNull()
  })

  it('reads the sets forgivingly: no code is dropped, a code twice is one set, a field missing is null', () => {
    const sets = setsOf({ sets: [set('por', 'Portal', '1997-05-01', false), { name: 'No code' }, null, 'POR', set('POR', 'Again', null, true), { code: 'X1', released: 'soon' }] })
    expect([...sets.keys()]).toEqual(['POR', 'X1'])
    expect(sets.get('POR')).toEqual({ code: 'por', name: 'Portal', released: '1997-05-01', incomplete: false })
    expect(sets.get('X1')).toEqual({ code: 'X1', name: null, released: null, incomplete: null })
    expect(setsOf({ sets: 'all of them' })).toBeNull()
  })

  it('reads the live suite from vitest\'s report, and the specs from the runner\'s record, forgivingly', () => {
    expect(liveOf(liveReport())).toEqual({ total: 69, passed: 69, failed: 0, skipped: 0, success: true, ms: 76_670, failures: [] })
    expect(liveOf(liveReport(1)).failures).toEqual(['the engine on the wire plays a game'])
    expect(liveOf({ numTotalTests: '69' })).toEqual({ total: null, passed: null, failed: null, skipped: 0, success: false, ms: null, failures: [] })
    expect(liveOf(null)).toBeNull()
    expect(browserOf(browserRecord()).specs[0]).toEqual({ spec: ENGINE_SPECS[0], passed: 212, failed: 0, note: null, fault: null, failures: [], ms: 239_000 })
    expect(browserOf({ total: 2, specs: [{ passed: 3 }, { spec: 'x', passed: 'many', failures: ['one', 2] }] }).specs)
      .toEqual([{ spec: 'x', passed: null, failed: null, note: null, fault: null, failures: ['one'], ms: null }])
    expect(browserOf({ specs: 'none' })).toBeNull()
  })

  it('offers only where every test ran and passed, and both engines said what they hold', () => {
    expect(verdictOf(kept())).toEqual([])
    expect(verdictOf(kept({ live: liveOf(liveReport(2)) }))).toEqual(['tests/engine-live.test.js: 2 of 69 failed'])
    expect(verdictOf(kept({ live: liveOf(liveReport(0, 69)) })).join()).toMatch(/69 skipped, so not run against upstream/)
    expect(verdictOf(kept({ live: null }))).toEqual(['tests/engine-live.test.js left no results'])
    expect(verdictOf(kept({ live: liveOf({}) })).join()).toMatch(/ran no tests/)
    expect(verdictOf(kept({ browser: null }))).toEqual(["the engine's browser specs left no record"])
    expect(verdictOf(kept({ browser: browserOf({ total: 1, passed: true, specs: [browserRecord().specs[0]] }) }))).toEqual([`${ENGINE_SPECS[1]} was not run`])
    expect(verdictOf(kept({ browser: browserOf(browserRecord({ passed: 211, failed: 1, fault: '1 failed' })) }))).toEqual([`${ENGINE_SPECS[0]}: 1 failed`])
    expect(verdictOf(kept({ browser: browserOf(browserRecord({ passed: 0, note: 'skipped: no engine' })) }))).toEqual([`${ENGINE_SPECS[0]} ended skipped (skipped: no engine)`])
    expect(verdictOf(kept({ browser: browserOf(browserRecord({ note: 'three states skipped on a phone' })) }))).toEqual([`${ENGINE_SPECS[0]} ended skipped (three states skipped on a phone)`])
    expect(verdictOf(kept({ browser: browserOf(browserRecord({ passed: 0 })) }))).toEqual([`${ENGINE_SPECS[0]}: 0 passed, 0 failed`])
    expect(verdictOf(kept({ pin: { rev: PIN } })).join()).toMatch(/pin's engine was not built, or said nothing readable/)
    expect(verdictOf(kept({ next: undefined })).join()).toMatch(/upstream's engine was not built, or said nothing readable/)
    expect(verdictOf(kept({ next: { rev: 'main', hello: {} } }))).toEqual(['which upstream commit was built is not recorded'])
    // Nothing kept at all is every reason, not a pass.
    expect(verdictOf({}).length).toBeGreaterThanOrEqual(4)
  })

  it('counts only its own pull requests as an offer open or turned down, never a fork\'s of the same branch name', () => {
    // As `gh pr list --json number,headRefName,isCrossRepository,author` gives them.
    const pr = (number, headRefName, over = {}) => ({ number, headRefName, isCrossRepository: false, author: { is_bot: true, login: 'app/github-actions' }, ...over })
    const listed = [
      pr(11, 'engine-pin/bbbbbbbbbbbb'),
      // Anybody can open one from a fork's branch of the same name: somebody else's.
      pr(12, 'engine-pin/x', { isCrossRepository: true, author: { login: 'someone' } }),
      pr(13, 'engine-pin/bbbbbbbbbbbb', { isCrossRepository: true }),
      // A person's own branch in this repository, named like the workflow's.
      pr(14, 'engine-pin/by-hand', { author: { id: 'U_1', login: 'someone', is_bot: false } }),
      // The run's throwaway branch is never a pull request's; nor is any other.
      pr(15, 'engine-pin-try/bbbbbbbbbbbb-1'),
      pr(16, 'main'),
      // The workflow's own, as the REST API spells GitHub Actions.
      pr(17, 'engine-pin/cccccccccccc', { author: { login: 'github-actions[bot]' } }),
    ]
    expect(offersOf(listed)).toEqual(['#11', '#17'])
    expect(offersOf(listed, 'engine-pin/bbbbbbbbbbbb')).toEqual(['#11'])
    expect(offersOf(listed, 'engine-pin/dddddddddddd')).toEqual([])
    // Read forgivingly: what does not say it is this repository's, or who opened it, is not the workflow's.
    expect(offersOf([pr(18, 'engine-pin/a', { isCrossRepository: undefined }), pr(19, 'engine-pin/a', { author: null }), { number: '20', headRefName: 'engine-pin/a' }, null, 'x'])).toEqual([])
    expect(offersOf({ data: [] })).toEqual([])
    expect(offersOf(null)).toEqual([])
  })

  it('keeps upstream\'s words from being read as Markdown', () => {
    expect(code('Z|Z')).toBe('Z\\|Z')
    expect(code('a`b\nc')).toBe("a'b c")
    expect(code('@NEC')).toBe('@NEC')
    expect(md('Commander | Legends')).toBe('Commander \\| Legends')
    expect(md('Ask @someone about #12')).toBe('Ask \\@someone about \\#12')
    expect(md('[click](https://example.com)')).toBe('\\[click\\](https://example.com)')
    expect(md('two\nlines\r\n')).toBe('two lines')
    expect(md('*bold* and `code` <b>')).toBe('\\*bold\\* and \\`code\\` \\<b\\>')
    expect(md(null)).toBe('')
  })

  it('links to upstream only where it is a GitHub repository', () => {
    expect(webOf('https://github.com/ronoccc/engine-choo-choo.git')).toBe('https://github.com/ronoccc/engine-choo-choo')
    expect(webOf('https://github.com/ronoccc/engine-choo-choo')).toBe('https://github.com/ronoccc/engine-choo-choo')
    expect(webOf('git@github.com:ronoccc/engine-choo-choo.git')).toBeNull()
    expect(webOf('https://example.com/a/b.git')).toBeNull()
    expect(webOf(undefined)).toBeNull()
  })

  it('writes the pull request\'s body: the move, the sets new, the measurements and the results', () => {
    const body = bodyOf({
      ...kept(), offer: true, repo: 'https://github.com/ronoccc/engine-choo-choo.git', runUrl: 'https://github.com/o/r/actions/runs/1',
      status: 'ahead', ahead: '3', mentions: [{ path: 'engine/README.md', count: 1 }, { path: 'docs/table-rebuild/PLAN.md', count: 4 }],
    })
    expect(body).toContain("Moves the engine's pin, `ENGINE_REV` in `scripts/engine-build.sh`, from Argentum `aaaaaaa` to `bbbbbbb`: upstream `main` as committed on 2026-09-22, 3 commits on ([the changes](https://github.com/ronoccc/engine-choo-choo/compare/aaaaaaa...bbbbbbb)).")
    expect(body).toContain('none of it is written by hand. It is the owner\'s to merge.')
    expect(body).toContain('| `NEC` | Neon Dynasty Commander | 2022-02-18 | — |')
    expect(body).toContain('| `EOC` | Edge of Eternities Commander | 2025-08-01 | incomplete |')
    expect(body).toContain('Gone since the pin: `WHO` Doctor Who.')
    expect(body).toContain('No longer marked incomplete by Argentum: `BLB` Bloomburrow.')
    expect(body).toContain('| Card names a deck may hold (`hello.cards`) | 13,242 | 13,274 |')
    expect(body).toContain('| Loading the corpus, the first answer (`hello.load.ms`) | 18.7 s | 18.4 s |')
    expect(body).toContain('| Heap once loaded (`hello.load.heapMb`) | 127 MB | 128 MB |')
    expect(body).toContain("| The build | restored from `deploy.yml`'s cache | 302 s, fetched and built |")
    expect(body).not.toContain('Gradle\'s cache warm')
    // Where the pin was built in the same job, upstream's build is said to have had Gradle's cache warm.
    const both = bodyOf(kept({ pin: { rev: PIN, builtSeconds: 431, hello: helloOf(pinSets) } }))
    expect(both).toContain('| The build | 431 s, fetched and built | 302 s, fetched and built |')
    expect(both).toContain("Upstream's build came after the pin's in the same job, with Gradle's cache warm from it.")
    expect(body).toContain('| `tests/engine-live.test.js` | 69 of 69 passed | 76.7 s |')
    expect(body).toContain(`| \`${ENGINE_SPECS[0]}\` | 212 passed, 0 failed | 239.0 s |`)
    expect(body).toContain('**Approve workflows to run**')
    expect(body).toContain('`engine/README.md` (1), `docs/table-rebuild/PLAN.md` (4)')
    expect(body).not.toContain('Not offered')
  })

  it('says in the run\'s summary why it was not offered, and what failed', () => {
    const summary = bodyOf({ ...kept({ live: liveOf(liveReport(1)) }), runUrl: 'https://github.com/o/r/actions/runs/2' })
    expect(summary).toContain('**Not offered**, because:\n\n- tests/engine-live.test.js: 1 of 69 failed\n')
    expect(summary).toContain('Failed in `tests/engine-live.test.js`:\n\n- the engine on the wire plays a game')
    expect(summary).not.toContain('Before merging')
    const spec = bodyOf(kept({ browser: browserOf(browserRecord({ passed: 211, failed: 1, fault: '1 failed', failures: ['the example deck Esika | 54 of 100'] })) }))
    expect(spec).toContain(`- ${ENGINE_SPECS[0]}: 1 failed`)
    expect(spec).toContain(`Failed in \`${ENGINE_SPECS[0]}\`:\n\n- the example deck Esika \\| 54 of 100`)
    // A verdict, never a claim that the pull request was opened: that is the offer job's, and can fail.
    const passed = bodyOf(kept())
    expect(passed).toContain("**Every test passed**, so the `offer` job moves the pin and opens the pull request; its own summary says whether it did.")
    expect(passed).not.toMatch(/is offered|was offered|offered in/)
  })

  it('writes something true from whatever a run kept, however little', () => {
    const empty = bodyOf({})
    expect(empty).toContain("Unknown: an engine's `hello` gave no list of sets to compare.")
    expect(empty).toContain('| Protocol (`hello.protocol`) | not said | not said |')
    expect(empty).toContain('| `tests/engine-live.test.js` | no results | — |')
    expect(empty).toContain('| The build | not timed | not timed |')
    expect(empty).toContain(`| \`${ENGINE_SPECS[1]}\` | not run | — |`)
    const same = bodyOf({ ...kept({ next: { ...kept().next, hello: helloOf(pinSets) } }), status: 'diverged' })
    expect(same).toContain('None: upstream registers the same 3 sets as the pin.')
    expect(same).toContain("on a history that no longer holds the pin (GitHub's comparison says the two have diverged)")
    // A set's name from upstream reads as its name, never as Markdown.
    const odd = bodyOf(kept({ next: { ...kept().next, hello: helloOf([...nextSets, set('Z|Z', 'Ask @you [now](x)', 'someday', 'yes')]) } }))
    expect(odd).toContain('| `Z\\|Z` | Ask \\@you \\[now\\](x) | — | not said |')
  })

  it('moves the pin on its one line and nothing else, and refuses anything it cannot read', () => {
    const script = readFileSync(resolve(root, 'scripts', 'engine-build.sh'), 'utf8')
    const pinned = /^rev=\$\{ENGINE_REV:-([0-9a-f]{40})\}$/m.exec(script)[1]
    const other = pinned === NEXT ? PIN : NEXT
    const after = moved(script, pinned, other)
    const changed = script.split('\n').map((line, i) => [line, after.split('\n')[i]]).filter(([a, b]) => a !== b)
    expect(changed).toEqual([[`rev=\${ENGINE_REV:-${pinned}}`, `rev=\${ENGINE_REV:-${other}}`]])
    expect(() => moved(script, other, pinned)).toThrow(`pins ${pinned}, not ${other}`)
    expect(() => moved(script, pinned, 'main')).toThrow(/40 hex digits/)
    expect(() => moved('#!/bin/sh\n', PIN, NEXT)).toThrow(/has 0 lines/)
    expect(() => moved(`rev=\${ENGINE_REV:-${PIN}}\nrev=\${ENGINE_REV:-${PIN}}\n`, PIN, NEXT)).toThrow(/has 2 lines/)
    expect(moved(`a\r\nrev=\${ENGINE_REV:-${PIN}}\r\nb\r\n`, PIN, NEXT)).toBe(`a\r\nrev=\${ENGINE_REV:-${NEXT}}\r\nb\r\n`)
  })

  it('names the files that still say the old pin, never the script it moves', () => {
    const script = readFileSync(resolve(root, 'scripts', 'engine-build.sh'), 'utf8')
    const pinned = /^rev=\$\{ENGINE_REV:-([0-9a-f]{40})\}$/m.exec(script)[1].slice(0, 7)
    const found = mentionsOf(pinned, root)
    expect(Array.isArray(found)).toBe(true)
    expect(found.map((m) => m.path)).not.toContain('scripts/engine-build.sh')
    expect(found.every((m) => typeof m.path === 'string' && m.count >= 1)).toBe(true)
    // Nowhere, said as none; a folder git cannot read, said as not known.
    expect(mentionsOf(['n', 'owhere', 'q7'].join(''), root)).toEqual([])
    const away = mkdtempSync(join(tmpdir(), 'engine-pin-'))
    try { expect(mentionsOf('70d525c', away)).toBeNull() } finally { rmSync(away, { recursive: true, force: true }) }
    expect(mentionsOf(null, root)).toBeNull()
  })
})
