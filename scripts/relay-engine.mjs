/**
 * A rules-enforced room: the relay's other authority.
 *
 * An unenforced room is a table the relay holds (`relay-server.mjs`). An
 * enforced room is a table the engine holds: one engine process per room
 * (engine/README.md), started the moment every human seat has sat down with
 * a deck, and spoken to through `engine-bridge.mjs`. The browser talks to
 * both kinds of room over the same socket; what differs is the messages,
 * all of them `{ t: 'engine', op }` here, and who decides. Nothing in this
 * file knows a rule of Magic either — it knows whose turn the engine says
 * it is, and forwards.
 *
 *   from a client        sit { name, deck: { "Mountain": 14, … }, sideboard?: { … }, seat?, deltas?, level?, answers?, mulligans? }
 *                        act { stop, index, attackers?, blockers?, targets?, x?, damage?, cost?, auto?, cards? }
 *                        decide { stop, … }        turn                    resync
 *   to every client      seats [ … ]               status { … }            gone { reason }
 *   to one client        seated { seat, engineSeat, sideboardLeftOut, unknownPrintings, level?, ai?, choices? }
 *                        view { you, seq, state | delta, log }             refused { error, stale?, answering? }
 *
 * `stop` is the number of the status a client is answering: an act sent
 * against a stale status is refused rather than landing on a different
 * offer with the same index.
 *
 * A view carries a `seq` of its own, counted per seat: the first view a seat
 * is sent is the whole `state`, and every later one may be a `delta` against
 * the one before it, with only the log lines added since. A client that sees
 * a gap in the numbers asks for `resync` and is sent a whole state again,
 * rather than draw a board built on a delta it never had. Deltas are sent
 * only to a client that said in its `sit` that it can apply them, and only by
 * a room whose engine speaks protocol 3: a tab left open across a deploy, or
 * an older engine, is served whole views as before.
 *
 * Watching the engine's turn is the room's job too (HANDOFF.md, M2). The
 * engine is dealt a paced table, which stops as soon as its own seat has made
 * a play worth watching; the room publishes that stop to every seat, waits
 * its pace, asks for the next step, and repeats until a player is to act or
 * the game ends. The engine never sleeps — one process serves one table over
 * one line — so all the waiting in wall-clock time is here.
 *
 * How strongly the engine plays is a room setting too (HANDOFF.md, M3): one of
 * the levels in `src/lib/engine/levels.js`, given when the room is opened
 * (`POST /rooms { level }`) and changed by a sit that names one, until the
 * deal. The room asks the engine for it only where the engine has levels
 * (protocol 4), and believes the engine's reply as to whether it was taken:
 * every `seated` after the deal says `level`, the level the engine is playing
 * at, or null where it plays its one way, and `ai`, the kind of player the
 * engine fields here, since only a heuristic one has levels to play at. A room
 * nobody asked a level of asks the engine for none, which is how a tab from
 * before levels plays as it did.
 *
 * What a person may choose is the engine's to say and the client's to show
 * (HANDOFF.md, M4). An engine at protocol 5 says in its `hello` what its `act`
 * takes beyond an index — targets, an X, a division of damage, what a cost
 * takes — and which decisions it can put to a person. A client says in its sit
 * which decisions it can show (`answers`), and the room passes that to the
 * deal for that seat alone; the engine answers the rest for them, as it always
 * has. Every `seated` after the deal then says `choices`: what that seat's
 * `act` may carry and which decisions it will be asked. A client told nothing —
 * by an older relay, or of an older engine — keeps holding back what it cannot
 * send, which is how nobody is shown a choice that would be dropped on the way.
 *
 * The status goes to every seat, and a decision can carry the faces of cards
 * only the deciding seat may see — the top of its library, looked at. Every
 * other seat's copy leaves those out.
 *
 * The opening hands are the players' to keep (HANDOFF.md, M4, and the owner's
 * "mulligans on", §3 item 3). A client says in its sit that it can show a
 * mulligan (`mulligans: true`), and where every person at the table has said
 * so and the engine speaks protocol 6, the room deals with Argentum's own
 * mulligan phase: the first statuses offer keeping, a mulligan, and then the
 * cards to put on the bottom, which the room forwards as it forwards any act.
 * Anywhere else every hand is kept, as it always was, so a tab from before
 * mulligans is never offered one it cannot take.
 */
import { startEngine } from './engine-bridge.mjs'
import { levelOf } from '../src/lib/engine/levels.js'

export const OP = {
  sit: 'sit', act: 'act', decide: 'decide', turn: 'turn', resync: 'resync',
  seated: 'seated', seats: 'seats', status: 'status', view: 'view', refused: 'refused', gone: 'gone',
}

// How long an engine's first answer may take. It loads the whole card corpus
// before it reads a line, which is far slower than any answer after it. An
// allowance rather than a measurement: engine/README.md has the measured load,
// and this is revisited against it.
export const STARTUP_MS = 120_000

/**
 * How long one of the engine's plays is left standing before the room asks for
 * the next. Moxgate's table plays the opponent's turn at a pace rather than in
 * one jump, and 600 ms is where this one starts (HANDOFF.md, M2). It is the
 * room's setting rather than a constant in the loop, so the playback-speed
 * preset of TARGET.md §5 — Relaxed, Brisk, Instant — has somewhere to land.
 */
export const PACE_MS = 600

/** The protocol that first had a pace, a `continue` and a log inside a delta. */
const PACED_PROTOCOL = 3
/** The protocol that first had levels, and said in its reply which one each seat took. */
const LEVELLED_PROTOCOL = 4
/** The protocol whose `act` first carried what a person chose, and which could ask more decisions. */
const CHOOSING_PROTOCOL = 5
/** The protocol that first dealt a mulligan phase when asked, and said in its reply that it had. */
const MULLIGAN_PROTOCOL = 6

/** A list of short words from the wire, read forgivingly: anything else in it is dropped. */
const words = (list, most = 32) => (Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 40).slice(0, most) : [])

/**
 * What an engine said a person may choose (its `hello`'s `choices`), kept as
 * the room passes it on. Read forgivingly: an engine that said nothing, or
 * something unreadable, offers nothing to choose.
 */
const choicesOf = (hello) => {
  const c = hello?.choices
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  return { act: words(c.act), costs: words(c.costs) }
}

/**
 * The status as one seat may see it. A decision is put to one seat, and the
 * faces it carries of cards in a hidden zone (`decision.cards`) are that
 * seat's alone: every other seat is sent the question without them.
 */
const statusFor = (status, seat) => {
  const d = status?.decision
  if (!d?.cards || status.actor === seat?.engineSeat) return status
  const { cards, ...rest } = d
  return { ...status, decision: rest }
}

// A deck line is a count, or a printing with a count, or a list of those.
const copiesOf = (v) => {
  if (Array.isArray(v)) return v.reduce((sum, x) => sum + copiesOf(x), 0)
  const n = typeof v === 'number' ? v : v?.count
  return Number.isInteger(n) && n > 0 ? n : 0
}
// An engine at protocol 1 reads a deck line only as a count, so it is sent only
// counts: the printings are lost, but the game is dealt rather than refused.
const forProtocol = (protocol, lines) => (!lines || protocol >= 2 ? lines : Object.fromEntries(Object.entries(lines).map(([name, v]) => [name, copiesOf(v)])))

export function createEngineRoom({ code, seats: seatCount, ai = 'heuristic', level: askedLevel = null, engineCommand, seed = null, deliver, onStderr = null, paceMs = PACE_MS, wait = null }) {
  const humanSeats = Math.max(1, ai ? seatCount - 1 : seatCount)
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    seat: `p${i + 1}`, name: null, here: false, ready: false, socket: null, deck: null, sideboard: null,
    ai: ai && i === seatCount - 1 ? ai : null, engineSeat: null, sideboardLeftOut: [], unknownPrintings: [],
    // What this seat has been sent: the number of its last view, whether it
    // has had a whole state since it last connected, and whether the client
    // there said it can apply a delta.
    seq: 0, whole: false, deltas: false,
    // The decisions the client at this seat said it can show, passed to the
    // deal; and, after it, the ones the engine said it will ask this seat.
    answers: [], asked: null,
    // Whether the client at this seat said it can show a mulligan, until the deal.
    mulligans: false,
  }))
  // The level the room was asked for, until the deal; a word this build does
  // not know is no level. After the deal, `played` is the engine's own word
  // for what its seat is playing at, or null where it took none.
  let level = levelOf(askedLevel)
  let played = null
  let profile = null
  // The level is said only once there is a deal to have taken it: before that,
  // a seated carries no `level`, rather than one the engine may yet refuse.
  // With it goes the kind of player the engine fields here, `ai` — heuristic,
  // random, or null for none — because only the first has levels, and a null
  // `level` means "plays one way" only where it could have had one.
  //
  // And what the person in the seat may choose, once the engine has said: what
  // their `act` may carry and which decisions they will be asked. Said only
  // where an engine said it, so a client told nothing holds back what it
  // cannot send, as it did before there was anything to choose.
  const seated = (seat) => ({
    seat: seat.seat, engineSeat: seat.engineSeat, sideboardLeftOut: seat.sideboardLeftOut, unknownPrintings: seat.unknownPrintings,
    ...(seat.engineSeat ? { level: played, ai: ai ?? null } : {}),
    ...(seat.engineSeat && choices && !seat.ai ? { choices: { ...choices, decisions: seat.asked ?? [] } } : {}),
  })
  const sockets = new Map()
  let engine = null
  // The last process this room started, kept even after the room has let it
  // go, so a test can see that one which failed to deal was closed.
  let lastStarted = null
  let status = null
  let stop = 0
  let starting = false
  let gone = null
  // What the engine said it is: whether it took the pace, and whether it is new
  // enough to be asked for a delta. Both are the engine's word rather than this
  // room's assumption, because an older one answers neither and must not be
  // driven as though it had.
  let paced = false
  let protocol = 0
  // What the engine said a person may choose (protocol 5), or null.
  let choices = null
  // Whether the engine dealt the game with a mulligan phase, in its own word (protocol 6).
  let mulliganed = false
  let closed = false

  const say = (socket, op, body = {}) => deliver(socket, { t: 'engine', op, ...body })
  const tell = (op, body = {}) => { for (const s of sockets.values()) say(s, op, body) }
  /** The status, numbered, as the seat at this socket may see it (`statusFor`). */
  const sayStatus = (socket) => say(socket, OP.status, { status: { ...statusFor(status, seats.find((x) => x.socket === socket)), stop } })
  // The engine's seat says the level it plays at: the room's setting until
  // the deal, and what the engine took after it.
  const seatList = () => seats.map(({ seat, name, here, ready, ai: bot, engineSeat }) => ({
    seat, name, here, ready: ready || Boolean(bot), ai: bot, engineSeat,
    ...(bot ? { level: engineSeat ? played : level } : {}),
  }))

  /**
   * The room has lost its engine, said once. A process can be found to have
   * gone by three different routes at once — a call that rejects, the step the
   * pace asked for, the exit itself — and a room that told each of them would
   * say the same thing three times to every seat. The first word is kept,
   * because it is the one that says what happened rather than what followed.
   */
  const lost = (reason) => {
    if (gone) return
    gone = reason
    tell(OP.gone, { reason })
  }

  /**
   * One seat's view of the table, numbered. A seat that has had a whole state
   * and said it can apply a delta is sent one; anything else is sent the state
   * entire. What comes back decides which it was: an engine that answered a
   * delta with a whole state is believed, and the seat's count starts again
   * from it, rather than a delta being announced that was never sent.
   */
  const sendView = async (seat, { whole = false } = {}) => {
    if (!engine || !seat.socket || !seat.engineSeat) return
    const asDelta = !whole && seat.whole && seat.deltas && protocol >= PACED_PROTOCOL
    // A view the engine answered but this room did not send is a hole in the
    // chain with no gap for the client to see. The engine moves a seat on when
    // it builds the reply — its own last view for that seat, and its count of
    // the log lines sent — so a reply that is lost, refused or never comes has
    // still moved it: the next delta would be against a view nobody has, and
    // the lines that travelled with the lost one never come again, while the
    // numbers stay consecutive and nothing asks. So the seat is marked as
    // holding nothing whole, and its next view is asked for whole, which
    // starts both of the engine's counts again and resends the log entire.
    try {
      const v = await engine.call('view', { viewer: seat.engineSeat, ...(asDelta ? { delta: true } : {}) })
      const body = v.state ? { state: v.state } : v.delta ? { delta: v.delta } : null
      if (!body) { seat.whole = false; return }
      if (v.state) seat.whole = true
      // The log beside a delta is only what was added since this seat's last
      // view, which its client appends; beside a whole state it is the lot.
      say(seat.socket, OP.view, { you: seat.engineSeat, seq: ++seat.seq, ...body, log: v.log ?? [] })
    } catch { seat.whole = false }
  }

  const publish = async () => {
    if (!engine || !status) return
    stop++
    for (const s of sockets.values()) sayStatus(s)
    for (const seat of seats) await sendView(seat)
  }

  // The room's own wait between the engine's steps. Held as a wake so that a
  // room closing, or the last seat emptying, is not waited out first: the loop
  // is woken and finds its own reason to stop.
  let napWake = null
  const nap = (ms) => new Promise((done) => {
    const timer = setTimeout(() => { napWake = null; done() }, Math.max(0, ms))
    timer.unref?.()
    napWake = () => { clearTimeout(timer); napWake = null; done() }
  })
  const wakeNap = () => napWake?.()
  const pause = wait ?? nap

  /**
   * Watching the engine's turn. While the engine is waiting on itself, the room
   * publishes what it just did, waits the room's pace and asks for the next
   * step. It stops the moment there is nothing or nobody to watch it for — the
   * game hands back, the room closes, the engine dies, the last seat empties —
   * and only one loop ever runs, so a rejoin mid-turn takes the turn up again
   * without starting a second (an act cannot: it is refused before it gets
   * here, because it is not that seat the game is waiting on).
   */
  let driving = false
  // Somebody in a seat, not merely somebody on the wire: a socket is in the
  // room from the moment it connects, and one whose sit was refused — every
  // seat taken — would otherwise keep the turn running for a room where
  // nobody can be sent a view, since `sendView` has no seat to send one to.
  const watching = () => Boolean(engine) && !closed && paced && seats.some((s) => s.socket) && status?.waiting === 'engine'
  /**
   * How many steps in a row may fail before the room stops taking them. A step
   * can fail without the engine being dead: a call that timed out, a reply
   * that threw after the table had already moved on. Giving up on the first
   * would leave the plate saying the engine was thinking about a turn nobody
   * was taking, and never giving up would ask a broken engine once a pace for
   * the rest of the game. So a few, and then it is said in words.
   */
  const STEPS_BEFORE_GIVING_UP = 3
  const drive = async () => {
    if (driving || !watching()) return
    driving = true
    let failed = 0
    try {
      // The try is inside the loop, so a step that failed and was recovered
      // from is one step lost rather than the whole of the engine's turn: the
      // loop looks again at whether there is anything to watch and carries on.
      while (watching()) {
        try {
          await pause(paceMs)
          if (!watching()) break
          status = await engine.call('continue')
          await publish()
          failed = 0
        } catch (e) {
          // An engine that has gone is said by its exit, and there is no turn
          // left to take.
          if (engine?.exited) break
          failed++
          // A continue the engine refused: it is not waiting on itself after all.
          // Its word for where the table stands is worth more than this room's,
          // so the room asks rather than keep asking for a step that is not there.
          try { status = await engine.call('turn'); await publish() } catch { /* an engine that cannot say has gone, and its exit says so */ }
          // Still the engine's to play, and still not playing it. A room left
          // saying "The engine is thinking…" about a turn nobody is taking is
          // a screen saying something untrue, so this is the end of the turn
          // and the room says why.
          if (failed >= STEPS_BEFORE_GIVING_UP) { lost(`The engine stopped taking its turn: ${e.message}`); break }
        }
      }
    } finally {
      driving = false
    }
  }

  const start = async () => {
    if (engine || starting) return
    starting = true
    try {
      // Watched for its exit as well as asked: a process can stop answering
      // before it is gone — a write to a stdin that is no longer writable
      // rejects while the exit is still in flight — and without this the room
      // would learn of it only from whichever call happened to be waiting.
      // Said only while the room still holds this process: one let go of after
      // a refused deal, or closed with the room, has not gone, it was ended.
      const started = startEngine({
        command: engineCommand,
        onStderr,
        onExit: (why) => { if (!closed && engine === started) lost(why) },
      })
      engine = started
      lastStarted = engine
      // Asked first and given the long allowance, so that the corpus loading
      // is waited for once, here, and every later call keeps the usual wait.
      const hello = await engine.call('hello', {}, { timeoutMs: STARTUP_MS })
      // The engine's own seat plays the first human's deck: a mirror match,
      // until the lobby lets a deck be chosen for it. It is said so on screen.
      // The mirror is the whole deck, sideboard too, or a wish in it would be
      // a dead card on one side of the table only.
      const first = seats.find((s) => !s.ai && s.deck)
      protocol = Number(hello?.protocol) || 0
      // Taken only from an engine new enough to carry a choice in its `act`:
      // an older one ignores every key a choice would travel in.
      choices = protocol >= CHOOSING_PROTOCOL ? choicesOf(hello) : null
      // A level is asked only of an engine that has them, and only for the seat
      // it plays with its own judgement: an older engine ignores the key and
      // plays its one way, and a random player has no levels to play at.
      const levelled = level && protocol >= LEVELLED_PROTOCOL
      const player = (s) => {
        const side = forProtocol(hello?.protocol, s.ai ? first?.sideboard : s.sideboard)
        const deck = forProtocol(hello?.protocol, s.ai ? (first?.deck ?? {}) : (s.deck ?? {}))
        return {
          name: s.name ?? (s.ai ? 'The engine' : s.seat), deck, ...(side ? { sideboard: side } : {}), ai: s.ai, autoPass: !s.ai,
          // The decisions this seat's client can show, for a person's seat and an engine that asks them.
          ...(choices && !s.ai && s.answers.length ? { answers: s.answers } : {}),
          ...(levelled && s.ai === 'heuristic' ? { level } : {}),
        }
      }
      // A pace is asked for only of an engine that has one: an older one ignores
      // the key and would then refuse the `continue` that followed it.
      const asking = paceMs > 0 && protocol >= PACED_PROTOCOL
      // A mulligan phase only where every person here can be shown one: a seat
      // whose client cannot would be offered keeping and bottoming it has no
      // prompt for, and the game would wait on it for good.
      const opening = protocol >= MULLIGAN_PROTOCOL && seats.filter((s) => !s.ai).every((s) => s.mulligans)
      const reply = await engine.call('new', {
        players: seats.map(player),
        // Absent, the engine picks one and says which in its reply.
        ...(seed == null ? {} : { seed }),
        // Sent as the room's own pace in milliseconds, which the engine reads
        // only as a yes: the waiting is this room's, not the process's.
        ...(asking ? { pace: paceMs } : {}),
        ...(opening ? { mulligans: true } : {}),
      })
      // Taken only where the engine says it took it, so a room never drives a
      // table that is not stopping for it.
      paced = asking && reply?.paced === true
      mulliganed = opening && reply?.mulligans === true
      reply.seats.forEach((es, i) => {
        seats[i].engineSeat = es.id
        if (seats[i].ai) seats[i].name = es.name
        // Read forgivingly: an engine from before the sideboard sends none.
        seats[i].sideboardLeftOut = Array.isArray(es.sideboardLeftOut) ? es.sideboardLeftOut.filter((n) => typeof n === 'string') : []
        seats[i].unknownPrintings = Array.isArray(es.unknownPrintings) ? es.unknownPrintings.filter((n) => typeof n === 'string') : []
        // What the engine will ask this person, in its own words; an engine that
        // does not say asks what every engine has: targets, yes or no, an option.
        seats[i].asked = choices && !seats[i].ai ? words(es.asked) : null
      })
      // The level the engine says its seat took, and only where this room asked
      // for that one: an older engine says none, and a word the room did not ask
      // for is not one it can vouch for.
      const bot = reply.seats.find((_, i) => seats[i]?.ai)
      played = levelled && levelOf(bot?.level) === level ? level : null
      profile = typeof bot?.profile === 'string' ? bot.profile : null
      status = reply
      tell(OP.seats, { seats: seatList() })
      for (const seat of seats) if (seat.socket) say(seat.socket, OP.seated, seated(seat))
      await publish()
      drive()
    } catch (e) {
      lost(e.message)
      // A refused deal leaves the process up and waiting, and one that missed
      // the startup allowance is still loading: either way it holds the whole
      // corpus, and once the room lets go of it nothing else can close it.
      const dead = engine
      engine = null
      dead?.close().catch(() => {})
    } finally {
      starting = false
    }
  }

  const maybeStart = () => {
    const ready = seats.filter((s) => !s.ai && s.ready).length
    if (ready >= humanSeats) start()
  }

  const sit = (socket, { name, seat: wanted, deck, sideboard, deltas, level: wantedLevel, answers, mulligans }) => {
    let seat = wanted ? seats.find((s) => s.seat === wanted && !s.ai) : null
    if (seat?.socket && seat.socket !== socket) { sockets.delete(seat.socket.id); seat.socket.terminate?.() }
    if (!seat) seat = seats.find((s) => !s.ai && !s.here) ?? null
    if (!seat) { say(socket, OP.refused, { error: 'Every seat is taken.' }); return }
    // A client that has just arrived holds no view to apply a delta to, whether
    // it is a new one or the same one come back, so this seat starts whole
    // again. Deltas are what this client says it can read, asked each time it
    // sits: the one at a seat may be a newer build than the one before it.
    if (seat.socket !== socket) seat.whole = false
    seat.deltas = deltas === true
    // Kept until the deal, as the deck is; after it, the engine asks what it
    // was dealt to ask, whichever build comes back to the seat. So is whether
    // this client can show a mulligan.
    if (!engine && !starting) { seat.answers = words(answers); seat.mulligans = mulligans === true }
    seat.socket = socket; seat.here = true; seat.name = name || seat.name || seat.seat
    if (deck && typeof deck === 'object' && Object.keys(deck).length) {
      seat.deck = deck
      // The sideboard belongs to the deck it came with; a rejoin without a deck keeps both.
      seat.sideboard = sideboard && typeof sideboard === 'object' && !Array.isArray(sideboard) && Object.keys(sideboard).length ? sideboard : null
      seat.ready = true
    }
    socket.seat = seat.seat
    // The level is the room's until the deal, and a sit that names one changes
    // it: the lobby's choice travels with the sit. After the deal it is the
    // game's, and a sit that comes back naming another is told what it is.
    if (!engine && !starting && levelOf(wantedLevel)) level = levelOf(wantedLevel)
    say(socket, OP.seated, seated(seat))
    tell(OP.seats, { seats: seatList() })
    if (gone) { say(socket, OP.gone, { reason: gone }); return }
    if (engine && status) {
      sayStatus(socket)
      // Whole, and then the engine's turn goes on being watched: somebody who
      // came back mid-turn is who the pace was waiting for.
      sendView(seat, { whole: true }).then(drive)
    } else maybeStart()
  }

  /**
   * A client that missed a view asks for the table whole. Its next number is
   * the one after the view it never got, so a gap is closed rather than
   * papered over, and what it draws is the engine's own state, not a board
   * built on a delta applied to the wrong thing.
   */
  const resync = (socket) => {
    const seat = seats.find((s) => s.socket === socket)
    if (!seat) { say(socket, OP.refused, { error: 'Sit down first.' }); return }
    if (!engine || !status) { say(socket, OP.refused, { error: gone ?? 'The game has not started.' }); return }
    sendView(seat, { whole: true })
  }

  /*
   * One move at a time. The stop a press answers does not move on until the
   * engine has answered it, and against a level that searches (M3 measured up
   * to ten seconds at hard) a second press in that time used to pass the stale
   * check below, reach the engine after the first, and be applied to whatever
   * it offered next: a play nobody chose. So while one is being answered, the
   * next is refused and said, not sent.
   */
  let answering = false
  const forward = async (socket, op, message) => {
    const seat = seats.find((s) => s.socket === socket)
    if (!seat) { say(socket, OP.refused, { error: 'Sit down first.' }); return }
    if (!engine || !status) { say(socket, OP.refused, { error: gone ?? 'The game has not started.' }); return }
    if (status.actor !== seat.engineSeat) { say(socket, OP.refused, { error: 'It is not you the game is waiting on.' }); return }
    if (message.stop !== undefined && message.stop !== stop) { say(socket, OP.refused, { error: 'The table moved on; look again.', stale: true }); return }
    // `answering` marks this refusal as the guard's, which the answer on its
    // way makes untrue: a client drops it at the next status, where it keeps
    // any other refusal standing through the engine's turn.
    if (answering) { say(socket, OP.refused, { error: 'The engine is still answering your last move.', stale: true, answering: true }); return }
    const { t, op: _op, stop: _stop, ...params } = message
    answering = true
    try {
      status = await engine.call(op, params)
      await publish()
      drive()
    } catch (e) {
      say(socket, OP.refused, { error: e.message })
      if (engine?.exited) lost(e.message)
    } finally {
      answering = false
    }
  }

  return {
    mode: 'enforced',
    get engine() { return engine },
    get lastStarted() { return lastStarted },
    get status() { return status },
    join(socket) { sockets.set(socket.id, socket) },
    leave(socket) {
      sockets.delete(socket.id)
      const seat = seats.find((s) => s.socket === socket)
      if (seat) { seat.socket = null; seat.here = false; seat.whole = false; tell(OP.seats, { seats: seatList() }) }
      // Nobody left in a seat to watch the engine play: the pace is woken so
      // the turn stops where it is rather than running on to a room nobody can
      // be sent a view in. It goes on from there when somebody sits down again.
      if (!seats.some((s) => s.socket)) wakeNap()
    },
    receive(message, socket) {
      if (message?.t !== 'engine') return
      switch (message.op) {
        case OP.sit: sit(socket, message); break
        case OP.act: forward(socket, 'act', message); break
        case OP.decide: forward(socket, 'decide', message); break
        case OP.turn: if (status) sayStatus(socket); break
        case OP.resync: resync(socket); break
        default: say(socket, OP.refused, { error: `Unknown op "${message.op}".` })
      }
    },
    describe() {
      // `level` is what the room was asked for; `played` what the engine took,
      // once there is a deal, with Argentum's own id for the profile behind it.
      // `started` is an engine process begun, which is some seconds before a
      // deal — the whole corpus loads first — and `dealt` is the deal itself:
      // a lobby that read "started" as "under way" said the game was being
      // played, one way only, while it was still loading (found in M3's review).
      // `mulligans` is whether the game was dealt with a mulligan phase, once it is dealt.
      return {
        mode: 'enforced', ai, seats: seatList(), started: Boolean(engine), dealt: Boolean(engine && status), over: Boolean(status?.over), pace: paceMs, paced,
        level, ...(engine && status ? { played, profile, mulligans: mulliganed } : {}),
      }
    },
    async close() {
      // The loop is told the room has gone before the engine is: a step asked
      // for after this would be a call on a closing process, and a pace waited
      // out would hold the close for as long as it had left.
      closed = true
      wakeNap()
      await engine?.close()
    },
  }
}
