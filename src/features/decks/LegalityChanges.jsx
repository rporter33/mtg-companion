import { useState } from 'react'
import { checkedAgainst } from '../../lib/snapshot.js'

/**
 * The launch banner for rules changes that touched the user's own decks.
 *
 * Collapsed by default to a single sentence, because the headline ("something
 * you own is no longer playable") is the part that has to land; the specifics
 * matter only once you have decided to care. `dataFrom` is when the oldest
 * card data it compared was fetched, which the details give as a date.
 */
export default function LegalityChanges({ report, summary, dataFrom, onDismiss, onOpenDeck }) {
  const [open, setOpen] = useState(false)
  if (!summary) return null

  const hasBad = report.some((entry) => entry.changes.some((c) => c.severity === 'error'))

  return (
    <div className={`banner banner--${hasBad ? 'error' : 'info'} stack stack--snug`}>
      <div className="row">
        <strong className="grow">{summary}</strong>
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Details'}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>

      {open && (
        <div className="stack stack--mid">
          {report.map((entry) => (
            <div key={entry.deckId}>
              <button className="btn btn--sm btn--ghost" onClick={() => onOpenDeck?.(entry.deckId)}>
                {entry.deckName} →
              </button>
              <ul className="violation-list" style={{ marginTop: 'var(--space-1)' }}>
                {entry.changes.map((change, i) => (
                  <li key={i}>
                    {change.message}
                    {change.severity === 'good' && <span className="chip chip--ok tiny" style={{ marginLeft: 6 }}>good news</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="faint tiny m0">
            {checkedAgainst(dataFrom)} You will only be told once per change.
          </p>
        </div>
      )}
    </div>
  )
}
