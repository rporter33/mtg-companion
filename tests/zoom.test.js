import { describe, it, expect } from 'vitest'
import {
  clampScale, panBounds, clampOffset, zoomAbout, distance, midpoint,
  sourceForScale, stepZoom, toggleZoom, MIN_SCALE, MAX_SCALE,
} from '../src/lib/zoom.js'

// A card rendered inside a taller viewport — the normal case, and the one the
// old frame-relative bounds got wrong.
const CARD = { width: 300, height: 418 }
const FRAME = { width: 300, height: 418 }
const TALL_FRAME = { width: 420, height: 800 }

describe('clampScale', () => {
  it('holds the range', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(2)).toBe(2)
  })

  it('survives junk rather than propagating NaN into a transform', () => {
    // NaN is "unknown" and fails safe to fit; Infinity is "too big" and clamps
    // like any oversized number. A degenerate pinch can produce either.
    expect(clampScale(NaN)).toBe(MIN_SCALE)
    expect(clampScale(undefined)).toBe(MIN_SCALE)
    expect(clampScale(null)).toBe(MIN_SCALE)
    expect(clampScale('2')).toBe(MIN_SCALE)
    expect(clampScale(Infinity)).toBe(MAX_SCALE)
    expect(clampScale(-Infinity)).toBe(MIN_SCALE)
  })
})

describe('panBounds', () => {
  it('allows no movement at fit', () => {
    expect(panBounds(CARD, FRAME, 1)).toEqual({ x: 0, y: 0 })
  })

  it('allows exactly the overhang', () => {
    // At 2x the content is twice the frame, so half of it hangs outside —
    // a quarter on each side.
    expect(panBounds(CARD, FRAME, 2)).toEqual({ x: 150, y: 209 })
  })

  it('grows with scale', () => {
    expect(panBounds(CARD, FRAME, 4).x).toBeGreaterThan(panBounds(CARD, FRAME, 2).x)
  })

  it('allows no movement while the scaled card still fits the viewport', () => {
    // A 300x418 card in a 420x800 viewport is fully visible even at 1.8x tall,
    // so there is nothing to pan toward and it must not drift.
    expect(panBounds(CARD, TALL_FRAME, 1.2)).toEqual({ x: 0, y: 0 })
  })

  it('starts allowing movement only once the card overflows', () => {
    // 300 * 1.5 = 450, which is 30px wider than the 420 frame: 15px each side.
    expect(panBounds(CARD, TALL_FRAME, 1.5).x).toBeCloseTo(15, 6)
  })

  it('bounds by the card, not the viewport', () => {
    // The bug this replaced: bounding by the frame let a card that still fitted
    // on screen be dragged halfway out of view.
    const byCard = panBounds(CARD, TALL_FRAME, 2)
    const byFrame = panBounds(TALL_FRAME, TALL_FRAME, 2)
    expect(byCard.x).toBeLessThan(byFrame.x)
  })
})

describe('clampOffset', () => {
  it('pins the content at fit', () => {
    expect(clampOffset({ x: 500, y: -500 }, CARD, FRAME, 1)).toEqual({ x: 0, y: 0 })
  })

  it('never returns negative zero', () => {
    // -0 is not Object.is-equal to 0, so it makes an unchanged offset look
    // changed and re-renders on every pointer move.
    const clamped = clampOffset({ x: -500, y: -500 }, CARD, FRAME, 1)
    expect(Object.is(clamped.x, -0)).toBe(false)
    expect(Object.is(clamped.y, -0)).toBe(false)
  })

  it('stops the content being dragged into empty space', () => {
    const clamped = clampOffset({ x: 9999, y: 9999 }, CARD, FRAME, 2)
    expect(clamped).toEqual({ x: 150, y: 209 })
  })

  it('leaves a legal offset alone', () => {
    expect(clampOffset({ x: 40, y: -30 }, CARD, FRAME, 2)).toEqual({ x: 40, y: -30 })
  })

  it('treats a missing offset as centred', () => {
    expect(clampOffset({}, CARD, FRAME, 2)).toEqual({ x: 0, y: 0 })
  })
})

describe('zoomAbout', () => {
  it('keeps the point under the cursor fixed', () => {
    // This is the whole reason the function exists: zooming about the centre
    // makes the content feel like it is sliding away from your finger.
    const point = { x: 60, y: -40 }
    const { scale, offset } = zoomAbout(point, 1, 2, { x: 0, y: 0 }, CARD, FRAME)
    expect(scale).toBe(2)
    // The content coordinate under the pointer is unchanged:
    //   (point - offset) / scale should equal (point - 0) / 1
    expect((point.x - offset.x) / scale).toBeCloseTo(point.x, 5)
    expect((point.y - offset.y) / scale).toBeCloseTo(point.y, 5)
  })

  it('is a no-op when the scale does not change', () => {
    const result = zoomAbout({ x: 10, y: 10 }, 2, 2, { x: 5, y: 5 }, CARD, FRAME)
    expect(result).toEqual({ scale: 2, offset: { x: 5, y: 5 } })
  })

  it('never returns an offset outside the bounds', () => {
    const { scale, offset } = zoomAbout({ x: 9999, y: 9999 }, 1, 4, { x: 0, y: 0 }, CARD, FRAME)
    const bounds = panBounds(CARD, FRAME, scale)
    expect(Math.abs(offset.x)).toBeLessThanOrEqual(bounds.x + 1e-9)
    expect(Math.abs(offset.y)).toBeLessThanOrEqual(bounds.y + 1e-9)
  })

  it('recentres when zooming back to fit', () => {
    const zoomedIn = zoomAbout({ x: 80, y: 80 }, 1, 3, { x: 0, y: 0 }, CARD, FRAME)
    const backOut = zoomAbout({ x: 80, y: 80 }, 3, 1, zoomedIn.offset, CARD, FRAME)
    expect(backOut.scale).toBe(1)
    expect(backOut.offset).toEqual({ x: 0, y: 0 })
  })

  it('respects the maximum when asked for more', () => {
    expect(zoomAbout({ x: 0, y: 0 }, 1, 50, { x: 0, y: 0 }, CARD, FRAME).scale).toBe(MAX_SCALE)
  })
})

describe('pinch helpers', () => {
  it('measures distance and midpoint', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 })
  })
})

describe('sourceForScale', () => {
  it('upgrades the image rather than magnifying pixels', () => {
    expect(sourceForScale(1)).toBe('normal')
    expect(sourceForScale(1.5)).toBe('large')
    expect(sourceForScale(3)).toBe('png')
  })

  it('does not fetch a bigger image before it would help', () => {
    // A 488px-wide normal still looks fine a little above fit.
    expect(sourceForScale(1.3)).toBe('normal')
  })
})

describe('stepZoom and toggleZoom', () => {
  it('steps in both directions within range', () => {
    expect(stepZoom(1, +1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(MIN_SCALE)
    expect(stepZoom(MAX_SCALE, +1)).toBe(MAX_SCALE)
  })

  it('double tap zooms in from fit and back out from anywhere', () => {
    const inward = toggleZoom(1, { x: 20, y: 20 }, CARD, FRAME)
    expect(inward.scale).toBe(2.5)

    const outward = toggleZoom(2.5, { x: 20, y: 20 }, CARD, FRAME)
    expect(outward).toEqual({ scale: 1, offset: { x: 0, y: 0 } })
  })
})
