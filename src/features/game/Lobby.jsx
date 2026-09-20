import { useMemo, useState } from 'react'
import { FORMATS } from '../../lib/formats.js'
import { libraryOf } from '../../lib/board/deck.js'
import { unionColorIdentity } from '../../lib/deck.js'
import { artUrl, faceIdFor } from '../../lib/deck-art.js'
import { getPrefs } from '../../lib/storage.js'
import { navigate } from '../../lib/router.js'
import { EXAMPLE_DECKS } from '../../data/example-decks.js'
import DeckArt from '../../components/DeckArt.jsx'
import ManaCost from '../../components/ManaCost.jsx'
import useShelfCards from './useShelfCards.js'

/**
 * The lobby: pick a deck, see who is at the table, start.
 *
 * Its shape is Moxgate's (docs/table-rebuild/TARGET.md §2) — format tabs, a
 * search, a colours filter whose chips carry counts, three tiles, a shelf of
 * decks with art and pips, a seats panel on the right, and one line that
 * changes with who is seated. That line is the honest part: with no engine
 * yet there is nobody to seat, and it says so rather than offering a button
 * that does nothing.
 *
 * Only what is known is shown. A deck's colour identity is the union of its
 * commanders' — the same arithmetic the deck checker uses — so the pips and
 * the colours filter exist on the Commander-family tabs, where that is a
 * fact, and not on the sixty-card tabs, where it would take every card in the
 * deck to say. There is no bracket filter because nothing in this app knows a
 * deck's bracket, and a filter with nothing behind it is not a filter.
 */

/* The tabs Moxgate shows first, in its order; every other format is behind "More". */
const FRONT = ['commander', 'standard', 'pauper']
const COLOURS = ['W', 'U', 'B', 'R', 'G']

export default function Lobby({ decks }) {
  const counts = useMemo(() => countBy(decks, (d) => d.formatId), [decks])
  const [format, setFormat] = useState(() => firstWithDecks(counts))
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(null)
  const [more, setMore] = useState(false)
  const [wanted, setWanted] = useState(() => new Set())
  const [exactly, setExactly] = useState(false)

  const inFormat = useMemo(() => decks.filter((d) => d.formatId === format), [decks, format])
  const cards = useShelfCards(inFormat)
  const showImages = getPrefs().showCardImages !== false
  const commanderFamily = FORMATS[format]?.group === 'commander'

  // What the shelf knows about each deck, from the few cards it loaded.
  const info = useMemo(() => {
    const out = new Map()
    for (const deck of inFormat) out.set(deck.id, describe(deck, cards, { showImages, commanderFamily }))
    return out
  }, [inFormat, cards, showImages, commanderFamily])

  // Facet counts are taken before the colour filter is applied, so a chip
  // always says how many decks are behind it rather than how many are left.
  const facet = useMemo(() => {
    const out = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
    for (const deck of inFormat) {
      const identity = info.get(deck.id)?.identity
      if (!identity) continue
      if (identity.length === 0) out.C++
      for (const c of identity) out[c]++
    }
    return out
  }, [inFormat, info])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inFormat
      .filter((d) => !q
        || d.name.toLowerCase().includes(q)
        || (info.get(d.id)?.commanderName ?? '').toLowerCase().includes(q))
      .filter((d) => matchesColours(info.get(d.id)?.identity, wanted, exactly))
  }, [inFormat, info, query, wanted, exactly])
  const unknownHidden = wanted.size
    ? inFormat.filter((d) => !info.get(d.id)?.identity && !matchesColours(null, wanted, exactly)).length
    : 0

  const chosenDeck = shown.find((d) => d.id === chosen) ?? null
  const rest = Object.keys(FORMATS).filter((id) => !FRONT.includes(id))
  const guide = useMemo(() => pickGuide(format), [format])

  const start = (deck) => navigate({ tab: 'game', gameDeckId: deck.id })
  const pickFormat = (id) => { setFormat(id); setChosen(null); setWanted(new Set()) }

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
        {FRONT.map((id) => <FormatTab key={id} id={id} current={format} count={counts[id]} onPick={pickFormat} />)}
        <button
          type="button"
          className={`chip lobby__tab${more ? ' lobby__tab--on' : ''}`}
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          ▾ More
        </button>
        {more && rest.map((id) => <FormatTab key={id} id={id} current={format} count={counts[id]} onPick={pickFormat} />)}
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
            {commanderFamily && (
              <ColourFilter facet={facet} wanted={wanted} exactly={exactly}
                onWanted={setWanted} onExactly={setExactly} />
            )}
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
            {guide && (
              <button type="button" className="lobby__tile" onClick={() => navigate({ tab: 'guide' })}>
                <span className="lobby__tilekind">Guide</span>
                <span className="lobby__tilename">{guide.name}</span>
                <span className="lobby__tilenote">rotates every visit</span>
              </button>
            )}
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
              {query.trim() || wanted.size ? 'No deck here matches.' : `You have no ${FORMATS[format]?.name ?? format} decks yet.`}
            </p>
          ) : (
            <ul className="lobby__shelf" role="list">
              {shown.map((deck) => (
                <li key={deck.id}>
                  <DeckTile
                    deck={deck}
                    info={info.get(deck.id)}
                    chosen={chosen === deck.id}
                    onChoose={() => setChosen(deck.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {unknownHidden > 0 && (
            <p className="faint tiny" role="status">
              {unknownHidden === 1 ? 'One deck is' : `${unknownHidden} decks are`} not shown because
              {unknownHidden === 1 ? ' its' : ' their'} colours are not known yet.
            </p>
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

/**
 * One deck on the shelf: painting behind, name, commander and size, pips.
 * The painting is decoration and the pips are spoken by ManaCost, so a
 * screen reader hears "white, green" where a sighted person sees two dots.
 */
function DeckTile({ deck, info, chosen, onChoose }) {
  const pips = info?.identity ? (info.identity.length ? info.identity.map((c) => `{${c}}`).join('') : '{C}') : null
  return (
    <button
      type="button"
      className={`lobby__deck${chosen ? ' lobby__deck--chosen' : ''}${info?.art ? ' lobby__deck--art' : ''}`}
      aria-pressed={chosen}
      onClick={onChoose}
    >
      {info?.art && <DeckArt src={info.art.src} cardId={info.art.id} className="lobby__art" />}
      <span className="lobby__deckbody">
        <span className="lobby__deckname">{deck.name}</span>
        <span className="lobby__deckmeta faint tiny">
          {info?.commanderName ? `${info.commanderName} · ` : ''}{sizeOf(deck, Boolean(info?.commanderName))}
        </span>
        {pips && <ManaCost cost={pips} className="lobby__pips" />}
      </span>
      {chosen && <span className="lobby__tick" aria-hidden="true">✓</span>}
    </button>
  )
}

/**
 * Moxgate's colours dropdown: a chip per colour carrying how many decks are
 * behind it, and "Exactly these" to turn "includes" into "is". Counts stay
 * fixed while you pick, so the chips read as a map of what you have.
 */
function ColourFilter({ facet, wanted, exactly, onWanted, onExactly }) {
  const [open, setOpen] = useState(false)
  const toggle = (c) => {
    const next = new Set(wanted)
    if (next.has(c)) next.delete(c); else next.add(c)
    onWanted(next)
  }
  const label = wanted.size ? `Colours · ${[...COLOURS, 'C'].filter((c) => wanted.has(c)).join('')}` : 'Colours ·'
  return (
    <div className="lobby__filter">
      <button type="button" className={`chip lobby__tab${wanted.size ? ' lobby__tab--on' : ''}`}
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="lobby__facets" role="group" aria-label="Colours">
          {[...COLOURS, 'C'].map((c) => (
            <button
              key={c}
              type="button"
              className={`chip lobby__facet${wanted.has(c) ? ' lobby__tab--on' : ''}`}
              aria-pressed={wanted.has(c)}
              onClick={() => toggle(c)}
            >
              <ManaCost cost={`{${c}}`} />
              <span className="lobby__count">{facet[c]}</span>
            </button>
          ))}
          <button type="button" className={`chip lobby__facet${exactly ? ' lobby__tab--on' : ''}`}
            aria-pressed={exactly} onClick={() => onExactly(!exactly)}>
            Exactly these
          </button>
        </div>
      )}
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

/**
 * What the shelf can say about a deck from the cards it has. `identity` is
 * null when it is not known — a sixty-card deck, or a commander whose card
 * has not arrived — and an empty array when it is known to be colourless.
 * Those are different answers and the filter treats them differently.
 */
function describe(deck, cards, { showImages, commanderFamily }) {
  const face = cards.get(faceIdFor(deck))
  const art = showImages && face && artUrl(face) ? { src: artUrl(face), id: face.id } : null
  const commanders = (deck.commanders ?? []).map((id) => cards.get(id))
  const known = commanderFamily && commanders.length > 0 && commanders.every(Boolean)
  return {
    art,
    identity: known ? unionColorIdentity(commanders) : null,
    commanderName: commanders.filter(Boolean).map((c) => c.name).join(' / ') || null,
  }
}

function matchesColours(identity, wanted, exactly) {
  if (!wanted.size) return true
  if (!identity) return false
  const have = new Set(identity.length ? identity : ['C'])
  if (exactly) return have.size === wanted.size && [...wanted].every((c) => have.has(c))
  return [...wanted].every((c) => have.has(c))
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

/**
 * "Thorin, King of Durin's Folk · 100 cards", the way Moxgate says it. Once
 * the commander is named beside it, "1 in the command zone" repeats what the
 * name already says, so the count becomes the whole deck. Without the name —
 * a commander whose card has not arrived — the split is still worth saying.
 */
function sizeOf(deck, commanderNamed) {
  const n = libraryOf(deck).length
  const command = deck.commanders?.length ?? 0
  if (commanderNamed) return `${n + command} cards`
  return `${n} cards${command ? ` · ${command} in the command zone` : ''}`
}

/** A different example deck each visit, in the current format where one exists. */
function pickGuide(format) {
  const pool = EXAMPLE_DECKS.filter((e) => e.formatId === format)
  const from = pool.length ? pool : EXAMPLE_DECKS
  return from.length ? from[Math.floor(Math.random() * from.length)] : null
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
