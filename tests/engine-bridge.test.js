// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startEngine, findEngine, engineRequired } from '../scripts/engine-bridge.mjs'

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
    expect(a).toMatchObject({ engine: 'fake', protocol: 10, cards: 3 })
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

  it('says the engine has gone once, to a caller with nothing waiting to hear it', async () => {
    // A room between steps has no call in flight, so without this it would
    // learn of a death only from whatever it happened to ask next — and a
    // paced room asks nothing while it is waiting out its own pace.
    const said = []
    const e = fake({ onExit: (why) => said.push(why) })
    await e.call('hello')
    await expect(e.call('die')).rejects.toThrow(/stopped/)
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/The engine stopped/)
  })

  it('gives up on a reply that never comes', async () => {
    const e = fake({ timeoutMs: 60 })
    await expect(e.call('slow', { ms: 2000 })).rejects.toThrow(/did not answer "slow"/)
  })

  it('waits longer for one call when told to, and no longer for the rest', async () => {
    const e = fake({ timeoutMs: 60 })
    expect((await e.call('slow', { ms: 150 }, { timeoutMs: 2000 })).slept).toBe(150)
    await expect(e.call('slow', { ms: 150 })).rejects.toThrow(/within 60ms/)
  })

  it('closes politely, then not', async () => {
    const e = fake()
    await e.close()
    expect(e.exited).toMatchObject({ code: 0 })
  })

  it('ends an engine that acknowledges quit and stays up', async () => {
    const e = fake()
    await e.call('stubborn')
    await e.close({ graceMs: 100 })
    expect(e.exited).toBeTruthy()
    expect(e.exited.code).not.toBe(0)
  })
})

// A folder with a space in its name, because that is where quoting breaks.
const launcherDir = () => mkdtempSync(join(tmpdir(), 'engine launcher-'))
const batFor = (dir) => {
  const bat = join(dir, 'companion.bat')
  writeFileSync(bat, `@echo off\r\n"${process.execPath}" "${FAKE}" %*\r\n`)
  return bat
}
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('the engine on Windows, through the .bat Gradle writes', () => {
  it.runIf(process.platform === 'win32')('starts it from a folder with a space in the path, and talks to it', async () => {
    const dir = launcherDir()
    const e = startEngine({ command: batFor(dir) })
    engines.push(e)
    expect((await e.call('hello')).engine).toBe('fake')
    await e.close()
    expect(e.exited).toMatchObject({ code: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  it.runIf(process.platform === 'win32')('takes the engine down too when it has to force the launcher closed', async () => {
    const dir = launcherDir()
    const e = startEngine({ command: batFor(dir) })
    engines.push(e)
    // The process behind the .bat, not the cmd.exe in front of it.
    const { pid } = await e.call('pid')
    expect(pid).not.toBe(e.pid)
    await e.call('stubborn')
    await e.close({ graceMs: 100 })
    const start = Date.now()
    while (alive(pid) && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 25))
    expect(alive(pid)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('finding the engine', () => {
  it('honours ENGINE_CMD, else looks beside the repo, else says so', () => {
    expect(findEngine({ ENGINE_CMD: '/somewhere/companion' })).toBe('/somewhere/companion')
    expect(findEngine({ ENGINE_HOME: '/nowhere/at/all' })).toBeNull()
  })

  it('picks the launcher the platform can run: the .bat on Windows, the script elsewhere', () => {
    const home = launcherDir()
    const bin = join(home, 'companion', 'build', 'install', 'companion', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'companion'), '')
    writeFileSync(join(bin, 'companion.bat'), '')
    expect(findEngine({ ENGINE_HOME: home }, 'win32')).toBe(join(bin, 'companion.bat'))
    expect(findEngine({ ENGINE_HOME: home }, 'linux')).toBe(join(bin, 'companion'))
    rmSync(home, { recursive: true, force: true })
  })

  it('is required only where ENGINE_REQUIRED says so, as CI does once it has built one', () => {
    expect(engineRequired({})).toBe(false)
    for (const no of ['', ' ', '0', 'false', 'FALSE', 'no', ' No ']) expect(engineRequired({ ENGINE_REQUIRED: no })).toBe(false)
    for (const yes of ['1', 'true', 'yes', 'on']) expect(engineRequired({ ENGINE_REQUIRED: yes })).toBe(true)
  })
})
