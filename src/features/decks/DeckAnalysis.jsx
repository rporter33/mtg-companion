import { useMemo } from 'react'
import { analyzeDeck, CURVE_BUCKETS } from '../../lib/analysis.js'
import { percent } from '../../lib/probability.js'
import { COLOR_NAMES } from '../../lib/mana.js'
import Term from '../../components/Term.jsx'

const COLOR_VAR = { W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)' }

export default function DeckAnalysis({ deck, lookup, cardCount }) {
  const analysis = useMemo(() => analyzeDeck(deck, lookup), [deck, cardCount])

  if (analysis.size === 0) {
    return <div className="empty"><h3>Nothing to analyse yet</h3><p>Add some cards first.</p></div>
  }

  return (
    <div className="stack">
      <Curve curve={analysis.curve} />
      <Colors colors={analysis.colors} />
      <Lands lands={analysis.lands} />
      <Odds odds={analysis.odds} />
      <Types types={analysis.types} size={analysis.size} />
      <Price price={analysis.price} priciest={analysis.priciest} />
    </div>
  )
}

function Curve({ curve }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2><Term id="curve">Mana curve</Term></h2>
        <span className="faint">avg {curve.averageManaValue.toFixed(2)}</span>
      </div>
      <div className="curve">
        {CURVE_BUCKETS.map((bucket) => {
          const count = curve.buckets[bucket]
          const height = curve.peak ? (count / curve.peak) * 100 : 0
          return (
            <div className="curve__col" key={bucket}>
              <div className="curve__bar-track">
                <div
                  className="curve__bar"
                  style={{ height: `${Math.max(height, count ? 4 : 0)}%` }}
                  title={`${count} card${count === 1 ? '' : 's'} at mana value ${bucket}${bucket === 7 ? '+' : ''}`}
                />
              </div>
              <span className="curve__count mono">{count || ''}</span>
              <span className="curve__label">{bucket}{bucket === 7 ? '+' : ''}</span>
            </div>
          )
        })}
      </div>
      <p className="faint tiny mt2 m0">
        Lands are excluded — they are all mana value zero and would swamp the chart.
      </p>
    </section>
  )
}

function Colors({ colors }) {
  if (!colors.length) {
    return (
      <section className="panel">
        <div className="section-title"><h2>Colour requirements</h2></div>
        <p className="faint m0">This deck is entirely colourless.</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="section-title"><h2>Colour requirements</h2></div>
      <div className="stack stack--mid">
        {colors.map((row) => (
          <div key={row.color}>
            <div className="row tiny">
              <span className="dot" style={{ background: COLOR_VAR[row.color] }} />
              <strong>{COLOR_NAMES[row.color]}</strong>
              <span className="faint">{row.pips} pip{row.pips === 1 ? '' : 's'}</span>
              <span className="spacer" />
              <span className={row.healthy ? 'chip chip--ok' : 'chip chip--warn'}>
                {row.sources} / {row.needed} sources
              </span>
            </div>
            <div className="meter" style={{ marginTop: 6 }}>
              <div
                className="meter__fill"
                style={{
                  width: `${Math.min(100, (row.sources / Math.max(row.needed, 1)) * 100)}%`,
                  background: COLOR_VAR[row.color],
                }}
              />
            </div>
            {!row.healthy && (
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                You want this colour by turn {row.earliestTurn}. Add {row.shortfall} more
                {' '}{COLOR_NAMES[row.color].toLowerCase()} source{row.shortfall === 1 ? '' : 's'} to
                cast those spells on time nine games in ten.
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="faint tiny" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
        &ldquo;Needed&rdquo; is solved from this deck&rsquo;s actual size rather than taken from a
        published table, so a 100-card deck is judged as a 100-card deck.
      </p>
    </section>
  )
}

function Lands({ lands }) {
  const tone = Math.abs(lands.delta) <= 2 ? 'ok' : 'warn'
  return (
    <section className="panel">
      <div className="section-title"><h2>Mana base</h2></div>
      <div className="row row--wrap">
        <span className="chip"><Term id="land">Lands</Term>: {lands.landCount}</span>
        {lands.nonLandSources > 0 && <span className="chip"><Term id="ramp">Other sources</Term>: {lands.nonLandSources}</span>}
        <span className={`chip chip--${tone}`}>Recommended: {lands.recommended} sources</span>
      </div>
      <p className="muted tiny" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
        {lands.delta === 0 && 'Right on target for this curve.'}
        {lands.delta > 0 && `${lands.delta} more source${lands.delta === 1 ? '' : 's'} than a deck at this curve usually needs. Not wrong — just worth knowing.`}
        {lands.delta < 0 && `${-lands.delta} short of what a deck at this curve usually wants. Expect some slow starts.`}
        {' '}Target is at least two sources in your opening seven, which is the objective that
        reproduces the land counts real decks actually run.
      </p>
    </section>
  )
}

function Odds({ odds }) {
  return (
    <section className="panel">
      <div className="section-title"><h2>Draw odds</h2></div>
      <table className="odds">
        <thead>
          <tr><th>By turn</th><th>On the play</th><th>On the draw</th></tr>
        </thead>
        <tbody>
          {odds.rows.map((row) => (
            <tr key={row.turn}>
              <td>{row.turn} land{row.turn === 1 ? '' : 's'} by turn {row.turn}</td>
              <td className="mono">{percent(row.onPlay, 0)}</td>
              <td className="mono">{percent(row.onDraw, 0)}</td>
            </tr>
          ))}
          <tr>
            <td>Opening hand with no lands</td>
            <td className="mono" colSpan={2}>{percent(odds.noLandHand, 1)}</td>
          </tr>
          <tr>
            <td>Opening hand that is all lands</td>
            <td className="mono" colSpan={2}>{percent(odds.allLandHand, 1)}</td>
          </tr>
        </tbody>
      </table>
      <p className="faint tiny mt2 m0">
        Both no-land hands are <Term id="mulligan">mulligans</Term>. If either number looks
        high, that is the land count telling you something.
      </p>
    </section>
  )
}

function Types({ types, size }) {
  const rows = Object.entries(types).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return (
    <section className="panel">
      <div className="section-title"><h2>Card types</h2></div>
      <div className="stack stack--snug">
        {rows.map(([type, count]) => (
          <div key={type}>
            <div className="row tiny">
              <span className="grow">{type}</span>
              <span className="mono faint">{count} · {Math.round((count / size) * 100)}%</span>
            </div>
            <div className="meter" style={{ marginTop: 4 }}>
              <div className="meter__fill" style={{ width: `${(count / size) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Price({ price, priciest }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>Price</h2>
        <span className="faint mono">${price.total.toFixed(2)}</span>
      </div>
      {price.missing > 0 && (
        <p className="faint tiny">
          {price.missing} card{price.missing === 1 ? ' has' : 's have'} no price data and
          {price.missing === 1 ? ' is' : ' are'} not counted — the real total is higher.
        </p>
      )}
      {price.foilOnly > 0 && (
        <p className="faint tiny">
          {price.foilOnly} card{price.foilOnly === 1 ? '' : 's'} exist only in foil, so
          {price.foilOnly === 1 ? ' its' : ' their'} foil price is used. A nonfoil printing,
          if one appears later, will be cheaper.
        </p>
      )}
      {priciest.length > 0 && (
        <div className="stack" style={{ gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
          {priciest.map(({ card, quantity, total, foil }) => (
            <div className="row tiny" key={card.id}>
              <span className="grow">
                {quantity > 1 && `${quantity}× `}{card.name}
                {foil && <span className="faint"> · foil only</span>}
              </span>
              <span className="mono faint">${total.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="faint tiny" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
        Scryfall aggregates prices daily from market listings. Cheapest printing is not
        necessarily the one shown here.
      </p>
    </section>
  )
}
