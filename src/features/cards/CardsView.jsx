import { useCallback, useEffect, useRef, useState } from 'react'
import { searchCards, ScryfallError, OfflineError } from '../../lib/scryfall.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import CardImage from '../../components/CardImage.jsx'
import Term from '../../components/Term.jsx'
import './cards.css'

/** Starting points that double as a demonstration of the query syntax. */
const EXAMPLES = [
  { label: 'Modern removal under $2', query: 'f:modern o:destroy t:instant usd<2' },
  { label: 'Green commanders', query: 'is:commander id:g' },
  { label: 'Cheap blue counterspells', query: 'f:pauper t:instant o:counter c:u' },
  { label: 'Big red dragons', query: 't:dragon c:r pow>=5' },
  { label: 'Lifegain in white', query: 'c:w o:"gain life" t:creature' },
]

export default function CardsView({ onOpenCard, offline, seedQuery }) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [results, setResults] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [showImages, setShowImages] = useState(() => getPrefs().showCardImages)
  const abortRef = useRef(null)

  const run = useCallback(async (raw) => {
    const q = raw.trim()
    if (!q) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)
    setSubmitted(q)
    try {
      const result = await searchCards(q, { signal: controller.signal })
      setResults(result)
      setStatus('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err)
      setResults(null)
      setStatus('error')
    }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  // A query handed over from another tab (for example "show me this set")
  // runs once on arrival, and only if the user has not already typed something.
  useEffect(() => {
    if (seedQuery && !submitted) {
      setQuery(seedQuery)
      run(seedQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery])

  const toggleImages = () => {
    const next = !showImages
    setShowImages(next)
    setPref('showCardImages', next)
  }

  return (
    <div className="stack">
      <div>
        <h1>Cards</h1>
        <p className="muted">
          Search with Scryfall&rsquo;s syntax — <code className="mono">t:creature</code> for type,{' '}
          <code className="mono">c:r</code> for colour, <code className="mono">f:modern</code> for
          format legality, <code className="mono">usd&lt;5</code> for price.
        </p>
      </div>

      <form
        className="search"
        onSubmit={(e) => { e.preventDefault(); run(query) }}
        role="search"
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Lightning Bolt, or t:goblin c:r cmc<=2"
          aria-label="Search cards"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button className="btn btn--primary" type="submit" disabled={!query.trim() || status === 'loading'}>
          {status === 'loading' ? '…' : 'Search'}
        </button>
      </form>

      {!submitted && (
        <div className="stack">
          <div className="section-title"><h2>Try one of these</h2></div>
          <div className="row row--wrap">
            {EXAMPLES.map((example) => (
              <button
                key={example.query}
                className="chip"
                onClick={() => { setQuery(example.query); run(example.query) }}
              >
                {example.label}
              </button>
            ))}
          </div>
          <div className="panel">
            <h3>New to this?</h3>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Every card here shows its full rules text, its official <Term id="stack">rulings</Term>,
              which formats it is legal in, and what it costs. If a word on a card does not make
              sense, tap anything with a dotted underline.
            </p>
          </div>
        </div>
      )}

      {status === 'error' && <SearchError error={error} offline={offline} />}

      {results?.notFound && (
        <div className="empty">
          <h3>No cards matched</h3>
          <p>Nothing matches <code className="mono">{submitted}</code>.</p>
        </div>
      )}

      {results?.cards?.length > 0 && (
        <>
          <div className="row">
            <span className="faint">
              {results.totalCards.toLocaleString()} card{results.totalCards === 1 ? '' : 's'}
              {results.hasMore && ` · showing the first ${results.cards.length}`}
              {results.fromCache && ' · from cache'}
            </span>
            <span className="spacer" />
            <button className="btn btn--sm btn--ghost" onClick={toggleImages}>
              {showImages ? 'Show as text' : 'Show art'}
            </button>
          </div>

          {results.warnings?.length > 0 && (
            <div className="banner banner--warn">{results.warnings.join(' ')}</div>
          )}

          <div className="card-grid">
            {results.cards.map((card) => (
              <CardImage
                key={card.id}
                card={card}
                size="normal"
                preferImages={showImages}
                onClick={() => onOpenCard(card)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SearchError({ error, offline }) {
  if (error instanceof OfflineError || offline) {
    return (
      <div className="banner banner--warn">
        <strong>No connection.</strong> Cards you have already viewed are still available, and
        everything else in the app works offline.
      </div>
    )
  }
  if (error instanceof ScryfallError && error.status === 400) {
    return (
      <div className="banner banner--error">
        <strong>Scryfall could not read that query.</strong>
        <div style={{ marginTop: 'var(--space-2)' }}>{error.message}</div>
      </div>
    )
  }
  return (
    <div className="banner banner--error">
      {error?.message ?? 'Something went wrong with that search.'}
    </div>
  )
}
