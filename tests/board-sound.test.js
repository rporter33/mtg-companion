import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { play, playFor, resetAudio, BY_EVENT } from '../src/lib/board/sound.js'

/**
 * The sound is synthesised, so what is worth testing is not how it sounds:
 * it is that it never gets in the way. Off means silent, an unknown event
 * means silent, a browser that refuses an AudioContext means silent rather
 * than an exception in the middle of a card moving, and a burst of events
 * makes one sound rather than seven.
 */

const stub = () => {
  const started = []
  const node = () => ({ connect: (next) => next, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0 }, type: '', Q: { value: 0 } })
  return {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) }),
    createBufferSource: () => ({ buffer: null, connect: (n) => n, start: () => started.push('noise') }),
    createBiquadFilter: node,
    createGain: node,
    createOscillator: () => ({ ...node(), start: () => started.push('tone'), stop() {} }),
    started,
  }
}

let context
beforeEach(() => {
  resetAudio()
  context = stub()
  vi.stubGlobal('window', { AudioContext: function AudioContextStub() { return context } })
})
afterEach(() => { resetAudio(); vi.unstubAllGlobals() })

describe('the sound of cards', () => {
  it('makes no sound at all when it is switched off', () => {
    expect(play('tap', false)).toBe(false)
    expect(playFor([{ type: 'drew' }], false)).toBe(false)
    expect(context.started).toEqual([])
  })

  it('plays a card sound for a card event', () => {
    expect(play('tap', true)).toBe(true)
    expect(context.started.length).toBeGreaterThan(0)
  })

  it('says nothing for a kind it has no voice for', () => {
    expect(play('somethingElse', true)).toBe(false)
  })

  it('makes one sound for a burst, not one per event', () => {
    expect(playFor([{ type: 'drew' }, { type: 'drew' }, { type: 'drew' }], true)).toBe(true)
    // A single buffer source, however many cards were drawn.
    expect(context.started).toEqual(['noise'])
  })

  it('stays silent for a burst of events it has no voice for', () => {
    expect(playFor([{ type: 'noted' }, { type: 'tidied' }], true)).toBe(false)
    expect(context.started).toEqual([])
  })

  it('swallows a browser that will not give it an audio context', () => {
    resetAudio()
    vi.stubGlobal('window', {})
    expect(play('tap', true)).toBe(false)
    resetAudio()
    vi.stubGlobal('window', { AudioContext: function Boom() { throw new Error('refused') } })
    expect(play('tap', true)).toBe(false)
  })

  it('has a voice for the events a player would expect to hear', () => {
    for (const type of ['tapped', 'drew', 'shuffled', 'moved', 'rolled', 'life']) {
      expect(BY_EVENT[type], type).toBeTruthy()
    }
  })
})
