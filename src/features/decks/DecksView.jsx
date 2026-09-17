import { useEffect, useState } from 'react'
import { listDecks, saveDeck, deleteDeck, loadState } from '../../lib/storage.js'
import { backupStatus } from '../../lib/data-safety.js'
import YourData, { BackupNudge } from './YourData.jsx'
import { createDeck } from '../../lib/deck.js'
import { FORMAT_GROUPS, formatsInGroup, getFormat } from '../../lib/formats.js'
import DeckEditor from './DeckEditor.jsx'
import LegalityChanges from './LegalityChanges.jsx'
import useLegalityWatch from './useLegalityWatch.js'
import Term from '../../components/Term.jsx'
import { navigate } from '../../lib/router.js'
import DeckArt from '../../components/DeckArt.jsx'
import { artUrl, faceIdFor } from '../../lib/deck-art.js'
import { getCard } from '../../lib/cache.js'
import { getPrefs } from '../../lib/storage.js'
import './decks.css'

export default function DecksView({ onOpenCard, offline, route, seed, onSeedConsumed }) {
  const [decks, setDecks] = useState(() => listDecks())
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(null)
  const { report, summary, dismiss } = useLegalityWatch({ enabled: !offline })

  // Which deck is open, and whether the data screen is, come from the URL.
  const editingId = route?.deckId ?? null
  const showingData = !!route?.data
  const openDeck = (id, deckTab = null) => navigate({ tab: 'decks', deckId: id, deckTab, data: false })
  const closeDeck = () => navigate({ tab: 'decks', deckId: null, deckTab: null, data: false })
  const showData = (on) => navigate({ tab: 'decks', data: on, deckId: null, deckTab: null }, { replace: !on })

  // A link to a deck that no longer exists goes back to the list rather than
  // rendering nothing. Checked against storage, not the decks in state: a
  // route change is flushed synchronously by React while a state update from
  // the same effect is still batched, so right after creating a deck one
  // render sees the new URL with the old list. Judging by that render sent
  // every new deck straight back to the list.
  useEffect(() => {
    if (editingId && !listDecks().some((d) => d.id === editingId)) closeDeck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const refresh = () => setDecks(listDecks())
  const backup = backupStatus(loadState())

  /**
   * A commander or example deck handed over from the Learn tab. Creating the
   * deck here rather than there keeps deck creation in one place, so the format
   * defaults and naming stay consistent however you arrive.
   */
  useEffect(() => {
    if (!seed) return
    const { example, card } = seed
    const deck = createDeck({
      name: example?.name ?? (card ? `${card.name} deck` : 'Untitled deck'),
      formatId: example?.formatId ?? 'commander',
    })
    saveDeck(deck)
    refresh()
    setPending(example ? { kind: 'example', example } : { kind: 'commander', card })
    openDeck(deck.id, example ? 'io' : null)
    onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  if (showingData) {
    return <YourData onClose={() => showData(false)} onChanged={refresh} />
  }

  if (editingId) {
    const deck = decks.find((d) => d.id === editingId) ?? listDecks().find((d) => d.id === editingId)
    if (!deck) return null
    return (
      <DeckEditor
        deck={deck}
        tab={route?.deckTab ?? 'list'}
        onTab={(id) => navigate({ deckTab: id }, { replace: true })}
        onBack={() => { refresh(); setPending(null); closeDeck() }}
        onChange={(next) => { saveDeck(next); refresh() }}
        onOpenCard={onOpenCard}
        offline={offline}
        pending={pending}
        onPendingConsumed={() => setPending(null)}
      />
    )
  }

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ flex: 1 }}>Decks</h1>
        <button className="btn btn--ghost btn--sm" onClick={() => showData(true)}>Your data</button>
        <button className="btn btn--primary" onClick={() => setCreating(true)}>New deck</button>
      </div>
      {(backup.level === 'never' || backup.level === 'stale') && (
        <button className="banner banner--warn tiny" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => showData(true)}>
          <BackupNudge backup={backup} /> Tap to download one.
        </button>
      )}
      <div style={{ display: 'none' }}>
      </div>

      <LegalityChanges
        report={report}
        summary={summary}
        onDismiss={dismiss}
        onOpenDeck={(id) => openDeck(id)}
      />

      {creating && (
        <NewDeckForm
          onCancel={() => setCreating(false)}
          onCreate={(deck) => {
            saveDeck(deck)
            refresh()
            setCreating(false)
            openDeck(deck.id)
          }}
        />
      )}

      {!decks.length && !creating && (
        <div className="empty">
          <h3>No decks yet</h3>
          <p>
            Build one and this app checks it against the format&rsquo;s real rules as you go —
            deck size, copy limits, <Term id="colorIdentity">colour identity</Term>, and the
            current ban list.
          </p>
        </div>
      )}

      <div className="deck-list">
        {decks.map((deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => openDeck(deck.id)}
            onDelete={() => {
              if (confirm(`Delete "${deck.name}"? This cannot be undone.`)) {
                deleteDeck(deck.id)
                refresh()
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The painting for a deck on the list screen, where no cards are loaded.
 * One read from the card cache — every card in a deck is pinned there — so
 * ten decks cost ten reads, not a thousand.
 */
function useFaceArt(deck) {
  const faceId = faceIdFor(deck)
  const [art, setArt] = useState(null)
  useEffect(() => {
    let live = true
    if (!faceId || getPrefs().showCardImages === false) { setArt(null); return undefined }
    getCard(faceId).then((hit) => { if (live) setArt(hit ? { src: artUrl(hit.card), id: faceId } : null) })
    return () => { live = false }
  }, [faceId])
  return art?.src ? art : null
}

function DeckCard({ deck, onOpen, onDelete }) {
  const format = getFormat(deck.formatId)
  const count = deck.main.reduce((n, e) => n + e.quantity, 0)
    + (format?.commanderCountsTowardDeck ? deck.commanders.length : 0)
  const target = format?.deck.max ?? format?.deck.min ?? 60
  const identity = deck.identity ?? 'C'
  const art = useFaceArt(deck)

  return (
    <div className={`panel panel--tinted deck-card ${art ? 'deck-card--art' : ''}`} data-identity={identity}>
      {art && <DeckArt src={art.src} cardId={art.id} className="deck-art--card" />}
      <button className="deck-card__open" onClick={onOpen}>
        <h3>{deck.name}</h3>
        <div className="row row--wrap" style={{ marginTop: 'var(--space-2)' }}>
          <span className="chip">{format?.name ?? deck.formatId}</span>
          <span className={`chip ${count === target ? 'chip--ok' : ''}`}>
            {count}/{target} cards
          </span>
        </div>
      </button>
      <button className="btn btn--sm btn--ghost btn--danger" onClick={onDelete} aria-label={`Delete ${deck.name}`}>
        ✕
      </button>
    </div>
  )
}

function NewDeckForm({ onCreate, onCancel }) {
  const [name, setName] = useState('')
  const [formatId, setFormatId] = useState('commander')
  const format = getFormat(formatId)

  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault()
        onCreate(createDeck({ name: name.trim() || 'Untitled deck', formatId }))
      }}
    >
      <label className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="faint tiny">Deck name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled deck" autoFocus />
      </label>

      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        <span className="faint tiny">Format</span>
        {FORMAT_GROUPS.map((group) => (
          <div key={group.id}>
            <div className="faint tiny" style={{ marginBottom: 4 }}>{group.label}</div>
            <div className="row row--wrap">
              {formatsInGroup(group.id).map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`chip ${formatId === f.id ? 'chip--active' : ''}`}
                  onClick={() => setFormatId(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {format && (
        <div className="banner banner--info">
          <strong>{format.name}.</strong> {format.blurb}
          <div style={{ marginTop: 'var(--space-2)' }} className="tiny">
            {format.deck.max === format.deck.min
              ? `Exactly ${format.deck.min} cards`
              : `At least ${format.deck.min} cards`}
            {' · '}
            {format.singleton ? 'one copy of each card' : `up to ${format.maxCopies} copies of each card`}
            {' · '}
            {format.startingLife} starting life
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn btn--primary" type="submit">Create deck</button>
        <button className="btn btn--ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
