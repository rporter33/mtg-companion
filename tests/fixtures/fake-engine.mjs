// A stand-in for the engine process, for testing the bridge's framing without
// a JVM: answers the protocol's shape, refuses what it does not know, and can
// be told to die mid-conversation.
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
lines.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { say({ id: null, ok: false, error: 'not json' }); return }
  switch (req.op) {
    case 'hello': say({ id: req.id, ok: true, engine: 'fake', protocol: 1, cards: 3 }); break
    case 'slow': setTimeout(() => say({ id: req.id, ok: true, slept: req.ms }), req.ms); break
    case 'echo': say({ id: req.id, ok: true, got: req }); break
    case 'garbage': process.stdout.write('this is not json\n'); say({ id: req.id, ok: true }); break
    case 'die': process.stderr.write('fake engine: dying on request\n'); process.exit(3); break
    case 'quit': say({ id: req.id, ok: true }); process.exit(0); break
    default: say({ id: req.id, ok: false, error: `Unknown op "${req.op}".` })
  }
})
