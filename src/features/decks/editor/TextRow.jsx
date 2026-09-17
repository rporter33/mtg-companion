import { memo } from 'react'
import ManaCost from '../../../components/ManaCost.jsx'
import { identityAttr } from '../../../components/CardFace.jsx'

/**
 * One line in the text view: quantity, name, cost. Nothing else, so a hundred
 * cards fit on a screen the way a printed decklist does.
 *
 * Pointing at the name shows the card in the panel beside the list; so does
 * keyboard focus, which is the same information for someone tabbing through.
 * Pressing the name opens the card sheet as everywhere else — on a phone,
 * where nothing hovers and the panel is not shown, that is the whole
 * interaction. The stepper is there but quiet until the row is pointed at or
 * focused, because this view is for reading a deck, not counting it.
 */
const TextRow = memo(function TextRow({
  card, cardId, quantity, zone, isCommander, flagged, previewed, act, onPreview, onOpenCard,
}) {
  const onOpen = () => card && onOpenCard(card)
  const onSet = (n) => act('set', cardId, zone, n)
  const onRemove = () => act('remove', cardId, zone, isCommander)
  const show = () => onPreview(cardId)
  if (!card) {
    return (
      <div className="text-row text-row--missing">
        <span className="text-row__qty">{quantity}</span>
        <span className="text-row__name faint">Card not loaded</span>
        <button className="text-row__step" onClick={onRemove} aria-label="Remove unloaded card">✕</button>
      </div>
    )
  }
  return (
    <div
      className={`text-row ${flagged ? 'text-row--flagged' : ''} ${previewed ? 'text-row--previewed' : ''}`}
      data-identity={identityAttr(card)}
      onPointerEnter={show}
    >
      <span className={`text-row__qty ${isCommander ? 'text-row__qty--commander' : ''}`} title={isCommander ? 'Commander' : undefined}>
        {isCommander ? '★' : quantity}
      </span>
      <button className="text-row__name" onClick={onOpen} onFocus={show}>{card.name}</button>
      <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
      {!isCommander && (
        <span className="text-row__edit">
          <button className="text-row__step" onClick={() => onSet(quantity - 1)} aria-label={`One fewer ${card.name}`}>−</button>
          <button className="text-row__step" onClick={() => onSet(quantity + 1)} aria-label={`One more ${card.name}`}>+</button>
        </span>
      )}
    </div>
  )
})

export default TextRow
