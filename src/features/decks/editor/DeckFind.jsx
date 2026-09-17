import Chip from '../../../components/Chip.jsx'

/**
 * The bar pinned above the deck list: find a card, narrow to what you still
 * need, and a hairline in the deck's colours underneath.
 *
 * It filters as you type because the deck is already in memory; the Add
 * cards search beside it waits for Enter because that one goes to Scryfall.
 * Escape empties the box and keeps focus, Enter puts focus on the first
 * match (which also drops the phone keyboard), and "/" anywhere on the
 * list brings focus here — that listener lives in DeckList, which owns the
 * list the key applies to.
 *
 * The status line is visually hidden and polite: a screen reader hears
 * "3 of 100 cards match" as the count changes without the sighted layout
 * gaining a line.
 */
export default function DeckFind({
  value, onChange, needOnly, onNeedOnly, status, identity = [], inputRef, onEnter, children = null,
}) {
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (value) { event.preventDefault(); event.stopPropagation(); onChange('') }
      return
    }
    if (event.key === 'Enter') { event.preventDefault(); onEnter?.() }
  }

  return (
    <div className={`deck-find ${children ? 'deck-find--sections' : ''}`} role="search">
      <div className="deck-find__row">
        <div className={`deck-find__field ${value ? 'deck-find__field--filled' : ''}`}>
          <svg className="deck-find__glass" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            className="deck-find__input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find in deck"
            aria-label="Find a card in this deck"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          {value && (
            <button
              type="button"
              className="deck-find__clear"
              aria-label="Clear"
              onClick={() => { onChange(''); inputRef?.current?.focus() }}
            >
              ✕
            </button>
          )}
        </div>
        <Chip
          pressed={needOnly}
          onClick={onNeedOnly}
          title="Only the cards missing from your collection"
        >
          Not owned
        </Chip>
      </div>
      {children}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</p>
      <span className="deck-find__identity" aria-hidden="true">
        {identity.length
          ? identity.map((c) => <i key={c} data-identity={c} />)
          : <i />}
      </span>
    </div>
  )
}
