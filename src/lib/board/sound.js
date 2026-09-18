/**
 * The sound of cards.
 *
 * Synthesised, not sampled: a handful of short noise bursts and clicks cost
 * nothing to ship, work offline, and cannot arrive late. A table with no
 * sound at all feels like a spreadsheet; a table with a full sound pack is
 * 400 KB of audio for a card game that is mostly played in a room where
 * other people are talking. So this is the smallest thing that reads as
 * paper: a tap, a riffle, a knock.
 *
 * Off by default, and every call is wrapped: an AudioContext can be refused,
 * suspended, or unavailable, and none of that should stop a card moving.
 */
let context = null

/**
 * Throws away the audio context. One context per page is right in a browser,
 * which means the cached one outlives any test that stubs the window — so
 * this exists as a seam for the tests, the way storage has useBackend.
 */
export function resetAudio() {
  try { context?.close?.() } catch { /* already gone */ }
  context = null
}

const ready = () => {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext ?? window.webkitAudioContext
  if (!Ctx) return null
  try {
    if (!context) context = new Ctx()
    // Browsers start a context suspended until a gesture; every caller here
    // is inside one, so this resolves on the first click and is a no-op after.
    if (context.state === 'suspended') context.resume?.()
    return context
  } catch { return null }
}

/** A short band-limited noise burst: the sound of card on card. */
function riffle(ctx, { duration = 0.09, gain = 0.05, frequency = 2200, q = 0.7 } = {}) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // Noise under a decaying envelope. Nothing clever: it is a click.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = q
  const volume = ctx.createGain()
  volume.gain.value = gain
  source.connect(filter).connect(volume).connect(ctx.destination)
  source.start()
}

/** A soft tone, for a number rather than a card. */
function tone(ctx, { frequency = 660, duration = 0.12, gain = 0.035 } = {}) {
  const osc = ctx.createOscillator()
  const volume = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = frequency
  volume.gain.setValueAtTime(gain, ctx.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
  osc.connect(volume).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + duration)
}

/** What each kind of thing sounds like. Anything not listed makes no sound. */
const VOICES = {
  tap: (ctx) => riffle(ctx, { duration: 0.05, frequency: 3200, gain: 0.04 }),
  place: (ctx) => riffle(ctx, { duration: 0.08, frequency: 1400, gain: 0.055 }),
  draw: (ctx) => riffle(ctx, { duration: 0.11, frequency: 2600, gain: 0.045, q: 0.5 }),
  shuffle: (ctx) => { riffle(ctx, { duration: 0.22, frequency: 1800, gain: 0.05, q: 0.4 }) },
  die: (ctx) => { riffle(ctx, { duration: 0.06, frequency: 900, gain: 0.06 }); tone(ctx, { frequency: 880, duration: 0.08 }) },
  life: (ctx) => tone(ctx, { frequency: 520, duration: 0.1 }),
}

/**
 * Plays a sound, or does nothing at all. `on` is the player's preference,
 * passed in rather than read here so this file knows nothing about storage.
 */
export function play(kind, on) {
  if (!on) return false
  const voice = VOICES[kind]
  if (!voice) return false
  const ctx = ready()
  if (!ctx) return false
  try { voice(ctx); return true } catch { return false }
}

/** Which event on the board makes which sound. Silence is the default. */
const BY_EVENT = {
  tapped: 'tap', untapped: 'tap', untappedAll: 'tap',
  moved: 'place', attached: 'place', detached: 'place', tokenMade: 'place', tokenGone: 'place',
  drew: 'draw', fromTop: 'draw',
  shuffled: 'shuffle', seated: 'shuffle',
  rolled: 'die',
  life: 'life',
}

/**
 * One sound for a burst of events, so drawing seven cards is a riffle and not
 * seven overlapping riffles. The first event that has a voice wins.
 */
export function playFor(events, on) {
  if (!on || !events?.length) return false
  for (const event of events) {
    const kind = BY_EVENT[event.type]
    if (kind) return play(kind, on)
  }
  return false
}

export { VOICES, BY_EVENT }
