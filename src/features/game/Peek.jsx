import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { imageUrl } from '../../components/CardImage.jsx'
import { placePeek, PEEK_W } from './peekPlace.js'

/**
 * Reading a card without picking it up.
 *
 * Moxgate's "hold Z to zoom the card you are hovering" is the affordance
 * that makes a one-tap table safe: the preview that used to be the first of
 * two taps moves to something that costs nothing. Rest the pointer on a card
 * for a moment and its printed face appears, large, beside it; press Z and
 * it appears at once; move away and it goes. It never sits under the
 * pointer, and it never covers the prompt panel or the rail, where Pass is:
 * those are where the next press goes (peekPlace.js says how).
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

  /**
   * `at` is the element the pointer is resting on, or failing that its
   * rectangle. An element is read again each time the preview is placed, so
   * the card is measured where it is then — lifted out of the fan, which it
   * is not yet at the moment the pointer arrives — and a card that has left
   * the table takes its preview with it.
   */
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

/** Where the card is now: an element read afresh, or the rectangle it was given. */
function rectOf(at) {
  if (at && typeof at.getBoundingClientRect === 'function') return at.isConnected ? at.getBoundingClientRect() : null
  return at ?? null
}

const same = (a, b) => a === b || (a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

/**
 * The preview itself: the printed face, beside the card, inside the viewport,
 * and clear of whatever `avoid` returns — rectangles read at the moment of
 * placing, not remembered, because the prompt comes and goes with every stop.
 * It is placed again after every render of the table, before the browser
 * paints, so a prompt that appears while a card is being read moves the
 * preview off it rather than being covered by it for a frame.
 */
export default function Peek({ peek, avoid }) {
  const [spot, setSpot] = useState(null)
  const src = peek?.card ? imageUrl(peek.card, 'normal') ?? imageUrl(peek.card, 'large') : null
  // A card in hand lifts out of the fan as the pointer arrives, and the
  // preview shown at once for Z is placed while it is still rising; once it
  // has settled it is measured again, so the preview is clear of where the
  // card ended up rather than of where it was on the way.
  const [, settled] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    const el = peek?.at
    if (!el || typeof el.addEventListener !== 'function') return undefined
    el.addEventListener('transitionend', settled)
    return () => el.removeEventListener('transitionend', settled)
  }, [peek?.at])
  useLayoutEffect(() => {
    const at = src ? rectOf(peek.at) : null
    const next = at
      ? placePeek({ at, view: { width: window.innerWidth, height: window.innerHeight }, avoid: avoid?.() ?? [], width: PEEK_W })
      : null
    setSpot((was) => (same(was, next) ? was : next))
  })
  if (!src || !spot) return null
  return (
    <div className="facepeek" style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }} data-side={spot.side} aria-hidden="true">
      <img className="facepeek__face" src={src} alt="" draggable="false" />
    </div>
  )
}
