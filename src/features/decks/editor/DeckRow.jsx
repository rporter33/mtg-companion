import Stepper from '../../../components/Stepper.jsx'
import { memo } from 'react'
import ManaCost from '../../../components/ManaCost.jsx'
import DeckArt from '../../../components/DeckArt.jsx'
import { identityAttr } from '../../../components/CardFace.jsx'
import { priceLabel } from '../../../lib/prices.js'
import CategoryPicker from './CategoryPicker.jsx'

const DeckRow = memo(function DeckRow({
  card, cardId, quantity, isCommander, flagged, market, owned = 0, zone, section, sections,
  act, onOpenCard, onPrinting = null, art = null, marked = false,
}) {
  const onOpen = () => card && onOpenCard(card)
  const onSet = (n) => act('set', cardId, zone, n)
  const onRemove = () => act('remove', cardId, zone, isCommander)
  const onCategory = (to) => act('category', cardId, zone, to)
  if (!card) {
    return (
      <div className="deck-row deck-row--missing">
        <span className="deck-row__qty">{quantity}</span>
        <span className="deck-row__name faint">Card not loaded ({cardId.slice(0, 8)}…)</span>
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove}>✕</button>
      </div>
    )
  }

  return (
    <div
      className={`deck-row ${flagged ? 'deck-row--flagged' : ''} ${art ? 'deck-row--art' : ''} ${marked ? 'deck-row--arrived' : ''}`}
      data-identity={identityAttr(card)}
    >
      {art && <DeckArt src={art} cardId={card.id} className="deck-art--row" />}
      {isCommander
        ? <span className="deck-row__qty deck-row__qty--commander" title="Commander">★</span>
        : <Stepper value={quantity} name={card.name} onChange={onSet} />}

      <button className="deck-row__name" onClick={onOpen}>{card.name}</button>
      <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
      <span className="deck-row__price faint tiny">{priceLabel(card, market)}</span>
      {owned < quantity && (
        <span className="deck-row__need tiny" title={`You have ${owned} of ${quantity}`}>
          need {quantity - owned}
        </span>
      )}
      {!isCommander && zone !== 'sideboard' && (
        <CategoryPicker card={card} section={section} sections={sections} onCategory={onCategory} />
      )}
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
      <button
        className="btn btn--sm btn--ghost btn--danger deck-row__remove"
        onClick={onRemove}
        aria-label={`Remove ${card.name}`}
      >
        ✕
      </button>
    </div>
  )
})

export default DeckRow
