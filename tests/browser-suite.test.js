// @vitest-environment node
/**
 * The runner CI takes the browser suite through (scripts/browser-suite.mjs,
 * HANDOFF.md M9): that it runs what `npm run test:browser` runs, reads each
 * spec's last line as the spec means it, and lets no spec off as skipped in a
 * run that has the engine built for it; and that a spec it runs which answers
 * Scryfall's images by a route keeps the app's service worker out of the way.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { specsOf, tallyOf, faultOf, summaryOf, optionsOf, pick, recordOf, failuresOf } from '../scripts/browser-suite.mjs'

const chain = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).scripts['test:browser']

describe('the browser suite, run spec by spec', () => {
  it('runs every spec the chain runs, in its order, and only those', () => {
    const specs = specsOf(chain)
    expect(specs).toHaveLength(chain.split('&&').length)
    expect(specs.every((s) => existsSync(resolve(process.cwd(), s)))).toBe(true)
    expect(specs.join(' ')).toBe(chain.replace(/node /g, '').replace(/ && /g, ' '))
    // The two that drive the real engine, which CI now builds for them.
    expect(specs).toContain('tests/browser/game-engine.spec.mjs')
    expect(specs).toContain('tests/browser/engine-restart.spec.mjs')
  })

  it('refuses a chain holding anything but a spec, rather than leave it unrun', () => {
    expect(() => specsOf('node tests/browser/zoom.spec.mjs && echo done')).toThrow(/"echo done"/)
    expect(() => specsOf('node tests/browser/zoom.spec.mjs && node --inspect tests/browser/game.spec.mjs')).toThrow(/cannot run it/)
    expect(() => specsOf('')).toThrow()
    expect(() => specsOf(undefined)).toThrow()
  })

  it('reads the tally a spec ends with, and the reason it gives for skipping', () => {
    expect(tallyOf('  PASS  a\n  PASS  b\n\n2 passed, 0 failed\n')).toEqual({ passed: 2, failed: 0, note: null })
    expect(tallyOf('No engine is built here.\r\n\r\n0 passed, 0 failed (skipped: no engine)\r\n')).toEqual({ passed: 0, failed: 0, note: 'skipped: no engine' })
    expect(tallyOf('3 passed, 1 failed')).toEqual({ passed: 3, failed: 1, note: null })
    // A tally that is not the last word is not the spec's verdict.
    expect(tallyOf('3 passed, 0 failed\nError: something after it')).toBeNull()
    expect(tallyOf('')).toBeNull()
    expect(tallyOf(undefined)).toBeNull()
  })

  it('counts a spec passed only where it exited cleanly and said nothing failed', () => {
    expect(faultOf({ code: 0, tally: { passed: 12, failed: 0, note: null } })).toBeNull()
    expect(faultOf({ code: 1, tally: { passed: 11, failed: 1, note: null } })).toBe('1 failed')
    expect(faultOf({ code: 1, tally: { passed: 12, failed: 0, note: null } })).toBe('exited with 1 after 12 passed')
    expect(faultOf({ code: 1, tally: null })).toMatch(/^exited with 1 before its/)
    expect(faultOf({ code: 0, tally: null })).toMatch(/^ended without its/)
    expect(faultOf({ code: 'signal SIGKILL', tally: null })).toMatch(/^exited with signal SIGKILL/)
    expect(faultOf({ code: 1, tally: { passed: 0, failed: 1, note: 'no engine, where one is required' } })).toBe('1 failed (no engine, where one is required)')
  })

  it('lets a spec off as skipped only where the run has no engine built for it', () => {
    const skipped = { passed: 0, failed: 0, note: 'skipped: no engine' }
    expect(faultOf({ code: 0, tally: skipped, required: false })).toBeNull()
    expect(faultOf({ code: 0, tally: skipped, required: true })).toMatch(/^ended skipped \(skipped: no engine\)/)
    expect(faultOf({ code: 0, tally: { passed: 5, failed: 0, note: 'three states skipped on a phone' }, required: true })).toMatch(/^ended skipped/)
    expect(faultOf({ code: 0, tally: { passed: 5, failed: 0, note: null }, required: true })).toBeNull()
  })

  it('sets the times out as a table, the spec that stopped the suite saying why', () => {
    const table = summaryOf([
      { spec: 'tests/browser/zoom.spec.mjs', tally: { passed: 12, failed: 0, note: null }, fault: null, ms: 8_200 },
      { spec: 'tests/browser/game-engine.spec.mjs', tally: { passed: 0, failed: 1, note: 'no engine, where one is required' }, fault: '1 failed (no engine, where one is required)', ms: 900 },
    ], 39)
    expect(table).toContain('| `tests/browser/zoom.spec.mjs` | 12 passed, 0 failed | 8.2 s |')
    expect(table).toContain('| `tests/browser/game-engine.spec.mjs` | **Failed:** 1 failed (no engine, where one is required) | 0.9 s |')
    expect(table).toContain('| **2 of 39 specs run** | 12 checks passed, and the suite stopped at the failure | 9.1 s |')
    const whole = summaryOf([{ spec: 'tests/browser/zoom.spec.mjs', tally: { passed: 12, failed: 0, note: null }, fault: null, ms: 8_200 }], 1)
    expect(whole).toContain('| **1 of 1 specs run** | 12 checks passed | 8.2 s |')
  })

  // The weekly offer to move the engine's pin (HANDOFF.md §3 item 12) runs the
  // engine's specs alone, and keeps what they did for its pull request.
  it("takes its own arguments out, and gives every spec the rest as they came", () => {
    expect(optionsOf(['http://localhost:4173/'])).toEqual({ only: [], record: null, args: ['http://localhost:4173/'] })
    expect(optionsOf(['--only=a.spec.mjs, b.spec.mjs', 'http://localhost:4180/', '--record=run.json', '--only=c.spec.mjs', 'extra']))
      .toEqual({ only: ['a.spec.mjs', 'b.spec.mjs', 'c.spec.mjs'], record: 'run.json', args: ['http://localhost:4180/', 'extra'] })
    expect(optionsOf(['--only=', '--record='])).toEqual({ only: [], record: null, args: [] })
    expect(optionsOf(undefined)).toEqual({ only: [], record: null, args: [] })
  })

  it('runs only the specs named, in the chain\'s order, and refuses a name that is not one spec of it', () => {
    const specs = specsOf(chain)
    expect(pick(specs, [])).toEqual(specs)
    expect(pick(specs, ['engine-restart.spec.mjs', 'tests/browser/game-engine.spec.mjs']))
      .toEqual(['tests/browser/game-engine.spec.mjs', 'tests/browser/engine-restart.spec.mjs'])
    expect(pick(specs, ['.\\tests\\browser\\zoom.spec.mjs'])).toEqual(['tests/browser/zoom.spec.mjs'])
    expect(pick(specs, ['zoom.spec.mjs', 'zoom.spec.mjs'])).toEqual(['tests/browser/zoom.spec.mjs'])
    expect(() => pick(specs, ['game-engin.spec.mjs'])).toThrow(/"game-engin\.spec\.mjs", which is no spec of test:browser/)
    expect(() => pick(['a/x.spec.mjs', 'b/x.spec.mjs'], ['x.spec.mjs'])).toThrow(/more than one spec/)
  })

  it('keeps the checks a spec says failed, as every spec says it', () => {
    expect(failuresOf('  PASS  one\n  FAIL  two\n        what it saw\r\n  FAIL  three  \n1 passed, 2 failed')).toEqual(['two', 'three'])
    // Only a check's own line: the words FAIL elsewhere are not a failure.
    expect(failuresOf('FAIL  not indented\n    FAIL  too far in\nno FAIL here')).toEqual([])
    expect(failuresOf(undefined)).toEqual([])
  })

  // The built app's service worker (public/sw.js) fetches every *.scryfall.io
  // image itself, and page.route never sees a service worker's requests; a
  // spec that answers Scryfall's images with a route and leaves the worker on
  // loads real faces from Scryfall instead, and a moment's failure to reach it
  // is a console error in a spec every deploy waits on (PLAN.md, §3 item 12).
  it('opens every page with service workers blocked in a spec that answers Scryfall\'s images by a route', () => {
    const routing = specsOf(chain).filter((spec) => /\.route\(\s*'[^']*scryfall\.io[^']*'/.test(readFileSync(resolve(process.cwd(), spec), 'utf8')))
    // The engine's specs and the stand-in's, whose cards carry Scryfall's image links.
    expect(routing.length).toBeGreaterThanOrEqual(6)
    for (const spec of routing) {
      const source = readFileSync(resolve(process.cwd(), spec), 'utf8')
      // A page or a context opened from the browser itself; a context's own pages take its options.
      const opened = [...source.matchAll(/\bbrowser\.new(?:Page|Context)\(([^)]*)\)/g)].map((m) => m[1])
      expect(opened.length, spec).toBeGreaterThan(0)
      for (const options of opened) expect(options, spec).toMatch(/serviceWorkers:\s*'block'/)
    }
  })

  it('records a run as passed only where every spec picked ran and none failed', () => {
    const good = { spec: 'tests/browser/game-engine.spec.mjs', tally: { passed: 212, failed: 0, note: null }, fault: null, ms: 239_012.6 }
    const bad = { spec: 'tests/browser/engine-restart.spec.mjs', tally: null, fault: 'exited with 1 before its "N passed, M failed" line', ms: 900.2 }
    expect(recordOf([good], 1)).toEqual({ total: 1, passed: true, specs: [{ spec: good.spec, passed: 212, failed: 0, note: null, fault: null, failures: [], ms: 239_013 }] })
    expect(recordOf([good], 2).passed).toBe(false)
    const stopped = recordOf([good, { ...bad, failures: ['the table opens'] }], 2)
    expect(stopped.passed).toBe(false)
    expect(stopped.specs[1]).toEqual({ spec: bad.spec, passed: null, failed: null, note: null, fault: bad.fault, failures: ['the table opens'], ms: 900 })
    // Nothing run is not a pass.
    expect(recordOf([], 0)).toEqual({ total: 0, passed: false, specs: [] })
  })
})
