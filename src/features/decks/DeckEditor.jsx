import { Suspense, lazy, useMemo, useState } from 'react'
import useDeckCards from './useDeckCards.js'
import DeckAnalysis from './DeckAnalysis.jsx'
import DeckCoach from './DeckCoach.jsx'
import DeckSearch from './DeckSearch.jsx'
import DeckList from './editor/DeckList.jsx'
import { validateDeck, deckSize } from '../../lib/deck.js'
import { getFormat } from '../../lib/formats.js'
import { captureSnapshot } from '../../lib/snapshot.js'
import { deckSections } from '../../lib/categories.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { totalFor, formatPrice, MARKETS } from '../../lib/prices.js'
import DeckArt from '../../components/DeckArt.jsx'
import { artUrl, faceCardFor, setDeckArt, stampFace } from '../../lib/deck-art.js'
// Loaded when their tab opens; DecksView prefetches them on idle.
const DeckPlaytest = lazy(() => import('./DeckPlaytest.jsx'))
const DeckHistory = lazy(() => import('./DeckHistory.jsx'))
const DeckImportExport = lazy(() => import('./DeckImportExport.jsx'))
import { useCollection } from '../../lib/collection-store.js'
import { missingFor, missingCost, ownEverythingIn } from '../../lib/collection.js'

/** "USD via TCGplayer" — the label alone does not say where a number came from. */
const getMarketLabel = (id) => {
  const market = MARKETS.find((m) => m.id === id)
  return market ? `${market.label} via ${market.source}` : id
}

export default function DeckEditor({
  deck, tab = 'list', onTab, onBack, onChange, onOpenCard, offline, pending, onPendingConsumed,
}) {
  // The open tab lives in the URL (see router.js), so a reload keeps it and a
  // link can point at a deck's analysis.
  const setTab = onTab
  const [coachQuery, setCoachQuery] = useState(null)
  const { cards, loading, missing, lookup } = useDeckCards(deck)
  const format = getFormat(deck.formatId)

  const validation = useMemo(() => validateDeck(deck, cards), [deck, cards])

  // Capture the legality verdict alongside every edit, so a later ban
  // announcement is a *diff* against a known-good baseline rather than a silent
  // rewrite of what this deck used to be.
  const commit = (next) => {
    const snapshot = cards.size ? captureSnapshot(next, cards) : next.snapshot
    // The automatic face card is recorded alongside, so the Decks screen can
    // show the same art without loading the cards. Same object when unchanged.
    onChange(stampFace(snapshot ? { ...next, snapshot } : next, lookup, market))
  }
  const total = deckSize(deck, format)
  const target = format?.deck.max ?? format?.deck.min ?? 60

  // Which market to price in. Stored, because a player in Europe should not
  // have to re-pick dollars-or-euros every time they open a deck.
  const [market, setMarket] = useState(() => getPrefs().market ?? 'usd')
  const chooseMarket = (id) => { setMarket(id); setPref('market', id) }

  const groups = useMemo(
    () => deckSections(deck, lookup, { marketId: market }),
    [deck, cards, market],
  )

  // The painting that stands for this deck, and whether paintings show at
  // all. Both follow the person's choices: the images preference from the
  // card search applies here too, and the row art has its own switch.
  const showImages = getPrefs().showCardImages !== false
  const face = useMemo(() => faceCardFor(deck, lookup, market), [deck, cards, market])
  const [rowArt, setRowArt] = useState(() => getPrefs().rowArt !== false)
  const toggleRowArt = () => { setRowArt(!rowArt); setPref('rowArt', !rowArt) }
  const artChoices = useMemo(() => [...cards.values()]
    .filter((card) => artUrl(card))
    .sort((a, b) => a.name.localeCompare(b.name)), [cards])

  const [collection, setCollection] = useCollection()
  const notOwned = useMemo(() => missingFor(deck, lookup, collection), [deck, cards, collection])
  const toBuy = useMemo(() => missingCost(notOwned, market), [notOwned, market])

  const money = useMemo(
    () => totalFor(groups.flatMap((g) => g.entries).filter((e) => e.card), market),
    [groups, market],
  )
  const errors = validation.violations.filter((v) => v.severity === 'error')
  const warnings = validation.violations.filter((v) => v.severity === 'warning')

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← Decks</button>
        <span className="spacer" />
        <span className={`chip ${validation.legal ? 'chip--ok' : 'chip--error'}`}>
          {validation.legal ? 'Legal' : `${errors.length} problem${errors.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className={`deck-head ${showImages && face ? 'deck-head--art' : ''}`}>
        {showImages && <DeckArt src={artUrl(face)} cardId={face?.id} className="deck-art--head" />}
        <input
          className="deck-title"
          value={deck.name}
          onChange={(e) => onChange({ ...deck, name: e.target.value })}
          aria-label="Deck name"
        />
        <div className="row row--wrap" style={{ marginTop: 'var(--space-2)' }}>
          <span className="chip">{format?.name}</span>
          <span className={`chip ${total === target ? 'chip--ok' : ''}`}>{total}/{target}</span>
          {deck.sideboard.length > 0 && (
            <span className="chip">{deck.sideboard.reduce((n, e) => n + e.quantity, 0)} sideboard</span>
          )}
          {loading && <span className="chip">loading cards…</span>}
          <span className="chip" title={`${getMarketLabel(market)} — a daily aggregate, not a live quote`}>
            {formatPrice(money.total, market)}
          </span>
          {/*
            Archidekt shows one "Est cost" and says nothing about the cards it
            could not price. A total that quietly skips nine of them is a wrong
            number with a confident label, so the gap is shown next to it.
          */}
          {money.missing > 0 && (
            <span className="chip chip--warn" title="These have no price for this market, so they are not in the total">
              {money.missing} unpriced
            </span>
          )}
          {/* What is left to buy, which is a different question from what the
              deck is worth — and the one people actually ask while building. */}
          {cards.size > 0 && (
            notOwned.length === 0 ? (
              <span className="chip chip--ok" title="Every card in this deck is in your collection">
                You own this deck
              </span>
            ) : (
              <button
                className="chip chip--warn"
                title="Mark every card in this deck as owned"
                onClick={() => setCollection(ownEverythingIn(collection, deck, lookup))}
              >
                {notOwned.reduce((n, m) => n + m.quantity, 0)} to get
                {toBuy.priced > 0 ? ` · ${formatPrice(toBuy.total, market)}` : ''}
              </button>
            )
          )}
          <select
            className="chip"
            aria-label="Price in"
            value={market}
            onChange={(e) => chooseMarket(e.target.value)}
          >
            {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {showImages && artChoices.length > 0 && (
            <select
              className="chip"
              aria-label="Deck art"
              title="Which card's painting stands for this deck"
              value={deck.artCardId ?? ''}
              onChange={(e) => onChange(setDeckArt(deck, e.target.value || null))}
            >
              <option value="">Art: automatic{face && !deck.artCardId ? ` (${face.name})` : ''}</option>
              {artChoices.map((card) => <option key={card.id} value={card.id}>Art: {card.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="banner banner--warn">
          {missing.length} card{missing.length === 1 ? '' : 's'} could not be loaded
          {offline ? ' while offline' : ''}. The rest of the deck is checked normally.
        </div>
      )}

      {errors.length > 0 && (
        <div className="banner banner--error stack" style={{ gap: 'var(--space-2)' }}>
          <strong>This deck is not legal in {format?.name} yet.</strong>
          <ul className="violation-list">
            {errors.slice(0, 8).map((v, i) => <li key={i}>{v.message}</li>)}
          </ul>
          {errors.length > 8 && <span className="tiny">…and {errors.length - 8} more.</span>}
        </div>
      )}

      {warnings.length > 0 && errors.length === 0 && (
        <div className="banner banner--warn tiny">{warnings[0].message}</div>
      )}

      <nav className="row" role="tablist">
        {[['list', 'List'], ['add', 'Add cards'], ['coach', 'Coach'], ['analysis', 'Analysis'], ['hand', 'Playtest'], ['history', 'History'], ['io', 'Import / export']]
          .map(([id, label]) => (
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

      <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
      {tab === 'list' && (
        <DeckList
          deck={deck} groups={groups} format={format} market={market} lookup={lookup}
          art={showImages && rowArt} artSwitch={showImages ? toggleRowArt : null}
          collection={collection}
          onChange={commit} onOpenCard={onOpenCard} validation={validation}
        />
      )}
      {tab === 'add' && (
        <DeckSearch
          deck={deck} onChange={commit} onOpenCard={onOpenCard}
          offline={offline} cards={cards} seedQuery={coachQuery}
          market={market} art={showImages && rowArt}
        />
      )}
      {tab === 'coach' && (
        <DeckCoach
          deck={deck}
          lookup={lookup}
          cardCount={cards.size}
          onSearch={(query) => { setCoachQuery(query); setTab('add') }}
        />
      )}
      {tab === 'analysis' && (
        <DeckAnalysis deck={deck} lookup={lookup} cardCount={cards.size} />
      )}
      {tab === 'hand' && (
        <DeckPlaytest deck={deck} lookup={lookup} cards={cards} onOpenCard={onOpenCard} />
      )}

      {tab === 'history' && (
        <DeckHistory deck={deck} lookup={lookup} market={market} onChange={commit} />
      )}

      {tab === 'io' && (
        <DeckImportExport
          deck={deck} lookup={lookup} onChange={commit}
          pending={pending} onPendingConsumed={onPendingConsumed}
        />
      )}
      </Suspense>
    </div>
  )
}
