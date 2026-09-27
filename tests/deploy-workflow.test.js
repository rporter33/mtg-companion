// @vitest-environment node
/**
 * .github/workflows/deploy.yml, read as text (HANDOFF.md, M8's review): the app the
 * browser suite drives has no relay address, whatever the repository variable
 * RELAY_URL says, and only the copy GitHub Pages serves is built with it, after the
 * suite has passed. Were the suite's build given the deployed relay's address, every
 * spec that sets none of its own would ask that relay's /health from CI, and a relay
 * that was down would fail the suite and hold back the deploy.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKFLOW = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n')

/** The `test` job's steps, each as its own text, comments dropped. */
const steps = (() => {
  const job = WORKFLOW.slice(WORKFLOW.indexOf('\n  test:\n'), WORKFLOW.indexOf('\n  deploy:\n'))
  const lines = job.slice(job.indexOf('\n    steps:\n') + '\n    steps:\n'.length).split('\n').filter((l) => !/^\s*#/.test(l))
  return lines.reduce((all, line) => {
    if (/^ {6}- /.test(line)) all.push(line)
    else if (all.length && line.trim()) all[all.length - 1] += `\n${line}`
    return all
  }, [])
})()
const find = (test) => steps.findIndex(test)

describe('the deploy workflow', () => {
  it('builds the app the browser suite drives with no relay address', () => {
    const suite = find((s) => s.includes('node scripts/browser-suite.mjs'))
    expect(suite).toBeGreaterThan(0)
    const builds = steps.map((s, i) => [s, i]).filter(([s]) => /npm run build\b/.test(s))
    const tested = builds.filter(([, i]) => i < suite)
    expect(tested).toHaveLength(1)
    const [build] = tested[0]
    expect(build).toMatch(/\n {10}VITE_RELAY_URL: ''\n/)
    expect(build).not.toMatch(/RELAY_URL \}\}|vars\./)
    expect(build).not.toMatch(/--outDir/)
  })

  it('reads RELAY_URL only after the suite, into a build of its own that Pages serves', () => {
    const suite = find((s) => s.includes('node scripts/browser-suite.mjs'))
    const reading = steps.map((s, i) => [s, i]).filter(([s]) => s.includes('vars.RELAY_URL'))
    expect(reading.length).toBe(1)
    const [pages, at] = reading[0]
    expect(at).toBeGreaterThan(suite)
    expect(pages).toMatch(/VITE_RELAY_URL: \$\{\{ vars\.RELAY_URL \}\}/)
    expect(pages).toMatch(/npm run build -- --outDir dist-pages --emptyOutDir/)
    // Unset, the build the suite drove is what is published.
    expect(pages).toMatch(/cp -R dist dist-pages/)
    // Set, the address is checked to be in the bundle.
    expect(pages).toMatch(/grep -rqF -- "\$address" dist-pages\/assets/)
    const upload = find((s) => s.includes('actions/upload-pages-artifact'))
    expect(upload).toBeGreaterThan(at)
    expect(steps[upload]).toMatch(/\n {10}path: dist-pages$/)
    // Built only where it is published: on main, never for a pull request.
    const onMain = "if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'"
    expect(pages).toContain(onMain)
    expect(steps[upload]).toContain(onMain)
  })

  it('names RELAY_URL nowhere else in the workflow', () => {
    expect(WORKFLOW.match(/vars\.RELAY_URL/g)).toHaveLength(1)
  })
})
