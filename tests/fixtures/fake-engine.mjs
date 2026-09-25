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
// And decks of its own (protocol 7): an engine seat dealt `deck: "own"` says in
// the reply what it built, in Server.kt's shape, by one rule of the fake's own —
// the formats Server.kt builds to, from the sets in its hello (Trek, which
// Argentum marks incomplete, standing for sets with too few cards), else from the
// whole format, else a copy of the person's deck — and a seat dealt names says
// it plays them. FAKE_PROTOCOL=6 plays an engine from before them, which refuses
// a deck that is not a list, as the real one does.
//
// And Commander (protocol 8): dealt `format: "commander"` with a commander for
// every player, in Server.kt's words where one is missing or unknown, it deals a
// Commander table of its own making over the captured views — 40 life, each
// commander in its owner's command zone, and before each captured stop a main
// phase of the first seat's that offers to cast its commander from there, with
// the commander tax Server.kt says (`from`, `commanderTax`). Casting it puts it
// on the battlefield; `commanderTo` moves it anywhere else, as a test needs, and
// a yes to a decision carrying `commanderZone` (asked with `ask`) sends it home.
// `commanderDamage` sets the tally a player's view carries. FAKE_PROTOCOL=7
// plays an engine from before it, which deals the decks by the ordinary rules.
//
// And keeping a game (protocol 9): `snapshot` answers everything it holds as
// text, and `restore` takes that text back into a stand-in that holds no game
// (or any, with `replace`), answering as `new` does. The text carries a random
// number generator's state as the real one's does, a 64-bit number JavaScript
// cannot hold, and a restore whose number came back as another is refused: a
// relay that read the text as JSON would round it, and another game would be
// played. FAKE_PROTOCOL=8 plays an engine from before it, which knows neither op.
//
// It can be made to hold a request until the test lets it go (`holdActs`,
// `holdSnapshot`, `release`, FAKE_HOLD_HELLO), which is how a test waits on
// "the engine is still answering" without waiting on a clock.
//
// And to fail the ways M7's review found a room must survive: `fragile` ends the
// process at the first view asked for after it answers a `continue`, as a reply
// it could not write would, and is kept in its snapshot, so a game taken back
// from before that play fails at the same place again, as a crash tied to a
// position does; `failSnapshot` answers the next snapshot with the error given.
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
const protocol = () => Number(process.env.FAKE_PROTOCOL) || 9
// Protocol 9: how many games this stand-in has taken back, and the last text it
// was given, so a test can see what the relay kept and passed back.
let restores = 0
let lastRestore = null
let holdingSnapshot = false
// The faults above: whether this game ends the process at the view after a
// continue, whether the last answer was a continue, and the error the next
// snapshot is to be answered with.
let fragile = false
let continued = false
let snapshotError = null
/**
 * The random number generator's state the stand-in's kept games carry: past
 * 2^53, as the real one's are (PLAN.md, M7), so JavaScript reads it as another
 * number. Written into the text and read back from it as text, never as JSON.
 */
const RNG = '9007199254740993'
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
// Protocol 7's decks. The formats are Server.kt's (every DeckFormat but the
// Commander family); the sets are the fake's hello's, Trek standing for a set too
// thin to build from; the colours are the fake's own, one pair for each pool.
const BUILDS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'premodern']
const SETS = { POR: 'Portal', HOB: 'The Hobbit', TRC: 'Star Trek Commander' }
const FORMAT_NAMES = { standard: 'Standard', pioneer: 'Pioneer', modern: 'Modern', legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper', premodern: 'Premodern', commander: 'Commander' }
const count = (deck) => Object.values(deck ?? {}).reduce((sum, v) => sum + copiesOf(v), 0)
/** A commander as `new` carries one (protocol 8): a name, or {name, set, number}. */
const commanderName = (v) => (typeof v === 'string' ? v : typeof v?.name === 'string' ? v.name : null)
/** The commander the fake's own Commander deck is led by, a real card the real engine knows. */
const OWN_COMMANDER = "Sythis, Harvest's Hand"
/**
 * What an engine seat plays, as Server.kt says it: `deck` on the seat in the
 * reply to `new`. FAKE_DECK_REPORT=noisy plays an engine that says more than
 * that, and some of it badly — its cards by name, a count that is no count,
 * colours as a word, sets with no code — so a test can see the room keep to
 * what a client may be told (`reportOf`, scripts/relay-engine.mjs).
 */
const built = (p, players, commanderGame = false) => {
  const said = plainlyBuilt(p, players, commanderGame)
  if (process.env.FAKE_DECK_REPORT !== 'noisy' || !said.deck) return said
  return { deck: {
    ...said.deck,
    names: ['Raging Goblin', 'Mountain'], list: { 'Raging Goblin': 20 }, cards: -1, colours: 'RG',
    sets: [...(said.deck.sets ?? []), { name: 'No code at all' }, 'BLB', { code: 7, name: 'Seven' }, { code: 'A CODE LONGER THAN FORTY LETTERS, WHICH NONE IS', name: 'Too long' }],
    missingSets: [3, null], commander: { name: 'Not a name' }, fellBack: 12,
  } }
}
const plainlyBuilt = (p, players, commanderGame = false) => {
  if (!p?.ai || protocol() < 7) return {}
  const person = (players ?? []).find((x) => !x.ai && x.deck && typeof x.deck === 'object')
  // A Commander deck counts its commander, and is named by its colours (Server.kt, coloursOf).
  const led = (name) => (commanderGame && name ? { commander: name } : {})
  const plus = (name) => (commanderGame && name ? 1 : 0)
  if (p.deck && typeof p.deck === 'object') return { deck: { asked: 'deck', played: 'deck', cards: count(p.deck) + plus(commanderName(p.commander)), colours: ['R'], ...led(commanderName(p.commander)) } }
  const mirror = (extra) => ({ deck: { asked: p.deck, played: 'mirror', cards: count(person?.deck) + plus(commanderName(person?.commander)), colours: ['R'], ...extra, ...led(commanderName(person?.commander)) } })
  if (p.deck === 'mirror') return mirror({})
  const format = typeof p.format === 'string' ? p.format.toLowerCase() : null
  if (commanderGame) {
    if (format !== 'commander') return mirror({ ...(format ? { format } : {}), fellBack: 'format', why: `A Commander game is dealt a Commander deck of its own, and "${format}" is not one.` })
    const known = Array.isArray(p.sets) ? p.sets.map((s) => String(s).toUpperCase()).filter((s) => s in SETS) : []
    return { deck: { asked: 'own', played: 'own', cards: 100, colours: ['W', 'G'], commander: OWN_COMMANDER, format, formatName: 'Commander', from: 'format', ...(Array.isArray(p.sets) ? { fellBack: known.length ? 'thin' : 'sets' } : {}) } }
  }
  if (!BUILDS.includes(format)) return mirror({ ...(format ? { format } : {}), fellBack: 'format', why: format === 'commander' ? 'A "commander" deck of its own is built only for a Commander game.' : `The engine builds no "${format}" deck of its own.` })
  const own = { asked: 'own', played: 'own', cards: 60, format, formatName: FORMAT_NAMES[format] }
  if (!Array.isArray(p.sets)) return { deck: { ...own, colours: ['B', 'G'], from: 'format' } }
  const known = p.sets.map((s) => String(s).toUpperCase()).filter((s) => s in SETS)
  const missingSets = p.sets.filter((s) => !(String(s).toUpperCase() in SETS))
  const missing = missingSets.length ? { missingSets } : {}
  if (!known.length) return { deck: { ...own, colours: ['B', 'G'], from: 'format', ...missing, fellBack: 'sets' } }
  if (known.includes('TRC') && known.length === 1) return { deck: { ...own, colours: ['B', 'G'], from: 'format', ...missing, fellBack: 'thin', why: 'The deck came to 12 cards, short of 60.' } }
  return { deck: { ...own, colours: ['R', 'G'], from: 'sets', sets: known.map((code) => ({ code, name: SETS[code] })), ...missing } }
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
// A Commander table (protocol 8), or null: each seat's commander by name, where
// it is, how often it has been cast from the command zone, the commander damage
// each player has been dealt, and whether the first seat is at the main phase
// the fake puts before each captured stop.
let commanders = null
const COMMAND_ID = (seat) => `cmd-${seat}`
/** The commander's card as the engine's view carries one: public, and marked as a commander. */
const commanderCard = (seat, name, zone) => ({
  id: COMMAND_ID(seat), name, manaCost: '{G/W}', manaValue: 1, typeLine: 'Legendary Creature — Elf Warrior', cardTypes: ['CREATURE'], subtypes: ['Elf', 'Warrior'],
  colors: ['GREEN', 'WHITE'], oracleText: '', power: 1, toughness: 1, basePower: 1, baseToughness: 1, keywords: [], counters: {},
  isTapped: false, hasSummoningSickness: zone === 'Battlefield', controllerId: seat, ownerId: seat, isToken: false, zone: { ownerId: seat, zoneType: zone },
  attachments: [], isFaceDown: false, isCommander: true,
})
const ZONE_TYPES = { command: 'Command', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', hand: 'Hand', library: 'Library' }
/** The captured view as a Commander table shows it: 40 life, the commanders where they are, the tally. */
const commanderView = (view) => {
  if (!commanders) return view
  const cards = { ...view.cards }
  const zones = view.zones.map((z) => ({ ...z, cardIds: [...(z.cardIds ?? [])] }))
  for (const [seat, c] of Object.entries(commanders.seats)) {
    const type = ZONE_TYPES[c.where]
    // A commander in a hidden zone is out of every view but its owner's, as any card there is.
    const hidden = (type === 'Hand' || type === 'Library') && seat !== view.viewingPlayerId
    if (!hidden) cards[COMMAND_ID(seat)] = commanderCard(seat, c.name, type)
    let zone = zones.find((z) => z.zoneId?.ownerId === seat && z.zoneId?.zoneType === type)
    if (!zone) { zone = { zoneId: { ownerId: seat, zoneType: type }, cardIds: [], size: 0, isVisible: true }; zones.push(zone) }
    if (!hidden) zone.cardIds.push(COMMAND_ID(seat))
    zone.size += 1
    if (type !== 'Command' && !zones.some((z) => z.zoneId?.ownerId === seat && z.zoneId?.zoneType === 'Command')) zones.push({ zoneId: { ownerId: seat, zoneType: 'Command' }, cardIds: [], size: 0, isVisible: true })
  }
  const players = view.players.map((p) => {
    const dealt = Object.entries(commanders.damage[p.playerId] ?? {}).filter(([, n]) => n > 0)
    return {
      ...p, life: p.life + 20,
      ...(dealt.length ? { commanderDamage: dealt.map(([seat, amount]) => ({ commanderId: COMMAND_ID(seat), commanderName: commanders.seats[seat].name, controllerId: seat, amount, threshold: 21 })) } : {}),
    }
  })
  const main = commanders.main ? { currentPhase: 'PRECOMBAT_MAIN', currentStep: 'PRECOMBAT_MAIN', combat: null } : {}
  return { ...view, ...main, cards, zones, players }
}
/** The main phase the fake puts before a captured stop at a Commander table: a pass, and the commander from the command zone. */
const mainStop = () => {
  const seat = FIXTURE.seats[0].id
  const c = commanders.seats[seat]
  const casts = c.casts
  const home = c.where === 'command'
  return {
    ok: true, over: false, winner: null, turn: shot().status.turn, phase: 'PRECOMBAT_MAIN', step: 'PRECOMBAT_MAIN', actor: seat, waiting: 'action',
    actions: [
      { index: 0, type: 'PassPriority', description: 'Pass priority', affordable: true, meaningful: false },
      ...(home ? [{
        index: 1, type: 'CastSpell', description: `Cast ${c.name}`, card: COMMAND_ID(seat), affordable: true, meaningful: true,
        manaCost: casts ? `{${2 * casts}}{G/W}` : '{G/W}', from: 'command', commanderTax: { casts, generic: 2 * casts }, requiresTargets: false,
      }] : []),
    ],
    autoPassed: 0, decided: [],
  }
}
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
  if (commanders?.main && at >= 0 && at < shots.length) return mainStop()
  return at >= shots.length ? ended() : { ...shots[at].status, ok: true }
}
/**
 * The reply to a deal, and to a game taken back (protocol 9): the status, what
 * the deal took, and the seats as Server.kt says them. A sideboard card it does
 * not know is left out and named, as the real engine does.
 */
const dealtReply = (req, commanderGame, leaders) => ({
  ...status(),
  ...(paced ? { paced: true } : {}),
  ...(mulligan ? { mulligans: true } : {}),
  ...(commanderGame ? { format: 'commander' } : {}),
  seats: FIXTURE.seats.map((s, i) => ({ ...s, ai: req.players?.[i]?.ai ?? null, sideboardLeftOut: Object.keys(req.players?.[i]?.sideboard ?? {}).filter(unknownName), unknownPrintings: missedPrintings(typeof req.players?.[i]?.deck === 'object' ? req.players[i].deck : null), ...played(req.players?.[i]), ...asked(req.players?.[i]), ...built(req.players?.[i], req.players, commanderGame), ...(leaders[i] ? { commander: leaders[i] } : {}) })),
})

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
  // Only the views that follow a continue are the ones `fragile` fails on.
  if (req.op !== 'view') continued = false
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
        ...(protocol() >= 7 ? { decks: { formats: protocol() >= 8 ? [...BUILDS, 'commander'] : BUILDS } } : {}),
        ...(protocol() >= 8 ? { formats: ['standard', 'commander'] } : {}),
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
      // A deck that is not a list is a deck of the engine's own or a copy, from
      // protocol 7; an older engine reads it as no deck, as the real one does.
      const listless = (req.players ?? []).find((p) => !p.deck || typeof p.deck !== 'object')
      if (listless && (protocol() < 7 || !listless.ai || !['own', 'mirror'].includes(listless.deck))) { say({ id, ok: false, error: `${listless.name ?? 'A player'} has no deck.` }); break }
      const missing = (req.players ?? []).flatMap((p) => Object.keys(p.deck && typeof p.deck === 'object' ? p.deck : {}).filter(unknownName))
      if (missing.length) { say({ id, ok: false, error: `The engine does not know ${missing.length} cards: ${missing.join(', ')}` }); break }
      // The game (protocol 8), refused in Server.kt's words where it deals no such
      // game, where a player has no commander, and where it does not know one. An
      // older engine has never heard of the key and deals the ordinary game.
      const format = protocol() >= 8 && typeof req.format === 'string' ? req.format.toLowerCase() : 'standard'
      if (!['standard', 'commander'].includes(format)) { say({ id, ok: false, error: `The engine deals no "${format}" game; it deals "standard" and "commander".` }); break }
      const commanderGame = format === 'commander'
      const leaders = (req.players ?? []).map((p, i) => {
        if (!commanderGame) return null
        if (!p.ai) return commanderName(p.commander)
        return built(p, req.players, true).deck?.commander ?? null
      })
      if (commanderGame) {
        const i = leaders.findIndex((n) => !n)
        if (i >= 0) { say({ id, ok: false, error: `${req.players[i].name ?? 'A player'} has no commander, and every player in a Commander game has one.` }); break }
        const j = leaders.findIndex((n) => unknownName(n))
        if (j >= 0) { say({ id, ok: false, error: `The engine does not know ${req.players[j].name ?? 'a player'}'s commander, ${leaders[j]}.` }); break }
      }
      commanders = commanderGame
        ? { seats: Object.fromEntries(FIXTURE.seats.map((s, i) => [s.id, { name: leaders[i], where: 'command', casts: 0 }])), damage: {}, main: true }
        : null
      at = 0; steps = 0; pending = 0
      lastView.clear(); sentLines.clear()
      lastNew = req
      // A pace is read only as a yes, and only by an engine that has one: an
      // older one has never heard of the key and ignores it, as the real one does.
      paced = protocol() >= 3 && (req.pace === true || (typeof req.pace === 'number' && req.pace > 0))
      // So is a mulligan phase, from protocol 6.
      mulligan = protocol() >= 6 && req.mulligans === true ? { taken: 0, kept: false } : null
      say({ id, ...dealtReply(req, commanderGame, leaders) })
      break
    }
    // The game as it stands, as text (protocol 9), with the generator's state
    // written into it as digits no JavaScript number can hold.
    case 'snapshot': {
      if (protocol() < 9) { say({ id, ok: false, error: `Unknown op "${req.op}".` }); break }
      // Test-only: held, as an act is held, for a relay going down while its
      // engine is still writing down the stop it has just published.
      if (holdingSnapshot && !req.released) { holdingSnapshot = false; held = req; return }
      if (!lastNew) { say({ id, ok: false, error: 'No game yet. Send "new" first.' }); break }
      if (snapshotError) { say({ id, ok: false, error: snapshotError }); snapshotError = null; break }
      const body = JSON.stringify({ kind: 'fake-game', at, steps, paced, plays, pending, mulligan, commanders, asking, lastNew, fragile })
      const text = `${body.slice(0, -1)},"rng":${RNG}}`
      say({ id, ok: true, snapshot: text, bytes: Buffer.byteLength(text) })
      break
    }
    // A kept game taken back, answered as `new` is (protocol 9). Refused into a
    // stand-in that holds a game already, as the real one refuses it, unless
    // asked to replace it; and refused where the text is not the one kept.
    case 'restore': {
      if (protocol() < 9) { say({ id, ok: false, error: `Unknown op "${req.op}".` }); break }
      if (lastNew && req.replace !== true) { say({ id, ok: false, error: 'This engine already holds a game; a kept game is taken back by a fresh one.' }); break }
      if (typeof req.snapshot !== 'string') { say({ id, ok: false, error: '"snapshot" is required: the text a "snapshot" answered.' }); break }
      // Read as text: parsed as JSON, the digits would come back as 9007199254740992.
      const rng = req.snapshot.match(/"rng":(-?\d+)\}$/)?.[1]
      let doc
      try { doc = JSON.parse(req.snapshot) } catch (e) { say({ id, ok: false, error: `That snapshot could not be read: ${e.message}` }); break }
      if (doc?.kind !== 'fake-game') { say({ id, ok: false, error: 'That is not a game this engine kept.' }); break }
      if (rng !== RNG) { say({ id, ok: false, error: `That game's random number generator came back as ${rng ?? 'nothing'}, where it was kept as ${RNG}.` }); break }
      ;({ at, steps, paced, plays, pending, mulligan, commanders, asking, lastNew } = doc)
      fragile = doc.fragile === true
      lastView.clear(); sentLines.clear()
      restores++
      lastRestore = req.snapshot
      const leaders = FIXTURE.seats.map((s) => commanders?.seats?.[s.id]?.name ?? null)
      say({ id, ...dealtReply(lastNew, Boolean(commanders), leaders), restored: true })
      break
    }
    case 'lastRestore': say({ id, ok: true, snapshot: lastRestore, restores }); break
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
    case 'tally': say({ id, ok: true, continues, steps, pending, paced, plays, acts, restores }); break
    // Test-only: the next act is taken and not answered until `release`.
    case 'holdActs': holding = true; say({ id, ok: true }); break
    case 'holdSnapshot': holdingSnapshot = true; say({ id, ok: true }); break
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
    // Test-only, at a Commander table: a seat's commander moved to another zone
    // (a graveyard, before the 903.9a question is asked), and the commander damage
    // a player has been dealt by a seat's commander.
    case 'commanderTo': {
      const c = commanders?.seats?.[req.seat]
      if (!c || !(req.zone in ZONE_TYPES)) { say({ id, ok: false, error: 'No such commander, or no such zone.' }); break }
      c.where = req.zone; steps++
      say({ id, ok: true })
      break
    }
    case 'commanderDamage': {
      if (!commanders) { say({ id, ok: false, error: 'Not a Commander table.' }); break }
      commanders.damage[req.to] = { ...(commanders.damage[req.to] ?? {}), [req.from]: Number(req.amount) || 0 }
      steps++
      say({ id, ok: true })
      break
    }
    // Test-only faults, above.
    case 'dropViews': dropViews = Math.max(0, Number(req.count) || 0); say({ id, ok: true, dropViews }); break
    case 'sulk': sulking = true; say({ id, ok: true }); break
    case 'fragile': fragile = true; say({ id, ok: true }); break
    case 'failSnapshot': snapshotError = String(req.error ?? 'It could not.'); say({ id, ok: true }); break
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
      // The main phase before a captured stop at a Commander table: a pass goes on
      // to the captured stop, and the commander cast from the command zone goes to
      // the battlefield, one more cast for its tax, and then on as well.
      if (commanders?.main) {
        const offer = mainStop().actions[req.index]
        if (!offer) { say({ id, ok: false, error: `No action ${req.index}; ${mainStop().actions.length} were offered.` }); break }
        if (offer.type === 'CastSpell') { const c = commanders.seats[FIXTURE.seats[0].id]; c.where = 'battlefield'; c.casts++ }
        commanders.main = false
        steps++
        say({ id, ...status() })
        break
      }
      const offered = shots[at].status.actions ?? []
      if (!(req.index >= 0 && req.index < offered.length)) { say({ id, ok: false, error: `No action ${req.index}; ${offered.length} were offered.` }); break }
      at++; steps++
      if (commanders) commanders.main = true
      // Then the engine's own turn, one play at a time, if this table is paced
      // and there is anything in it to watch.
      if (paced && plays > 0) { pending = plays; steps++ }
      say({ id, ...status() })
      break
    }
    case 'decide': {
      lastDecide = req
      if (asking.length) {
        // The CR 903.9a question at a Commander table: yes, or the engine's own
        // choice, which is yes, sends the commander to its command zone.
        const d = asking[0]
        const seat = typeof d?.player === 'string' ? d.player : FIXTURE.seats[0].id
        if (commanders && d?.commanderZone && commanders.seats[seat] && (req.yes === true || req.auto === true)) commanders.seats[seat].where = 'command'
        asking.shift(); steps++; say({ id, ...status() }); break
      }
      if (at < 0) { say({ id, ok: false, error: 'There is no decision to make.' }); break }
      at++; steps++
      if (commanders) commanders.main = true
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
      continued = true
      break
    }
    case 'view': {
      if (fragile && continued) { process.stderr.write('fake engine: a view it could not write\n'); process.exit(3) }
      const here = shot()
      const seatId = req.viewer ?? here.view.viewingPlayerId
      const next = commanderView({ ...here.view, viewingPlayerId: seatId })
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
