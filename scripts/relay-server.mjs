#!/usr/bin/env node
/**
 * The relay: one table per room, held for the people playing at it.
 *
 * Moxgate's creator describes theirs as a pure relay with zero game logic —
 * every client runs the full game, the server broadcasts what each one did,
 * and the only thing decided server-side is whose turn it is. This one keeps
 * that shape and improves on it in one respect: the server runs the same
 * board model the clients do (`src/lib/board/`), so it holds the table
 * itself rather than whatever a client last uploaded. That buys a snapshot
 * for late joiners that is always current and always passes the board's own
 * invariants, actions numbered in one place, and the "not your card" and
 * "not your turn" refusals decided once. It still knows no rules of Magic:
 * the board is a table, not a judge, on the server exactly as in a browser.
 *
 * The four things the creator called non-obvious are built in from the
 * first commit rather than learned the hard way:
 *
 *   - a hosting proxy drops a socket idle for sixty seconds, so the server
 *     pings every thirty and terminates anything that does not pong, which
 *     lets a client's backoff reconnect fire cleanly instead of hanging;
 *   - on SIGTERM every socket is closed with 1012 (Service Restart), so a
 *     client knows to reconnect rather than show a broken board;
 *   - rooms are written to disk as JSON, so a deploy mid-game keeps the game;
 *   - a late joiner or a reconnect gets the whole table from the server,
 *     without asking a host who may have gone.
 *
 * Since M7 the rooms the engine holds are written too: the room's settings and
 * seats, and the engine's own text of the game at the last stop, gzipped. A
 * relay that comes back starts an engine for each and has it take the game
 * back (`relay-engine.mjs`), so a restart is a pause at that table as well.
 *
 *   node scripts/relay-server.mjs                 # localhost:8788
 *   PORT=9000 ROOMS_DIR=/data/rooms STATIC_DIR=dist node scripts/relay-server.mjs
 *
 * The API, in full:
 *   POST /rooms            body: { seats?: 2..6, enforced?: true, ai?: 'heuristic' | 'random' | null,
 *                                  pace?: milliseconds | false, level?: 'easy' | 'intermediate' | 'hard' }
 *                                                  -> { code, seats, mode }
 *   GET  /rooms/<code>                              -> { code, seats, seq, players }, or for an enforced room
 *                                                      { mode, ai, seats, started, dealt, …, restoring? }
 *   WS   /rooms/<code>/ws                           the protocol in src/lib/board/net.js
 *   POST /engine/check     body: { deck: { name: count, … }, sideboard? }
 *                                                  -> { known, total, unknown, unknownSideboard, engineSets? }
 *   GET  /health                                    -> { ok, rooms, engine }
 *   GET  /*                 the built app, when STATIC_DIR is set
 *
 * One process serves all three, the way Moxgate's does, because the relay is
 * nearly free to run and a second service would cost more than it saves.
 */
import { createServer } from 'node:http'
import { randomInt } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { WebSocketServer } from 'ws'
import { host, KIND, PROTOCOL, restore } from '../src/lib/board/net.js'
import { findEngine, startEngine } from './engine-bridge.mjs'
import { createEngineRoom, PACE_MS, STARTUP_MS } from './relay-engine.mjs'
import { newRun } from '../src/lib/board/runner.js'
import { createBoard } from '../src/lib/board/model.js'

/** Room codes: nothing that sounds or looks like something else read aloud. */
export const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ346789'
export const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

/** The close code that means "back in a moment": reconnect, do not give up. */
export const SERVICE_RESTART = 1012
export const MIN_SEATS = 2
export const MAX_SEATS = 6
/** How long a room lives with nobody doing anything in it. */
export const IDLE_MS = 7 * 24 * 60 * 60 * 1000
/**
 * How long the engine kept for checking decks stays up with nothing to check.
 * It holds the whole card corpus in memory, so it is let go rather than kept
 * for a lobby nobody is looking at; starting it again costs one slow answer.
 */
export const CHECK_IDLE_MS = 10 * 60 * 1000
/**
 * The longest pace a room may be opened with. A pace is a wait between the
 * engine's plays, not a timeout, so a number far past watching is a mistake
 * rather than a preference, and one that would hold a turn for a minute is
 * brought back to something a person would sit through.
 */
export const MAX_PACE_MS = 10 * 1000
/**
 * How long a relay going down waits for an engine to finish writing down the
 * stop it has just published (M7). A snapshot took 6 ms at the median and
 * under 200 at the most when measured (PLAN.md, M7), so this is room to spare;
 * but one asked behind a move a hard level is still thinking over waits on that
 * move, and a restart is not held for it. The room then comes back to the stop
 * before, and says so to whoever made the move.
 */
export const KEEP_GRACE_MS = 1000
/**
 * How long a room waits, after something worth writing, before it is written:
 * a card being dragged is many actions a second, and the disk is not. What
 * must be on disk before anybody sees it — a stop an enforced room publishes, a
 * move it is answering — is written at once instead (M7's review).
 */
export const FLUSH_MS = 250

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
}

/**
 * Builds a relay. Everything is a parameter so a test can run one on port 0
 * with a fast ping and a temporary rooms directory; `main` below runs it
 * from the environment. `flushMs` and `keepGraceMs` are the waits above, so a
 * test can hold what the disk says without sitting through either.
 */
export function createRelay({ roomsDir = null, pingMs = 30 * 1000, staticDir = null, idleMs = IDLE_MS, now = Date.now, engineCommand = findEngine(), engineSeed = null, checkIdleMs = CHECK_IDLE_MS, pace = PACE_MS, flushMs = FLUSH_MS, keepGraceMs = KEEP_GRACE_MS } = {}) {
  const rooms = new Map()
  let nextSocketId = 1

  // --- rooms ---------------------------------------------------------------

  const roomFile = (code) => (roomsDir ? join(roomsDir, `${code}.json`) : null)

  /**
   * The engine's text of a game, as the disk keeps it (M7): gzipped, a tenth
   * of its size or less when measured (PLAN.md, M7), and base64 so the record
   * stays one JSON file. Compressed once per text, since a room is written
   * again for things that do not change it — a move in flight, a touch.
   */
  const packed = (room, kept) => {
    if (room.packed?.text !== kept.text) room.packed = { text: kept.text, gzip: gzipSync(kept.text).toString('base64') }
    return { stop: kept.stop, bytes: Buffer.byteLength(kept.text), gzip: room.packed.gzip }
  }
  /**
   * An enforced room's record as it comes off the disk, the game unpacked back
   * into the engine's text for `savedRoomOf` to read. Text that will not
   * unpack is dropped here, and the room says its game could not come back.
   */
  const unpacked = (saved) => {
    const k = saved?.kept
    if (k === undefined || k === null) return saved
    const unreadable = { ...saved, kept: null, unkept: 'what was kept of it could not be read back from the disk.' }
    if (typeof k !== 'object') return unreadable
    let text = typeof k.text === 'string' ? k.text : null
    if (!text && typeof k.gzip === 'string') {
      try { text = gunzipSync(Buffer.from(k.gzip, 'base64')).toString('utf8') } catch { text = null }
    }
    return text ? { ...saved, kept: { text, stop: k.stop } } : unreadable
  }

  /** What goes to disk: the table and who is at it, nothing derived. */
  const record = (room) => {
    if (room.mode === 'enforced') {
      const r = room.engine.record()
      return { version: 1, code: room.code, mode: 'enforced', touchedAt: room.touchedAt, room: r.kept ? { ...r, kept: packed(room, r.kept) } : r }
    }
    return {
      version: 1,
      code: room.code,
      seq: room.table.seq,
      snapshot: room.table.table().snapshot,
      seats: room.table.seats.map(({ seat, name }) => ({ seat, name })),
      touchedAt: room.touchedAt,
    }
  }

  // Set once a relay going down has written its rooms for the last time. A room
  // answering late — an engine's reply landing as it is closed — must not write
  // over that last record, which the relay after this one may already be reading.
  let down = false
  /**
   * A room written whole, beside its file and then over it, so the file on disk
   * is always a whole record: the last one, or the one before. Written in place,
   * a full disk freed the old record's blocks as it opened the file and then
   * failed partway through the new one, and the room came back as nothing at all
   * (found in M7's review, where an enforced room's record grew to tens of
   * kilobytes, written after every stop). A write that fails leaves the last
   * record standing, and a half-written one beside it is ignored and cleared up
   * when the rooms are next read (`loadRooms`).
   */
  const flush = (room) => {
    const file = roomFile(room.code)
    if (!file || down) return
    clearTimeout(room.flushTimer)
    room.flushTimer = null
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(record(room)))
      renameSync(`${file}.tmp`, file)
    } catch { /* the last record stands: a full disk loses a save, not the game */ }
  }

  // Written a moment after things settle rather than on every action: a
  // card being dragged is many actions a second and the disk is not.
  const save = (room) => {
    if (!roomFile(room.code) || room.flushTimer || down) return
    room.flushTimer = setTimeout(() => flush(room), flushMs)
  }
  /**
   * Somebody did something in this room: it is a week from being dropped
   * again, and written. Only people's doings count. A room writing itself for
   * its own reasons — a game taken back at start-up, a snapshot kept — is `save`,
   * which leaves the clock alone: counted as a touch, every restart made every
   * room the engine holds look freshly played, and none was ever dropped
   * (found in M7's review).
   */
  const touch = (room) => {
    room.touchedAt = now()
    save(room)
  }

  const wire = (room) => {
    room.table = host({
      run: room.run,
      seat: null,
      seq: room.seq,
      seats: room.seats,
      send: (message, to) => {
        if (to) {
          const socket = room.sockets.get(to)
          if (message.t === KIND.welcome && message.seat) socket && (socket.seat = message.seat)
          deliver(socket, message)
        } else {
          for (const socket of room.sockets.values()) deliver(socket, message)
        }
        if (message.t === KIND.action || message.t === KIND.seat) touch(room)
      },
    })
    delete room.run
    delete room.seq
    delete room.seats
    return room
  }

  /**
   * A room's pace: how long one of the engine's plays stands before the room
   * asks for the next (`relay-engine.mjs`). The relay's own is the default;
   * a room may be opened with its own, which is where a playback-speed preset
   * will land. `false` or 0 turns the pacing off, and the engine's turn then
   * arrives in one jump, as it did before there was a pace at all.
   */
  const paceFor = (asked) => {
    if (asked === undefined || asked === null || asked === true) return pace
    if (asked === false) return 0
    const ms = Number(asked)
    return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_PACE_MS) : pace
  }

  /**
   * The other authority. An enforced room is held by an engine process of its
   * own rather than by the board model here. Since M7 it is written to disk
   * like any other — its settings, and once dealt the engine's own text of the
   * game at the last stop — whenever the room says something worth keeping
   * changed (`onChange`), through the same debounced write, or at once where it
   * says so (`now`: a stop it is about to publish, a move it is about to have
   * answered); and it comes back with the relay (`loadRooms`). None of that is
   * somebody touching the room, and none of it moves its clock (`touch`).
   */
  const enforcedRoom = ({ code, touchedAt, seats, ai, level, paceMs, saved = null }) => {
    const room = { code, mode: 'enforced', sockets: new Map(), touchedAt, flushTimer: null }
    room.engine = createEngineRoom({
      // The level is read by the room, which takes only a word it knows.
      code, seats, ai: ai || null, level, engineCommand, seed: engineSeed, paceMs,
      deliver, onStderr: (line) => console.error(`[${code}] ${line}`),
      saved, onChange: (how) => (how?.now ? flush(room) : save(room)),
    })
    return room
  }

  const makeRoom = ({ seats = MIN_SEATS, enforced = false, ai = 'heuristic', pace: asked, level = null } = {}) => {
    const n = Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.floor(Number(seats)) || MIN_SEATS))
    let code = makeCode()
    while (rooms.has(code)) code = makeCode()
    if (enforced) {
      if (!engineCommand) throw Object.assign(new Error('This relay has no engine.'), { status: 503 })
      const room = enforcedRoom({ code, touchedAt: now(), seats: n, ai, level, paceMs: paceFor(asked) })
      rooms.set(code, room)
      // Written at once, so a room shared by its code and not yet sat at still
      // has that code after a restart.
      touch(room)
      return room
    }
    const players = Array.from({ length: n }, (_, i) => `p${i + 1}`)
    const room = wire({
      code, sockets: new Map(), touchedAt: now(), flushTimer: null,
      run: newRun(createBoard({ players, seed: randomInt(1e9), active: 'p1' })), seq: 0, seats: null,
    })
    rooms.set(code, room)
    touch(room)
    return room
  }

  /**
   * Rooms back from disk. A file this build cannot make sense of is left
   * where it is and skipped, never deleted: the next build may read it.
   * Rooms nobody has touched for a week are dropped.
   *
   * A room the engine holds comes back with an engine started for it at once
   * (M7), which takes its game back while the people at it are still finding
   * their way back; what cannot come back is said to them when they sit. A
   * relay with no engine leaves such a file where it is, for one that has.
   *
   * A record half written beside its room's (`flush`) is what a relay that died
   * mid-write left: the room's own file is the last whole one, and this is
   * cleared away rather than read.
   */
  const loadRooms = () => {
    if (!roomsDir) return
    mkdirSync(roomsDir, { recursive: true })
    for (const name of readdirSync(roomsDir)) {
      if (name.endsWith('.json.tmp')) { try { unlinkSync(join(roomsDir, name)) } catch { /* not a file of ours to clear */ } continue }
      if (!name.endsWith('.json')) continue
      try {
        const saved = JSON.parse(readFileSync(join(roomsDir, name), 'utf8'))
        if (saved.version !== 1 || typeof saved.code !== 'string' || !/^[A-Z0-9]{5}$/.test(saved.code)) continue
        if (now() - (saved.touchedAt ?? 0) > idleMs) { unlinkSync(join(roomsDir, name)); continue }
        if (saved.mode === 'enforced') {
          if (!engineCommand) continue
          const r = saved.room && typeof saved.room === 'object' ? saved.room : {}
          const seats = Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.floor(Number(r.seats)) || MIN_SEATS))
          const ai = r.ai === 'heuristic' || r.ai === 'random' ? r.ai : r.ai === null ? null : 'heuristic'
          const room = enforcedRoom({
            code: saved.code, touchedAt: Number.isFinite(saved.touchedAt) ? saved.touchedAt : now(),
            seats, ai, level: r.level ?? null, paceMs: paceFor(r.pace), saved: unpacked(r),
          })
          rooms.set(saved.code, room)
          room.engine.comeBack()
          continue
        }
        const run = restore(saved.snapshot)
        if (!run) continue
        rooms.set(saved.code, wire({
          code: saved.code, sockets: new Map(), touchedAt: saved.touchedAt ?? now(), flushTimer: null,
          run, seq: saved.seq ?? 0, seats: saved.seats ?? [],
        }))
      } catch { /* unreadable: skipped, kept */ }
    }
  }

  const sweep = () => {
    for (const [code, room] of rooms) {
      if (room.sockets.size || now() - room.touchedAt <= idleMs) continue
      rooms.delete(code)
      clearTimeout(room.flushTimer)
      if (room.mode === 'enforced') room.engine.close()
      const file = roomFile(code)
      if (file) try { unlinkSync(file) } catch { /* already gone */ }
    }
  }

  // --- sockets -------------------------------------------------------------

  const deliver = (socket, message) => {
    if (!socket || socket.readyState !== socket.OPEN) return
    try { socket.send(JSON.stringify(message)) } catch { /* closing under us */ }
  }

  const leave = (room, socket) => {
    room.sockets.delete(socket.id)
    if (room.mode === 'enforced') { room.engine.leave(socket); socket.seat = null; return }
    if (socket.seat) room.table.receive({ t: KIND.bye, protocol: PROTOCOL, seat: socket.seat })
    socket.seat = null
  }

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (socket, room) => {
    socket.id = `s${nextSocketId++}`
    socket.seat = null
    socket.isAlive = true
    room.sockets.set(socket.id, socket)
    socket.on('pong', () => { socket.isAlive = true })
    if (room.mode === 'enforced') room.engine.join(socket)
    socket.on('message', (data) => {
      let message
      try { message = JSON.parse(String(data)) } catch { return }
      if (!message || typeof message !== 'object') return
      // Somebody at an enforced table: its clock starts again, and is written.
      if (room.mode === 'enforced') { touch(room); room.engine.receive(message, socket); return }
      /*
       * Somebody coming back for their seat before the server noticed they
       * had gone: the old socket is dead weight and the seat is theirs.
       */
      if (message.t === KIND.hello && message.seat) {
        for (const other of room.sockets.values()) {
          if (other !== socket && other.seat === message.seat) { leave(room, other); other.terminate() }
        }
      }
      room.table.receive(message, socket.id)
    })
    socket.on('close', () => leave(room, socket))
    socket.on('error', () => { /* close follows */ })
  })

  // Thirty seconds against a sixty-second proxy: a socket that has not
  // answered by the next round is gone, and saying so is what lets the
  // client's reconnect fire instead of waiting on a connection that will
  // never speak again.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue }
      socket.isAlive = false
      socket.ping()
    }
  }, pingMs)
  heartbeat.unref?.()
  const sweeper = setInterval(sweep, Math.min(idleMs, 60 * 60 * 1000))
  sweeper.unref?.()

  // --- http ----------------------------------------------------------------

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers })
    res.end(JSON.stringify(body))
  }

  // A body past its limit stops being kept but is still read to the end, so
  // the caller hears a 413 rather than a connection torn down under it. Far
  // past the limit the connection is dropped after all. `value` is null for
  // text that is not JSON, and an empty object for no body. The bytes are
  // decoded once, at the end: a chunk can end halfway through a character,
  // and "Æther Vial" decoded a chunk at a time comes out as a different name.
  const readBody = (req, { limit = 4096 } = {}) => new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
      else if (size > limit * 16) { req.destroy(); resolve({ tooLarge: true }) }
    })
    req.on('end', () => {
      if (size > limit) { resolve({ tooLarge: true }); return }
      const text = Buffer.concat(chunks).toString('utf8')
      try { resolve({ value: text ? JSON.parse(text) : {} }) } catch { resolve({ value: null }) }
    })
    req.on('error', () => resolve({ value: null }))
  })

  // --- checking a deck --------------------------------------------------------

  // The lobby asks whether the engine knows a deck before any room exists, so
  // checking has an engine process of its own: started by the first check,
  // shared by every check after it, and let go after a quiet spell. Its first
  // answer is hello with the long allowance, as a room's engine is asked, so
  // the corpus loading is waited for once; every check keeps the usual wait.
  let checker = null
  let checkersStarted = 0
  let checksInFlight = 0
  let checkerIdle = null
  const checkerFor = () => {
    if (checker && !checker.engine.exited) return checker
    const engine = startEngine({ command: engineCommand, onStderr: (line) => console.error(`[check] ${line}`) })
    checkersStarted++
    checker = { engine, ready: engine.call('hello', {}, { timeoutMs: STARTUP_MS }) }
    return checker
  }
  const letCheckerGo = () => {
    const gone = checker
    checker = null
    return gone?.engine.close()
  }
  // The hello comes back with the answer: its set list is what the lobby
  // gives its reasons from.
  const check = async (body) => {
    const held = checkerFor()
    checksInFlight++
    clearTimeout(checkerIdle)
    try {
      const hello = await held.ready
      return { hello, reply: await held.engine.call('check', body) }
    } catch (e) {
      // A refusal is an answer. Anything else means this process is no use,
      // and the next check starts another rather than asking a dead one.
      if (!e.refused && checker === held) letCheckerGo()
      throw e
    } finally {
      if (--checksInFlight === 0) {
        checkerIdle = setTimeout(letCheckerGo, checkIdleMs)
        checkerIdle.unref?.()
      }
    }
  }

  const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
  const answerCheck = async (req, res) => {
    if (!engineCommand) { json(res, 503, { error: 'This relay has no engine.' }); return }
    const read = await readBody(req, { limit: 64 * 1024 })
    if (read.tooLarge) { json(res, 413, { error: 'That deck is too large to check.' }, { connection: 'close' }); return }
    const deck = plainObject(read.value?.deck)
    if (!deck) { json(res, 400, { error: 'A deck to check is required.' }); return }
    const sideboard = plainObject(read.value?.sideboard)
    let reply
    let hello
    try {
      ({ reply, hello } = await check(sideboard ? { deck, sideboard } : { deck }))
    } catch (e) {
      if (e.refused && /Unknown op/.test(e.message)) {
        json(res, 501, { error: 'The engine on this relay is too old to check a deck; rebuild it.' })
      } else if (e.refused) {
        json(res, 400, { error: e.message })
      } else {
        // The engine's reason alone: the lobby puts its own words in front.
        json(res, 502, { error: e.message || 'The engine gave no reason.' })
      }
      return
    }
    // Read forgivingly: the engine is another program, and the lobby should
    // never meet a shape it has to guard against.
    const count = (n) => (Number.isFinite(n) ? n : 0)
    const names = (a) => (Array.isArray(a) ? a.filter((n) => typeof n === 'string') : [])
    const answer = { known: count(reply?.known), total: count(reply?.total), unknown: names(reply?.unknown), unknownSideboard: names(reply?.unknownSideboard) }
    // The sets the engine says it holds, with their codes as it gives them and
    // whether it marks each incomplete, so the lobby can say why a card is not
    // known from the engine's own word. Its release dates stay here: they are
    // Argentum's, not Scryfall's, and the lobby does not show them. An engine
    // whose hello lists no sets sends none, and the lobby names the cards alone.
    const sets = (Array.isArray(hello?.sets) ? hello.sets : [])
      .filter((s) => typeof s?.code === 'string' && s.code)
      .map((s) => ({ code: s.code, name: typeof s.name === 'string' ? s.name : null, incomplete: s.incomplete === true }))
    json(res, 200, sets.length ? { ...answer, engineSets: sets } : answer)
  }

  const describe = (room) => (room.mode === 'enforced'
    ? { code: room.code, ...room.engine.describe() }
    : { code: room.code, mode: 'table', seq: room.table.seq, players: room.table.run.board.players, seats: room.table.seats })

  /** The built app, when asked to serve it. Anything not a file is the app. */
  const serveStatic = (req, res) => {
    if (!staticDir) { json(res, 404, { error: 'not found' }); return }
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(staticDir, path)
    if (!file.startsWith(normalize(staticDir))) { json(res, 404, { error: 'not found' }); return }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html')
    if (!existsSync(file)) { json(res, 404, { error: 'not found' }); return }
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    // Hashed assets are immutable; the shell is not, so it is always re-checked.
    const cache = /\/assets\//.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'content-type': type, 'cache-control': cache })
    res.end(readFileSync(file))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/rooms') {
      const read = await readBody(req)
      if (read.tooLarge) { json(res, 413, { error: 'That request is too large.' }, { connection: 'close' }); return }
      let room
      try { room = makeRoom(read.value ?? {}) } catch (e) { json(res, e.status ?? 500, { error: e.message }); return }
      json(res, 201, room.mode === 'enforced'
        ? { code: room.code, seats: room.engine.describe().seats.length, mode: 'enforced' }
        : { code: room.code, seats: room.table.run.board.players.length, mode: 'table' })
      return
    }
    const m = url.pathname.match(/^\/rooms\/([A-Z0-9]{5})$/)
    if (req.method === 'GET' && m) {
      const room = rooms.get(m[1])
      if (!room) { json(res, 404, { error: 'That room has gone.' }); return }
      json(res, 200, describe(room))
      return
    }
    if (req.method === 'POST' && url.pathname === '/engine/check') { await answerCheck(req, res); return }
    if (url.pathname === '/health') { json(res, 200, { ok: true, rooms: rooms.size, engine: Boolean(engineCommand) }); return }
    if (req.method === 'GET') { serveStatic(req, res); return }
    json(res, 404, { error: 'not found' })
  })

  server.on('upgrade', (req, socket, head) => {
    const m = new URL(req.url, 'http://x').pathname.match(/^\/rooms\/([A-Z0-9]{5})\/ws$/)
    const room = m ? rooms.get(m[1]) : null
    if (!room) {
      socket.write('HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, room))
  })

  /**
   * Going down on purpose. Every table is written first, no new socket is
   * let in, then every socket is told 1012 — the code that means "back in a
   * moment", which a client treats as a reason to reconnect rather than to
   * give up — and any that has not answered within a second is cut.
   */
  const shutdown = async () => {
    clearInterval(heartbeat)
    clearInterval(sweeper)
    clearTimeout(checkerIdle)
    // Tables first: the program gives shutdown three seconds, and an engine
    // still loading the corpus cannot answer quit in that time. Nothing that
    // matters may wait behind it, so the engines are closed alongside the
    // goodbyes and waited for last.
    for (const room of rooms.values()) flush(room)
    // A room the engine holds may be writing down the stop it has just
    // published (M7): each is given a moment to finish, and written again, and
    // only then is its engine closed. Bounded, so a restart is never held for
    // a move a hard level is still thinking over; that room comes back to the
    // stop before, and tells the person whose move it was.
    const enforced = [...rooms.values()].filter((r) => r.mode === 'enforced')
    const keeping = Promise.race([
      Promise.all(enforced.map((r) => r.engine.settled().then(() => flush(r), () => {}))),
      new Promise((done) => { const t = setTimeout(done, keepGraceMs); t.unref?.() }),
    ])
    const engines = Promise.all([letCheckerGo(), keeping.then(() => {
      down = true
      for (const room of rooms.values()) clearTimeout(room.flushTimer)
      return Promise.all(enforced.map((r) => r.engine.close()))
    })])
    // Nobody new from here on. A client told 1012 comes back a quarter of a
    // second later, while this relay may still be waiting on a slow goodbye;
    // one that found it listening would be seated at a table already written
    // to disk, then dropped with no 1012 when the process ends. With the
    // listener shut it is refused, and tries again until the relay that
    // replaces this one answers. The sockets already open are kept for their
    // goodbyes.
    const stopped = new Promise((resolve) => server.close(() => resolve()))
    // The close frame has to reach the client before the connection under
    // it is torn down, or the client sees a dropped socket rather than a
    // 1012 and waits the long way. So: say goodbye, wait briefly for the
    // handshakes, then pull the plug on whatever is left.
    const goodbyes = [...wss.clients].map((socket) => new Promise((done) => {
      socket.once('close', done)
      socket.close(SERVICE_RESTART, 'Service Restart')
    }))
    await Promise.race([Promise.all(goodbyes), new Promise((done) => setTimeout(done, 1000))])
    // The plug is pulled here: ws closes no client when its server closes,
    // and closeAllConnections does not reach a socket that has been
    // upgraded, so without this a socket that never answers holds the server
    // open for ws's own thirty-second close timeout. A terminated socket
    // closes at once, and is waited for so that nothing is left open when
    // this returns.
    for (const socket of wss.clients) socket.terminate()
    await Promise.all(goodbyes)
    wss.close()
    server.closeAllConnections?.()
    await stopped
    await engines
  }

  loadRooms()

  return {
    server, rooms, wss, makeRoom, flush: () => { for (const room of rooms.values()) flush(room) }, shutdown, sweep,
    /** The engine process kept for checking decks, or null when none is up. */
    get checker() { return checker?.engine ?? null },
    get checkersStarted() { return checkersStarted },
  }
}

// --- as a program ----------------------------------------------------------

const asProgram = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (asProgram) {
  const relay = createRelay({
    roomsDir: process.env.ROOMS_DIR || '/tmp/rooms',
    staticDir: process.env.STATIC_DIR || null,
    pingMs: Number(process.env.PING_MS) || 30 * 1000,
  })
  const port = Number(process.env.PORT) || 8788
  relay.server.listen(port, () => {
    console.log(`relay on :${port}, ${relay.rooms.size} room(s) back from disk`)
  })
  const stop = (signal) => {
    console.log(`${signal}: closing ${relay.wss.clients.size} socket(s) with 1012`)
    relay.shutdown().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}
