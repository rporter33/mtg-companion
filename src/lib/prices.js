// Card prices.
//
// WHAT SCRYFALL ACTUALLY PROVIDES, AND WHAT IT DOES NOT
//
// Three markets, and only three: US dollars from TCGplayer, euros from
// Cardmarket, and MTGO tickets from Cardhoarder. Other deckbuilding sites show
// a fourth vendor; this app cannot, because the data is not in the API it uses,
// and a column of numbers labelled with a shop that did not supply them would
// be a lie that looks like a feature.
//
// Every figure is a daily aggregate of market data, not a live quote and not an
// offer. The card in front of you may sell for something else entirely.
//
// ABSENCE IS NOT ZERO. A printing with no price is common — new cards, promos,
// anything unreleased — and `Number(null)` is 0, so the absent case has to be
// tested before conversion or a $200 card reads as free. Unknown renders as
// dashes, never as a number.

const read = (card, key) => {
  const raw = card?.prices?.[key]
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export const MARKETS = [
  {
    id: 'usd',
    label: 'USD',
    source: 'TCGplayer',
    currency: 'USD',
    locale: 'en-US',
    keys: { normal: 'usd', foil: 'usd_foil', etched: 'usd_etched' },
    purchase: 'tcgplayer',
  },
  {
    id: 'eur',
    label: 'EUR',
    source: 'Cardmarket',
    currency: 'EUR',
    locale: 'de-DE',
    keys: { normal: 'eur', foil: 'eur_foil', etched: 'eur_etched' },
    purchase: 'cardmarket',
  },
  {
    id: 'tix',
    label: 'MTGO',
    source: 'Cardhoarder',
    currency: null, // Tickets are not money and must not be formatted as any.
    locale: 'en-US',
    keys: { normal: 'tix' },
    purchase: 'cardhoarder',
  },
]

export const getMarket = (id) => MARKETS.find((m) => m.id === id) ?? MARKETS[0]

/**
 * One card's price in one market.
 *
 * Falls back from normal to foil to etched, and says which it landed on. A foil
 * price is a different thing from the price of the card people meant, so it is
 * reported rather than folded in — an etched-only printing quoted as if it were
 * the normal one is how a deck total quietly drifts.
 */
export function priceFor(card, marketId = 'usd') {
  const market = getMarket(marketId)
  for (const basis of ['normal', 'foil', 'etched']) {
    const key = market.keys[basis]
    if (!key) continue
    const value = read(card, key)
    if (value !== null) return { value, basis, market }
  }
  return { value: null, basis: null, market }
}

const formatters = new Map()

function formatterFor(market) {
  if (!formatters.has(market.id)) {
    formatters.set(market.id, market.currency
      ? new Intl.NumberFormat(market.locale, {
        style: 'currency', currency: market.currency, minimumFractionDigits: 2,
      })
      : new Intl.NumberFormat(market.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  }
  return formatters.get(market.id)
}

const symbols = new Map()

/**
 * The currency symbol a market actually uses, asked of the formatter rather
 * than assumed. Hardcoding "$" put a dollar sign in front of the euro
 * placeholder, which is the sort of thing that only shows up on screen.
 */
function symbolFor(market) {
  if (!market.currency) return ''
  if (!symbols.has(market.id)) {
    const part = formatterFor(market).formatToParts(0).find((p) => p.type === 'currency')
    symbols.set(market.id, part?.value ?? '')
  }
  return symbols.get(market.id)
}

/**
 * A price as text, with a placeholder when there is none.
 *
 * Dashes rather than "0.00" or an empty cell: one of those claims the card is
 * free and the other looks like a rendering bug.
 */
export function formatPrice(value, marketId = 'usd') {
  const market = getMarket(marketId)
  if (value === null || value === undefined) {
    const symbol = symbolFor(market)
    // Euros trail their symbol in the locales that use them, and a placeholder
    // that sits on the wrong side of the number reads as a different currency.
    return symbol ? (market.locale === 'en-US' ? `${symbol}----` : `---- ${symbol}`) : '----'
  }
  const text = formatterFor(market).format(value)
  return market.currency ? text : `${text} tix`
}

/** Convenience: a card's price already formatted. */
export function priceLabel(card, marketId = 'usd') {
  return formatPrice(priceFor(card, marketId).value, marketId)
}

/**
 * Adds up a list of {card, quantity}.
 *
 * Reports what it could not price instead of dropping it. A total that silently
 * skips nine unpriced cards is not an estimate, it is a wrong number with a
 * confident label.
 */
export function totalFor(resolved, marketId = 'usd') {
  let total = 0
  let priced = 0
  let missing = 0
  let substituted = 0

  for (const { card, quantity = 1 } of resolved ?? []) {
    const { value, basis } = priceFor(card, marketId)
    if (value === null) {
      missing += quantity
      continue
    }
    total += value * quantity
    priced += quantity
    if (basis !== 'normal') substituted += quantity
  }

  return { total, priced, missing, substituted, marketId }
}

/** The most expensive cards first, for "where is the money going". */
export function costliest(resolved, marketId = 'usd', limit = 5) {
  return (resolved ?? [])
    .map((entry) => ({ ...entry, price: priceFor(entry.card, marketId).value }))
    .filter((entry) => entry.price !== null)
    .sort((a, b) => (b.price * b.quantity) - (a.price * a.quantity))
    .slice(0, limit)
}

/**
 * Where to buy one.
 *
 * Scryfall supplies these per printing and they carry its referral tags, which
 * is how Scryfall is funded. They are passed through untouched rather than
 * rebuilt, because rebuilding them would strip that.
 */
export function purchaseUri(card, marketId = 'usd') {
  return card?.purchase_uris?.[getMarket(marketId).purchase] ?? null
}
