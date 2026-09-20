import { describe, it, expect } from 'vitest'
import { dropTarget, actionsForDrop } from '../src/lib/board/drop.js'

/**
 * The drop order Moxgate's creator arrived at, pinned as a function over
 * rectangles: a card under the pointer beats a zone tile, a zone tile beats
 * the hand strip, the hand strip beats the battlefield, and the battlefield
 * beats nothing. Every rectangle here overlaps the next so the order, not
 * the geometry, is what decides.
 */
const r = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
const field = r(0, 0, 400, 400)
const hand = r(0, 380, 400, 100)            // overlaps the bottom of the field
const zones = [{ zone: 'graveyard', rect: r(300, 400, 40, 60) }] // inside the hand strip
const cards = [{ id: 'bear', rect: r(100, 100, 60, 40) }, { id: 'aura', rect: r(110, 105, 30, 20) }]

describe('where a drop lands', () => {
  it('is the card under the pointer before anything else, the smallest one when they pile', () => {
    expect(dropTarget({ x: 105, y: 102 }, { cards, field })).toEqual({ kind: 'attach', id: 'bear' })
    expect(dropTarget({ x: 120, y: 110 }, { cards, field })).toEqual({ kind: 'attach', id: 'aura' })
  })
  it('never a card on itself', () => {
    expect(dropTarget({ x: 120, y: 110 }, { dragged: 'aura', cards, field })).toEqual({ kind: 'attach', id: 'bear' })
    expect(dropTarget({ x: 105, y: 102 }, { dragged: 'bear', cards: cards.slice(0, 1), field })).toMatchObject({ kind: 'field' })
  })
  it('then a zone tile, even one sitting inside the hand strip', () => {
    expect(dropTarget({ x: 320, y: 420 }, { hand, zones, field })).toEqual({ kind: 'zone', zone: 'graveyard' })
  })
  it('then the hand, even where it overlaps the battlefield', () => {
    expect(dropTarget({ x: 50, y: 390 }, { hand, zones, field })).toEqual({ kind: 'hand' })
  })
  it('then the battlefield, as a fraction of it', () => {
    expect(dropTarget({ x: 200, y: 100 }, { hand, zones, field })).toEqual({ kind: 'field', x: 0.5, y: 0.25 })
  })
  it('and nothing at all off the table', () => {
    expect(dropTarget({ x: 900, y: 900 }, { cards, hand, zones, field })).toBe(null)
  })
})

describe('what a drop does', () => {
  it('puts a permanent on another from the battlefield, and lands it first from hand', () => {
    expect(actionsForDrop({ kind: 'attach', id: 'bear' }, { id: 'aura', from: 'battlefield' }))
      .toEqual([{ type: 'attach', id: 'aura', to: 'bear' }])
    expect(actionsForDrop({ kind: 'attach', id: 'bear' }, { id: 'aura', from: 'hand' }))
      .toEqual([{ type: 'move', id: 'aura', zone: 'battlefield' }, { type: 'attach', id: 'aura', to: 'bear' }])
  })
  it('moves to a zone from its tile', () => {
    expect(actionsForDrop({ kind: 'zone', zone: 'exile' }, { id: 'bear', from: 'battlefield' }))
      .toEqual([{ type: 'move', id: 'bear', zone: 'exile', to: 'top' }])
  })
  it('brings a card back to hand, and leaves a hand card dropped on the hand alone', () => {
    expect(actionsForDrop({ kind: 'hand' }, { id: 'bear', from: 'battlefield' })).toEqual([{ type: 'move', id: 'bear', zone: 'hand' }])
    expect(actionsForDrop({ kind: 'hand' }, { id: 'bear', from: 'hand' })).toEqual([])
  })
  it('places on the battlefield where it was dropped, and does nothing for no target', () => {
    expect(actionsForDrop({ kind: 'field', x: 0.5, y: 0.25 }, { id: 'bear', from: 'hand' }))
      .toEqual([{ type: 'move', id: 'bear', zone: 'battlefield', x: 0.5, y: 0.25 }])
    expect(actionsForDrop(null, { id: 'bear', from: 'hand' })).toEqual([])
  })
})
