// The Node side of the engine's wire (engine/README.md).
//
// Spawns the engine process and turns its JSON lines into promises. This is
// the whole of what the relay will know about the engine: `call(op, params)`
// and that the process can die. Everything about the rules stays behind it.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Where the built engine is, or null. `ENGINE_CMD` wins; otherwise the
 * launcher `scripts/engine-build.sh` produces in the sibling checkout.
 *
 * Gradle writes two launchers side by side, a POSIX shell script and a .bat,
 * and Windows can run only the second: handed the script, it cannot start it
 * at all.
 */
export function findEngine(env = process.env, platform = process.platform) {
  if (env.ENGINE_CMD) return env.ENGINE_CMD
  const home = env.ENGINE_HOME || resolve(here, '..', '..', 'argentum')
  const launcher = resolve(home, 'companion', 'build', 'install', 'companion', 'bin',
    platform === 'win32' ? 'companion.bat' : 'companion')
  return existsSync(launcher) ? launcher : null
}

/**
 * Starts an engine and returns a way to talk to it.
 *
 *   const engine = startEngine({ command })
 *   const hello = await engine.call('hello')
 *   await engine.close()
 *
 * `call` resolves with the reply's body (minus `id`) when `ok`, and rejects
 * with an Error carrying the engine's `error` text when not. A reply that
 * never comes — the process died — rejects every call still waiting.
 */
export function startEngine({ command, args = [], cwd, timeoutMs = 30_000, onStderr } = {}) {
  if (!command) throw new Error('startEngine needs a command')
  // A JavaScript file as the engine — the scripted stand-in the tests use —
  // is run by this same Node rather than executed as a program.
  const viaNode = /\.(mjs|cjs|js)$/.test(command)
  // A .bat is the launcher Gradle writes for Windows. Node will not start one
  // without a shell, and the shell does not quote what it is given, so the
  // path goes in quotes here or a folder with a space in its name splits it.
  const viaShell = /\.(bat|cmd)$/i.test(command)
  const stdio = ['pipe', 'pipe', 'pipe']
  const child = viaNode
    ? spawn(process.execPath, [command, ...args], { cwd, stdio })
    : viaShell
      ? spawn(`"${command}"`, args.map((a) => `"${a}"`), { cwd, stdio, shell: true })
      : spawn(command, args, { cwd, stdio })
  // Through a shell, the process Node holds is cmd.exe, and killing that
  // leaves the JVM it started running with nothing left to stop it. So a
  // forced close takes the whole tree down instead.
  const kill = () => (viaShell && process.platform === 'win32'
    ? spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    : child.kill())
  const waiting = new Map()
  let nextId = 1
  let exited = null
  let settleExit
  const exitPromise = new Promise((r) => { settleExit = r })
  // A write to an engine that has just died is not news: the exit itself is
  // what every waiting call hears about. Without this the EPIPE is unhandled.
  child.stdin.on('error', () => {})

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let msg
    try { msg = JSON.parse(line) } catch { onStderr?.(`engine said something that was not JSON: ${line}`); return }
    const entry = waiting.get(msg.id)
    if (!entry) return
    waiting.delete(msg.id)
    clearTimeout(entry.timer)
    const { id, ok, error, ...body } = msg
    if (ok) entry.resolve(body)
    else entry.reject(Object.assign(new Error(error || 'The engine refused.'), { refused: true, body }))
  })
  child.stderr.on('data', (chunk) => onStderr?.(String(chunk).trimEnd()))

  const fail = (why) => {
    for (const [, entry] of waiting) { clearTimeout(entry.timer); entry.reject(new Error(why)) }
    waiting.clear()
  }
  child.on('exit', (code, signal) => {
    exited = { code, signal }
    fail(`The engine stopped (${signal ?? `exit ${code}`}).`)
    settleExit()
  })
  child.on('error', (err) => { exited = { error: err }; fail(`The engine could not start: ${err.message}`); settleExit() })

  // One call may be given longer than the rest: the first answer waits on the
  // whole card corpus loading, and no later one should wait that long before
  // a hung engine is noticed.
  const call = (op, params = {}, { timeoutMs: wait = timeoutMs } = {}) => new Promise((resolve, reject) => {
    if (exited || !child.stdin.writable) { reject(new Error('The engine is not running.')); return }
    const id = nextId++
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`The engine did not answer "${op}" within ${wait}ms.`))
    }, wait)
    waiting.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`)
  })

  /** Asks the engine to quit, waits briefly for it to go, and ends it if it does not. */
  const close = async ({ graceMs = 2000 } = {}) => {
    if (exited) return
    try { await call('quit') } catch { /* it may already be gone */ }
    await Promise.race([exitPromise, new Promise((r) => setTimeout(r, graceMs))])
    if (!exited) { kill(); await exitPromise }
  }

  return { call, close, get exited() { return exited }, pid: child.pid }
}
