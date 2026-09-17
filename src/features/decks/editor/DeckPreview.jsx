import CardImage from '../../../components/CardImage.jsx'
import PriceRow from '../../../components/PriceRow.jsx'
import { priceLabel } from '../../../lib/prices.js'

/**
 * The card the text view is pointing at, shown large with its prices.
 *
 * Pinned beside the list on a wide screen and absent on a narrow or touch
 * one, where there is no pointer to follow and the card sheet already does
 * this on a tap. It is a live region so a screen reader hears the name
 * change as focus moves down the list.
 */
export default function DeckPreview({ card, market, owned, onOpenCard }) {
  return (
    <aside className="deck-preview" aria-live="polite" aria-label="Card under the pointer">
      {card ? (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <CardImage card={card} size="normal" onClick={() => onOpenCard(card)} />
          <div>
            <div className="deck-preview__name">{card.name}</div>
            <div className="faint tiny">{card.type_line}</div>
          </div>
          <PriceRow card={card} size="sm" />
          <div className="faint tiny">
            {owned > 0 ? `You own ${owned}` : 'Not in your collection'}
            {' · '}{priceLabel(card, market)}
          </div>
        </div>
      ) : (
        <p className="faint tiny deck-preview__hint">
          Point at a card, or tab to one, to see it here.
        </p>
      )}
    </aside>
  )
}
