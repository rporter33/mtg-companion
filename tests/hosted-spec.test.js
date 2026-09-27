// @vitest-environment node
/**
 * tests/browser/hosted.spec.mjs runs against a relay it is given (HANDOFF.md, M8),
 * and every run leaves two tables the engine holds on that relay, each with an
 * engine JVM, for a week, started again at every restart. So it takes only a relay
 * on this machine, which can be thrown away, and refuses any other address before
 * asking it anything (M8's review). Refusing needs no browser, no engine and no
 * network, so it is held here rather than in the browser suite.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

const run = (address) => spawnSync(process.execPath, ['tests/browser/hosted.spec.mjs', address], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
  // Nothing here may reach an engine: an address the spec took would be tried.
  env: { ...process.env, ENGINE_CMD: '', ENGINE_REQUIRED: '' },
})

describe('the hosted spec', () => {
  it('refuses a relay that is not on this machine, before asking it anything', () => {
    // `.invalid` never resolves (RFC 2606), so a spec that asked would be told
    // nothing answers there, and say so instead.
    for (const address of ['https://relay.invalid/', 'http://192.0.2.10:8788/', 'https://mtg.invalid:8443/health']) {
      const ran = run(address)
      expect(ran.status, address).toBe(1)
      expect(ran.stdout, address).toMatch(/is not on this machine\./)
      expect(ran.stdout.trimEnd().split('\n').at(-1), address).toBe('0 passed, 1 failed (not a relay on this machine)')
    }
  })
})
