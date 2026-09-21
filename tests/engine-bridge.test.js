// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { startEngine, findEngine } from '../scripts/engine-bridge.mjs'

const FAKE = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url))
const engines = []
const fake = (opts = {}) => {
  const e = startEngine({ command: process.execPath, args: [FAKE], ...opts })
  engines.push(e)
  return e
}
afterEach(async () => { for (const e of engines.splice(0)) await e.close() })

describe('the engine bridge', () => {
  it('correlates replies to requests by id and strips the envelope', async () => {
    const e = fake()
    const [a, b] = await Promise.all([e.call('hello'), e.call('echo', { x: 1 })])
    expect(a).toEqual({ engine: 'fake', protocol: 1, cards: 3 })
    expect(b.got).toMatchObject({ op: 'echo', x: 1 })
    expect(b.got.id).toBeTypeOf('number')
  })

  it('keeps order straight when a slow reply overtakes a fast one', async () => {
    const e = fake()
    const slow = e.call('slow', { ms: 80 })
    const quick = e.call('hello')
    expect((await quick).engine).toBe('fake')
    expect((await slow).slept).toBe(80)
  })

  it('turns a refusal into a rejection that says why', async () => {
    const e = fake()
    await expect(e.call('nonsense')).rejects.toMatchObject({ message: 'Unknown op "nonsense".', refused: true })
    // and the bridge is still usable afterwards
    expect((await e.call('hello')).cards).toBe(3)
  })

  it('ignores a line that is not JSON and reports it, without losing the reply behind it', async () => {
    const said = []
    const e = fake({ onStderr: (l) => said.push(l) })
    await expect(e.call('garbage')).resolves.toEqual({})
    expect(said.some((l) => /not JSON/.test(l))).toBe(true)
  })

  it('rejects everything waiting when the process dies, and refuses new calls', async () => {
    const e = fake()
    const pending = e.call('slow', { ms: 5000 })
    await expect(e.call('die')).rejects.toThrow(/stopped/)
    await expect(pending).rejects.toThrow(/stopped/)
    expect(e.exited).toMatchObject({ code: 3 })
    await expect(e.call('hello')).rejects.toThrow(/not running/)
  })

  it('gives up on a reply that never comes', async () => {
    const e = fake({ timeoutMs: 60 })
    await expect(e.call('slow', { ms: 2000 })).rejects.toThrow(/did not answer "slow"/)
  })

  it('closes politely, then not', async () => {
    const e = fake()
    await e.close()
    expect(e.exited).toMatchObject({ code: 0 })
  })
})

describe('finding the engine', () => {
  it('honours ENGINE_CMD, else looks beside the repo, else says so', () => {
    expect(findEngine({ ENGINE_CMD: '/somewhere/companion' })).toBe('/somewhere/companion')
    expect(findEngine({ ENGINE_HOME: '/nowhere/at/all' })).toBeNull()
  })
})
