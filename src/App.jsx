import { useCallback, useEffect, useMemo, useState } from 'react'
import CardsView from './features/cards/CardsView.jsx'
import DecksView from './features/decks/DecksView.jsx'
import PlayView from './features/play/PlayView.jsx'
import GuideView from './features/guide/GuideView.jsx'
import CardDetail from './features/cards/CardDetail.jsx'
import { loadState } from './lib/storage.js'

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
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false)

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
      case 'decks': return <DecksView onOpenCard={openCard} offline={offline} />
      case 'play':  return <PlayView />
      default:      return (
        <GuideView
          onOpenCard={openCard}
          onNavigate={setTab}
          onExploreQuery={(query) => { setSeedQuery(query); setTab('cards') }}
        />
      )
    }
  }, [tab, openCard, offline, seedQuery])

  return (
    <div className="app">
      <main className="app__main">
        {offline && (
          <div className="banner banner--warn" style={{ marginBottom: 'var(--space-4)' }}>
            Offline — your decks, the guide and the life counter all still work.
            Card search is limited to what you have already looked at.
          </div>
        )}
        {view}
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
