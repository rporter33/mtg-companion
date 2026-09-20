/**
 * Where a dropped card goes.
 *
 * Moxgate's creator found the stock "nearest centre" collision useless once
 * zones overlap and cards are targets, and wrote a priority-ordered one:
 * attach targets first, then the hand, then zone drops, then nearest centre
 * as the fallback. This is that order, as a pure function over rectangles
 * so it can be tested without a pointer. The screen gathers the rectangles;
 * this decides.
 *
 * Priority is the point. A card dropped on another card is being put on it
 * — an aura on a creature, an equipment on a bearer — even though that card
 * is also inside the battlefield, so the battlefield must not win. A card
 * dropped on the graveyard tile is going to the graveyard even though the
 * tile may sit inside the hand strip on a narrow screen. Whatever is most
 * specific under the pointer wins; the table itself only when nothing else
 * does.
 */
const within = (point, rect) => Boolean(rect)
  && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom

/**
 * @param point   { x, y } in the same space as the rectangles (client pixels)
 * @param targets {
 *   dragged: the id of the card being dropped, which cannot be its own target
 *   cards:   [{ id, rect }] permanents that can have something put on them
 *   hand:    rect of the hand strip, or null
 *   zones:   [{ zone, rect }] the zone tiles
 *   field:   rect of the battlefield, or null
 * }
 * @returns { kind: 'attach', id } | { kind: 'hand' } | { kind: 'zone', zone }
 *        | { kind: 'field', x, y } | null
 */
export function dropTarget(point, { dragged = null, cards = [], hand = null, zones = [], field = null } = {}) {
  // Smallest first among overlapping cards, so a card piled on another is
  // the one under the pointer rather than the one underneath it.
  const hits = cards.filter((c) => c.id !== dragged && within(point, c.rect))
    .sort((a, b) => area(a.rect) - area(b.rect))
  if (hits.length) return { kind: 'attach', id: hits[0].id }
  const tile = zones.find((z) => within(point, z.rect))
  if (tile) return { kind: 'zone', zone: tile.zone }
  if (within(point, hand)) return { kind: 'hand' }
  if (within(point, field)) {
    return {
      kind: 'field',
      x: Math.min(1, Math.max(0, (point.x - field.left) / field.width)),
      y: Math.min(1, Math.max(0, (point.y - field.top) / field.height)),
    }
  }
  return null
}

const area = (rect) => (rect.width ?? rect.right - rect.left) * (rect.height ?? rect.bottom - rect.top)

/**
 * What a drop means as actions, given where the card came from.
 *
 * The board's own rules apply on top — a card that does not stay on the
 * battlefield is refused there — and nothing here checks whether the thing
 * being attached could legally be attached. It is a table.
 */
export function actionsForDrop(target, { id, from }) {
  if (!target) return []
  switch (target.kind) {
    case 'attach':
      // Coming from anywhere but the battlefield, the card lands first.
      return from === 'battlefield'
        ? [{ type: 'attach', id, to: target.id }]
        : [{ type: 'move', id, zone: 'battlefield' }, { type: 'attach', id, to: target.id }]
    case 'zone':
      return [{ type: 'move', id, zone: target.zone, to: 'top' }]
    case 'hand':
      // A card already in hand dropped back on the hand stays where it was:
      // the board keeps no hand order to change. Anything else comes to hand.
      return from === 'hand' ? [] : [{ type: 'move', id, zone: 'hand' }]
    case 'field':
      return [{ type: 'move', id, zone: 'battlefield', x: target.x, y: target.y }]
    default:
      return []
  }
}
