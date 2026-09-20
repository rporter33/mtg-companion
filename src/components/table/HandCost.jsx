import ManaCost from '../ManaCost.jsx'
import { withinReach } from '../../lib/board/mana.js'
/**
 * A card's cost, floating above it in hand.
 *
 * Borrowed from Moxgate, and the best small idea in their hand: you read what
 * a card costs without reading the card, so a fanned hand of seven is legible
 * at a glance rather than seven things to squint at.
 *
 * The reach hint is ours and is weaker than theirs by design. Theirs knows
 * what you can cast; this compares two numbers and is wrong about cost
 * reduction, alternative costs and anything that taps for more than one — so
 * it only ever dims a cost, never forbids a play, and says what it ignores.
 */
export default function HandCost({ card, pool }) {
  const cost = card?.mana_cost ?? card?.card_faces?.[0]?.mana_cost ?? ''
  if (!cost) return null
  const reach = withinReach(card, pool)
  return (
    <span
      className={`tabletop__cost${reach === 'no' ? ' tabletop__cost--far' : ''}`}
      title={reach === 'no'
        ? 'More than your untapped sources, counted one per card. It does not read conditions or cost reductions.'
        : undefined}
    >
      <ManaCost cost={cost} />
    </span>
  )
}

