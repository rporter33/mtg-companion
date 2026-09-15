import { useCallback, useRef, useState } from 'react'
import { searchCards } from '../../lib/scryfall.js'
import { addCard, setCommanders } from '../../lib/deck.js'
import { getFormat, canBeCommander, cardLegality, effectiveCopyLimit } from '../../lib/formats.js'
import { combinedCounts } from '../../lib/deck.js'
import { pinCards } from '../../lib/cache.js'
import ManaCost from '../../components/ManaCost.jsx'
import { identityAttr } from '../../components/CardFace.jsx'

/**
 * In-deck search. Scopes the query to the deck's format by default, since 90%
 * of the time while building you only want cards you can actually play — and
 * shows why a card is blocked rather than just hiding it.
 */
export default function DeckSearch({ deck, onChange, onOpenCard, offline }) {
  const [query, setQuery] = useState('')
  const [scoped, setScoped] = useState(true)
  const [results, setResults] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const format = getFormat(deck.formatId)
  const counts = combinedCounts(deck)

  const run = useCallback(async (raw) => {
    const q = raw.trim()
    if (!q) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)
    const scopedQuery = scoped ? `${q} legal:${format.legalityKey}` : q
    try {
      const result = await searchCards(scopedQuery, { signal: controller.signal })
      setResults(result)
      setStatus('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err)
      setStatus('error')
    }
  }, [scoped, format.legalityKey])

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

      <label className="row tiny muted" style={{ gap: 'var(--space-2)' }}>
        <input
          type="checkbox"
          checked={scoped}
          onChange={(e) => { setScoped(e.target.checked); if (query.trim()) run(query) }}
          style={{ width: 'auto' }}
        />
        Only show cards legal in {format.name}
      </label>

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
