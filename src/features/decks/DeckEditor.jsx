import { useMemo, useState } from 'react'
import useDeckCards from './useDeckCards.js'
import DeckAnalysis from './DeckAnalysis.jsx'
import DeckCoach from './DeckCoach.jsx'
import DeckSearch from './DeckSearch.jsx'
import DeckImportExport from './DeckImportExport.jsx'
import ManaCost from '../../components/ManaCost.jsx'
import Term from '../../components/Term.jsx'
import { identityAttr } from '../../components/CardFace.jsx'
import {
  validateDeck, setQuantity, removeCard, setCommanders, deckSize, isLandCard,
} from '../../lib/deck.js'
import { getFormat, typeLineOf } from '../../lib/formats.js'
import { manaValueOf } from '../../lib/analysis.js'
import { captureSnapshot } from '../../lib/snapshot.js'
import {
  deckSections, setCategory, renameCategory, clearCategory, moveCategory,
  categoryNames, COMMANDER_CATEGORY,
} from '../../lib/categories.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { totalFor, formatPrice, priceLabel, MARKETS } from '../../lib/prices.js'
import CardImage from '../../components/CardImage.jsx'
import PriceRow from '../../components/PriceRow.jsx'
import DeckPlaytest from './DeckPlaytest.jsx'
import { useCollection } from '../../lib/collection-store.js'
import { missingFor, missingCost, ownEverythingIn, ownedOf } from '../../lib/collection.js'


/** "USD via TCGplayer" — the label alone does not say where a number came from. */
const getMarketLabel = (id) => {
  const market = MARKETS.find((m) => m.id === id)
  return market ? `${market.label} via ${market.source}` : id
}

export default function DeckEditor({
  deck, onBack, onChange, onOpenCard, offline, pending, onPendingConsumed,
}) {
  const [tab, setTab] = useState(pending?.kind === 'example' ? 'io' : 'list')
  const [coachQuery, setCoachQuery] = useState(null)
  const { cards, loading, missing, lookup } = useDeckCards(deck)
  const format = getFormat(deck.formatId)

  const validation = useMemo(() => validateDeck(deck, cards), [deck, cards])

  // Capture the legality verdict alongside every edit, so a later ban
  // announcement is a *diff* against a known-good baseline rather than a silent
  // rewrite of what this deck used to be.
  const commit = (next) => {
    const snapshot = cards.size ? captureSnapshot(next, cards) : next.snapshot
    onChange(snapshot ? { ...next, snapshot } : next)
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

      <div>
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
        {[['list', 'List'], ['add', 'Add cards'], ['coach', 'Coach'], ['analysis', 'Analysis'], ['hand', 'Playtest'], ['io', 'Import / export']]
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

      {tab === 'list' && (
        <DeckList
          deck={deck} groups={groups} format={format} market={market} lookup={lookup}
          collection={collection}
          onChange={commit} onOpenCard={onOpenCard} validation={validation}
        />
      )}
      {tab === 'add' && (
        <DeckSearch
          deck={deck} onChange={commit} onOpenCard={onOpenCard}
          offline={offline} cards={cards} seedQuery={coachQuery}
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

      {tab === 'io' && (
        <DeckImportExport
          deck={deck} lookup={lookup} onChange={commit}
          pending={pending} onPendingConsumed={onPendingConsumed}
        />
      )}
    </div>
  )
}

function DeckList({ deck, groups, format, market, lookup, collection, onChange, onOpenCard, validation }) {
  const problemIds = new Set(
    validation.violations.filter((v) => v.severity === 'error' && v.cardId).map((v) => v.cardId),
  )

  // Two ways to read the same deck. The list is faster to edit and survives a
  // narrow screen; the grid is how a deck is actually recognised, because
  // players know their cards by art long before they read the name.
  const [view, setView] = useState(() => getPrefs().deckView ?? 'list')
  const chooseView = (next) => { setView(next); setPref('deckView', next) }

  if (!groups.length) {
    return (
      <div className="empty">
        <h3>Empty deck</h3>
        <p>Use <strong>Add cards</strong> to search and build.</p>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row">
        <span className="spacer" />
        <div className="row" role="group" aria-label="How to show the deck">
          {[['list', 'List'], ['grid', 'Grid']].map(([id, label]) => (
            <button
              key={id}
              className={`chip ${view === id ? 'chip--active' : ''}`}
              aria-pressed={view === id}
              onClick={() => chooseView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {groups.map(({ name, entries, count, price, chosen }) => (
        <section key={name}>
          <div className="section-title">
            <h2>{name}</h2>
            <span className="faint">{count}</span>
            <span className="spacer" />
            <span className="faint tiny">{formatPrice(price.total, market)}</span>
            {name !== COMMANDER_CATEGORY && name !== 'Sideboard' && (
              <SectionMenu
                name={name}
                chosen={chosen}
                onRename={(to) => onChange(renameCategory(
                  deck, name, to, entries.map((e) => e.cardId),
                ))}
                onMove={(delta) => onChange(moveCategory(
                  deck, name, delta, groups.map((g) => g.name),
                ))}
                onDissolve={() => onChange(clearCategory(deck, name))}
              />
            )}
          </div>
          <div className={view === 'grid' ? 'deck-grid' : 'deck-rows'}>
            {entries.map(({ cardId, quantity, card, zone, isCommander }) => (
              view === 'grid' ? (
                <DeckTile
                  key={`${zone}:${cardId}`}
                  card={card}
                  cardId={cardId}
                  quantity={quantity}
                  market={market}
                  owned={ownedOf(collection, card)}
                  isCommander={isCommander}
                  flagged={problemIds.has(cardId)}
                  onOpen={() => card && onOpenCard(card)}
                  onSet={(n) => onChange(setQuantity(deck, cardId, n, zone))}
                  onRemove={() => onChange(
                    isCommander
                      ? setCommanders(deck, deck.commanders.filter((id) => id !== cardId))
                      : removeCard(deck, cardId, zone),
                  )}
                />
              ) : (
              <DeckRow
                key={`${zone}:${cardId}`}
                card={card}
                market={market}
                owned={ownedOf(collection, card)}
                section={name}
                sections={categoryNames(deck, lookup)}
                onCategory={(to) => onChange(setCategory(deck, cardId, to))}
                cardId={cardId}
                quantity={quantity}
                zone={zone}
                isCommander={isCommander}
                flagged={problemIds.has(cardId)}
                format={format}
                onOpen={() => card && onOpenCard(card)}
                onSet={(n) => onChange(setQuantity(deck, cardId, n, zone))}
                onRemove={() => onChange(
                  isCommander
                    ? setCommanders(deck, deck.commanders.filter((id) => id !== cardId))
                    : removeCard(deck, cardId, zone),
                )}
              />
              )
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * One card in the grid view.
 *
 * The quantity sits on the art, the way it does on a physical stack and on
 * every deckbuilding site, rather than in a column beside it. Controls stay
 * visible rather than appearing on hover — hover does not exist on the phone
 * this is mostly used on.
 */
function DeckTile({
  card, cardId, quantity, market, owned = 0, isCommander, flagged, onOpen, onSet, onRemove,
}) {
  if (!card) {
    return (
      <div className="deck-tile deck-tile--missing">
        <span className="faint tiny">Card not loaded</span>
        <span className="faint tiny mono">{cardId.slice(0, 8)}…</span>
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove}>Remove</button>
      </div>
    )
  }

  return (
    <div className={`deck-tile ${flagged ? 'deck-tile--flagged' : ''}`} data-identity={identityAttr(card)}>
      <div className="deck-tile__art">
        <CardImage card={card} size="normal" onClick={onOpen} />
        <span className={`deck-tile__qty ${isCommander ? 'deck-tile__qty--commander' : ''}`}>
          {isCommander ? '★' : quantity}
        </span>
        {owned < quantity && (
          <span className="deck-tile__need tiny" title={`You have ${owned} of ${quantity}`}>
            need {quantity - owned}
          </span>
        )}
      </div>

      <PriceRow card={card} size="sm" />

      <div className="deck-tile__controls">
        {isCommander ? (
          <span className="faint tiny">Commander</span>
        ) : (
          <>
            <button className="deck-row__step" onClick={() => onSet(quantity - 1)} aria-label={`One fewer ${card.name}`}>−</button>
            <span className="deck-row__qty">{quantity}</span>
            <button className="deck-row__step" onClick={() => onSet(quantity + 1)} aria-label={`One more ${card.name}`}>+</button>
          </>
        )}
        <span className="spacer" />
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove} aria-label={`Remove ${card.name}`}>✕</button>
      </div>
    </div>
  )
}

/**
 * Rename, reorder or dissolve a section.
 *
 * A derived section can be renamed too — that is what turns it into one the
 * player owns. "Dissolve" only appears for sections somebody made, because
 * there is nothing to dissolve about being a creature.
 */
function SectionMenu({ name, chosen, onRename, onMove, onDissolve }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(name)

  if (!open) {
    return (
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => { setDraft(name); setOpen(true) }}
        aria-label={`Edit the ${name} section`}
      >
        ⋯
      </button>
    )
  }

  const commit = () => { onRename(draft); setOpen(false) }

  return (
    <div className="row section-menu">
      <input
        className="input input--sm"
        value={draft}
        autoFocus
        aria-label={`Rename ${name}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      <button className="btn btn--sm" onClick={commit}>Rename</button>
      <button className="btn btn--sm btn--ghost" onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>↑</button>
      <button className="btn btn--sm btn--ghost" onClick={() => onMove(1)} aria-label={`Move ${name} down`}>↓</button>
      {chosen && (
        <button className="btn btn--sm btn--ghost" onClick={onDissolve} title="Put these cards back under their card type">
          Dissolve
        </button>
      )}
      <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>Done</button>
    </div>
  )
}

/** Moves one card to another section, or to a new one. */
function CategoryPicker({ card, section, sections, onCategory }) {
  const NEW = '\u0000new'
  const options = [...new Set([section, ...sections])].filter(Boolean)

  return (
    <select
      className="deck-row__category"
      value={section}
      aria-label={`Section for ${card.name}`}
      onChange={(e) => {
        if (e.target.value !== NEW) return onCategory(e.target.value)
        // eslint-disable-next-line no-alert
        const typed = window.prompt(`Move ${card.name} to which section?`, section)
        if (typed?.trim()) onCategory(typed.trim())
      }}
    >
      {options.map((name) => <option key={name} value={name}>{name}</option>)}
      <option value={NEW}>New section…</option>
    </select>
  )
}

function DeckRow({
  card, cardId, quantity, isCommander, flagged, market, owned = 0, zone, section, sections,
  onOpen, onSet, onRemove, onCategory,
}) {
  if (!card) {
    return (
      <div className="deck-row deck-row--missing">
        <span className="deck-row__qty">{quantity}</span>
        <span className="deck-row__name faint">Card not loaded ({cardId.slice(0, 8)}…)</span>
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove}>✕</button>
      </div>
    )
  }

  return (
    <div
      className={`deck-row ${flagged ? 'deck-row--flagged' : ''}`}
      data-identity={identityAttr(card)}
    >
      {isCommander
        ? <span className="deck-row__qty deck-row__qty--commander" title="Commander">★</span>
        : (
          <div className="deck-row__stepper">
            <button className="deck-row__step" onClick={() => onSet(quantity - 1)} aria-label={`One fewer ${card.name}`}>−</button>
            <span className="deck-row__qty">{quantity}</span>
            <button className="deck-row__step" onClick={() => onSet(quantity + 1)} aria-label={`One more ${card.name}`}>+</button>
          </div>
        )}

      <button className="deck-row__name" onClick={onOpen}>{card.name}</button>
      <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
      <span className="deck-row__price faint tiny">{priceLabel(card, market)}</span>
      {owned < quantity && (
        <span className="deck-row__need tiny" title={`You have ${owned} of ${quantity}`}>
          need {quantity - owned}
        </span>
      )}
      {!isCommander && zone !== 'sideboard' && (
        <CategoryPicker card={card} section={section} sections={sections} onCategory={onCategory} />
      )}
      <button
        className="btn btn--sm btn--ghost btn--danger deck-row__remove"
        onClick={onRemove}
        aria-label={`Remove ${card.name}`}
      >
        ✕
      </button>
    </div>
  )
}

/** Groups a deck the way a decklist is normally written: by card type. */

