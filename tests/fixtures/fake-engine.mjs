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
// The last deal asked for, so a test can see exactly what the relay sent.
let lastNew = null
// The one rule the fake has for which cards it knows, used by check and new
// alike: a name the real engine would resolve is not its business. The real
// resolution is tested against the real engine, in engine-live.test.js.
const unknownName = (name) => /^Made-Up/.test(name)
// A deck line is a count, or a printing with a count, or a list of those.
const copiesOf = (v) => {
  if (Array.isArray(v)) return v.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof v === 'number' ? v : v?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}

const lines = createInterface({ input: process.stdin })
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const ended = () => ({ ok: true, over: true, winner: FIXTURE.seats[0].id, turn: 9, phase: 'ENDING', step: 'END', actor: null, waiting: null, autoPassed: 0, decided: [] })
const status = () => (at >= shots.length ? ended() : { ...shots[at].status, ok: true })
lines.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { say({ id: null, ok: false, error: 'not json' }); return }
  const { id } = req
  switch (req.op) {
    // The real engine's shape: every set it knows, in release order, and what
    // loading them cost. Portal's details are Argentum's own (PortalSet.kt).
    // FAKE_PROTOCOL plays an older engine, to test what the relay sends one.
    case 'hello': say({ id, ok: true, engine: 'fake', protocol: Number(process.env.FAKE_PROTOCOL) || 2, cards: 3, sets: [{ code: 'POR', name: 'Portal', released: '1997-05-01', incomplete: false }], load: { ms: 0, heapMb: 0, maxHeapMb: 0 } }); break
    case 'cards': say({ id, ok: true, names: [...new Set(shots.flatMap((s) => Object.values(s.view.cards).map((c) => c.name)))].sort() }); break
    case 'check': {
      if (!req.deck || typeof req.deck !== 'object') { say({ id, ok: false, error: '"deck" is required.' }); break }
      const lines = Object.entries(req.deck)
      const total = lines.reduce((sum, [, v]) => sum + copiesOf(v), 0)
      const known = lines.filter(([n]) => !unknownName(n)).reduce((sum, [, v]) => sum + copiesOf(v), 0)
      say({
        id, ok: true, known, total,
        unknown: lines.map(([n]) => n).filter(unknownName).sort(),
        unknownSideboard: Object.keys(req.sideboard ?? {}).filter(unknownName).sort(),
      })
      break
    }
    case 'new': {
      const missing = (req.players ?? []).flatMap((p) => Object.keys(p.deck ?? {}).filter(unknownName))
      if (missing.length) { say({ id, ok: false, error: `The engine does not know ${missing.length} cards: ${missing.join(', ')}` }); break }
      at = 0; acted = 0
      lastNew = req
      // A sideboard card it does not know is left out and named, as the real engine does.
      say({ id, ...status(), seats: FIXTURE.seats.map((s, i) => ({ ...s, ai: req.players?.[i]?.ai ?? null, sideboardLeftOut: Object.keys(req.players?.[i]?.sideboard ?? {}).filter(unknownName), unknownPrintings: [] })) })
      break
    }
    case 'turn': say({ id, ...status() }); break
    case 'lastNew': say({ id, ok: true, request: lastNew }); break
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
