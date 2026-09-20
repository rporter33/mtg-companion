import { useCallback, useEffect, useRef, useState } from 'react'
import { imageUrl } from '../../components/CardImage.jsx'

/**
 * Reading a card without picking it up.
 *
 * Moxgate's "hold Z to zoom the card you are hovering" is the affordance
 * that makes a one-tap table safe: the preview that used to be the first of
 * two taps moves to something that costs nothing. Rest the pointer on a card
 * for a moment and its printed face appears, large, beside it; press Z and
 * it appears at once; move away and it goes. It never sits under the
 * pointer, so it never covers the thing you were about to do.
 *
 * The preview is decoration for a sighted pointer user and is hidden from
 * everyone else. The same card is one press from "Read it" in the actions
 * panel, which is where a screen reader or a keyboard goes.
 */
const REST_MS = 380

export function usePeek({ enabled = true } = {}) {
  const [peek, setPeek] = useState(null)
  const hovering = useRef(null)
  const timer = useRef(null)
  const zHeld = useRef(false)
  // After a press the pointer is resting where the next card slides in, and
  // a preview of that card would be answering a question nobody asked. So a
  // press quietens the preview until the pointer actually moves.
  const quiet = useRef(false)

  const show = useCallback(() => {
    if (!hovering.current || quiet.current) return
    setPeek({ ...hovering.current })
  }, [])

  const arm = useCallback(() => {
    clearTimeout(timer.current)
    if (!hovering.current) return
    if (zHeld.current) show()
    else timer.current = setTimeout(show, REST_MS)
  }, [show])

  const enter = useCallback((card, at) => {
    if (!enabled || !card) return
    hovering.current = { card, at }
    arm()
  }, [enabled, arm])

  const leave = useCallback(() => {
    hovering.current = null
    clearTimeout(timer.current)
    setPeek(null)
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const down = (e) => {
      if (e.key !== 'z' && e.key !== 'Z') return
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return
      zHeld.current = true
      show()
    }
    const up = (e) => { if (e.key === 'z' || e.key === 'Z') zHeld.current = false }
    const press = () => { quiet.current = true; clearTimeout(timer.current); setPeek(null) }
    const move = (e) => {
      if (!quiet.current || e.pointerType !== 'mouse') return
      quiet.current = false
      arm()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointermove', move, true)
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up)
      window.removeEventListener('pointerdown', press, true); window.removeEventListener('pointermove', move, true)
    }
  }, [enabled, show, arm])

  return { peek, enter, leave }
}

/** The preview itself: the printed face, beside the pointer, inside the viewport. */
export default function Peek({ peek }) {
  if (!peek?.card) return null
  const src = imageUrl(peek.card, 'normal') ?? imageUrl(peek.card, 'large')
  if (!src) return null
  const w = 280
  const h = Math.round(w * 88 / 63)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  // Above the card when it sits low on the screen — a card in hand, whose
  // neighbours the preview would otherwise cover — else to its right if
  // there is room, else to its left; and never off any edge.
  const above = peek.at.top - h - 12 >= 8 && peek.at.top > vh * 0.55
  const left = above
    ? Math.max(8, Math.min(vw - w - 8, peek.at.left + peek.at.width / 2 - w / 2))
    : peek.at.right + 16 + w <= vw ? peek.at.right + 16 : Math.max(8, peek.at.left - 16 - w)
  const top = above
    ? peek.at.top - h - 12
    : Math.max(8, Math.min(vh - h - 8, peek.at.top + peek.at.height / 2 - h / 2))
  return (
    <div className="facepeek" style={{ left, top, width: w, height: h }} aria-hidden="true">
      <img className="facepeek__face" src={src} alt="" draggable="false" />
    </div>
  )
}
