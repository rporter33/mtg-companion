import ManaCost from '../ManaCost.jsx'

/**
 * What you have not tapped yet.
 *
 * Moxgate can print "available mana" as a number because its engine knows
 * what every card does. This one counts the untapped permanents Scryfall says
 * make mana, and shows the colours between them — a fact about the printings
 * rather than a claim about the rules.
 *
 * So it is labelled "untapped", not "available". A Sol Ring counts once, and
 * a land that only works while you control a Swamp counts at all: the wording
 * on screen has to carry that, because a number that looks exact and is not
 * is worse than no number.
 */
export default function Pool({ pool }) {
  if (!pool || !pool.count) return null
  const cost = pool.colours.map((colour) => `{${colour}}`).join('')

  return (
    <span
      className="pool"
      title="Untapped permanents Scryfall says make mana. One per card, and it cannot see conditions."
    >
      <span className="pool__label">Untapped</span>
      <span className="pool__count">{pool.count}</span>
      {cost && <ManaCost cost={cost} className="pool__pips" />}
      <span className="sr-only">
        {` — ${pool.count} untapped ${pool.count === 1 ? 'source' : 'sources'}`}
        {pool.colours.length ? `, between them ${pool.colours.join(', ')}` : ''}
        . Counted one per card, and conditions are not read.
      </span>
    </span>
  )
}
