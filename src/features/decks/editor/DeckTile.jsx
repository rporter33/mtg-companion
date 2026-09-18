import Stepper from '../../../components/Stepper.jsx'
import { memo } from 'react'
import CardImage from '../../../components/CardImage.jsx'
import PriceRow from '../../../components/PriceRow.jsx'
import DeckArt from '../../../components/DeckArt.jsx'
import { identityAttr } from '../../../components/CardFace.jsx'

/**
 * One card in the grid view.
 *
 * The quantity sits on the art, the way it does on a physical stack and on
 * every deckbuilding site, rather than in a column beside it. Controls stay
 * visible rather than appearing on hover — hover does not exist on the phone
 * this is mostly used on.
 */
const DeckTile = memo(function DeckTile({
  card, cardId, quantity, zone, market, owned = 0, isCommander, flagged, act, onOpenCard, onPrinting = null,
  art = null, marked = false,
}) {
  const onOpen = () => card && onOpenCard(card)
  const onSet = (n) => act('set', cardId, zone, n)
  const onRemove = () => act('remove', cardId, zone, isCommander)
  if (!card) {
    return (
      <div className="deck-tile deck-tile--missing">
        <span className="faint tiny">Card not loaded</span>
        <span className="faint tiny mono">{cardId.slice(0, 8)}…</span>
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove}>Remove</button>
      </div>
    )
  }

  return (
    <div className={`deck-tile ${flagged ? 'deck-tile--flagged' : ''} ${art ? 'deck-tile--backed' : ''} ${marked ? 'deck-tile--arrived' : ''}`} data-identity={identityAttr(card)}>
      {art && <DeckArt src={art} cardId={card.id} className="deck-art--tile" />}
      <div className="deck-tile__art">
        <CardImage card={card} size="normal" onClick={onOpen} />
        <span className={`deck-tile__qty ${isCommander ? 'deck-tile__qty--commander' : ''}`}>
          {isCommander ? '★' : quantity}
        </span>
        {owned < quantity && (
          <span className="deck-tile__need tiny" title={`You have ${owned} of ${quantity}`}>
            need {quantity - owned}
          </span>
        )}
      </div>

      <PriceRow card={card} size="sm" />

      <div className="deck-tile__controls">
        {isCommander ? (
          <span className="faint tiny">Commander</span>
        ) : (
          <Stepper value={quantity} name={card.name} onChange={onSet} />
        )}
        <span className="spacer" />
        {onPrinting && (
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => onPrinting(cardId)}
            aria-label={`Choose which printing of ${card.name} is in this deck`}
            title="Which printing"
          >
            ✦
          </button>
        )}
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove} aria-label={`Remove ${card.name}`}>✕</button>
      </div>
    </div>
  )
})

export default DeckTile
