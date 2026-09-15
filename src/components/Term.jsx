import { useState } from 'react'
import { lookupTerm } from '../data/glossary.js'
import Sheet from './Sheet.jsx'
import './term.css'

/**
 * Guide layer three: any jargon anywhere in the app is tappable.
 *
 * Deliberately styled as a dotted underline rather than a link — it should read
 * as "there is more here if you want it", not as navigation that takes you away
 * from what you were doing.
 */
export default function Term({ id, children, as: Tag = 'button' }) {
  const [open, setOpen] = useState(false)
  const entry = lookupTerm(id)
  if (!entry) return <>{children ?? id}</>

  return (
    <>
      <Tag
        type="button"
        className="term"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        aria-label={`What is ${entry.term}?`}
      >
        {children ?? entry.term}
      </Tag>
      <Sheet open={open} onClose={() => setOpen(false)} title={entry.term}>
        <TermBody entry={entry} />
      </Sheet>
    </>
  )
}

export function TermBody({ entry }) {
  return (
    <div className="stack">
      <p className="term__short">{entry.short}</p>
      <p className="muted">{entry.long}</p>
      {entry.seeAlso?.length > 0 && (
        <div className="row row--wrap">
          <span className="faint">See also</span>
          {entry.seeAlso.map((key) => {
            const related = lookupTerm(key)
            return related ? <Term key={key} id={key} as="span" /> : null
          })}
        </div>
      )}
    </div>
  )
}
