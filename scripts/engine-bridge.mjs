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
 */
export function findEngine(env = process.env) {
  if (env.ENGINE_CMD) return env.ENGINE_CMD
  const home = env.ENGINE_HOME || resolve(here, '..', '..', 'argentum')
  const launcher = resolve(home, 'companion', 'build', 'install', 'companion', 'bin', 'companion')
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
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
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

  const call = (op, params = {}) => new Promise((resolve, reject) => {
    if (exited || !child.stdin.writable) { reject(new Error('The engine is not running.')); return }
    const id = nextId++
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`The engine did not answer "${op}" within ${timeoutMs}ms.`))
    }, timeoutMs)
    waiting.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`)
  })

  /** Asks the engine to quit, waits briefly for it to go, and ends it if it does not. */
  const close = async ({ graceMs = 2000 } = {}) => {
    if (exited) return
    try { await call('quit') } catch { /* it may already be gone */ }
    await Promise.race([exitPromise, new Promise((r) => setTimeout(r, graceMs))])
    if (!exited) { child.kill(); await exitPromise }
  }

  return { call, close, get exited() { return exited }, pid: child.pid }
}
