import { useState } from 'react'
import { notesFor } from '../../lib/board/coach.js'

/**
 * The coach, at a table that enforces nothing.
 *
 * It never blocks and it never asks. A note is an observation with a cross
 * on it, and one switch silences the lot — which matters more here than
 * anywhere else in the app, because the whole promise of this table is that
 * nothing on it tells you what to do. A coach that cannot be told to be
 * quiet would break that promise even while being right.
 *
 * Dismissal is per turn: a note waved away now can be worth saying again
 * next turn, and a note the player has decided they do not need this turn
 * should not come straight back because a card moved.
 */
export default function Coach({ board, events, lookup, onSilence }) {
  const [dismissed, setDismissed] = useState(() => new Set())
  // On a narrow screen only the first note is shown until this is set; with
  // room beside the table they are all shown and this does nothing. The
  // choice is the stylesheet's, so there is no media query in here.
  const [open, setOpen] = useState(false)
  const notes = notesFor(board, events, lookup)
  const shown = notes.filter((note) => !dismissed.has(`${note.id}:${board.turn}`))
  if (!shown.length) return null

  return (
    <section className={`tablecoach${open ? ' tablecoach--open' : ''}`} aria-label="Notes">
      <div className="row row--wrap tablecoach__head">
        <h2 className="pile__title">Notes <span className="chip tiny">{shown.length}</span></h2>
        <span className="spacer" />
        {shown.length > 1 && (
          <button className="btn btn--ghost btn--sm tablecoach__more" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Just the first' : `All ${shown.length}`}
          </button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={onSilence}>Quiet, please</button>
      </div>
      <ul className="tablecoach__list" role="list">
        {shown.map((note) => (
          <li key={note.id} className={`tablecoach__note tablecoach__note--${note.severity}`}>
            <span>{note.text}</span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setDismissed((was) => new Set(was).add(`${note.id}:${board.turn}`))}
              aria-label={`Dismiss: ${note.text}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
