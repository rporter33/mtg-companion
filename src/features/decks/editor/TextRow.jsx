import Stepper from '../../../components/Stepper.jsx'
import { memo } from 'react'
import ManaCost from '../../../components/ManaCost.jsx'
import NotOutChip from '../../../components/NotOutChip.jsx'
import { identityAttr } from '../../../components/CardFace.jsx'
import { notOutUntil } from '../../../lib/release.js'

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
  card, cardId, quantity, zone, isCommander, flagged, previewed, act, onPreview, onOpenCard, marked = false,
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
  const name = <button className="text-row__name" onClick={onOpen} onFocus={show}>{card.name}</button>
  return (
    <div
      className={`text-row ${flagged ? 'text-row--flagged' : ''} ${previewed ? 'text-row--previewed' : ''} ${marked ? 'text-row--arrived' : ''}`}
      data-identity={identityAttr(card)}
      onPointerEnter={show}
    >
      <span className={`text-row__qty ${isCommander ? 'text-row__qty--commander' : ''}`} title={isCommander ? 'Commander' : undefined}>
        {isCommander ? '★' : quantity}
      </span>
      {notOutUntil(card) ? (
        // Under the name, not beside it: a column is narrow enough that the
        // chip beside the name cut "Island" to "I…".
        <span className="text-row__what">
          {name}
          <NotOutChip card={card} />
        </span>
      ) : name}
      <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
      {!isCommander && (
        <Stepper compact value={quantity} name={card.name} onChange={onSet} className="text-row__edit" />
      )}
    </div>
  )
})

export default TextRow
