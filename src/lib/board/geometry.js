/**
 * Where a card sits on the battlefield, and what it lands on.
 *
 * Kept free of React and the DOM so it can be tested. Positions are in
 * fractions of the battlefield, not pixels, because the same board has to
 * read on a phone and on a desktop and survive a rotation. A card at
 * { x: 0.5, y: 0.5 } is in the middle of the field whatever size that
 * field is.
 *
 * Nothing here knows a rule. It is a table top: it knows where things are,
 * what overlaps what, and how to tidy up.
 */

/** A card's size as a fraction of the field, so cards stay in proportion. */
export const CARD_W = 0.11
export const CARD_H = CARD_W * 1.4

export const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Keeps a whole card inside the field, so nothing can be dragged out of reach. */
export function clampToField(x, y, { w = CARD_W, h = CARD_H } = {}) {
  return { x: Math.min(1 - w / 2, Math.max(w / 2, clamp01(x))), y: Math.min(1 - h / 2, Math.max(h / 2, clamp01(y))) }
}

/** Do two cards overlap enough to read as a pile rather than two cards? */
export function overlaps(a, b, { w = CARD_W, h = CARD_H, share = 0.5 } = {}) {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return dx < w * share && dy < h * share
}

/**
 * The topmost card under a point, or null. Later cards are on top, which
 * matches the render order, so the search runs backwards.
 */
export function cardAt(point, cards, { w = CARD_W, h = CARD_H } = {}) {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]
    if (Math.abs(point.x - c.x) <= w / 2 && Math.abs(point.y - c.y) <= h / 2) return c
  }
  return null
}

/**
 * A free spot near where a card was dropped, so two cards never land exactly
 * on top of one another by accident. Steps outward in a small spiral; a
 * deliberate pile is made by dropping onto a card, not by missing.
 */
export function freeSpot(wanted, taken, { w = CARD_W, h = CARD_H } = {}) {
  const step = w * 0.55
  const spiral = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]
  for (const [dx, dy] of spiral) {
    const spot = clampToField(wanted.x + dx * step, wanted.y + dy * step * 1.4, { w, h })
    if (!taken.some((c) => overlaps(spot, c, { w, h, share: 0.35 }))) return spot
  }
  return clampToField(wanted.x, wanted.y, { w, h })
}

/**
 * Tidies a set of cards into rows, the way a player straightens a board
 * mid-game. Lands go to the back row, everything else in front, because
 * that is how almost everyone lays a table out.
 */
export function tidy(cards, { isLand = () => false, w = CARD_W, h = CARD_H, rows = 3 } = {}) {
  const lands = cards.filter(isLand)
  const others = cards.filter((c) => !isLand(c))
  const placed = []
  const layout = (list, top) => {
    if (!list.length) return
    // Fill each row before starting another, so two lands sit side by side
    // rather than stacking into a column of one.
    const fits = Math.max(1, Math.floor(1 / (w * 1.15)))
    const perRow = Math.max(Math.ceil(list.length / rows), Math.min(list.length, fits))
    const gap = Math.min(w * 1.15, (1 - w) / Math.max(1, perRow - 1 || 1))
    list.forEach((card, i) => {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      const rowCount = Math.min(perRow, list.length - row * perRow)
      const width = gap * (rowCount - 1)
      placed.push({ ...card, ...clampToField(0.5 - width / 2 + col * gap, top + row * h * 0.75, { w, h }) })
    })
  }
  layout(others, 0.30)
  layout(lands, 0.68)
  return placed
}

/** Turns a pointer position inside an element's box into field fractions. */
export function pointToField(point, rect) {
  if (!rect || !rect.width || !rect.height) return { x: 0.5, y: 0.5 }
  return { x: clamp01((point.x - rect.left) / rect.width), y: clamp01((point.y - rect.top) / rect.height) }
}
