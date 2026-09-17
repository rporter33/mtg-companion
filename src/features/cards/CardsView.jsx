import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchCards, ScryfallError, OfflineError } from '../../lib/scryfall.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import {
  parseQuery, serialiseQuery, clearFilters, hasActiveFilters, getSort, SORT_OPTIONS,
} from '../../lib/query.js'
import CardImage from '../../components/CardImage.jsx'
import PriceRow from '../../components/PriceRow.jsx'
import SearchFilters from './SearchFilters.jsx'
import Term from '../../components/Term.jsx'
import './cards.css'
import './filters.css'

/** Starting points that double as a demonstration of the query syntax. */
const EXAMPLES = [
  { label: 'Modern removal under $2', query: 'f:modern o:destroy t:instant usd<2' },
  { label: 'Green commanders', query: 'is:commander id:g' },
  { label: 'Cheap blue counterspells', query: 'f:pauper t:instant o:counter c:u' },
  { label: 'Big red dragons', query: 't:dragon c:r pow>=5' },
  { label: 'Lifegain in white', query: 'c:w o:"gain life" t:creature' },
]

export default function CardsView({ onOpenCard, offline, seedQuery }) {
  const prefs = getPrefs()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [sortId, setSortId] = useState(prefs.sortId ?? 'name')
  const [dir, setDir] = useState(prefs.sortDir ?? null)
  const [pages, setPages] = useState([])
  const [status, setStatus] = useState('idle')
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [showImages, setShowImages] = useState(prefs.showCardImages)
  const [showFilters, setShowFilters] = useState(false)
  const abortRef = useRef(null)

  // The query string is the single source of truth. The controls are a view of
  // it, so editing either one keeps both correct by construction.
  const filters = useMemo(() => parseQuery(query), [query])
  const sort = getSort(sortId)
  const direction = dir ?? sort.defaultDir

  const run = useCallback(async (raw, { order, orderDir, page = 1, append = false } = {}) => {
    const q = raw.trim()
    if (!q) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (append) setLoadingMore(true)
    else { setStatus('loading'); setPages([]) }
    setError(null)
    setSubmitted(q)

    try {
      const result = await searchCards(q, {
        order, dir: orderDir, page, signal: controller.signal,
      })
      setPages((current) => (append ? [...current, result] : [result]))
      setStatus('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err)
      if (!append) setPages([])
      setStatus('error')
    } finally {
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  // A query handed over from another tab (for example "show me this set")
  // runs once on arrival, and only if the user has not already typed something.
  useEffect(() => {
    if (seedQuery && !submitted) {
      setQuery(seedQuery)
      run(seedQuery, { order: sort.order, orderDir: direction })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery])

  const submit = (nextQuery = query, nextSortId = sortId, nextDir = dir) => {
    const option = getSort(nextSortId)
    run(nextQuery, { order: option.order, orderDir: nextDir ?? option.defaultDir })
  }

  /** Filter changes rewrite the query, and re-run if a search is already showing. */
  const applyFilters = (next) => {
    const rewritten = serialiseQuery(next)
    setQuery(rewritten)
    if (submitted) submit(rewritten)
  }

  /**
   * Sorting re-queries rather than reordering what is on screen. Scryfall pages
   * at 175 cards, so sorting the loaded page would put "cheapest" at the top of
   * page one while a cheaper card sits on page three — confidently wrong.
   */
  const changeSort = (nextSortId, nextDir) => {
    setSortId(nextSortId)
    setDir(nextDir)
    setPref('sortId', nextSortId)
    setPref('sortDir', nextDir)
    if (submitted) submit(submitted, nextSortId, nextDir)
  }

  const cards = pages.flatMap((page) => page.cards)
  const last = pages[pages.length - 1]
  const total = last?.totalCards ?? 0
  const hasMore = !!last?.hasMore
  const notFound = pages.length === 1 && pages[0]?.notFound

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
          Search with Scryfall&rsquo;s syntax, or use the filters — they write the same
          query, so you can watch it build and edit it by hand.
        </p>
      </div>

      <form className="search" onSubmit={(e) => { e.preventDefault(); submit() }} role="search">
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

      <div className="search-controls">
        <button
          className={`btn btn--sm ${hasActiveFilters(filters) ? 'chip--active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          Filters{hasActiveFilters(filters) ? ' · on' : ''}
        </button>

        <label className="row" style={{ gap: 'var(--space-1)', width: 'auto' }}>
          <span className="faint tiny">Sort</span>
          <select
            className="sort-select"
            value={sortId}
            aria-label="Sort results by"
            onChange={(e) => changeSort(e.target.value, null)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <button
          className="btn btn--sm"
          onClick={() => changeSort(sortId, direction === 'asc' ? 'desc' : 'asc')}
          aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}
          title={direction === 'asc' ? 'Ascending' : 'Descending'}
        >
          {direction === 'asc' ? '↑' : '↓'}
        </button>

        <span className="spacer" />
        <button className="btn btn--sm btn--ghost" onClick={toggleImages}>
          {showImages ? 'Text' : 'Art'}
        </button>
      </div>

      {showFilters && (
        // No separate query preview: the search box above already shows the
        // composed query live, and a second copy of the same string is clutter.
        <SearchFilters
          filters={filters}
          onChange={applyFilters}
          onClear={() => applyFilters(clearFilters(filters))}
        />
      )}

      {!submitted && (
        <div className="stack">
          <div className="section-title"><h2>Try one of these</h2></div>
          <div className="row row--wrap">
            {EXAMPLES.map((example) => (
              <button
                key={example.query}
                className="chip"
                onClick={() => { setQuery(example.query); submit(example.query) }}
              >
                {example.label}
              </button>
            ))}
          </div>
          <div className="panel">
            <h3>New to this?</h3>
            <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Every card here shows its full rules text, its official <Term id="stack">rulings</Term>,
              which formats it is legal in, and what it costs. Tap any card to open it, then
              zoom in to read it properly.
            </p>
          </div>
        </div>
      )}

      {status === 'error' && <SearchError error={error} offline={offline} />}

      {notFound && (
        <div className="empty">
          <h3>No cards matched</h3>
          <p>Nothing matches <code className="mono">{submitted}</code>.</p>
          {hasActiveFilters(filters) && (
            <button className="btn btn--sm" onClick={() => applyFilters(clearFilters(filters))}>
              Clear filters and try again
            </button>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <>
          <div className="row">
            <span className="faint">
              {total.toLocaleString()} card{total === 1 ? '' : 's'}
              {cards.length < total && ` · showing ${cards.length.toLocaleString()}`}
              {last?.fromCache && ' · from cache'}
            </span>
          </div>

          {last?.warnings?.length > 0 && (
            <div className="banner banner--warn">{last.warnings.join(' ')}</div>
          )}

          <div className="card-grid">
            {cards.map((card, i) => (
              <div className="card-tile" key={`${card.id}-${i}`}>
                <CardImage
                  card={card}
                  size="normal"
                  preferImages={showImages}
                  onClick={() => onOpenCard(card)}
                />
                <PriceRow card={card} size="sm" />
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              className="btn"
              disabled={loadingMore}
              onClick={() => run(submitted, {
                order: sort.order, orderDir: direction, page: pages.length + 1, append: true,
              })}
            >
              {loadingMore ? 'Loading…' : `Load more (${(total - cards.length).toLocaleString()} left)`}
            </button>
          )}
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
