// A stand-in for the engine process, for testing the bridge and the relay
// without a JVM. It answers the protocol's shape (engine/README.md) from
// views captured off the real engine (engine-views.json): `new` is the first
// stop, every `act` or `decide` is the next, and after the last the game is
// over. It refuses what it does not know and can be told to die.
//
// It plays a paced table too (protocol 3): dealt with a `pace` it stops after
// each of its own plays, with `waiting: "engine"`, and `continue` takes the
// next step. How many plays it makes between one stop of the player's and the
// next is the test's to say, with `plays` — the captured shots are stops of
// the player's, and what the engine did between them was never in them.
//
// And it has levels (protocol 4): an engine seat dealt with `level` says in the
// reply's seats which it took. FAKE_PROTOCOL=3 plays an engine from before them.
//
// And choices (protocol 5): its hello says what a person may choose, a person's
// seat dealt with `answers` says in the reply which decisions it will be asked,
// and it keeps the last `act` and `decide` it was sent, so a test can see what
// the room passed on. FAKE_PROTOCOL=4 plays an engine from before them.
//
// And mulligans (protocol 6): dealt with `mulligans: true`, it opens with the
// first seat's opening hand to keep, in Server.kt's shapes — keep or take a
// mulligan, and after keeping with mulligans taken, the cards to put on the
// bottom, refused in Server.kt's words where one is named twice or they are not
// as many as owed, and in Argentum's where one is not in the hand —
// before its first captured stop. Its hand is the first shot's; it draws no new
// one, since the captured views hold one hand. FAKE_PROTOCOL=5 plays an engine
// from before them.
//
// It can be made to hold a request until the test lets it go (`holdActs`,
// `release`, FAKE_HOLD_HELLO), which is how a test waits on "the engine is
// still answering" without waiting on a clock.
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'

const FIXTURE = JSON.parse(readFileSync(new URL('./engine-views.json', import.meta.url), 'utf8'))
const shots = FIXTURE.shots
let at = -1
// Every step taken, of anybody's: one line of the log each, so a view asked
// for mid-turn has something new in it to carry.
let steps = 0
// A paced table (engine/README.md): dealt with `pace`, stopping after each of
// its own plays. `pending` is how many of those are left before the table is
// the player's again; `plays` is how many it makes after each of theirs.
let paced = false
let plays = 0
let pending = 0
// Every `continue` this engine was asked for, so a test can see that the room
// asked once a step and that it stopped asking when it should have.
let continues = 0
// What each seat was last sent, so a delta is against that seat's own last
// view and its log carries only the lines added since — the real process
// keeps exactly this much per viewer.
const lastView = new Map()
const sentLines = new Map()
// Told to be stubborn, it acknowledges quit and stays up, the way a hung JVM
// would, so a test can make the bridge fall back to force.
let stubborn = false
// Test-only faults, each one a thing the real process can do while still alive.
// `dropViews` answers the next few `view` calls with a refusal *after* moving
// that seat on, exactly as the real one does: it writes its last view and its
// count of lines sent before it builds the reply, so a reply that is refused
// or lost has still advanced them. `sulking` refuses `continue` while still
// saying the table is waiting on the engine, which is what a call that timed
// out looks like from the room.
let dropViews = 0
let sulking = false
// `holdActs` makes the next `act` wait for the test, as the real process makes
// a press wait while a hard level thinks: the act is taken and not answered,
// and every line after it waits behind it — one request at a time, the next
// read only after this one's reply — until `release` answers it and they go on
// in order. The test says when the answer comes, so nothing leans on a clock.
// `FAKE_HOLD_HELLO` does the same to the first `hello`, for a room caught while
// its engine is still loading the corpus.
let holding = false
let held = null
let waitingLines = []
let helloHeld = Boolean(process.env.FAKE_HOLD_HELLO)
let acts = 0
// The last deal asked for, so a test can see exactly what the relay sent; and
// the last act and decide, for the same reason.
let lastNew = null
let lastAct = null
let lastDecide = null
const protocol = () => Number(process.env.FAKE_PROTOCOL) || 6
// Protocol 5's choices, as the real engine names them in hello (Server.kt);
// protocol 6 adds the cards put on the bottom after a mulligan to what act takes.
const ALWAYS_ASKED = ['ChooseTargets', 'YesNo', 'ChooseOption']
const choices = () => ({ ...CHOICES, act: protocol() >= 6 ? [...CHOICES.act, 'cards'] : CHOICES.act })
const CHOICES = {
  act: ['targets', 'x', 'damage', 'cost', 'auto'],
  costs: ['DiscardCard', 'SacrificePermanent', 'TapPermanents', 'BouncePermanent', 'ExileFromGraveyard', 'ExileFromHand', 'Behold', 'RevealCard', 'Blight'],
  decisions: [...ALWAYS_ASKED, 'SelectCards', 'OrderObjects', 'ReorderLibrary', 'Distribute', 'CombatResolution', 'SelectManaSources', 'ChooseNumber', 'ChooseColor', 'ChooseMode', 'BatchYesNo'],
}
/** What a person's seat will be asked: every engine's three, and those of its client's it can ask. */
const asked = (p) => (p?.ai || protocol() < 5 ? {} : { asked: CHOICES.decisions.filter((d) => ALWAYS_ASKED.includes(d) || (Array.isArray(p?.answers) && p.answers.includes(d))) })
// Protocol 4's levels, as the real engine names them in hello. An engine seat
// asked for one of these takes it and says so; asked for anything else, or by a
// fake playing an older engine, it plays its one way and names no level.
const LEVELS = { easy: 'v0', intermediate: 'production-raceclock', hard: 'production-candidate-expiring' }
const played = (p) => {
  if (!p?.ai || p.ai === 'random' || protocol() < 4) return {}
  const level = p.level in LEVELS ? p.level : null
  return { level, profile: level ? LEVELS[level] : 'current' }
}
// The one rule the fake has for which cards it knows, used by check and new
// alike: a name the real engine would resolve is not its business. The real
// resolution is tested against the real engine, in engine-live.test.js.
const unknownName = (name) => /^Made-Up/.test(name)
// A deck line is a count, or a printing with a count, or a list of those.
// The printings it has not got: any whose collector number starts 9999.
const missedPrintings = (deck) => Object.entries(deck ?? {})
  .filter(([, v]) => [v].flat().some((x) => String(x?.number ?? '').startsWith('9999')))
  .map(([name]) => name)
const copiesOf = (v) => {
  if (Array.isArray(v)) return v.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof v === 'number' ? v : v?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}

const lines = createInterface({ input: process.stdin })
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const ended = () => ({ ok: true, over: true, winner: FIXTURE.seats[0].id, turn: 9, phase: 'ENDING', step: 'END', actor: null, waiting: null, autoPassed: 0, decided: [] })
/** The seat the engine plays, which is whichever one was dealt an AI. */
const engineSeat = () => (lastNew?.players ?? []).map((p, i) => (p.ai ? FIXTURE.seats[i]?.id : null)).find(Boolean) ?? FIXTURE.seats[1]?.id ?? null
const shot = () => shots[Math.min(Math.max(at, 0), shots.length - 1)]
/**
 * Stopped after one of its own plays: the seat that made it, nothing on offer
 * and nothing to decide, exactly as a paced table answers.
 */
const paused = () => ({
  ok: true, over: false, winner: null, turn: shot().status.turn, phase: shot().status.phase, step: shot().status.step,
  actor: engineSeat(), waiting: 'engine', autoPassed: 0, decided: [],
})
// Test-only: decisions the next stops put to the first seat, one at a time,
// each until it is decided (`ask`), for a test of what each seat is sent of
// one and of what a client sends back. Answering one moves the table on to the
// next asked, not to the next captured shot: the captured run has only two.
let asking = []
// The opening hand being kept (protocol 6), or null once the game has begun or
// where the deal did not ask for one: how many mulligans the first seat has
// taken, and whether it has kept.
let mulligan = null
/** The first seat's hand in the first shot: what it keeps, and what it puts on the bottom from. */
const openingHand = () => shots[0].view.zones.find((z) => z.zoneId?.zoneType === 'Hand' && z.zoneId?.ownerId === FIXTURE.seats[0].id)?.cardIds ?? []
/** Server.kt's offers for the mulligan phase, numbers and all, for a two-player game. */
const mulliganOffers = () => (mulligan.kept
  ? [{ index: 0, type: 'BottomCards', description: `Put ${mulligan.taken} ${mulligan.taken === 1 ? 'card' : 'cards'} on the bottom of your library`, affordable: true, meaningful: true, mulligans: mulligan.taken, bottom: mulligan.taken, candidates: openingHand() }]
  : [
      { index: 0, type: 'KeepHand', description: 'Keep this hand', affordable: true, meaningful: true, mulligans: mulligan.taken, bottom: mulligan.taken },
      ...(mulligan.taken < 7 ? [{ index: 1, type: 'TakeMulligan', description: 'Take a mulligan', affordable: true, meaningful: true, mulligans: mulligan.taken, draws: 7, bottom: mulligan.taken + 1 }] : []),
    ])
const status = () => {
  if (mulligan) {
    const { actions, ...rest } = shots[0].status
    return { ...rest, ok: true, turn: 1, phase: 'BEGINNING', step: 'UNTAP', actor: FIXTURE.seats[0].id, waiting: 'action', actions: mulliganOffers(), autoPassed: 0, decided: [] }
  }
  if (pending > 0) return paused()
  if (asking.length && at >= 0 && at < shots.length) {
    const { actions, ...rest } = shots[at].status
    return { ...rest, ok: true, waiting: 'decision', actor: FIXTURE.seats[0].id, decision: asking[0] }
  }
  return at >= shots.length ? ended() : { ...shots[at].status, ok: true }
}
/** The log so far: one line a step, each carrying its words and its step, as M1 left them. */
const logSoFar = () => Array.from({ length: steps }, (_, i) => ({ type: 'note', description: `Something happened (${i + 1})`, step: shot().status.step ?? null }))

/**
 * Argentum's StateDelta, as the real process passes it through: null means
 * unchanged, `players` is always whole, combat that has gone is said with
 * `combatCleared`, and `newLogEntries` is never here — this process keeps each
 * seat's log itself, beside the delta rather than inside it.
 */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const zoneKey = (z) => `${z?.zoneId?.ownerId}/${z?.zoneId?.zoneType}`
const deltaOf = (prev, next) => {
  const delta = { players: next.players ?? [] }
  const added = {}
  const updated = {}
  const removed = []
  for (const [id, card] of Object.entries(next.cards ?? {})) {
    const was = prev.cards?.[id]
    if (!was) added[id] = card
    else if (!same(was, card)) updated[id] = card
  }
  for (const id of Object.keys(prev.cards ?? {})) if (!(id in (next.cards ?? {}))) removed.push(id)
  if (Object.keys(added).length) delta.addedCards = added
  if (Object.keys(updated).length) delta.updatedCards = updated
  if (removed.length) delta.removedCardIds = removed
  const before = new Map((prev.zones ?? []).map((z) => [zoneKey(z), z]))
  const zones = (next.zones ?? []).filter((z) => !same(before.get(zoneKey(z)), z))
  if (zones.length) delta.updatedZones = zones
  for (const key of ['currentPhase', 'currentStep', 'activePlayerId', 'priorityPlayerId', 'turnNumber', 'isGameOver', 'winnerId', 'deck']) {
    if (!same(prev[key], next[key])) delta[key] = next[key]
  }
  if (next.combat && !same(prev.combat, next.combat)) delta.combat = next.combat
  if (prev.combat && !next.combat) delta.combatCleared = true
  return delta
}

lines.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { say({ id: null, ok: false, error: 'not json' }); return }
  // A request held (`holdActs`, FAKE_HOLD_HELLO) keeps every line after it
  // waiting, as a process busy on one request reads no other. Two get
  // through: the test's `release`, and `quit`, so a room closed mid-hold
  // ends its stand-in at once rather than after the bridge's wait for it.
  if (held && req.op !== 'release' && req.op !== 'quit') { waitingLines.push(req); return }
  handle(req)
})

function handle(req) {
  const { id } = req
  switch (req.op) {
    // The real engine's shape: every set it knows, in release order, and what
    // loading them cost. Each set's details are Argentum's own, as the built
    // engine's hello gave them on 2026-09-21: Star Trek Commander is one it
    // marks incomplete, and its date is Argentum's, not Scryfall's.
    // FAKE_PROTOCOL plays an older engine, to test what the relay sends one;
    // FAKE_NO_SETS one whose hello lists no sets.
    case 'hello':
      if (helloHeld && !req.released) { helloHeld = false; held = req; return }
      say({
        id, ok: true, engine: 'fake', protocol: protocol(), cards: 3,
        ...(protocol() >= 4 ? { levels: LEVELS } : {}),
        ...(protocol() >= 5 ? { choices: choices() } : {}),
        ...(process.env.FAKE_NO_SETS ? {} : { sets: [
          { code: 'POR', name: 'Portal', released: '1997-05-01', incomplete: false },
          { code: 'TRC', name: 'Star Trek Commander', released: '2026-01-23', incomplete: true },
          { code: 'HOB', name: 'The Hobbit', released: '2026-08-14', incomplete: false },
        ] }),
        load: { ms: 0, heapMb: 0, maxHeapMb: 0 },
      })
      break
    case 'cards': say({ id, ok: true, names: [...new Set(shots.flatMap((s) => Object.values(s.view.cards).map((c) => c.name)))].sort() }); break
    case 'check': {
      if (!req.deck || typeof req.deck !== 'object') { say({ id, ok: false, error: '"deck" is required.' }); break }
      // A check that kills the process, as a crashed JVM would, for the relay's 502.
      if ('Made-Up Crash' in req.deck) process.exit(3)
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
      at = 0; steps = 0; pending = 0
      lastView.clear(); sentLines.clear()
      lastNew = req
      // A pace is read only as a yes, and only by an engine that has one: an
      // older one has never heard of the key and ignores it, as the real one does.
      paced = protocol() >= 3 && (req.pace === true || (typeof req.pace === 'number' && req.pace > 0))
      // So is a mulligan phase, from protocol 6.
      mulligan = protocol() >= 6 && req.mulligans === true ? { taken: 0, kept: false } : null
      // A sideboard card it does not know is left out and named, as the real engine does.
      say({
        id,
        ...status(),
        ...(paced ? { paced: true } : {}),
        ...(mulligan ? { mulligans: true } : {}),
        seats: FIXTURE.seats.map((s, i) => ({ ...s, ai: req.players?.[i]?.ai ?? null, sideboardLeftOut: Object.keys(req.players?.[i]?.sideboard ?? {}).filter(unknownName), unknownPrintings: missedPrintings(req.players?.[i]?.deck), ...played(req.players?.[i]), ...asked(req.players?.[i]) })),
      })
      break
    }
    case 'turn': say({ id, ...status() }); break
    case 'lastNew': say({ id, ok: true, request: lastNew }); break
    case 'lastAct': say({ id, ok: true, request: lastAct }); break
    case 'ask': if (req.decision) asking.push(req.decision); else asking = []; say({ id, ok: true, asking: asking.length }); break
    case 'lastDecide': say({ id, ok: true, request: lastDecide }); break
    // Test-only: how many plays this engine makes after each of the player's,
    // on a paced table. Nothing the real protocol has — the captured shots hold
    // the player's stops alone, so what it does between them is said here.
    case 'plays': plays = Math.max(0, Number(req.count) || 0); say({ id, ok: true, plays }); break
    // Test-only: what this engine has been asked for and where it stands.
    case 'tally': say({ id, ok: true, continues, steps, pending, paced, plays, acts }); break
    // Test-only: the next act is taken and not answered until `release`.
    case 'holdActs': holding = true; say({ id, ok: true }); break
    case 'release': {
      // The held request is answered first, as the process would have answered
      // it, then this line, then whatever waited behind them, in order.
      const was = held
      held = null
      if (was) handle({ ...was, released: true })
      say({ id, ok: true, released: Boolean(was) })
      const later = waitingLines
      waitingLines = []
      for (const r of later) { if (held) waitingLines.push(r); else handle(r) }
      break
    }
    // Test-only faults, above.
    case 'dropViews': dropViews = Math.max(0, Number(req.count) || 0); say({ id, ok: true, dropViews }); break
    case 'sulk': sulking = true; say({ id, ok: true }); break
    case 'act': {
      if (!req.released) acts++
      lastAct = req
      if (holding && !req.released) { holding = false; held = req; return }
      if (mulligan) {
        // The opening hand, as Server.kt takes it: keeping and a mulligan need
        // nothing more, and the cards put on the bottom are exactly as many as
        // are owed, from the hand, or the engine's own with `auto`.
        const offer = mulliganOffers()[req.index]
        if (!offer) { say({ id, ok: false, error: `No action ${req.index}; ${mulliganOffers().length} were offered.` }); break }
        if (offer.type === 'TakeMulligan') mulligan.taken++
        else if (offer.type === 'KeepHand' && mulligan.taken > 0) mulligan.kept = true
        else if (offer.type === 'BottomCards') {
          const cards = req.auto === true ? offer.candidates.slice(0, offer.bottom) : req.cards
          if (!Array.isArray(cards)) { say({ id, ok: false, error: `Putting cards on the bottom needs "cards", the ${offer.bottom} chosen from your hand, or "auto": true.` }); break }
          if (new Set(cards).size !== cards.length) { say({ id, ok: false, error: 'Each card goes on the bottom once; the same card was named twice.' }); break }
          if (cards.length !== offer.bottom) { say({ id, ok: false, error: `Put exactly ${offer.bottom} on the bottom: ${cards.length} ${cards.length === 1 ? 'was' : 'were'} chosen.` }); break }
          if (cards.some((c) => !offer.candidates.includes(c))) { say({ id, ok: false, error: `The engine refused that: Cards not in hand: [${cards.filter((c) => !offer.candidates.includes(c)).join(', ')}]` }); break }
          mulligan = null
        } else mulligan = null
        steps++
        say({ id, ...status() })
        break
      }
      if (pending > 0) { say({ id, ok: false, error: 'The game is not waiting on anyone.' }); break }
      if (at < 0 || at >= shots.length) { say({ id, ok: false, error: 'The game is not waiting on anyone.' }); break }
      const offered = shots[at].status.actions ?? []
      if (!(req.index >= 0 && req.index < offered.length)) { say({ id, ok: false, error: `No action ${req.index}; ${offered.length} were offered.` }); break }
      at++; steps++
      // Then the engine's own turn, one play at a time, if this table is paced
      // and there is anything in it to watch.
      if (paced && plays > 0) { pending = plays; steps++ }
      say({ id, ...status() })
      break
    }
    case 'decide': {
      lastDecide = req
      if (asking.length) { asking.shift(); steps++; say({ id, ...status() }); break }
      if (at < 0) { say({ id, ok: false, error: 'There is no decision to make.' }); break }
      at++; steps++
      if (paced && plays > 0) { pending = plays; steps++ }
      say({ id, ...status() })
      break
    }
    // The next step of a paced table, refused the two ways the real one refuses
    // it: at a table that was never paced, and where nothing is waiting on the
    // engine. The last step is the one that hands the table back to the player.
    case 'continue': {
      continues++
      if (sulking) { say({ id, ok: false, error: 'The engine did not answer "continue" in time.' }); break }
      if (!paced) { say({ id, ok: false, error: 'This table is not paced: "new" was sent without "pace", so there is nothing to continue.' }); break }
      if (pending <= 0) { say({ id, ok: false, error: 'Nothing is waiting on the engine. Ask for "turn" to see where the table stands.' }); break }
      pending--; steps++
      say({ id, ...status() })
      break
    }
    case 'view': {
      const here = shot()
      const seatId = req.viewer ?? here.view.viewingPlayerId
      const next = { ...here.view, viewingPlayerId: seatId }
      const before = lastView.get(seatId)
      lastView.set(seatId, next)
      const all = logSoFar()
      const since = req.delta === true && before ? sentLines.get(seatId) ?? 0 : 0
      sentLines.set(seatId, all.length)
      const asDelta = req.delta === true && before && protocol() >= 3
      // Refused only now, with both maps already written: the point of the
      // fault is that the seat has been moved on by a reply nobody got.
      if (dropViews > 0) { dropViews--; say({ id, ok: false, error: 'That view could not be built.' }); break }
      say({ id, ok: true, ...(asDelta ? { delta: deltaOf(before, next) } : { state: next }), log: all.slice(since) })
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
}
