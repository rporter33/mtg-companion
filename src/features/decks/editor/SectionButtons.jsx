/**
 * The cascade: one button per section, pinned under the search.
 *
 * Tap a section and it opens alone; tap it again and the whole deck is
 * back. Each button carries the section's count, a dot when a card in it
 * failed the legality check, and how many of its cards are still to buy,
 * so a folded section can never hide a problem or a shopping list. While a
 * search is typed the accordion pauses: every section with a match is
 * open, the buttons count matches, a button with none is dimmed, and a
 * tap scrolls to the section instead.
 */
export default function SectionButtons({ items, open, searching, onPick, onJump }) {
  return (
    <div className="deck-sections" role="group" aria-label="Sections">
      {items.map((s) => {
        const isOpen = open === null || open === s.name
        const dim = searching && s.shownCount === 0
        const spoken = [
          s.problems > 0 ? `${s.problems} problem${s.problems === 1 ? '' : 's'}` : '',
          s.need > 0 ? `${s.need} to get` : '',
        ].filter(Boolean).join(', ')
        return (
          <button
            key={s.name}
            type="button"
            className={[
              'deck-sections__btn',
              !searching && open === s.name ? 'deck-sections__btn--open' : '',
              dim ? 'deck-sections__btn--dim' : '',
            ].join(' ')}
            aria-expanded={searching ? undefined : isOpen}
            aria-disabled={dim || undefined}
            onClick={() => { if (dim) return; if (searching) onJump(s.name); else onPick(s.name) }}
          >
            <span className="deck-sections__name">{s.name}</span>
            {' '}
            <span className="deck-sections__count">
              {searching ? `${s.shownCount} of ${s.count}` : s.count}
              <span className="sr-only"> cards</span>
            </span>
            {s.problems > 0 && <i className="deck-sections__dot" aria-hidden="true" />}
            {s.need > 0 && <span className="deck-sections__need" aria-hidden="true">{s.need}</span>}
            {spoken && <span className="sr-only">, {spoken}</span>}
          </button>
        )
      })}
    </div>
  )
}
