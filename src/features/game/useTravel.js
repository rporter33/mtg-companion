import { useLayoutEffect, useRef } from 'react'

/**
 * A card travels when it moves.
 *
 * A table where a card vanishes from your hand and appears on the field has
 * told you nothing about what just happened; one where it slides there has
 * told you everything, and in a quarter of a second. This is the difference
 * people mean when they say a screen feels like a table.
 *
 * Done the FLIP way: after React has laid the new frame out, every card
 * still on screen that used to be somewhere else is snapped back to where it
 * was with a transform and released, so the browser animates the journey
 * and the layout itself never lies. A card that left the screen for a pile
 * gets a ghost — a clone of what it looked like — that shrinks into the
 * pile's tile; a card that arrived from a pile grows out of that tile.
 *
 * Nothing here touches the board. It reads where elements are, before and
 * after, and it is switched off entirely when motion is reduced, in which
 * case cards simply are where they are, as before.
 */
const TRAVEL_MS = 260
const EASE = 'cubic-bezier(0.2, 0.9, 0.3, 1)'

export default function useTravel(rootRef, { board, reduced = false, me = 'you' }) {
  const before = useRef({ rects: new Map(), zones: new Map() })

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !board) return
    const now = measure(root)
    const was = before.current
    const zones = new Map(Object.values(board.cards).map((inst) => [inst.id, { zone: inst.zone, owner: inst.owner }]))

    if (!reduced && was.rects.size) {
      // Still on screen, somewhere else: slide from there to here.
      for (const [id, { el, rect }] of now) {
        const old = was.rects.get(id)
        // A card that only changed place within its own row is left to the
        // row's own transitions; this is for journeys between places.
        if (!old || old.where === rect.where || sameBox(old.rect, rect)) continue
        slide(el, old.rect, rect)
      }
      // Gone from the screen: into a pile's tile, if we know which.
      for (const [id, old] of was.rects) {
        if (now.has(id)) continue
        const at = zones.get(id)
        const tile = at ? tileFor(root, at.zone, at.owner, me) : null
        if (tile) ghost(old.snapshot, old.rect, tile.getBoundingClientRect())
      }
      // New on the screen: out of the pile it came from, if we know which.
      for (const [id, { el, rect }] of now) {
        if (was.rects.has(id)) continue
        const from = was.zones.get(id)
        const tile = from ? tileFor(root, from.zone, from.owner, me) : null
        if (tile) slide(el, tile.getBoundingClientRect(), rect, { grow: true })
      }
    }

    before.current = {
      rects: new Map([...now].map(([id, { el, rect }]) => [id, { rect, where: rect.where, snapshot: keep(el) }])),
      zones,
    }
  })
}

/** Every card element on screen, by instance id, with where it sits. */
function measure(root) {
  const out = new Map()
  for (const holder of root.querySelectorAll('[data-id]')) {
    const el = holder.querySelector('.bcard') ?? holder
    const id = holder.dataset.id
    if (!id || out.has(id)) continue
    const rect = el.getBoundingClientRect()
    if (!rect.width) continue
    rect.where = holder.closest('.field') ? 'field' : holder.closest('.game__hand') ? 'hand' : 'elsewhere'
    out.set(id, { el, rect })
  }
  return out
}

const sameBox = (a, b) => Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1
  && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1

/** The tile a zone is drawn as, for this owner: yours in your strip, theirs in theirs. */
function tileFor(root, zone, owner, me) {
  if (!['library', 'graveyard', 'exile', 'command'].includes(zone)) return null
  const scope = owner === me ? '.game__you' : `[data-seat="${owner}"]`
  return root.querySelector(`${scope} .ztile[data-zone="${zone}"]`)
    ?? (owner === me ? null : root.querySelector(`.game__them .ztile[data-zone="${zone}"]`))
}

/** From one box to another, on the element itself: transform only, so layout is never touched. */
function slide(el, from, to, { grow = false } = {}) {
  if (typeof el.animate !== 'function') return
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  const sx = grow ? from.width / to.width : Math.max(0.2, from.width / to.width)
  const sy = grow ? from.height / to.height : Math.max(0.2, from.height / to.height)
  el.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: grow ? 0.4 : 1 }, { transform: 'none', opacity: 1 }],
    { duration: TRAVEL_MS, easing: EASE, composite: 'replace' },
  )
}

/** A card's look at the moment it left, so its ghost is the card and not a rectangle. */
function keep(el) {
  return el.cloneNode(true)
}

/** The clone, from where the card was to the pile it went to, shrinking as it goes. */
function ghost(snapshot, from, to) {
  if (!snapshot || typeof snapshot.animate !== 'function' || typeof document === 'undefined') return
  const el = snapshot
  el.setAttribute('aria-hidden', 'true')
  el.removeAttribute('id')
  el.classList.add('ghost')
  Object.assign(el.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    margin: 0, zIndex: 900, pointerEvents: 'none', transformOrigin: '0 0',
  })
  document.body.appendChild(el)
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const anim = el.animate(
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.15, to.width / from.width)})`, opacity: 0.2 }],
    { duration: TRAVEL_MS, easing: EASE, fill: 'forwards' },
  )
  const done = () => el.remove()
  anim.onfinish = done
  anim.oncancel = done
  setTimeout(done, TRAVEL_MS + 100)
}
