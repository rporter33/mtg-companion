import { useCallback, useEffect, useRef, useState } from 'react'
import { pointToField } from '../../lib/board/geometry.js'

/**
 * Dragging a card with a pointer.
 *
 * Not HTML5 drag-and-drop: that API has no touch support worth the name, it
 * cannot be styled, and it fires a drag image the browser owns. Pointer
 * events are one code path for a mouse, a finger and a stylus, which is the
 * whole point when the same table has to work on a phone at a kitchen table
 * and on a desktop.
 *
 * A press that does not move is not a drag. It falls through to the card's
 * own click, so every card stays a real button: keyboard and screen reader
 * users get the same actions without a pointer ever being involved.
 */
const THRESHOLD = 6 // pixels of travel before a press counts as a drag

export default function useDrag({ fieldRef, onSlide, onPlay }) {
  const [drag, setDrag] = useState(null)
  const session = useRef(null)
  const detach = useRef(null)
  // A drag that ends over a card must not also click it.
  const swallow = useRef(false)

  useEffect(() => () => detach.current?.(), [])

  const begin = useCallback((event, { id, from }) => {
    if (event.button != null && event.button !== 0) return
    if (session.current) return
    // The field's box comes along for the ride so the lane under the card can
    // light up without measuring the layout on every pointer move.
    const rect = fieldRef.current?.getBoundingClientRect() ?? null
    const started = { id, from, rect, originX: event.clientX, originY: event.clientY, moved: false, x: event.clientX, y: event.clientY }
    session.current = started
    setDrag(started)

    const move = (e) => {
      const s = session.current
      if (!s) return
      if (Math.abs(e.clientX - s.originX) > THRESHOLD || Math.abs(e.clientY - s.originY) > THRESHOLD) s.moved = true
      s.x = e.clientX
      s.y = e.clientY
      setDrag({ ...s })
    }
    const finish = (e) => {
      detach.current?.()
      const s = session.current
      session.current = null
      setDrag(null)
      if (!s || !s.moved) return
      // A moved drag has done its job; the click it would produce is not wanted.
      swallow.current = true
      setTimeout(() => { swallow.current = false }, 0)
      const rect = fieldRef.current?.getBoundingClientRect()
      const inside = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      if (!inside) return
      const point = pointToField({ x: e.clientX, y: e.clientY }, rect)
      if (s.from === 'battlefield') onSlide?.(s.id, point)
      else onPlay?.(s.id, point)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    detach.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      detach.current = null
    }
  }, [fieldRef, onSlide, onPlay])

  /** True for the instant after a drag, so the click it produces is ignored. */
  const justDragged = useCallback(() => swallow.current, [])

  return { drag, begin, justDragged }
}
