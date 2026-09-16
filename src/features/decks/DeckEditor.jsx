import { useMemo, useState } from 'react'
import useDeckCards from './useDeckCards.js'
import DeckAnalysis from './DeckAnalysis.jsx'
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

const GROUP_ORDER = ['Commander', 'Creature', 'Planeswalker', 'Instant', 'Sorcery',
  'Artifact', 'Enchantment', 'Battle', 'Land', 'Other']

export default function DeckEditor({ deck, onBack, onChange, onOpenCard, offline }) {
  const [tab, setTab] = useState('list')
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

  const groups = useMemo(() => groupDeck(deck, lookup, format), [deck, cards, format])
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
        {[['list', 'List'], ['add', 'Add cards'], ['analysis', 'Analysis'], ['io', 'Import / export']]
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
          deck={deck} groups={groups} format={format}
          onChange={commit} onOpenCard={onOpenCard} validation={validation}
        />
      )}
      {tab === 'add' && (
        <DeckSearch deck={deck} onChange={commit} onOpenCard={onOpenCard} offline={offline} />
      )}
      {tab === 'analysis' && (
        <DeckAnalysis deck={deck} lookup={lookup} cardCount={cards.size} />
      )}
      {tab === 'io' && <DeckImportExport deck={deck} lookup={lookup} onChange={commit} />}
    </div>
  )
}

function DeckList({ deck, groups, format, onChange, onOpenCard, validation }) {
  const problemIds = new Set(
    validation.violations.filter((v) => v.severity === 'error' && v.cardId).map((v) => v.cardId),
  )

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
      {groups.map(({ title, entries, count }) => (
        <section key={title}>
          <div className="section-title">
            <h2>{title}</h2>
            <span className="faint">{count}</span>
          </div>
          <div className="deck-rows">
            {entries.map(({ cardId, quantity, card, zone, isCommander }) => (
              <DeckRow
                key={`${zone}:${cardId}`}
                card={card}
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
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function DeckRow({ card, cardId, quantity, isCommander, flagged, onOpen, onSet, onRemove }) {
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
      <button className="btn btn--sm btn--ghost btn--danger" onClick={onRemove} aria-label={`Remove ${card.name}`}>✕</button>
    </div>
  )
}

/** Groups a deck the way a decklist is normally written: by card type. */
function groupDeck(deck, lookup, format) {
  const buckets = new Map()
  const push = (title, entry) => {
    if (!buckets.has(title)) buckets.set(title, [])
    buckets.get(title).push(entry)
  }

  for (const cardId of deck.commanders) {
    push('Commander', { cardId, quantity: 1, card: lookup(cardId), zone: 'main', isCommander: true })
  }
  if (deck.signatureSpell) {
    push('Commander', {
      cardId: deck.signatureSpell, quantity: 1,
      card: lookup(deck.signatureSpell), zone: 'main', isCommander: true,
    })
  }

  for (const { cardId, quantity } of deck.main) {
    const card = lookup(cardId)
    push(card ? primaryType(card) : 'Other', { cardId, quantity, card, zone: 'main' })
  }
  for (const { cardId, quantity } of deck.sideboard) {
    push('Sideboard', { cardId, quantity, card: lookup(cardId), zone: 'sideboard' })
  }

  const order = [...GROUP_ORDER, 'Sideboard']
  return order
    .filter((title) => buckets.has(title))
    .map((title) => {
      const entries = buckets.get(title).sort(byManaThenName)
      return { title, entries, count: entries.reduce((n, e) => n + e.quantity, 0) }
    })
}

function primaryType(card) {
  const line = typeLineOf(card)
  if (isLandCard(card)) return 'Land'
  for (const type of GROUP_ORDER) {
    if (type === 'Land' || type === 'Commander' || type === 'Other') continue
    if (new RegExp(`\\b${type}s?\\b`).test(line)) return type
  }
  return 'Other'
}

function byManaThenName(a, b) {
  const av = a.card ? manaValueOf(a.card) : 99
  const bv = b.card ? manaValueOf(b.card) : 99
  if (av !== bv) return av - bv
  return (a.card?.name ?? '').localeCompare(b.card?.name ?? '')
}
