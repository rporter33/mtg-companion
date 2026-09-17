import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import CardDetail from './features/cards/CardDetail.jsx'

/*
 * The four views load on demand. Opening the app on Learn should not also
 * download the deck builder, card search and the life counter.
 *
 * This is safe here only because of the prefetch below. The service worker
 * caches same-origin responses as they are fetched, so a chunk the visitor
 * never navigated to would simply not exist offline — and "works offline" is
 * the app's whole claim, not a nice-to-have. So once the first view is up and
 * the browser is idle, the rest are pulled in anyway. The visitor gets a
 * smaller first paint; the cache still ends up holding everything.
 */
const VIEWS = {
  cards: () => import('./features/cards/CardsView.jsx'),
  decks: () => import('./features/decks/DecksView.jsx'),
  play: () => import('./features/play/PlayView.jsx'),
  guide: () => import('./features/guide/GuideView.jsx'),
}

const CardsView = lazy(VIEWS.cards)
const DecksView = lazy(VIEWS.decks)
const PlayView = lazy(VIEWS.play)
const GuideView = lazy(VIEWS.guide)
import { loadState, PERSIST_FAILED_EVENT, ROOM_MADE_EVENT } from './lib/storage.js'
import { checkForUpdate, reloadForUpdate, minutesAgo } from './lib/version.js'

const TABS = [
  { id: 'guide', label: 'Learn', icon: GuideIcon },
  { id: 'cards', label: 'Cards', icon: SearchIcon },
  { id: 'decks', label: 'Decks', icon: DeckIcon },
  { id: 'play',  label: 'Play',  icon: LifeIcon },
]

export default function App() {
  const [tab, setTab] = useState(() => (loadState().decks.length ? 'decks' : 'guide'))
  const [detailCard, setDetailCard] = useState(null)
  const [seedQuery, setSeedQuery] = useState(null)
  const [deckSeed, setDeckSeed] = useState(null)
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false)

  // A save that never reached storage used to be invisible: the screen showed
  // the change and the reload lost it. Storage fires this once when a write
  // fails, and the banner stays until the page is reloaded — because until it
  // is, nothing on screen is known to be durable.
  const [saveFailed, setSaveFailed] = useState(false)
  // When a refused write was rescued by thinning history, say so once and
  // briefly. Silently thinning history is the kind of thing that later reads
  // as data loss; a line saying what happened is not.
  const [roomMade, setRoomMade] = useState(null)
  useEffect(() => {
    const onFail = () => setSaveFailed(true)
    const onRoom = (e) => {
      setRoomMade(e.detail?.removed ?? 0)
      setTimeout(() => setRoomMade(null), 8000)
    }
    window.addEventListener(PERSIST_FAILED_EVENT, onFail)
    window.addEventListener(ROOM_MADE_EVENT, onRoom)
    return () => {
      window.removeEventListener(PERSIST_FAILED_EVENT, onFail)
      window.removeEventListener(ROOM_MADE_EVENT, onRoom)
    }
  }, [])

  // A newer build than the one running. Checked once shortly after load and
  // again whenever the tab comes back into view, no more than every few
  // minutes: an installed app can sit open for days, and "did my change
  // deploy?" should be answered on screen rather than by clearing caches.
  const [update, setUpdate] = useState(null)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let last = 0
    let timer = null
    const check = () => {
      if (Date.now() - last < 5 * 60_000) return
      last = Date.now()
      checkForUpdate().then((newer) => { if (newer) setUpdate(newer) })
    }
    timer = setTimeout(check, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    const online = () => setOffline(false)
    const away = () => setOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', away)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', away)
    }
  }, [])

  // One shared card-detail sheet for the whole app, so a card opened from a
  // deck, from search, or from the guide all behave identically.
  const openCard = useCallback((card) => setDetailCard(card), [])
  const closeCard = useCallback(() => setDetailCard(null), [])

  const view = useMemo(() => {
    switch (tab) {
      case 'cards': return <CardsView onOpenCard={openCard} offline={offline} seedQuery={seedQuery} />
      case 'decks': return (
        <DecksView
          onOpenCard={openCard}
          offline={offline}
          seed={deckSeed}
          onSeedConsumed={() => setDeckSeed(null)}
        />
      )
      case 'play':  return <PlayView />
      default:      return (
        <GuideView
          onOpenCard={openCard}
          onNavigate={setTab}
          onExploreQuery={(query) => { setSeedQuery(query); setTab('cards') }}
          onStartDeck={(example, card) => { setDeckSeed({ example, card }); setTab('decks') }}
        />
      )
    }
  }, [tab, openCard, offline, seedQuery, deckSeed])

  // Warm every other view once the first one is up and the browser is idle, so
  // the service worker holds all of them before the connection is needed. Runs
  // once, and never while offline — there would be nothing to fetch.
  useEffect(() => {
    if (offline) return undefined
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const handle = idle(() => {
      for (const [id, load] of Object.entries(VIEWS)) {
        if (id !== tab) load().catch(() => { /* it will load on demand instead */ })
      }
    })
    return () => cancel(handle)
    // Deliberately not keyed on `tab`: this is a one-off warm-up, not something
    // to redo on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline])

  return (
    <div className="app">
      <main className="app__main">
        {update && (
          <div className="banner banner--info row row--wrap" style={{ marginBottom: 'var(--space-4)', alignItems: 'center' }} role="status">
            <span style={{ flex: '1 1 16rem' }}>
              A newer version of this app was published
              {minutesAgo(update) !== null ? ` ${minutesAgo(update)} minute${minutesAgo(update) === 1 ? '' : 's'} ago` : ''}
              {' '}(build {update.sha}). Reload to get it; your decks stay where they are.
            </span>
            <button className="btn btn--primary btn--sm" onClick={reloadForUpdate}>Reload</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setUpdate(null)}>Later</button>
          </div>
        )}
        {roomMade !== null && (
          <div className="banner banner--warn" style={{ marginBottom: 'var(--space-4)' }} role="status">
            Saved — but storage was nearly full, so {roomMade} automatic version
            checkpoint{roomMade === 1 ? ' was' : 's were'} dropped to make room. Labelled versions were kept.
            Consider a backup.
          </div>
        )}
        {saveFailed && (
          <div className="banner banner--error" style={{ marginBottom: 'var(--space-4)' }} role="alert">
            A change could not be saved — the browser refused the write, usually because storage
            is full or disabled. What you see is still here for this session. Use
            <strong> Download all data</strong> on any deck&rsquo;s Import / export tab to keep it.
          </div>
        )}
        {offline && (
          <div className="banner banner--warn" style={{ marginBottom: 'var(--space-4)' }}>
            Offline — your decks, the guide and the life counter all still work.
            Card search is limited to what you have already looked at.
          </div>
        )}
        {/* A view arriving a frame late should not collapse the layout, so the
            fallback holds the same space rather than emptying the page. */}
        <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
          {view}
        </Suspense>
      </main>

      <nav className="app__nav" aria-label="Main">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <CardDetail card={detailCard} onClose={closeCard} onOpenCard={openCard} />
    </div>
  )
}

/* Inline icons — four small shapes are not worth an icon library, and this way
   they inherit currentColor and never arrive after first paint. */
const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round', strokeLinejoin: 'round',
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" {...stroke}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
}
function DeckIcon() {
  return <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="6" width="12" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12" /></svg>
}
function LifeIcon() {
  return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 20s-7-4.5-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.5 12 20 12 20Z" /></svg>
}
function GuideIcon() {
  return <svg viewBox="0 0 24 24" {...stroke}><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 0-2 2Z" /><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 1 2 2Z" /></svg>
}
