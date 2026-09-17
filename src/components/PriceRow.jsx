import { MARKETS, priceFor, formatPrice, purchaseUri } from '../lib/prices.js'

/**
 * The three market prices under a card.
 *
 * Every market is shown even when it has no price, because a row that changes
 * width per card makes a grid impossible to scan, and because "we don't have
 * this one" is itself worth seeing. A price nobody supplied renders as dashes,
 * never as zero.
 *
 * A price with a link becomes a link; one without stays text. The links are
 * Scryfall's own, referral tag intact — that is how Scryfall is paid for the
 * data this whole app runs on.
 */
export default function PriceRow({ card, size = 'md', linked = true }) {
  if (!card) return null

  return (
    <div className={`prices prices--${size}`}>
      {MARKETS.map((market) => {
        const { value, basis } = priceFor(card, market.id)
        const uri = linked ? purchaseUri(card, market.id) : null
        const text = formatPrice(value, market.id)
        // A foil or etched price is a different card from the one they asked
        // about, so say which rather than passing it off as the normal price.
        const title = value === null
          ? `${market.source} has no price for this printing`
          : `${market.source}${basis === 'normal' ? '' : ` — ${basis} only`}`

        const body = (
          <>
            <span className="prices__label">{market.label}</span>
            <span className={`prices__value ${value === null ? 'prices__value--none' : ''}`}>
              {text}
              {basis !== 'normal' && value !== null && (
                <span className="prices__basis" aria-hidden="true">{basis === 'foil' ? '✦' : '◈'}</span>
              )}
            </span>
          </>
        )

        return uri
          ? (
            <a
              key={market.id}
              className="prices__cell prices__cell--link"
              href={uri}
              target="_blank"
              rel="noopener noreferrer"
              title={`${title} — opens ${market.source}`}
            >
              {body}
            </a>
          )
          : <span key={market.id} className="prices__cell" title={title}>{body}</span>
      })}
    </div>
  )
}
