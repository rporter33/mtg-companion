import { useState } from 'react'

/**
 * Moves one card to another section, or to a new one.
 *
 * Rendered as a button until it is tapped. A <select> with nine options on
 * each of a hundred rows was nine hundred DOM nodes that nobody was looking
 * at; changing a section is rare next to reading the list.
 */
export default function CategoryPicker({ card, section, sections, onCategory }) {
  const NEW = '\u0000new'
  const [open, setOpen] = useState(false)
  const options = [...new Set([section, ...sections])].filter(Boolean)

  if (!open) {
    return (
      <button
        className="deck-row__category deck-row__category--closed"
        onClick={() => setOpen(true)}
        aria-label={`Section for ${card.name}: ${section}. Change`}
      >
        {section}
      </button>
    )
  }

  return (
    <select
      autoFocus
      onBlur={() => setOpen(false)}
      className="deck-row__category"
      value={section}
      aria-label={`Section for ${card.name}`}
      onChange={(e) => {
        setOpen(false)
        if (e.target.value !== NEW) return onCategory(e.target.value)
        // eslint-disable-next-line no-alert
        const typed = window.prompt(`Move ${card.name} to which section?`, section)
        if (typed?.trim()) onCategory(typed.trim())
      }}
    >
      {options.map((name) => <option key={name} value={name}>{name}</option>)}
      <option value={NEW}>New section…</option>
    </select>
  )
}
