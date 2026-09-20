import { useMemo, useState } from 'react'
import { FORMATS } from '../../lib/formats.js'
import { libraryOf } from '../../lib/board/deck.js'
import { navigate } from '../../lib/router.js'

/**
 * The lobby: pick a deck, see who is at the table, start.
 *
 * Its shape is Moxgate's (docs/table-rebuild/TARGET.md §2) — format tabs, a
 * search, a shelf of decks, a seats panel on the right, and one line that
 * changes with who is seated. That line is the honest part: with no engine
 * yet there is nobody to seat, and it says so rather than offering a button
 * that does nothing.
 *
 * Only what exists is shown. A deck's format, its size and whether it has a
 * commander are facts the deck carries; colours and art need its cards, which
 * arrive with the next commit, and there is no bracket because nothing in
 * this app knows one.
 */

/* The tabs Moxgate shows first, in its order; every other format is behind "More". */
const FRONT = ['commander', 'standard', 'pauper']

export default function Lobby({ decks }) {
  const counts = useMemo(() => countBy(decks, (d) => d.formatId), [decks])
  const [format, setFormat] = useState(() => firstWithDecks(counts))
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(null)
  const [more, setMore] = useState(false)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return decks
      .filter((d) => d.formatId === format)
      .filter((d) => !q || d.name.toLowerCase().includes(q))
  }, [decks, format, query])
  const chosenDeck = shown.find((d) => d.id === chosen) ?? null
  const rest = Object.keys(FORMATS).filter((id) => !FRONT.includes(id))

  const start = (deck) => navigate({ tab: 'game', gameDeckId: deck.id })

  return (
    <div className="lobby">
      <header className="lobby__head">
        <h1 className="lobby__title">
          <span className="lobby__mode">Solo:</span> {FORMATS[format]?.name ?? format}
        </h1>
        <p className="muted m0">{blurb(format)}</p>
      </header>

      <nav className="lobby__formats" aria-label="Format">
        <span className="lobby__label">Format</span>
        {FRONT.map((id) => <FormatTab key={id} id={id} current={format} count={counts[id]} onPick={setFormat} />)}
        <button
          type="button"
          className={`chip lobby__tab${more ? ' lobby__tab--on' : ''}`}
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          ▾ More
        </button>
        {more && rest.map((id) => <FormatTab key={id} id={id} current={format} count={counts[id]} onPick={setFormat} />)}
      </nav>

      <div className="lobby__body">
        <section className="lobby__decks" aria-label="Decks">
          <div className="lobby__tools">
            <label className="sr-only" htmlFor="lobby-find">Search decks</label>
            <input
              id="lobby-find"
              className="input lobby__find"
              type="search"
              placeholder="Search decks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="lobby__tiles">
            <button
              type="button"
              className="lobby__tile"
              disabled={!shown.length}
              onClick={() => start(shown[Math.floor(Math.random() * shown.length)])}
            >
              <span className="lobby__tilekind">Wildcard</span>
              <span className="lobby__tilename">Random deck</span>
            </button>
            <button type="button" className="lobby__tile" onClick={() => navigate({ tab: 'decks', deckTab: 'io' })}>
              <span className="lobby__tilekind">Import</span>
              <span className="lobby__tilename">My decks</span>
              <span className="lobby__tilenote">Paste a decklist to brew your own</span>
            </button>
          </div>

          {!decks.length ? (
            <div className="banner banner--info">
              There is nothing to play yet. Build or import a deck and it will appear here.
              <div className="row" style={{ marginTop: 'var(--space-2)' }}>
                <button className="btn btn--primary btn--sm" onClick={() => navigate({ tab: 'decks' })}>Go to Decks</button>
              </div>
            </div>
          ) : !shown.length ? (
            <p className="faint" role="status">
              {query.trim() ? 'No deck here matches.' : `You have no ${FORMATS[format]?.name ?? format} decks yet.`}
            </p>
          ) : (
            <ul className="lobby__shelf" role="list">
              {shown.map((deck) => (
                <li key={deck.id}>
                  <button
                    type="button"
                    className={`lobby__deck${chosen === deck.id ? ' lobby__deck--chosen' : ''}`}
                    aria-pressed={chosen === deck.id}
                    onClick={() => setChosen(deck.id)}
                  >
                    <span className="lobby__deckname">{deck.name}</span>
                    <span className="lobby__deckmeta faint tiny">
                      {sizeOf(deck)}
                    </span>
                    {chosen === deck.id && <span className="lobby__tick" aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="lobby__seats" aria-label="Table">
          <h2 className="lobby__label">Table · 1 / 2</h2>
          <ul className="lobby__seatlist" role="list">
            <li className="lobby__seat lobby__seat--you">
              <span className="lobby__avatar" aria-hidden="true">Y</span>
              <span>You</span>
            </li>
            <li className="lobby__seat lobby__seat--open">
              <span className="lobby__avatar" aria-hidden="true">2</span>
              <span className="faint">
                Open seat
                <span className="tiny"> · nobody to seat yet</span>
              </span>
            </li>
          </ul>
          {/*
            Moxgate's line changes from "Solitaire: no opponent yet" to
            "Rules Enforced: the engine runs the game" once someone is seated.
            Ours changes the same way when the engine lands; until then it
            tells the truth about what starting will get you.
          */}
          <p className="lobby__notice tiny">
            <strong>Solitaire:</strong> no opponent yet. You will be drawing and casting on your own —
            good for testing a deck. Opponents arrive with the engine.
          </p>
        </aside>
      </div>

      <footer className="lobby__foot">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!chosenDeck}
          onClick={() => chosenDeck && navigate({ tab: 'decks', deckId: chosenDeck.id })}
        >
          Preview deck
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!chosenDeck}
          onClick={() => chosenDeck && start(chosenDeck)}
        >
          {chosenDeck ? `Start game with ${chosenDeck.name} →` : 'Start game →'}
        </button>
      </footer>
    </div>
  )
}

function FormatTab({ id, current, count = 0, onPick }) {
  return (
    <button
      type="button"
      className={`chip lobby__tab${current === id ? ' lobby__tab--on' : ''}`}
      aria-pressed={current === id}
      onClick={() => onPick(id)}
    >
      {FORMATS[id]?.name ?? id}
      {count > 0 && <span className="lobby__count">{count}</span>}
    </button>
  )
}

/** One line under the title, the way Moxgate's says "100-card singleton". */
function blurb(format) {
  switch (format) {
    case 'commander': return '100-card singleton.'
    case 'pauper': return 'Sixty cards, commons only.'
    case 'brawl': return 'Sixty-card singleton with a commander.'
    default: return FORMATS[format] ? 'Sixty cards.' : ''
  }
}

function sizeOf(deck) {
  const n = libraryOf(deck).length
  const command = deck.commanders?.length ?? 0
  return `${n} cards${command ? ` · ${command} in the command zone` : ''}`
}

function countBy(list, key) {
  const out = {}
  for (const item of list) { const k = key(item); out[k] = (out[k] ?? 0) + 1 }
  return out
}

/** Open on the first front tab that has decks, so the shelf is never empty by default. */
function firstWithDecks(counts) {
  return FRONT.find((id) => counts[id]) ?? Object.keys(counts).find((id) => FORMATS[id]) ?? 'commander'
}
