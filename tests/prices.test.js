import { describe, it, expect } from 'vitest'
import {
  MARKETS, getMarket, priceFor, formatPrice, priceLabel, totalFor, costliest, purchaseUri,
} from '../src/lib/prices.js'

const card = (name, prices, extra = {}) => ({ name, prices, ...extra })

describe('what markets exist', () => {
  it('offers only the three Scryfall actually supplies', () => {
    expect(MARKETS.map((m) => m.id)).toEqual(['usd', 'eur', 'tix'])
  })

  it('falls back to dollars rather than throwing on an unknown market', () => {
    expect(getMarket('klingon-darsek').id).toBe('usd')
  })
})

describe('priceFor', () => {
  it('reads the plain price', () => {
    expect(priceFor(card('X', { usd: '7.49' }), 'usd')).toMatchObject({ value: 7.49, basis: 'normal' })
  })

  // Number(null) is 0, which is how a two-hundred-dollar card once read as free.
  it('treats an absent price as absent, not as zero', () => {
    for (const prices of [{ usd: null }, { usd: '' }, {}, undefined]) {
      expect(priceFor(card('X', prices), 'usd').value).toBeNull()
    }
  })

  it('falls back to foil and says so', () => {
    const result = priceFor(card('X', { usd: null, usd_foil: '199.00' }), 'usd')
    expect(result).toMatchObject({ value: 199, basis: 'foil' })
  })

  it('falls back to etched last', () => {
    const result = priceFor(card('X', { usd: null, usd_foil: null, usd_etched: '42.00' }), 'usd')
    expect(result).toMatchObject({ value: 42, basis: 'etched' })
  })

  it('never reports a foil price as if it were the normal one', () => {
    expect(priceFor(card('X', { usd: '1.00', usd_foil: '99.00' }), 'usd').basis).toBe('normal')
  })

  it('rejects a negative or unparseable price', () => {
    expect(priceFor(card('X', { usd: '-5' }), 'usd').value).toBeNull()
    expect(priceFor(card('X', { usd: 'free' }), 'usd').value).toBeNull()
  })

  it('reads euros and tickets from their own fields', () => {
    const c = card('X', { usd: '1.00', eur: '2.00', tix: '0.03' })
    expect(priceFor(c, 'eur').value).toBe(2)
    expect(priceFor(c, 'tix').value).toBe(0.03)
  })

  it('does not invent a foil ticket price', () => {
    expect(priceFor(card('X', { tix: null }), 'tix').value).toBeNull()
  })
})

describe('formatting', () => {
  it('formats each market in its own currency', () => {
    expect(formatPrice(7.49, 'usd')).toBe('$7.49')
    expect(formatPrice(7.17, 'eur')).toMatch(/7,17/)
  })

  it('does not dress tickets up as money', () => {
    expect(formatPrice(0.03, 'tix')).toBe('0.03 tix')
    expect(formatPrice(0.03, 'tix')).not.toMatch(/[$€]/)
  })

  // "$0.00" claims the card is free and an empty cell looks like a bug.
  it('shows dashes for a price it does not have', () => {
    expect(formatPrice(null, 'usd')).toBe('$----')
    expect(formatPrice(undefined, 'usd')).toBe('$----')
    expect(formatPrice(null, 'tix')).toBe('----')
  })

  // Caught on screen, not by a test: the euro placeholder rendered as "$----",
  // a dollar sign in front of a euro column.
  it('uses each market\'s own symbol in the placeholder', () => {
    expect(formatPrice(null, 'eur')).not.toMatch(/\$/)
    expect(formatPrice(null, 'eur')).toMatch(/€/)
  })

  it('puts the placeholder symbol where that locale puts it', () => {
    // Dollars lead, euros trail, and a placeholder on the wrong side reads as
    // a different currency entirely.
    expect(formatPrice(null, 'usd')).toMatch(/^\$/)
    expect(formatPrice(null, 'eur')).toMatch(/€$/)
    expect(formatPrice(1, 'usd').indexOf('$')).toBe(formatPrice(null, 'usd').indexOf('$'))
  })

  it('still prints an actual zero', () => {
    expect(formatPrice(0, 'usd')).toBe('$0.00')
  })

  it('labels a card straight from its data', () => {
    expect(priceLabel(card('X', { usd: '3.00' }), 'usd')).toBe('$3.00')
    expect(priceLabel(card('X', {}), 'usd')).toBe('$----')
  })
})

describe('totalFor', () => {
  const resolved = [
    { card: card('A', { usd: '10.00' }), quantity: 2 },
    { card: card('B', { usd: null, usd_foil: '5.00' }), quantity: 1 },
    { card: card('C', {}), quantity: 3 },
  ]

  it('multiplies by quantity', () => {
    expect(totalFor(resolved, 'usd').total).toBe(25)
  })

  // A total that silently skips what it could not price is a wrong number with
  // a confident label.
  it('reports what it could not price rather than dropping it', () => {
    expect(totalFor(resolved, 'usd')).toMatchObject({ priced: 3, missing: 3, substituted: 1 })
  })

  it('handles an empty or absent list', () => {
    expect(totalFor([], 'usd').total).toBe(0)
    expect(totalFor(undefined, 'usd')).toMatchObject({ total: 0, missing: 0 })
  })

  it('defaults a missing quantity to one', () => {
    expect(totalFor([{ card: card('A', { usd: '4.00' }) }], 'usd').total).toBe(4)
  })
})

describe('costliest', () => {
  it('ranks by total spend, not unit price', () => {
    const list = [
      { card: card('Single', { usd: '30.00' }), quantity: 1 },
      { card: card('Playset', { usd: '10.00' }), quantity: 4 },
    ]
    expect(costliest(list, 'usd', 1).map((e) => e.card.name)).toEqual(['Playset'])
  })

  it('leaves out what it cannot price', () => {
    expect(costliest([{ card: card('A', {}), quantity: 1 }], 'usd')).toEqual([])
  })
})

describe('purchaseUri', () => {
  it('passes Scryfall\'s own link through untouched, referral tag and all', () => {
    const c = card('X', {}, { purchase_uris: { tcgplayer: 'https://tcg?ref=scryfall' } })
    expect(purchaseUri(c, 'usd')).toBe('https://tcg?ref=scryfall')
  })

  it('is null when there is no link for that market', () => {
    expect(purchaseUri(card('X', {}), 'eur')).toBeNull()
    expect(purchaseUri(null, 'usd')).toBeNull()
  })
})
