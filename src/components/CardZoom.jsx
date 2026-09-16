import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CardFace from './CardFace.jsx'
import { imageUrl, hasBackFace } from './CardImage.jsx'
import {
  clampOffset, clampScale, distance, midpoint, sourceForScale,
  stepZoom, toggleZoom, zoomAbout, MIN_SCALE, MAX_SCALE,
} from '../lib/zoom.js'
import './card-zoom.css'

/**
 * Full-screen card viewer with pinch, wheel, double-tap and drag.
 *
 * Two things worth knowing about the design:
 *
 * Zoom upgrades the image rather than magnifying it. We browse with Scryfall's
 * `normal` (488px); past about 1.4x that is just bigger pixels, so the source is
 * swapped for `large` and then `png` as you go in.
 *
 * When there is no image — offline, or a card we only have data for — this falls
 * back to the CSS-rendered CardFace, which is live text and therefore stays
 * perfectly crisp at 4x. The fallback is the better zoom.
 */
export default function CardZoom({ card, open, onClose, initialFace = 0 }) {
  const [scale, setScale] = useState(MIN_SCALE)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [face, setFace] = useState(initialFace)
  const [imageFailed, setImageFailed] = useState(false)

  const frameRef = useRef(null)
  const contentRef = useRef(null)
  // Pointer handlers and the key handler read the live scale and offset from
  // inside state updaters and long-lived listeners, so both need refs.
  const scaleRef = useRef(MIN_SCALE)
  const offsetRef = useRef({ x: 0, y: 0 })
  const pointers = useRef(new Map())
  const backdropRef = useRef(false)
  const pinchRef = useRef(null)
  const dragRef = useRef(null)
  const lastTapRef = useRef(0)
  const restoreTo = useRef(null)

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { offsetRef.current = offset }, [offset])

  const reset = useCallback(() => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
  }, [])

  // The viewer is reused for every card, so state from the last one must not
  // leak into the next.
  useEffect(() => {
    reset()
    setFace(initialFace)
    setImageFailed(false)
  }, [card?.id, initialFace, reset])

  const frame = () => {
    const rect = frameRef.current?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 }
  }

  /**
   * The card's unscaled size. Pan limits are bounded by the card rather than the
   * viewport, so a card that still fits on screen cannot be dragged out of view.
   * The live rect is already scaled, so divide it back out.
   */
  const content = () => {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return frame()
    const s = scaleRef.current || 1
    return { width: rect.width / s, height: rect.height / s }
  }

  /** Pointer position relative to the frame's centre, which is what the maths wants. */
  const toLocal = (clientX, clientY) => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) }
  }

  const applyZoom = useCallback((nextScale, at) => {
    setScale((current) => {
      const result = zoomAbout(at, current, nextScale, offsetRef.current, content(), frame())
      setOffset(result.offset)
      return result.scale
    })
  }, [])

  // --- keyboard ----------------------------------------------------------
  useEffect(() => {
    if (!open) return undefined
    restoreTo.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event) => {
      const centre = { x: 0, y: 0 }
      switch (event.key) {
        case 'Escape':
          event.stopPropagation()
          onClose()
          break
        case '+': case '=':
          event.preventDefault()
          applyZoom(stepZoom(scaleRef.current, +1), centre)
          break
        case '-': case '_':
          event.preventDefault()
          applyZoom(stepZoom(scaleRef.current, -1), centre)
          break
        case '0':
          event.preventDefault()
          reset()
          break
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          if (scaleRef.current <= MIN_SCALE) return
          event.preventDefault()
          const step = event.shiftKey ? 80 : 30
          const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0
          const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0
          setOffset((current) => clampOffset(
            { x: current.x + dx, y: current.y + dy }, content(), frame(), scaleRef.current))
          break
        }
        default:
          break
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    frameRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus()
    }
  }, [open, onClose, applyZoom, reset])

  // --- pointers ----------------------------------------------------------
  const onPointerDown = (event) => {
    // Remember whether this gesture began on the card or on the empty space
    // around it. Tapping the backdrop closes, tapping the card does not — the
    // usual lightbox contract, and it keeps double-tap-to-zoom on the card
    // where it belongs.
    backdropRef.current = !contentRef.current?.contains(event.target)

    // Track the pointer BEFORE attempting capture. setPointerCapture throws
    // NotFoundError for a pointer the element does not recognise, and if that
    // escapes here the pointer is never tracked and the gesture silently dies.
    // Capture is an optimisation — it keeps a drag alive past the element's
    // edge — so losing it is survivable; losing the pointer is not.
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try {
      frameRef.current?.setPointerCapture?.(event.pointerId)
    } catch {
      /* capture unavailable; dragging still works within the frame */
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchRef.current = { startDistance: distance(a, b), startScale: scaleRef.current }
      dragRef.current = null
      return
    }

    if (pointers.current.size === 1) {
      dragRef.current = {
        startX: event.clientX, startY: event.clientY,
        originX: offsetRef.current.x, originY: offsetRef.current.y,
      }
    }
  }

  const onPointerMove = (event) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()]
      const spread = distance(a, b)
      if (pinchRef.current.startDistance > 0) {
        const next = pinchRef.current.startScale * (spread / pinchRef.current.startDistance)
        const focus = midpoint(a, b)
        applyZoom(next, toLocal(focus.x, focus.y))
      }
      return
    }

    if (dragRef.current && scaleRef.current > MIN_SCALE) {
      const next = {
        x: dragRef.current.originX + (event.clientX - dragRef.current.startX),
        y: dragRef.current.originY + (event.clientY - dragRef.current.startY),
      }
      setOffset(clampOffset(next, content(), frame(), scaleRef.current))
    }
  }

  const onPointerUp = (event) => {
    try {
      frameRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      /* never captured, or already released */
    }
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    if (pointers.current.size === 0) {
      const moved = dragRef.current
        && (Math.abs(event.clientX - dragRef.current.startX) > 6
          || Math.abs(event.clientY - dragRef.current.startY) > 6)
      dragRef.current = null

      if (!moved) {
        // A clean tap on the empty space around the card dismisses the viewer.
        // Guarded on `moved` so releasing a pan outside the card never closes.
        if (backdropRef.current) {
          onClose()
          return
        }
        // Double tap on the card toggles zoom. Only treated as a tap if the
        // pointer barely moved, so the end of a pan never zooms unexpectedly.
        const now = Date.now()
        if (now - lastTapRef.current < 300) {
          const result = toggleZoom(
            scaleRef.current, toLocal(event.clientX, event.clientY), content(), frame())
          setScale(result.scale)
          setOffset(result.offset)
          lastTapRef.current = 0
        } else {
          lastTapRef.current = now
        }
      }
    }
  }

  const onWheel = (event) => {
    // Only the viewer scrolls here, and it has nothing to scroll, so taking the
    // wheel is safe and is what people expect of a zoomable image.
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0015)
    applyZoom(clampScale(scaleRef.current * factor), toLocal(event.clientX, event.clientY))
  }

  const source = useMemo(() => sourceForScale(scale), [scale])
  const url = imageFailed ? null : imageUrl(card, source, face)
  const canFlip = hasBackFace(card)

  if (!open || !card) return null

  return (
    <div className="zoom" role="dialog" aria-modal="true" aria-label={`${card.name}, zoomable`}>
      <div className="zoom__bar">
        <span className="zoom__name">{card.name}</span>
        <span className="spacer" />
        <span className="zoom__level mono" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button className="btn btn--sm btn--ghost" onClick={() => applyZoom(stepZoom(scale, -1), { x: 0, y: 0 })}
          disabled={scale <= MIN_SCALE} aria-label="Zoom out">−</button>
        <button className="btn btn--sm btn--ghost" onClick={() => applyZoom(stepZoom(scale, +1), { x: 0, y: 0 })}
          disabled={scale >= MAX_SCALE} aria-label="Zoom in">+</button>
        {canFlip && (
          <button className="btn btn--sm btn--ghost" onClick={() => { setFace(face === 0 ? 1 : 0); reset() }}>
            Flip
          </button>
        )}
        <button className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div
        className="zoom__frame"
        ref={frameRef}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: scale > MIN_SCALE ? 'grab' : 'zoom-in' }}
        aria-label="Card viewer. Tap outside the card to close." 
      >
        <div
          ref={contentRef}
          className="zoom__content"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          {url ? (
            <img
              src={url}
              alt={card.name}
              draggable={false}
              onError={() => setImageFailed(true)}
            />
          ) : (
            // Live text, so this stays crisp at any magnification.
            <div className="zoom__face"><CardFace card={card} size="lg" showFlavor /></div>
          )}
        </div>
      </div>

      <div className="zoom__hint faint tiny">
        Pinch, scroll or double-tap to zoom · drag to move · tap outside to close
        <br />
        <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> <kbd>Esc</kbd>
      </div>
    </div>
  )
}
