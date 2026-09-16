// Zoom and pan maths, kept free of React and the DOM so it can be tested.
//
// The whole job is: given a scale and an offset, keep the content from being
// dragged somewhere useless. Clamping is the part that is easy to get subtly
// wrong and impossible to eyeball, which is why it lives here with tests
// rather than inline in a pointer handler.

export const MIN_SCALE = 1
export const MAX_SCALE = 4

export function clampScale(scale) {
  // NaN means "we do not know" — fail safe to fit. Infinity means "too big",
  // which is a different thing and clamps to the maximum like any other
  // oversized number. A degenerate pinch (two pointers in the same spot) can
  // produce either.
  if (Number.isNaN(scale) || scale === undefined || scale === null) return MIN_SCALE
  if (typeof scale !== 'number') return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

// Math.min/max happily return -0, which is not Object.is-equal to 0. That makes
// an unchanged offset look changed and re-renders on every pointer move.
const zeroed = (n) => (n === 0 ? 0 : n)

/**
 * How far the content may be moved from centre, in each axis.
 *
 * Bounded by the *content*, not the frame. A card is usually smaller than the
 * viewport it sits in, so bounding by the frame would let you drag a card that
 * still fits entirely on screen halfway out of view for no reason. The limit is
 * the overhang: how far the scaled content sticks out past the frame. When it
 * does not stick out at all, it does not move at all.
 *
 * `content` is the unscaled rendered size. Passing the frame for both gives the
 * old frame-relative behaviour, which is the right fallback before layout has
 * been measured.
 */
export function panBounds(content, frame, scale) {
  const s = clampScale(scale)
  const box = content ?? frame
  return {
    x: Math.max(0, (box.width * s - frame.width) / 2),
    y: Math.max(0, (box.height * s - frame.height) / 2),
  }
}

export function clampOffset(offset, content, frame, scale) {
  const bounds = panBounds(content, frame, scale)
  return {
    x: zeroed(Math.min(bounds.x, Math.max(-bounds.x, offset?.x || 0))),
    y: zeroed(Math.min(bounds.y, Math.max(-bounds.y, offset?.y || 0))),
  }
}

/**
 * Zooms about a point rather than about the centre, so the pixel under your
 * fingers or cursor stays put. Without this, zooming always drifts toward the
 * middle and feels like the content is sliding away from you.
 *
 * `point` is relative to the frame's centre.
 */
export function zoomAbout(point, fromScale, toScale, offset, content, frame) {
  const from = clampScale(fromScale)
  const to = clampScale(toScale)
  if (to === from) return { scale: from, offset: clampOffset(offset, content, frame, from) }

  // The content-space coordinate under the pointer must be unchanged by the
  // zoom, which gives offset' = point - (point - offset) * (to / from).
  const ratio = to / from
  const next = {
    x: point.x - (point.x - offset.x) * ratio,
    y: point.y - (point.y - offset.y) * ratio,
  }
  return { scale: to, offset: clampOffset(next, content, frame, to) }
}

/** Distance between two pointers, for pinch. */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Midpoint between two pointers, for pinch focus. */
export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Which Scryfall image to request for a given magnification.
 *
 * Magnifying a `normal` (488px wide) past about 1.4x just shows bigger pixels,
 * so zoom has to fetch a better source rather than scale a worse one. `png` is
 * the largest and has a transparent rounded corner, which is what we want when
 * it sits on a dark backdrop.
 */
export function sourceForScale(scale) {
  if (scale > 2) return 'png'
  if (scale > 1.4) return 'large'
  return 'normal'
}

/** Step used by keyboard zoom and the on-screen buttons. */
export const ZOOM_STEP = 0.5

export function stepZoom(scale, direction) {
  return clampScale(scale + direction * ZOOM_STEP)
}

/**
 * Double-tap behaviour: jump to a useful magnification, or back to fit.
 * Returning to exactly 1 also resets the offset, since at fit there is
 * nowhere to pan to.
 */
export function toggleZoom(scale, point, content, frame) {
  if (scale > MIN_SCALE) return { scale: MIN_SCALE, offset: { x: 0, y: 0 } }
  return zoomAbout(point, MIN_SCALE, 2.5, { x: 0, y: 0 }, content, frame)
}
