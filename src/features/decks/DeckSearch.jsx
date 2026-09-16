import { useCallback, useMemo, useRef, useState } from 'react'
import { searchCards } from '../../lib/scryfall.js'
import { addCard, setCommanders } from '../../lib/deck.js'
import { getFormat, canBeCommander, cardLegality, effectiveCopyLimit } from '../../lib/formats.js'
import { combinedCounts, unionColorIdentity } from '../../lib/deck.js'
import { parseQuery, serialiseQuery, clearFilters, hasActiveFilters } from '../../lib/query.js'
import SearchFilters from '../cards/SearchFilters.jsx'
import '../cards/filters.css'
import { pinCards } from '../../lib/cache.js'
import ManaCost from '../../components/ManaCost.jsx'
import { identityAttr } from '../../components/CardFace.jsx'

/**
 * In-deck search. Scopes the query to the deck's format by default, since 90%
 * of the time while building you only want cards you can actually play — and
 * shows why a card is blocked rather than just hiding it.
 */
export default function DeckSearch({ deck, onChange, onOpenCard, offline, cards }) {
  const [query, setQuery] = useState('')
  const [scoped, setScoped] = useState(true)
  const [identityScoped, setIdentityScoped] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const format = getFormat(deck.formatId)
  const counts = combinedCounts(deck)
  const filters = useMemo(() => parseQuery(query), [query])

  /**
   * A commander fixes what the deck may legally contain, so searching inside
   * one starts scoped to its colour identity. Cards you could not play simply
   * do not appear — with a visible chip saying so, because a filter you cannot
   * see is a filter you will blame the search for.
   */
  const commanderIdentity = useMemo(() => {
    if (!format.commander?.colorIdentity || !deck.commanders.length) return null
    const commanderCards = deck.commanders.map((id) => cards?.get?.(id)).filter(Boolean)
    if (!commanderCards.length) return null
    const identity = unionColorIdentity(commanderCards)
    return {
      letters: identity.map((c) => c.toLowerCase()),
      names: commanderCards.map((c) => c.name).join(' and '),
    }
  }, [deck.commanders, cards, format])

  /**
   * Scoping is passed in rather than read from state.
   *
   * A toggle that calls `setX(false)` and then `run(query)` in the same handler
   * runs the *previous* callback, which still closes over the old value — so
   * the search goes out with the setting the user just turned off. Explicit
   * overrides remove the race entirely.
   */
  const run = useCallback(async (raw, overrides = {}) => {
    const q = raw.trim()
    if (!q) return
    const useFormatScope = overrides.scoped ?? scoped
    const useIdentityScope = overrides.identityScoped ?? identityScoped

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)

    const parts = [q]
    if (useFormatScope) parts.push(`legal:${format.legalityKey}`)
    if (useIdentityScope && commanderIdentity) {
      // A colourless commander still restricts the deck to colourless cards.
      parts.push(commanderIdentity.letters.length
        ? `id<=${commanderIdentity.letters.join('')}`
        : 'id<=c')
    }

    try {
      const result = await searchCards(parts.join(' '), { signal: controller.signal })
      setResults(result)
      setStatus('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err)
      setStatus('error')
    }
  }, [scoped, identityScoped, commanderIdentity, format.legalityKey])

  const add = (card, asCommander = false) => {
    onChange(asCommander
      ? setCommanders(deck, [...deck.commanders, card.id])
      : addCard(deck, card.id, 1))
    pinCards([card.id])
  }

  return (
    <div className="stack">
      <form className="search" onSubmit={(e) => { e.preventDefault(); run(query) }} role="search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search cards for ${format.name}`}
          aria-label="Search cards to add"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button className="btn btn--primary" type="submit" disabled={!query.trim()}>Search</button>
      </form>

      <div className="row row--wrap">
        <button
          className={`btn btn--sm ${hasActiveFilters(filters) ? 'chip--active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          Filters{hasActiveFilters(filters) ? ' · on' : ''}
        </button>
        <label className="row tiny muted" style={{ gap: 'var(--space-2)', width: 'auto' }}>
          <input
            type="checkbox"
            checked={scoped}
            onChange={(e) => {
              setScoped(e.target.checked)
              if (query.trim()) run(query, { scoped: e.target.checked })
            }}
            style={{ width: 'auto' }}
          />
          Legal in {format.name}
        </label>
      </div>

      {commanderIdentity && identityScoped && (
        <div className="row row--wrap">
          <span className="scope-chip">
            Within {commanderIdentity.names}&rsquo;s colours
            <button
              onClick={() => {
                setIdentityScoped(false)
                if (query.trim()) run(query, { identityScoped: false })
              }}
              aria-label="Stop restricting to the commander's colour identity"
              title="Show cards outside this commander's colours too"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {commanderIdentity && !identityScoped && (
        <button
          className="btn btn--sm btn--ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setIdentityScoped(true)
            if (query.trim()) run(query, { identityScoped: true })
          }}
        >
          Restrict to {commanderIdentity.names}&rsquo;s colours again
        </button>
      )}

      {showFilters && (
        <>
          <SearchFilters
            filters={filters}
            onChange={(next) => {
              const rewritten = serialiseQuery(next)
              setQuery(rewritten)
              if (rewritten.trim()) run(rewritten)
            }}
            onClear={() => {
              const rewritten = serialiseQuery(clearFilters(filters))
              setQuery(rewritten)
              if (rewritten.trim()) run(rewritten)
            }}
            locked={identityScoped && !!commanderIdentity}
          />
          {identityScoped && commanderIdentity && (
            <p className="faint tiny" style={{ margin: 0 }}>
              Colour identity is set by your commander. Remove the chip above to filter it
              yourself.
            </p>
          )}
        </>
      )}

      {status === 'error' && (
        <div className="banner banner--error tiny">
          {offline ? 'Card search needs a connection. Cards already in this deck still work.' : error?.message}
        </div>
      )}

      {results?.cards?.length === 0 && status === 'done' && (
        <p className="faint">No cards matched.</p>
      )}

      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        {results?.cards?.map((card) => {
          const inDeck = counts.get(card.id) ?? 0
          const limit = effectiveCopyLimit(card, format)
          const status = cardLegality(card, format)
          const blocked = status === 'banned' || status === 'not_legal'
          const atLimit = inDeck >= limit
          const commanderOk = format.commander?.required
            && deck.commanders.length < format.commander.max
            && canBeCommander(card, format).ok

          return (
            <div className="deck-row" key={card.id} data-identity={identityAttr(card)}>
              <button
                className="btn btn--sm btn--primary"
                onClick={() => add(card)}
                disabled={blocked || atLimit}
                aria-label={`Add ${card.name}`}
                title={
                  blocked ? `${status === 'banned' ? 'Banned' : 'Not legal'} in ${format.name}`
                    : atLimit ? `Already at the limit of ${limit}` : undefined
                }
              >
                +
              </button>
              {commanderOk && (
                <button className="btn btn--sm" onClick={() => add(card, true)} title="Set as commander">★</button>
              )}
              <button className="deck-row__name" onClick={() => onOpenCard(card)}>
                {card.name}
                {inDeck > 0 && <span className="faint tiny"> · {inDeck} in deck</span>}
              </button>
              <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
              {blocked && (
                <span className="chip chip--error tiny">{status === 'banned' ? 'banned' : 'not legal'}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
