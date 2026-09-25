/**
 * Where the card preview goes, in the viewport's own pixels.
 *
 * Law 2 made reading a card free (FRICTION.md): its printed face appears for
 * resting the pointer on it. What the preview must never cost is the next
 * press, and at a table that press goes to one of two places — a card, which
 * the pointer is already on, or Pass, on the prompt panel and on the rail. A
 * preview laid over Pass is a preview the player has to move away before
 * they can carry on, which is the second tap Law 2 took away, back again
 * (HANDOFF.md, M1b; the Grok pack's "nothing overlays Pass", SOURCES.md).
 *
 * So a place is taken only if it keeps three rules, strictest first:
 *
 *   1. nothing in `avoid` is covered — the rectangles the table reads, at the
 *      moment of showing, off the prompt panel and the rail;
 *   2. the card itself is not covered, so the preview never sits under the
 *      pointer;
 *   3. the whole preview is inside the viewport.
 *
 * Among the places that keep all three, the one nearest the card wins, and
 * between places equally near, the order this preview always had: above a
 * card that sits low on the screen (a card in hand, whose neighbours a
 * preview beside it would cover), else to its right, then its left, then
 * below. Above a card in hand is where the prompt usually is, so there the
 * rules put it beside the card instead (HANDOFF.md, M1b), or above the prompt
 * where beside would cover it too, or the screen is too narrow for beside.
 *
 * Where nowhere at full size keeps all three, a smaller preview is tried, and
 * where nowhere at all does, the answer is null and nothing is shown. That is
 * the table choosing, and it chooses the press over the picture: the card is
 * still one press from "Read it" in the actions panel.
 *
 * Pure: rectangles in, a rectangle out.
 */

/** The preview's width at full size; its height is the card's own 63:88. */
export const PEEK_W = 280
const SCALES = [1, 0.8, 0.64]

const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
/** How far apart two rectangles are: 0 when they touch or overlap. */
const apart = (a, b) => Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom))

/**
 * @param {object} options
 * @param {{left:number, top:number, right:number, bottom:number, width:number, height:number}} options.at the card
 * @param {{width:number, height:number}} options.view the viewport
 * @param {Array<object>} [options.avoid] rectangles the preview must leave uncovered
 * @param {number} [options.gap] space between the preview and the card, or anything avoided
 * @param {number} [options.edge] space kept from the viewport's edges
 * @returns {{left:number, top:number, width:number, height:number, side:string}|null}
 */
export function placePeek({ at, view, avoid = [], width = PEEK_W, gap = 12, edge = 8 }) {
  if (!at || !view || !(view.width > 0) || !(view.height > 0)) return null
  const card = rect(at.left, at.top, at.right - at.left, at.bottom - at.top)
  // A rectangle with no area is something not drawn (a prompt that has gone,
  // a rail hidden by the layout): nothing to keep clear of.
  const keep = (avoid ?? []).filter((a) => a && a.right - a.left > 0 && a.bottom - a.top > 0)
  const low = card.top > view.height * 0.55
  const order = low ? ['above', 'right', 'left', 'below'] : ['right', 'left', 'above', 'below']

  for (const scale of SCALES) {
    const w = Math.round(width * scale)
    const h = Math.round((w * 88) / 63)
    const clampX = (x) => Math.max(edge, Math.min(view.width - w - edge, x))
    const clampY = (y) => Math.max(edge, Math.min(view.height - h - edge, y))
    // Along the card's edge. Above or below it, centred on it, and nowhere else:
    // a preview slid sideways off the card's column reads as belonging to a
    // neighbour, and beside is the next place to try anyway. Beside it, level
    // with it, or slid up or down past each thing kept clear — which is how a
    // preview beside a card in hand rises clear of the prompt.
    const across = [clampX(card.left + card.width / 2 - w / 2)]
    const along = [clampY(card.top + card.height / 2 - h / 2), ...keep.flatMap((a) => [clampY(a.top - gap - h), clampY(a.bottom + gap)])]
    // Away from the card: just beside it, or further out, past each thing kept
    // clear that stands in the way on that side.
    const sides = {
      above: { tops: [card.top - gap - h, ...keep.map((a) => a.top - gap - h)].filter((y) => y <= card.top - gap - h), lefts: across },
      below: { tops: [card.bottom + gap, ...keep.map((a) => a.bottom + gap)].filter((y) => y >= card.bottom + gap), lefts: across },
      right: { lefts: [card.right + gap, ...keep.map((a) => a.right + gap)].filter((x) => x >= card.right + gap), tops: along },
      left: { lefts: [card.left - gap - w, ...keep.map((a) => a.left - gap - w)].filter((x) => x <= card.left - gap - w), tops: along },
    }
    let best = null
    order.forEach((side, rank) => {
      for (const top of sides[side].tops) {
        for (const left of sides[side].lefts) {
          const spot = rect(left, top, w, h)
          if (spot.left < edge || spot.top < edge || spot.right > view.width - edge || spot.bottom > view.height - edge) continue
          if (overlaps(spot, card) || keep.some((a) => overlaps(spot, a))) continue
          const near = apart(spot, card)
          if (!best || near < best.near - 0.5 || (Math.abs(near - best.near) <= 0.5 && rank < best.rank)) best = { spot, near, rank, side }
        }
      }
    })
    if (best) return { left: best.spot.left, top: best.spot.top, width: w, height: h, side: best.side }
  }
  return null
}
