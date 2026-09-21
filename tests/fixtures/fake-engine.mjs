// A stand-in for the engine process, for testing the bridge and the relay
// without a JVM. It answers the protocol's shape (engine/README.md) from
// views captured off the real engine (engine-views.json): `new` is the first
// stop, every `act` or `decide` is the next, and after the last the game is
// over. It refuses what it does not know and can be told to die.
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'

const FIXTURE = JSON.parse(readFileSync(new URL('./engine-views.json', import.meta.url), 'utf8'))
const shots = FIXTURE.shots
let at = -1
let acted = 0
// Told to be stubborn, it acknowledges quit and stays up, the way a hung JVM
// would, so a test can make the bridge fall back to force.
let stubborn = false

const lines = createInterface({ input: process.stdin })
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const ended = () => ({ ok: true, over: true, winner: FIXTURE.seats[0].id, turn: 9, phase: 'ENDING', step: 'END', actor: null, waiting: null, autoPassed: 0, decided: [] })
const status = () => (at >= shots.length ? ended() : { ...shots[at].status, ok: true })
lines.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { say({ id: null, ok: false, error: 'not json' }); return }
  const { id } = req
  switch (req.op) {
    case 'hello': say({ id, ok: true, engine: 'fake', protocol: 1, cards: 3, sets: ['por'] }); break
    case 'cards': say({ id, ok: true, names: [...new Set(shots.flatMap((s) => Object.values(s.view.cards).map((c) => c.name)))].sort() }); break
    case 'new': {
      const missing = (req.players ?? []).flatMap((p) => Object.keys(p.deck ?? {}).filter((n) => /^Made-Up/.test(n)))
      if (missing.length) { say({ id, ok: false, error: `The engine does not know ${missing.length} cards: ${missing.join(', ')}` }); break }
      at = 0; acted = 0
      say({ id, ...status(), seats: FIXTURE.seats.map((s, i) => ({ ...s, ai: req.players?.[i]?.ai ?? null })) })
      break
    }
    case 'turn': say({ id, ...status() }); break
    case 'act': {
      if (at < 0 || at >= shots.length) { say({ id, ok: false, error: 'The game is not waiting on anyone.' }); break }
      const offered = shots[at].status.actions ?? []
      if (!(req.index >= 0 && req.index < offered.length)) { say({ id, ok: false, error: `No action ${req.index}; ${offered.length} were offered.` }); break }
      at++; acted++
      say({ id, ...status() })
      break
    }
    case 'decide': { if (at < 0) { say({ id, ok: false, error: 'There is no decision to make.' }); break } at++; say({ id, ...status() }); break }
    case 'view': {
      const shot = shots[Math.min(Math.max(at, 0), shots.length - 1)]
      say({ id, ok: true, state: { ...shot.view, viewingPlayerId: req.viewer ?? shot.view.viewingPlayerId }, log: Array.from({ length: acted }, (_, i) => ({ type: 'note', description: `Something happened (${i + 1})` })) })
      break
    }
    case 'slow': setTimeout(() => say({ id, ok: true, slept: req.ms }), req.ms); break
    case 'echo': say({ id, ok: true, got: req }); break
    case 'garbage': process.stdout.write('this is not json\n'); say({ id, ok: true }); break
    case 'die': process.stderr.write('fake engine: dying on request\n'); process.exit(3); break
    case 'pid': say({ id, ok: true, pid: process.pid }); break
    case 'stubborn': stubborn = true; say({ id, ok: true }); break
    case 'quit': say({ id, ok: true }); if (!stubborn) process.exit(0); break
    default: say({ id, ok: false, error: `Unknown op "${req.op}".` })
  }
})
