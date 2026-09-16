import { useEffect, useState } from 'react'
import { listDecks, saveDeck, deleteDeck } from '../../lib/storage.js'
import { createDeck } from '../../lib/deck.js'
import { FORMAT_GROUPS, formatsInGroup, getFormat } from '../../lib/formats.js'
import DeckEditor from './DeckEditor.jsx'
import LegalityChanges from './LegalityChanges.jsx'
import useLegalityWatch from './useLegalityWatch.js'
import Term from '../../components/Term.jsx'
import './decks.css'

export default function DecksView({ onOpenCard, offline, seed, onSeedConsumed }) {
  const [decks, setDecks] = useState(() => listDecks())
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(null)
  const { report, summary, dismiss } = useLegalityWatch({ enabled: !offline })

  const refresh = () => setDecks(listDecks())

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
    setEditingId(deck.id)
    setPending(example ? { kind: 'example', example } : { kind: 'commander', card })
    onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  if (editingId) {
    const deck = decks.find((d) => d.id === editingId)
    if (!deck) { setEditingId(null); return null }
    return (
      <DeckEditor
        deck={deck}
        onBack={() => { refresh(); setEditingId(null); setPending(null) }}
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
        <button className="btn btn--primary" onClick={() => setCreating(true)}>New deck</button>
      </div>

      <LegalityChanges
        report={report}
        summary={summary}
        onDismiss={dismiss}
        onOpenDeck={(id) => setEditingId(id)}
      />

      {creating && (
        <NewDeckForm
          onCancel={() => setCreating(false)}
          onCreate={(deck) => {
            saveDeck(deck)
            refresh()
            setCreating(false)
            setEditingId(deck.id)
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
            onOpen={() => setEditingId(deck.id)}
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

function DeckCard({ deck, onOpen, onDelete }) {
  const format = getFormat(deck.formatId)
  const count = deck.main.reduce((n, e) => n + e.quantity, 0)
    + (format?.commanderCountsTowardDeck ? deck.commanders.length : 0)
  const target = format?.deck.max ?? format?.deck.min ?? 60
  const identity = deck.identity ?? 'C'

  return (
    <div className="panel panel--tinted deck-card" data-identity={identity}>
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
