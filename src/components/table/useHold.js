import { useCallback, useEffect, useRef } from 'react'
import { HOLD_MS, THRESHOLD } from './useDrag.js'

/**
 * A finger or a stylus resting on a control, for a control that is not a card.
 *
 * A card has `useDrag`'s hold, which also carries it. A control that is only
 * pressed — the command zone's tile, which casts the commander at a tap (M6) —
 * needs the hold alone: the touch equivalent of a right-click, which a phone
 * does not have, and which iOS Safari does not raise from a long press at all
 * (found in M6's review, where the zone could not be opened on an iPhone while
 * its commander could be cast). The same wait and the same travel as a card's.
 *
 * `start(event, key)` goes on the control's pointerdown. A mouse is left to its
 * own right-click. Once the hold has fired, `justHeld()` is true until a moment
 * after the finger lifts, or until the next press on the control, so the click
 * the lift produces, and the contextmenu an Android browser raises from the
 * same long press, are both swallowed rather than casting or closing what the
 * hold opened.
 */
export default function useHold(onHold) {
  const timer = useRef(null)
  const release = useRef(null)
  const detach = useRef(null)
  const held = useRef(false)
  const latest = useRef(onHold)
  latest.current = onHold

  useEffect(() => () => {
    clearTimeout(timer.current)
    clearTimeout(release.current)
    detach.current?.()
  }, [])

  const start = useCallback((event, key) => {
    // A new press is a new gesture: what the last hold swallowed, it does not.
    // A right-click straight after a hold would otherwise be swallowed as the
    // hold's own contextmenu (found by the spec, which is quicker than a hand).
    clearTimeout(release.current)
    held.current = false
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    clearTimeout(timer.current)
    detach.current?.()
    const x = event.clientX
    const y = event.clientY
    const move = (e) => {
      if (Math.abs(e.clientX - x) > THRESHOLD || Math.abs(e.clientY - y) > THRESHOLD) clearTimeout(timer.current)
    }
    // The finger lifting ends the wait; after a hold, it starts the short
    // moment in which the click that follows is still swallowed.
    const up = () => {
      clearTimeout(timer.current)
      detach.current?.()
      if (held.current) {
        clearTimeout(release.current)
        release.current = setTimeout(() => { held.current = false }, 400)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    detach.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      detach.current = null
    }
    timer.current = setTimeout(() => {
      clearTimeout(release.current)
      held.current = true
      latest.current?.(key)
    }, HOLD_MS)
  }, [])

  /** True from a hold firing until just after the finger lifts, so what that lift produces is ignored. */
  const justHeld = useCallback(() => held.current, [])

  return { start, justHeld }
}
