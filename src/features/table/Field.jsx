import { CARD_W, CARD_H } from '../../lib/board/geometry.js'
import { stacked, nameOf } from '../../lib/board/model.js'
import BoardCard from './BoardCard.jsx'

/**
 * The battlefield: a square patch of table you can put cards anywhere on.
 *
 * Square because a position is stored as a fraction of the field, and only a
 * square field makes a fraction mean the same thing across and down. So a
 * board arranged on a phone opens arranged the same way on a desktop, at a
 * different size, and survives turning the phone sideways.
 *
 * Arrangement is not decoration. Which creature is in front, what is grouped
 * with what, which land is obviously still untapped — players read all of it
 * off the shape of the table, and an app that files everything into neat
 * rows has thrown that away.
 */
const NUDGE = 0.02

export default function Field({
  fieldRef, board, lookup, player = 'you', selectedId, drag, aiming, onBegin, onSelect, onNudge, onBackground,
}) {
  const cards = stacked(board, player)
  const dragged = drag && drag.from === 'battlefield' && drag.moved ? drag.id : null
  const rect = () => fieldRef.current?.getBoundingClientRect()

  const onKeyDown = (event) => {
    if (!selectedId || !event.key.startsWith('Arrow')) return
    const step = event.shiftKey ? NUDGE * 4 : NUDGE
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!by) return
    event.preventDefault()
    onNudge?.(selectedId, by[0], by[1])
  }

  return (
    <div
      className="field"
      ref={fieldRef}
      onKeyDown={onKeyDown}
      // Empty table is where you put a card down: a press on the felt itself
      // ends whatever was being held or pointed at.
      onClick={(event) => { if (!event.target.closest('.field__slot')) onBackground?.() }}
      role="group"
      aria-label={`Battlefield, ${cards.length} card${cards.length === 1 ? '' : 's'}`}
      style={{ '--card-w': `${CARD_W * 100}%`, '--card-h': `${CARD_H * 100}%` }}
    >
      <Arrows board={board} />
      {!cards.length && (
        <p className="field__empty">
          Drag a card up from your hand, or tap it to put it here.
        </p>
      )}
      {cards.map((inst) => {
        const live = dragged === inst.id ? livePosition(drag, rect()) : null
        return (
          <span
            key={inst.id}
            className={`field__slot${aiming && aiming.id !== inst.id ? ' field__slot--aimable' : ''}`}
            style={{ left: `${(live?.x ?? inst.x) * 100}%`, top: `${(live?.y ?? inst.y) * 100}%`, zIndex: live ? 999 : inst.z }}
          >
            {/* The rotation is on this wrapper, so the word beside it stays
                the right way up while the card turns sideways. */}
            <span className={`field__turn${inst.tapped ? ' field__turn--tapped' : ''}`}>
              <BoardCard
                card={inst.custom ? null : lookup?.(inst.cardId)}
                name={nameOf(board, inst.id, lookup)}
                inst={inst}
                selected={selectedId === inst.id}
                dragging={Boolean(live)}
                onPointerDown={(e) => onBegin(e, { id: inst.id, from: 'battlefield' })}
                onClick={() => onSelect(inst.id)}
              />
            </span>
            {inst.tapped && <span className="field__flag">tapped</span>}
          </span>
        )
      })}
    </div>
  )
}

/** Where a card being dragged should be drawn, before anything is committed. */
function livePosition(drag, rect) {
  if (!rect || !rect.width) return null
  return {
    x: Math.min(1, Math.max(0, (drag.x - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (drag.y - rect.top) / rect.height)),
  }
}

/**
 * The arrows, drawn over everything.
 *
 * This is the one thing on the table that a phone cannot do with a card: at
 * a real table you point, and the pointing is half of what combat is. An
 * arrow says what is attacking what and what a spell is aimed at, and it is
 * the player's claim rather than the app's ruling — nothing here checks
 * whether the thing at the far end could legally be attacked.
 *
 * Coordinates are in the same fractions the cards use, scaled to 100, with a
 * stroke that does not stretch with the box.
 */
function Arrows({ board }) {
  if (!board.arrows.length) return null
  const end = (id) => {
    const inst = board.cards[id]
    if (inst) return { x: inst.x * 100, y: inst.y * 100 }
    if (board.players.includes(id)) return { x: 50, y: 99 } // a player sits at the near edge
    return null
  }
  return (
    <svg className="field__arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="board-head-attack" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--mtg-r, #d89383)" />
        </marker>
        <marker id="board-head-target" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
        </marker>
      </defs>
      {board.arrows.map((arrow) => {
        const from = end(arrow.from)
        const to = end(arrow.to)
        if (!from || !to) return null
        return (
          <line
            key={arrow.id}
            className={`field__arrow field__arrow--${arrow.kind}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            markerEnd={`url(#board-head-${arrow.kind === 'attack' ? 'attack' : 'target'})`}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}
