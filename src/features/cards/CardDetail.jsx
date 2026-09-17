import { useEffect, useState } from 'react'
import Sheet from '../../components/Sheet.jsx'
import CardImage, { hasBackFace } from '../../components/CardImage.jsx'
import CardZoom from '../../components/CardZoom.jsx'
import ManaCost, { OracleText } from '../../components/ManaCost.jsx'
import Term from '../../components/Term.jsx'
import AddToDeck from '../decks/AddToDeck.jsx'
import ExplainCard from './ExplainCard.jsx'
import { getRulings, getPrintings } from '../../lib/scryfall.js'
import { FORMATS, FORMAT_IDS, typeLineOf, oracleTextOf } from '../../lib/formats.js'
import { describeColors } from '../../lib/mana.js'
import PriceRow from '../../components/PriceRow.jsx'
import { MARKETS, priceLabel } from '../../lib/prices.js'
import { getPrefs } from '../../lib/storage.js'
import { useCollection } from '../../lib/collection-store.js'
import { ownedOf, setOwned } from '../../lib/collection.js'

const STATUS_LABEL = {
  legal: 'Legal', banned: 'Banned', restricted: 'Restricted',
  not_legal: 'Not in pool', unknown: 'Unknown',
}

export default function CardDetail({ card, onClose, onOpenCard }) {
  return (
    <Sheet open={!!card} onClose={onClose} title={card?.name ?? ''} size="lg">
      {card && <CardDetailBody card={card} onOpenCard={onOpenCard} />}
    </Sheet>
  )
}

function CardDetailBody({ card, onOpenCard }) {
  const [face, setFace] = useState(0)
  // Explain leads, because the app is built for people who cannot yet read a
  // card. Legality is one tap away for anyone who already can.
  const [tab, setTab] = useState('explain')
  const [zoomed, setZoomed] = useState(false)

  // Reset when a different card is opened into the same sheet.
  useEffect(() => { setFace(0); setTab('explain'); setZoomed(false) }, [card.id])

  const activeFace = card.card_faces?.[face] ?? card
  const cost = activeFace.mana_cost ?? card.mana_cost ?? ''
  const text = activeFace.oracle_text ?? oracleTextOf(card)
  const type = activeFace.type_line ?? typeLineOf(card)

  return (
    <div className="stack">
      <div className="detail-layout">
        <div className="detail-layout__art stack">
          <CardImage
            card={card}
            size="normal"
            faceIndex={face}
            onClick={() => setZoomed(true)}
          />
          <button className="btn btn--sm" onClick={() => setZoomed(true)}>
            Zoom in
          </button>
          {hasBackFace(card) && (
            <button className="btn btn--sm" onClick={() => setFace(face === 0 ? 1 : 0)}>
              Flip to {card.card_faces[face === 0 ? 1 : 0].name}
            </button>
          )}
          <AddToDeck card={card} />
        </div>

        <div className="stack">
          <div>
            <div className="row">
              <h2 style={{ flex: 1 }}>{activeFace.name ?? card.name}</h2>
              <ManaCost cost={cost} />
            </div>
            <p className="muted tiny" style={{ marginTop: 4 }}>{type}</p>
          </div>

          {/* Tabs sit directly under the card rather than below every fact
              about it. Explain is the default and is what a new player needs
              first, so it must not be a scroll away on a phone. */}
          <nav className="row row--wrap" role="tablist">
            {[
              ['explain', 'Explain'],
              ['details', 'Details'],
              ['legality', 'Legality'],
              ['rulings', 'Rulings'],
              ['printings', 'Printings'],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`chip ${tab === id ? 'chip--active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {tab === 'explain' && <ExplainCard card={card} />}

      {tab === 'details' && (
        <div className="stack">
          <div className="panel">
            <OracleText text={text} />
            {(activeFace.power != null || activeFace.loyalty != null) && (
              <p className="mono" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
                {activeFace.power != null
                  ? `${activeFace.power}/${activeFace.toughness}`
                  : `Loyalty ${activeFace.loyalty}`}
              </p>
            )}
          </div>

          <dl className="facts">
            <Fact label="Mana value" value={card.cmc ?? 0} />
            <Fact label="Colour identity" value={describeColors(card.color_identity)} term="colorIdentity" />
            <Fact label="Rarity" value={card.rarity ? capitalise(card.rarity) : '—'} />
            <Fact
              label="Printing"
              value={card.set_name
                ? `${card.set_name}${card.collector_number ? ` · #${card.collector_number}` : ''}`
                : '—'}
            />
            {card.released_at && <Fact label="Released" value={card.released_at} />}
            {card.artist && <Fact label="Artist" value={card.artist} />}
            {card.keywords?.length > 0 && <Fact label="Keywords" value={card.keywords.join(', ')} />}
            {card.produced_mana?.length > 0 && (
              <Fact label="Produces" value={describeColors(card.produced_mana)} />
            )}
            {card.finishes?.length > 0 && (
              <Fact label="Finishes" value={card.finishes.map(capitalise).join(', ')} />
            )}
            {card.games?.length > 0 && (
              <Fact label="Playable in" value={card.games.map((g) => GAME_NAMES[g] ?? g).join(', ')} />
            )}
            {Number.isFinite(card.edhrec_rank) && (
              <Fact label="Commander rank" value={`#${card.edhrec_rank.toLocaleString()}`} />
            )}
            {card.reserved && <Fact label="Reserved list" value="Yes — never reprinted" />}
          </dl>

          <OwnedControl card={card} />

          <div className="panel stack">
            <h3>Prices</h3>
            <PriceRow card={card} />
            <p className="faint tiny" style={{ margin: 0 }}>
              {/* Naming the source matters: these are three different markets, not
                  three opinions about one. */}
              {MARKETS.map((m) => `${m.label} from ${m.source}`).join(' · ')}. Scryfall aggregates
              them once a day from listings — a guide, not a quote.
            </p>
          </div>
        </div>
      )}

      {tab === 'legality' && <Legality card={card} />}
      {tab === 'rulings' && <Rulings card={card} />}
      {tab === 'printings' && (
        <Printings card={card} onOpenCard={onOpenCard} market={getPrefs().market ?? 'usd'} />
      )}

      <CardZoom
        card={card}
        open={zoomed}
        initialFace={face}
        onClose={() => setZoomed(false)}
      />
    </div>
  )
}

function Fact({ label, value, term }) {
  return (
    <div className="fact">
      <dt>{term ? <Term id={term}>{label}</Term> : label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Legality({ card }) {
  return (
    <div className="stack">
      <div className="legality-grid">
        {FORMAT_IDS.map((id) => {
          const format = FORMATS[id]
          const status = card.legalities?.[format.legalityKey] ?? 'unknown'
          return (
            <div className={`legality legality--${status}`} key={id}>
              <span>{format.name}</span>
              <span className="legality__status">{STATUS_LABEL[status] ?? status}</span>
            </div>
          )
        })}
      </div>
      <p className="faint tiny">
        Straight from Scryfall, so this reflects the current ban lists rather than a copy
        baked into this app. <Term id="singleton">Singleton</Term> and deck-size rules are
        checked separately when you add a card to a deck.
      </p>
    </div>
  )
}

function Rulings({ card }) {
  const [rulings, setRulings] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRulings(null)
    setError(null)
    getRulings(card.id)
      .then((data) => { if (!cancelled) setRulings(data) })
      .catch((err) => { if (!cancelled) setError(err) })
    return () => { cancelled = true }
  }, [card.id])

  if (error) return <p className="faint">Rulings are unavailable offline.</p>
  if (!rulings) return <p className="faint">Loading rulings…</p>
  if (!rulings.length) {
    return <p className="faint">No official rulings — this card behaves exactly as written.</p>
  }

  return (
    <div>
      {rulings.map((ruling, i) => (
        <div className="ruling" key={i}>
          <div className="ruling__date">{ruling.published_at} · {ruling.source === 'wotc' ? 'Wizards of the Coast' : ruling.source}</div>
          {ruling.comment}
        </div>
      ))}
    </div>
  )
}

function Printings({ card, onOpenCard, market = 'usd' }) {
  const [printings, setPrintings] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setPrintings(null)
    setError(null)
    getPrintings(card)
      .then((data) => { if (!cancelled) setPrintings(data) })
      .catch((err) => { if (!cancelled) setError(err) })
    return () => { cancelled = true }
  }, [card.id, card.oracle_id])

  if (error) return <p className="faint">Printings are unavailable offline.</p>
  if (!printings) return <p className="faint">Loading printings…</p>

  return (
    <div className="printing-list">
      {printings.map((print) => (
        <button
          key={print.id}
          className="printing"
          onClick={() => onOpenCard?.(print)}
          aria-current={print.id === card.id ? 'true' : undefined}
        >
          <span className="printing__set">{print.set}</span>
          <span className="printing__name">
            {print.set_name}
            <span className="faint printing__meta">
              {print.collector_number ? `#${print.collector_number}` : ''}
              {print.rarity ? ` · ${capitalise(print.rarity)}` : ''}
              {print.released_at ? ` · ${print.released_at.slice(0, 4)}` : ''}
              {print.finishes?.length && !print.finishes.includes('nonfoil') ? ' · foil only' : ''}
            </span>
            {print.id === card.id && <span className="faint"> · showing</span>}
          </span>
          <span className="printing__price">{priceLabel(print, market)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * How many of this card the player owns.
 *
 * Counted per card, not per printing — owning a Sol Ring is owning a Sol Ring
 * whichever set it came from. It follows that this cannot value a collection,
 * because it does not know which printings they are, and it does not pretend to.
 */
function OwnedControl({ card }) {
  const [collection, setCollection] = useCollection()
  const owned = ownedOf(collection, card)

  return (
    <div className="panel row">
      <span>In your collection</span>
      <span className="spacer" />
      <button
        className="deck-row__step"
        onClick={() => setCollection(setOwned(collection, card, owned - 1))}
        disabled={owned === 0}
        aria-label={`One fewer ${card.name} owned`}
      >
        −
      </button>
      <span className="deck-row__qty" aria-live="polite">{owned}</span>
      <button
        className="deck-row__step"
        onClick={() => setCollection(setOwned(collection, card, owned + 1))}
        aria-label={`One more ${card.name} owned`}
      >
        +
      </button>
    </div>
  )
}

const GAME_NAMES = { paper: 'Paper', arena: 'Arena', mtgo: 'Magic Online' }

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)
