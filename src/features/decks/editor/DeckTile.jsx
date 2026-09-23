import Stepper from '../../../components/Stepper.jsx'
import { memo } from 'react'
import CardImage from '../../../components/CardImage.jsx'
import PriceRow from '../../../components/PriceRow.jsx'
import DeckArt from '../../../components/DeckArt.jsx'
import NotOutChip from '../../../components/NotOutChip.jsx'
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
  art = null, marked = false, stampedName = null,
}) {
  const onOpen = () => card && onOpenCard(card)
  const onSet = (n) => act('set', cardId, zone, n)
  const onRemove = () => act('remove', cardId, zone, isCommander)
  if (!card) {
    // No painting to show, but the name the deck stamped where there is one
    // (see stampNames), so the tile is still a card in the deck and not a gap.
    return (
      <div className="deck-tile deck-tile--missing">
        {/* The name is the one thing on this tile worth reading, so it is given
            the row's treatment rather than the faintest text token (see
            decks.css). `mono` stays on the truncated id, which is code; the
            words "not loaded" are not. */}
        <span className="deck-tile__name tiny">{stampedName ?? 'Card not loaded'}</span>
        <span className="faint tiny">{stampedName ? 'not loaded' : <span className="mono">{`${cardId.slice(0, 8)}…`}</span>}</span>
        <button
          className="btn btn--sm btn--ghost btn--danger"
          onClick={onRemove}
          aria-label={stampedName ? `Remove ${stampedName}` : 'Remove unloaded card'}
        >
          Remove
        </button>
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
      {/* Last, off the image, so the prices and controls of neighbouring
          tiles still line up across the grid. */}
      <NotOutChip card={card} />
    </div>
  )
})

export default DeckTile
