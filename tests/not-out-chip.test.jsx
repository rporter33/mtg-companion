import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NotOutChip from '../src/components/NotOutChip.jsx'
import PriceRow from '../src/components/PriceRow.jsx'

/**
 * The label for a printing that is not out, and the price title beside it.
 * Every render here is given the day, so the suite reads the same after the
 * cards in it are released as it does before.
 */

// The Island a bare name resolved to on 2026-09-21: previewed, every price null.
const TRK_ISLAND = {
  id: 'trk-319', name: 'Island', set: 'trk', collector_number: '319', released_at: '2026-11-13',
  prices: { usd: null, usd_foil: null, eur: null, tix: null },
}
const HOB_ISLAND = { ...TRK_ISLAND, id: 'hob-195', set: 'hob', collector_number: '195', released_at: '2026-08-14' }

const chip = (card, now) => renderToStaticMarkup(<NotOutChip card={card} now={now} />)
const titles = (card, now) => [...renderToStaticMarkup(<PriceRow card={card} now={now} linked={false} />)
  .matchAll(/title="([^"]*)"/g)].map((m) => m[1])

describe('NotOutChip', () => {
  it('says in words when a printing is out, and where the date comes from', () => {
    const html = chip(TRK_ISLAND, '2026-09-21')
    expect(html).toContain('Not out until 13 Nov 2026')
    expect(html).toContain('title="Release date from Scryfall"')
  })

  it('renders nothing for a printing that is out, from its release day on', () => {
    expect(chip(HOB_ISLAND, '2026-09-21')).toBe('')
    expect(chip(TRK_ISLAND, '2026-11-13')).toBe('')
  })

  it('renders nothing for a card an older build stored without a date, or no card', () => {
    expect(chip({ id: 'x', name: 'Island' }, '2026-09-21')).toBe('')
    expect(chip(null, '2026-09-21')).toBe('')
  })

  it('short, says "not out yet" and keeps the date in its title', () => {
    const html = renderToStaticMarkup(<NotOutChip card={TRK_ISLAND} now="2026-09-21" short className="tiny" />)
    expect(html).toContain('>not out yet<')
    expect(html).toContain('title="Not out until 13 Nov 2026 (release date from Scryfall)"')
    expect(html).toContain('class="chip chip--warn not-out tiny"')
    expect(renderToStaticMarkup(<NotOutChip card={TRK_ISLAND} now="2026-11-13" short />)).toBe('')
  })
})

describe('PriceRow for a printing that is not out', () => {
  it('titles a missing price with the release date rather than blaming the market', () => {
    expect(titles(TRK_ISLAND, '2026-09-21')).toEqual(Array(3).fill('No price yet: not out until 13 Nov 2026'))
  })

  it('keeps the market wording for a printing that is out, and for a real price', () => {
    expect(titles(HOB_ISLAND, '2026-09-21')).toEqual([
      'TCGplayer has no price for this printing',
      'Cardmarket has no price for this printing',
      'Cardhoarder has no price for this printing',
    ])
    const preorder = { ...TRK_ISLAND, prices: { ...TRK_ISLAND.prices, usd: '0.25' } }
    expect(titles(preorder, '2026-09-21')[0]).toBe('TCGplayer')
  })
})
