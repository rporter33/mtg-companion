/**
 * A finger resting on a control that is not a card (`useHold`): the command
 * zone's tile, which casts the commander at a tap, is opened by a hold instead
 * (HANDOFF.md §3 item 18), since a phone has no right-click and iOS raises no
 * contextmenu from a long press (found in M6's review). Held here with a fake
 * clock, so nothing waits on real time: the wait, a finger that moves or lifts
 * first, a mouse left to its right-click, and what the hold swallows after it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import useHold from '../src/components/table/useHold.js'
import { HOLD_MS } from '../src/components/table/useDrag.js'

let hook = null
let root = null
let container = null
const held = []
function Probe() { hook = useHold((key) => held.push(key)); return null }

/** A pointer event on the window, as a finger's move or lift arrives there. */
const onWindow = (type, init = {}) => {
  const e = new Event(type)
  Object.assign(e, { clientX: 0, clientY: 0, ...init })
  window.dispatchEvent(e)
}
const finger = (extra = {}) => ({ pointerType: 'touch', clientX: 10, clientY: 10, ...extra })

beforeEach(async () => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  held.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<Probe />) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.useRealTimers()
})

describe('a hold on a control', () => {
  it('fires once a finger has rested for the hold\'s time, as a card\'s hold does, and not before', () => {
    hook.start(finger(), 'command')
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(held).toEqual([])
    expect(hook.justHeld()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(held).toEqual(['command'])
    expect(hook.justHeld()).toBe(true)
  })

  it('is a stylus\'s too, and never a mouse\'s, which has its right-click', () => {
    hook.start({ pointerType: 'mouse', clientX: 0, clientY: 0 }, 'command')
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(held).toEqual([])
    hook.start(finger({ pointerType: 'pen' }), 'command')
    vi.advanceTimersByTime(HOLD_MS)
    expect(held).toEqual(['command'])
  })

  it('is no hold where the finger lifts, or moves away, first', () => {
    hook.start(finger(), 'command')
    vi.advanceTimersByTime(HOLD_MS - 50)
    onWindow('pointerup')
    vi.advanceTimersByTime(HOLD_MS)
    hook.start(finger(), 'command')
    onWindow('pointermove', { clientX: 30, clientY: 10 })
    vi.advanceTimersByTime(HOLD_MS)
    expect(held).toEqual([])
    // A tremble within the drag threshold is still a finger at rest.
    hook.start(finger(), 'command')
    onWindow('pointermove', { clientX: 13, clientY: 12 })
    vi.advanceTimersByTime(HOLD_MS)
    expect(held).toEqual(['command'])
  })

  it('swallows what the lift produces for a moment after it, and nothing after that', () => {
    hook.start(finger(), 'command')
    vi.advanceTimersByTime(HOLD_MS)
    // Held for a while before lifting: still swallowing, since the lift has not come.
    vi.advanceTimersByTime(2000)
    expect(hook.justHeld()).toBe(true)
    onWindow('pointerup')
    vi.advanceTimersByTime(399)
    expect(hook.justHeld()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(hook.justHeld()).toBe(false)
  })

  it('stops swallowing at the next press on the control, which is a gesture of its own', () => {
    hook.start(finger(), 'command')
    vi.advanceTimersByTime(HOLD_MS)
    onWindow('pointerup')
    // A right-click straight after: its contextmenu is not the hold's.
    hook.start({ pointerType: 'mouse', clientX: 0, clientY: 0 }, 'command')
    expect(hook.justHeld()).toBe(false)
  })
})
