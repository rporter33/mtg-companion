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

/**
 * A card's size as a fraction of the field, so cards stay in proportion.
 *
 * 1.4 is a card's own aspect (88/63), which means these two numbers only
 * agree with what is on screen if the field is square. It is, deliberately:
 * a square table is what a table looks like from above, and it is the only
 * shape where a position in fractions means the same thing horizontally and
 * vertically. The screen gives the leftover width to the piles instead.
 */
/*
 * 0.15 rather than 0.12: with four rows on the playmat each row is a quarter
 * of the field, and at 0.12 a card filled two thirds of the row it sat in,
 * which left the board looking mostly empty at the size a phone shows it.
 * At 0.15 the card is a little over four fifths of its row — close enough to
 * fill it, with room to see the row is a row.
 */
export const CARD_W = 0.15
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
  // A step of a bit more than a card, and "free" meaning almost no overlap:
  // a card that lands half on top of another hides the one underneath, and a
  // card you cannot point at is worse than one a little further away. A pile
  // is made on purpose, by dropping onto a card, not by missing.
  const step = w * 1.15
  const spiral = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [-2, 1], [2, -1], [-2, -1]]
  for (const [dx, dy] of spiral) {
    const spot = clampToField(wanted.x + dx * step, wanted.y + dy * step * 1.4, { w, h })
    if (!taken.some((c) => overlaps(spot, c, { w, h, share: 0.9 }))) return spot
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
    // The gap allows for a tapped card, which is turned sideways and so takes
    // up its own height across. Rows that look right until something taps are
    // rows a player has to straighten by hand.
    const wide = w * 1.5
    const fits = Math.max(1, Math.floor(1 / wide))
    const perRow = Math.max(Math.ceil(list.length / rows), Math.min(list.length, fits))
    const gap = Math.min(wide, (1 - w) / Math.max(1, perRow - 1 || 1))
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

/**
 * How far the fan of cards in your hand spreads.
 *
 * A hand is not a row. Held in one hand the cards overlap, each showing a
 * sliver of the one behind, and the whole thing arcs — which is not
 * decoration: it is the reason seven cards fit in the space of three and a
 * half. The screen is short in the direction a row of separate cards costs
 * most, so closing the gaps is what lets every card be bigger rather than
 * smaller.
 *
 * `FAN_WIDTH` is how many card widths the fan may spread past its first card,
 * so a hand of fourteen takes the same strip as a hand of five and only the
 * overlap deepens. `FAN_ARC` caps the total rotation, `FAN_STEP` the rotation
 * between neighbours, so a small hand fans gently rather than flying open.
 */
const FAN_WIDTH = 2.6
const FAN_ARC = 26
const FAN_STEP = 4
const FAN_DROP = 0.05

/** Two decimals: these become CSS, and the rest of a float is noise in a style attribute. */
const round = (n) => Math.round(n * 100) / 100

/**
 * Three decimals for the overlap alone, because it is the one number that is
 * multiplied by the size of the hand. Rounded to two, a sixtieth of a card
 * width of error becomes a third of a card across sixty of them, and the fan
 * quietly outgrows the strip it was measured to fit.
 */
const round3 = (n) => Math.round(n * 1000) / 1000

/**
 * The fan for a hand of `count` cards.
 *
 * Returns the overlap once — every card is laid on the last by the same
 * amount — the `span` the whole fan occupies in card widths, and then, per
 * card, the angle it is turned, how far it drops below its neighbours, and
 * where its cost badge belongs.
 *
 * The badge is the fiddly one: a card in the middle of a fan only shows its
 * left edge, so a badge centred on the card would be hidden by the card in
 * front of it. Every card but the last gets its badge over the sliver that is
 * actually visible.
 *
 * `span` is what lets the cards be sized to the strip rather than guessed at.
 * A hand that is laid out first and measured afterwards is a hand that
 * sometimes overflows; given the span, the stylesheet divides the width it
 * has by it and every card comes out as large as it can be and no larger.
 */
export function fan(count) {
  const n = Math.max(0, Math.floor(count) || 0)
  if (n === 0) return { overlap: 0, span: 0, cards: [] }
  if (n === 1) return { overlap: 0, span: 1, cards: [{ angle: 0, drop: 0, badge: 0.5 }] }

  const step = Math.min(1, FAN_WIDTH / (n - 1))
  const between = Math.min(FAN_STEP, FAN_ARC / (n - 1))
  const cards = []
  for (let i = 0; i < n; i++) {
    // -1 at the left of the fan, 0 in the middle, 1 at the right.
    const t = (i - (n - 1) / 2) / ((n - 1) / 2)
    cards.push({
      angle: round(t * between * (n - 1) / 2),
      // Squared, so the drop is a curve rather than a wedge: the cards either
      // side of the middle barely move and the outermost ones fall away.
      drop: round(FAN_DROP * t * t),
      badge: i === n - 1 ? 0.5 : round(step / 2),
    })
  }
  return { overlap: round3(1 - step), span: round3(1 + (n - 1) * step), cards }
}
