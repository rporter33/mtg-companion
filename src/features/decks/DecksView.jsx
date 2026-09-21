import { Suspense, lazy, useEffect, useState } from 'react'
import { listDecks, saveDeck, deleteDeck, loadState } from '../../lib/storage.js'
import { backupStatus } from '../../lib/data-safety.js'
import BackupNudge from './BackupNudge.jsx'
import { createDeck, deckFromSeed } from '../../lib/deck.js'
import { FORMAT_GROUPS, formatsInGroup, getFormat } from '../../lib/formats.js'
import DeckEditor from './DeckEditor.jsx'
import LegalityChanges from './LegalityChanges.jsx'
import useLegalityWatch from './useLegalityWatch.js'
import Term from '../../components/Term.jsx'
import { navigate } from '../../lib/router.js'
import DeckArt from '../../components/DeckArt.jsx'
import Confirm from '../../components/Confirm.jsx'
import { artUrl, faceIdFor } from '../../lib/deck-art.js'
import { getCard, pinCards } from '../../lib/cache.js'
import { getPrefs } from '../../lib/storage.js'
import { decorFor, useThemeSet } from '../../lib/theme-set.js'
import './decks.css'

/*
 * The rarer screens load on demand: the first-deck flow, the data screen,
 * and inside the editor the playtest, history and import tabs. Opening the
 * deck list should not download the colour dial. As in App.jsx, this is
 * safe only because of the prefetch: once this chunk is up and the browser
 * is idle, the rest are pulled in so the service worker holds them before
 * the connection is needed.
 */
const LAZY = {
  FirstDeck: () => import('./FirstDeck.jsx'),
  YourData: () => import('./YourData.jsx'),
  DeckPlaytest: () => import('./DeckPlaytest.jsx'),
  DeckHistory: () => import('./DeckHistory.jsx'),
  DeckImportExport: () => import('./DeckImportExport.jsx'),
}
const FirstDeck = lazy(LAZY.FirstDeck)
const YourData = lazy(LAZY.YourData)
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500))
  idle(() => { for (const load of Object.values(LAZY)) load().catch(() => {}) })
}
const Loading = () => <div className="view-loading" aria-busy="true" />

export default function DecksView({ onOpenCard, offline, route, seed, onSeedConsumed }) {
  // The deck a delete is being asked about, or null: the question is a
  // dialog in the house style rather than the browser's own.
  const [deleting, setDeleting] = useState(null)
  const [decks, setDecks] = useState(() => listDecks())
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(null)
  const { report, summary, dismiss } = useLegalityWatch({ enabled: !offline })
  const themeSet = useThemeSet()

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

  // The first-deck flow saves a deck of its own while this screen is still
  // mounted underneath it, so the list is re-read on the way back out.
  useEffect(() => { if (!route?.starting) refresh() }, [route?.starting])

  /**
   * A commander or example deck handed over from the Learn tab. Creating the
   * deck here rather than there keeps deck creation in one place, so the format
   * defaults and naming stay consistent however you arrive.
   *
   * An example opens on Import / export with its list waiting to be reviewed.
   * A commander is already seated by the time the deck is saved, so it opens
   * on the list and leaves nothing pending: a hand-over that nothing consumed
   * used to sit here and seat nobody.
   */
  useEffect(() => {
    if (!seed) return
    const { example } = seed
    const deck = deckFromSeed(seed)
    saveDeck(deck)
    if (deck.commanders.length) pinCards(deck.commanders)
    refresh()
    setPending(example ? { kind: 'example', example } : null)
    openDeck(deck.id, example ? 'io' : null)
    onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  if (showingData) {
    return <Suspense fallback={<Loading />}><YourData onClose={() => showData(false)} onChanged={refresh} /></Suspense>
  }

  if (route?.starting) {
    return <Suspense fallback={<Loading />}><FirstDeck onOpenCard={onOpenCard} /></Suspense>
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
        <h1 className="grow">Decks</h1>
        <button className="btn btn--ghost btn--sm" onClick={() => showData(true)}>Your data</button>
        <button className="btn btn--sm" onClick={() => navigate({ tab: 'decks', starting: true })}>Start a deck</button>
        <button className="btn btn--primary" onClick={() => setCreating(true)}>New deck</button>
      </div>
      {(backup.level === 'never' || backup.level === 'stale') && (
        <button className="banner banner--warn tiny banner--button" onClick={() => showData(true)}>
          <BackupNudge backup={backup} /> Tap to download one.
        </button>
      )}
      <ContinueBuilding decks={decks} />

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
        <div className="empty stack row--middle">
          <img className="empty__art" src={decorFor(themeSet).emptyState} alt="" aria-hidden="true" width="160" height="120" />
          <h3>No decks yet</h3>
          <p>
            Never built one? Pick a colour, say how you like to play, choose a commander, and
            build a starting list by role. Or start blank and this app checks it against the
            format&rsquo;s real rules as you go — deck size, copy limits,
            {' '}<Term id="colorIdentity">colour identity</Term>, and the current ban list.
          </p>
          <button className="btn btn--primary" onClick={() => navigate({ tab: 'decks', starting: true })}>Start your first deck</button>
        </div>
      )}

      <div className="deck-list">
        {decks.map((deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            onOpen={() => openDeck(deck.id)}
            onDelete={() => setDeleting(deck)}
          />
        ))}
      </div>

      {decks.length > 0 && (
        // Each deck card shows a painting cropped from its card, so the credit the crop lost is said here.
        <p className="faint tiny">
          Deck art is the property of Wizards of the Coast and the artists named on each card,
          shown under the Fan Content Policy. Unofficial, and not endorsed by Wizards.
        </p>
      )}

      <Confirm
        open={Boolean(deleting)}
        title={deleting ? `Delete ${deleting.name}` : ''}
        onClose={() => setDeleting(null)}
        actions={[
          { label: deleting ? `Delete ${deleting.name}` : 'Delete', kind: 'danger', onPress: () => { deleteDeck(deleting.id); setDeleting(null); refresh() } },
          { label: 'Keep it', kind: 'ghost', onPress: () => setDeleting(null) },
        ]}
      >
        The deck goes, with every version in its history. This cannot be undone.
      </Confirm>
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
  const themeSet = useThemeSet()

  return (
    <div className={`panel panel--tinted deck-card ${art ? 'deck-card--art' : 'deck-card--back'}`} data-identity={identity}>
      {art
        ? <DeckArt src={art.src} cardId={art.id} className="deck-art--card" />
        : <img className="deck-card__back" src={decorFor(themeSet).cardBack} alt="" aria-hidden="true" width="40" height="56" loading="lazy" />}
      <button className="deck-card__open" onClick={onOpen}>
        <h3>{deck.name}</h3>
        <div className="row row--wrap mt2">
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
      <label className="stack stack--tight">
        <span className="faint tiny">Deck name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled deck" autoFocus />
      </label>

      <div className="stack stack--snug">
        <span className="faint tiny">Format</span>
        {FORMAT_GROUPS.map((group) => (
          <div key={group.id}>
            <div className="faint tiny mb1">{group.label}</div>
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
          <div className="tiny mt2">
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


/**
 * A first deck left unfinished is offered back, with where it stands. The
 * flow itself remembers the deck and the step; this only reads that memory,
 * and says nothing once the deck is deleted or the list is complete.
 */
function ContinueBuilding({ decks }) {
  const saved = getPrefs().firstDeck
  const deck = saved?.deckId ? decks.find((d) => d.id === saved.deckId) : null
  if (!deck) return null
  const count = deck.main.reduce((n, e) => n + e.quantity, 0)
  if (count >= 99) return null
  return (
    <button
      className="banner banner--info banner--button"
      onClick={() => navigate({ tab: 'decks', starting: true, step: saved.step ?? null })}
    >
      <strong>Continue building {deck.name}</strong> — {count} of 99 cards so far. Pick up where you left off.
    </button>
  )
}
