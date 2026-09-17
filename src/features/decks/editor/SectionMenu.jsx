import { useState } from 'react'

/**
 * Rename, reorder or dissolve a section.
 *
 * A derived section can be renamed too — that is what turns it into one the
 * player owns. "Dissolve" only appears for sections somebody made, because
 * there is nothing to dissolve about being a creature.
 */
export default function SectionMenu({ name, chosen, onRename, onMove, onDissolve }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(name)

  if (!open) {
    return (
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => { setDraft(name); setOpen(true) }}
        aria-label={`Edit the ${name} section`}
      >
        ⋯
      </button>
    )
  }

  const commit = () => { onRename(draft); setOpen(false) }

  return (
    <div className="row section-menu">
      <input
        className="input input--sm"
        value={draft}
        autoFocus
        aria-label={`Rename ${name}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <button className="btn btn--sm" onClick={commit}>Rename</button>
      <button className="btn btn--sm btn--ghost" onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>↑</button>
      <button className="btn btn--sm btn--ghost" onClick={() => onMove(1)} aria-label={`Move ${name} down`}>↓</button>
      {chosen && (
        <button className="btn btn--sm btn--ghost" onClick={onDissolve} title="Put these cards back under their card type">
          Dissolve
        </button>
      )}
      <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>Done</button>
    </div>
  )
}
