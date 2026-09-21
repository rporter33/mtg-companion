import { notOutUntil, notOutText } from '../lib/release.js'
import './card.css'

/**
 * "Not out until 13 Nov 2026", beside a printing Scryfall lists ahead of its
 * release; nothing at all beside one that is out.
 *
 * Scryfall carries a set's cards from the day they are previewed, so a search
 * result, a printing or a card in a deck can be one nobody can hold yet, and
 * without this nothing on screen says so. It is a label and never a gate: the
 * card still opens, adds and stays in the deck. The words carry the meaning,
 * so it reads the same without its colour. It goes beside a card image and
 * never on one, because the image is Scryfall's and the app does not draw
 * over it. The date is checked each time it renders, so on release day the
 * label simply stops appearing.
 *
 * `short` is for a row whose card already shows the full label nearby, such
 * as each deck in AddToDeck: it reads "not out yet" in the idiom of the chips
 * around it, and the date moves to its title rather than repeating per row.
 */
export default function NotOutChip({ card, now, short = false, className = '' }) {
  const date = notOutUntil(card, now)
  if (!date) return null
  return (
    <span
      className={`chip chip--warn not-out ${className}`.trim()}
      title={short ? `${notOutText(date)} (release date from Scryfall)` : 'Release date from Scryfall'}
    >
      {short ? 'not out yet' : notOutText(date)}
    </span>
  )
}
