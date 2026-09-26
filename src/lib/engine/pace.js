/**
 * How a person plays at the engine's table: the pace presets, chosen once as a
 * posture rather than as a settings page (docs/MOXGATE_STUDY.md, "Pace is
 * chosen once, as a posture"; docs/table-rebuild/TARGET.md §5), and the
 * settings each one actually sets. The preset is a bundle; the settings are the
 * truth, and the choice shows them.
 *
 * Only settings this table really has are here, each with where it lands:
 *
 * - Where the game stops for you (`stops`): only where you hold something
 *   affordable to play — Law 1 (FRICTION.md), every other window passed for you
 *   and counted in the log — or at every priority window, both turns. It is the
 *   engine process's `autoPass` on a person's seat, which every engine reads at
 *   the deal, and which one at protocol 11 changes mid-game (Server.kt, `stops`).
 * - How long each of the engine's plays stands (`speed`): the room's pace
 *   (HANDOFF.md, M2), the relay's own wait between one play of the engine's and
 *   the next (scripts/relay-engine.mjs). Brisk is the relay's own pace, 600 ms
 *   unless it was started with another; Relaxed is twice that; Instant waits
 *   not at all, and each play still arrives on its own.
 * - Whether each step says what it is for (`explain`): the app's own words from
 *   docs/TURN_STRUCTURE.md (lib/engine/teach.js), cited by rule number, in the
 *   prompt at a stop, the first three times you stop in each step.
 *
 * And one thing the design source's presets set that this table has not got:
 * paying mana by hand. The engine pays for every spell itself (Argentum's
 * `AutoPay`), and asks which sources pay only where it raises that decision, so
 * no preset here can have you tap your own mana, and the choice says so.
 *
 * The bundles, the doubling and the three times are this app's own, and are
 * said to be; a first game is Controlled, the owner's choice (HANDOFF.md §3
 * item 24).
 *
 * Shared by the relay (scripts/relay-engine.mjs) and the app, so a word means
 * the same at both ends of the wire. Pure, and forgiving: anything here reads
 * what storage or the wire gave it, any build having written it.
 */

export const PRESETS = ['fast', 'controlled', 'learning']

/** The owner's choice for a first game (2026-09-25): Controlled, with the other two a tap away. */
export const DEFAULT_PRESET = 'controlled'

/** Where the game stops for a person: only where they can play (Law 1), or at every priority window. */
export const STOPS = ['playable', 'every']

/** How long each of the engine's plays stands, slowest first. */
export const SPEEDS = ['relaxed', 'brisk', 'instant']

/** What each preset sets. The app's own bundles. */
export const PRESET_SETTINGS = {
  fast: { stops: 'playable', speed: 'brisk', explain: false },
  controlled: { stops: 'every', speed: 'brisk', explain: false },
  learning: { stops: 'every', speed: 'relaxed', explain: true },
}

/** Relaxed, as a multiple of the relay's own pace. The app's own number. */
export const RELAXED_TIMES = 2

/** How many times a step says what it is for, at the first stops in it. The app's own number. */
export const EXPLAIN_TIMES = 3

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

export const presetOf = (v) => (PRESETS.includes(v) ? v : null)
export const stopsOf = (v) => (STOPS.includes(v) ? v : null)
export const speedOf = (v) => (SPEEDS.includes(v) ? v : null)

/** The preset these settings are, or null where they are a mix of the player's own. */
export function presetFor(settings) {
  const s = obj(settings)
  return PRESETS.find((p) => {
    const want = PRESET_SETTINGS[p]
    return want.stops === s.stops && want.speed === s.speed && want.explain === s.explain
  }) ?? null
}

/**
 * The choice kept with the player's table preferences (`tablePace`), read
 * forgivingly: `{ preset, stops, speed, explain, asked }`. A preset this build
 * knows is its bundle, whatever settings were kept beside it, so a bundle that
 * changes in a later build changes for everybody who chose it; with no preset
 * the settings are the player's own mix, each one that cannot be read taken
 * from the default. `asked` is whether the question has been answered, which
 * is what asks it once.
 */
export function chosenPace(value) {
  const v = obj(value)
  const named = presetOf(v.preset)
  const base = PRESET_SETTINGS[named ?? DEFAULT_PRESET]
  const settings = named ? base : {
    stops: stopsOf(v.stops) ?? base.stops,
    speed: speedOf(v.speed) ?? base.speed,
    explain: typeof v.explain === 'boolean' ? v.explain : base.explain,
  }
  return { preset: named ?? presetFor(settings), ...settings, asked: v.asked === true }
}

/**
 * What to keep after a change: a preset chosen, or one setting changed, which
 * leaves the preset where the settings still make it and a mix of the player's
 * own where they do not. Whether the question was answered is kept as it was;
 * `answered` marks it.
 */
export function paceWith(pace, change) {
  const was = chosenPace(pace)
  const c = obj(change)
  const preset = presetOf(c.preset)
  const settings = preset ? PRESET_SETTINGS[preset] : {
    stops: stopsOf(c.stops) ?? was.stops,
    speed: speedOf(c.speed) ?? was.speed,
    explain: typeof c.explain === 'boolean' ? c.explain : was.explain,
  }
  return { preset: preset ?? presetFor(settings), ...settings, asked: was.asked }
}

/** The same choice, with the question marked answered. */
export const answered = (pace) => ({ ...paceWith(pace, {}), asked: true })

/**
 * How long each of the engine's plays stands at a speed, in milliseconds, given
 * the room's own pace (`base`, the relay's) and the longest a pace may be. A
 * room with no pace plays the engine's turn in one go, and no speed changes that.
 */
export function speedMs(speed, base, most = Infinity) {
  if (!(Number.isFinite(base) && base > 0)) return 0
  if (speed === 'instant') return 0
  if (speed === 'relaxed') return Math.min(base * RELAXED_TIMES, most)
  return Math.min(base, most)
}

/**
 * What the room says of how this seat is played (`seated.pace`, from a relay
 * that knows the choice), read forgivingly: where the game stops for this
 * person, the speed, the wait it makes, whether the engine's turn is shown a
 * play at a time at all, and whether where this person stops is fixed until
 * their next table (an engine older than protocol 11, once dealt). Null where
 * the message says nothing readable; a `seated` with no `pace` at all is a
 * relay from before the choice, which the caller tells apart.
 */
export function roomPaceOf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const stops = stopsOf(v.stops)
  if (!stops) return null
  const ms = Number.isFinite(v.ms) && v.ms >= 0 ? v.ms : null
  return { stops, speed: speedOf(v.speed), ms, paced: v.paced === true, fixed: v.fixed === true }
}

export const PRESET_NAMES = { fast: 'Fast', controlled: 'Controlled', learning: 'Learning' }
export const PRESET_TAGLINES = { fast: 'Keep it moving', controlled: 'See every window', learning: 'Explain as you go' }
export const PRESET_CHIPS = { fast: 'Fewer stops', controlled: 'More passing', learning: 'Steps explained' }
/** What each preset does, in the app's own words, each true of what it sets. */
export const PRESET_LINES = {
  fast: 'The game stops only where you hold something you can play. Every other window is passed for you, and the log says how many.',
  controlled: 'The game stops at every priority window, both turns, and waits for your pass.',
  learning: 'Stops at every window, lets each of the engine’s plays stand longer, and says what each step is for the first three times you stop in it.',
}

export const STOPS_NAMES = { playable: 'Only where you can play', every: 'At every window' }
export const SPEED_NAMES = { relaxed: 'Relaxed', brisk: 'Brisk', instant: 'Instant' }
export const EXPLAIN_NAMES = { off: 'Off', on: 'The first three times' }

/** Where the game stops, as the end of a sentence: "stops for you at every priority window". */
export const STOPS_WORDS = {
  playable: 'only where you can play',
  every: 'at every priority window, both turns',
}

/** A wait in words: "1.2 s", "600 ms", "no wait". */
export function waitWords(ms) {
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'no wait'
  return ms >= 1000 ? `${(ms / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} s` : `${ms} ms`
}

/** What a speed does, in words, with the wait it makes at this room where the room has said. */
export function speedLine(speed, ms = null) {
  const at = ms === null ? '' : ` Here: ${waitWords(ms)}.`
  if (speed === 'relaxed') return `Each of the engine’s plays stands twice as long as Brisk.${at}`
  if (speed === 'instant') return `No wait between the engine’s plays; each still arrives on its own.${at}`
  return `The table’s own pace between the engine’s plays.${at}`
}

/**
 * What "every window" cannot mean here, said with the settings: this table gives
 * nobody priority with a spell on the stack. Argentum resolves a spell inside the
 * step that cast it (engine/README.md, "What is deliberately not here"), where
 * the rules have it resolve only once everybody has passed in turn (117.4).
 */
export const STACK_LINE = 'At every window means every window this table gives. It gives nobody one with a spell on the stack: a spell resolves in the step it was cast, where the rules would give each player a chance to respond first (117.4).'

/** What no preset can set here, said with the settings. */
export const PAYING_LINE = 'Paying mana: in every preset the engine pays for your spells itself and chooses which lands tap, and where it asks which sources pay, it asks you. Tapping your own mana is not built at this table.'

/**
 * Where the game stops for a person at an engine older than protocol 11, which
 * cannot change it once dealt (`fixed`), said where it is not what they chose.
 * A relay deals every person at such an engine Law 1 whatever they asked
 * (scripts/relay-engine.mjs): stopped everywhere, that engine put a declaration
 * with nothing to declare to them, with no pass to give it, and stopped them in
 * the untap step, where nobody gets priority (500.3). A room dealt by a relay
 * from before that may still stop them everywhere, fixed, which is said as it is.
 */
export function fixedLine(stops) {
  return stops === 'playable'
    ? 'This table’s engine is older than stopping you at every window, so the game stops for you only where you can play, whatever is chosen.'
    : `This table’s engine cannot change where it stops once the game is dealt, so the game goes on stopping for you ${STOPS_WORDS[stops] ?? STOPS_WORDS.every}, until your next table.`
}

/**
 * Where the game will stop for this person, as the end of the lobby's line about
 * rules-enforced play, from what they kept (`chosenPace`): the preset kept named,
 * whether or not the question was answered — a radio changed and left keeps its
 * preset — and Controlled said to be in force until they choose only where it is
 * Controlled that is kept, or nothing is.
 */
export function lobbyStopsLine(pace) {
  const p = chosenPace(pace)
  if (p.stops !== 'every') return 'the engine never stops you where you have nothing to do.'
  const where = 'the game stops for you at every priority window'
  if (p.asked) return `${where}, as you chose.`
  if (p.preset === DEFAULT_PRESET) return `${where}, as ${PRESET_NAMES[p.preset]} does until you choose at the table.`
  return p.preset ? `${where}, as ${PRESET_NAMES[p.preset]} does, picked at the table.` : `${where}, as your own mix at the table does.`
}

/**
 * The log's line when the deal or a change says where the game now stops for
 * this person, in the room's words; null where there is nothing to say.
 *
 * `room` is the room's report (`roomPaceOf`), or `undefined` from a relay older
 * than the choice, which stops only where there is something to play — as every
 * relay did before — and paces at its own speed, whatever was chosen. `wanted`
 * is what this person chose. `changed` says the line is for a change mid-game,
 * which takes effect from the next window.
 */
export function stopsLine(room, wanted, { changed = false } = {}) {
  const want = obj(wanted)
  if (room === undefined) {
    const differs = want.stops === 'every' || (want.speed && want.speed !== 'brisk')
    return differs ? 'This relay is older than choosing how you play: the game stops only where you can play, and the engine’s turn goes at the relay’s own pace, whatever is chosen.' : null
  }
  if (!room) return null
  if (room.fixed && want.stops && want.stops !== room.stops) return fixedLine(room.stops)
  const where = STOPS_WORDS[room.stops]
  if (changed) return `From the next window, the game stops for you ${where}.`
  return room.stops === 'every'
    ? `The game stops for you ${where}: pass with Pass or Space.`
    : `The game stops for you ${where}; the engine passes every other window for you, and says how many.`
}
