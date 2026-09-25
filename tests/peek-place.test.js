// @vitest-environment node
/**
 * Where the card preview goes (src/features/game/peekPlace.js): never over
 * the prompt or the rail, never over the card, never off the screen — and
 * otherwise where it always went.
 */
import { describe, it, expect } from 'vitest'
import { placePeek, PEEK_W } from '../src/features/game/peekPlace.js'

const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const asBox = (s) => box(s.left, s.top, s.width, s.height)
const DESK = { width: 1280, height: 900 }
const H = Math.round((PEEK_W * 88) / 63)

describe('with nothing to keep clear of, where it always went', () => {
  it('above a card that sits low, centred on it', () => {
    const card = box(500, 700, 100, 140)
    const s = placePeek({ at: card, view: DESK })
    expect(s.side).toBe('above')
    expect(s.top + s.height).toBe(card.top - 12)
    expect(s.left + s.width / 2).toBe(card.left + card.width / 2)
    expect(s.width).toBe(PEEK_W)
    expect(s.height).toBe(H)
  })

  it('to the right of a card higher up, and to its left at the right-hand edge', () => {
    expect(placePeek({ at: box(300, 200, 120, 80), view: DESK }).side).toBe('right')
    const edge = placePeek({ at: box(1100, 200, 120, 80), view: DESK })
    expect(edge.side).toBe('left')
    expect(edge.left + edge.width).toBe(1100 - 12)
  })
})

describe('keeping clear of where the next press goes', () => {
  it('beside a card in hand when above it would cover the prompt', () => {
    const card = box(600, 720, 100, 140)
    const prompt = box(380, 640, 300, 60)
    const s = placePeek({ at: card, view: DESK, avoid: [prompt] })
    expect(s.side).toBe('right')
    expect(s.left).toBe(card.right + 12)
    expect(overlaps(asBox(s), prompt)).toBe(false)
    expect(overlaps(asBox(s), card)).toBe(false)
  })

  it('and above the prompt instead, when beside would cover it too', () => {
    const card = box(560, 720, 100, 140)
    const prompt = box(380, 640, 480, 60)
    const s = placePeek({ at: card, view: DESK, avoid: [prompt] })
    expect(overlaps(asBox(s), prompt)).toBe(false)
    expect(overlaps(asBox(s), card)).toBe(false)
    expect(s.top + s.height).toBeLessThanOrEqual(prompt.top - 12)
  })

  it('above the prompt, clear of the card, where the screen is too narrow for beside', () => {
    const phone = { width: 430, height: 1100 }
    const card = box(170, 900, 70, 98)
    const prompt = box(16, 820, 398, 64)
    const s = placePeek({ at: card, view: phone, avoid: [prompt] })
    expect(s).not.toBeNull()
    expect(overlaps(asBox(s), prompt)).toBe(false)
    expect(overlaps(asBox(s), card)).toBe(false)
    expect(s.top + s.height).toBeLessThanOrEqual(prompt.top - 12)
  })

  it('smaller, when nowhere at full size keeps everything clear', () => {
    const small = { width: 560, height: 520 }
    const card = box(230, 300, 100, 140)
    const s = placePeek({ at: card, view: small, avoid: [box(0, 0, 560, 60)] })
    expect(s).not.toBeNull()
    expect(s.width).toBeLessThan(PEEK_W)
    expect(overlaps(asBox(s), card)).toBe(false)
  })

  it('and not at all, when nowhere does: the press is kept, the picture given up', () => {
    const tiny = { width: 320, height: 300 }
    expect(placePeek({ at: box(110, 100, 100, 140), view: tiny })).toBeNull()
  })

  it('whatever the card and wherever the prompt and the rail: never over either, the card, or the edge', () => {
    const layouts = [
      { view: DESK, avoid: [box(300, 620, 520, 64), box(150, 700, 110, 180)] },
      { view: DESK, avoid: [box(0, 560, 1280, 70)] },
      { view: { width: 430, height: 1100 }, avoid: [box(16, 820, 398, 64), box(16, 940, 200, 40)] },
      { view: { width: 900, height: 600 }, avoid: [box(200, 380, 420, 56), box(20, 450, 90, 140)] },
    ]
    let placed = 0
    let refused = 0
    for (const { view, avoid } of layouts) {
      for (let x = 0; x <= view.width - 60; x += 37) {
        for (let y = 0; y <= view.height - 84; y += 41) {
          const card = box(x, y, 60, 84)
          const s = placePeek({ at: card, view, avoid })
          if (!s) { refused++; continue }
          placed++
          const b = asBox(s)
          expect(overlaps(b, card)).toBe(false)
          for (const a of avoid) expect(overlaps(b, a)).toBe(false)
          expect(b.left).toBeGreaterThanOrEqual(8)
          expect(b.top).toBeGreaterThanOrEqual(8)
          expect(b.right).toBeLessThanOrEqual(view.width - 8)
          expect(b.bottom).toBeLessThanOrEqual(view.height - 8)
        }
      }
    }
    // Refusing is the last resort, not the habit.
    expect(placed).toBeGreaterThan(refused * 10)
  })

  it('pays no mind to a rectangle with no area, which is something not drawn', () => {
    const card = box(500, 700, 100, 140)
    expect(placePeek({ at: card, view: DESK, avoid: [box(0, 0, 0, 0), null] }).side).toBe('above')
  })

  it('answers nothing, rather than throwing, when it has nothing to go on', () => {
    expect(placePeek({ at: null, view: DESK })).toBeNull()
    expect(placePeek({ at: box(1, 1, 1, 1), view: null })).toBeNull()
    expect(placePeek({ at: box(1, 1, 1, 1), view: { width: 0, height: 0 } })).toBeNull()
  })
})
