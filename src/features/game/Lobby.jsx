import { useEffect, useMemo, useState } from 'react'
import { FORMATS } from '../../lib/formats.js'
import { libraryOf } from '../../lib/board/deck.js'
import { unionColorIdentity } from '../../lib/deck.js'
import { artUrl, faceIdFor } from '../../lib/deck-art.js'
import { getPrefs } from '../../lib/storage.js'
import { navigate } from '../../lib/router.js'
import { EXAMPLE_DECKS } from '../../data/example-decks.js'
import { byReason, nameList, reasonText } from '../../lib/engine/deck.js'
import Confirm from '../../components/Confirm.jsx'
import DeckArt from '../../components/DeckArt.jsx'
import ManaCost from '../../components/ManaCost.jsx'
import useShelfCards from './useShelfCards.js'
import useEngineCheck from './useEngineCheck.js'
import { agreeToLeaveOut } from './useEngineRoom.js'
import { relayAddress } from './relayAddress.js'
import Seats from './Seats.jsx'

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

export default function Lobby({ decks, room = null, engine = null }) {
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

  const start = (deck) => navigate({ tab: 'game', gameDeckId: deck.id, gameRoom: room, gameEngine: engine })

  // At the engine's table every deck on the shelf is asked about before anyone
  // sits: one the engine cannot fully hold says so on its tile, and pressing
  // Sit with it says why and offers what can be done instead.
  const checks = useEngineCheck({ address: engine ? relayAddress() : null, decks: inFormat, first: chosen })
  const [pending, setPending] = useState(null)
  const [gate, setGate] = useState(null)
  const sit = (deck) => {
    if (!engine) { start(deck); return }
    const check = checks.get(deck.id)
    // No answer at all means nothing was asked, which is a lobby with no relay
    // address: sit as before, and the table says the relay is not set.
    if (!check) { start(deck); return }
    if (check.state === 'asking') { setPending(deck.id); return }
    setPending(null)
    if (check.state === 'short') { setGate(deck.id); return }
    // Complete, or not checkable: sit as before. The engine still refuses a
    // card it does not know, by name, so nothing is dealt short unremarked.
    start(deck)
  }
  // A press made while the answer was still coming is carried out when it
  // arrives, rather than refused or asked for again: one press, one sit.
  const pendingState = pending ? checks.get(pending)?.state : null
  useEffect(() => {
    if (!pending || !pendingState || pendingState === 'asking') return
    const deck = inFormat.find((d) => d.id === pending)
    setPending(null)
    if (deck) sit(deck)
    // The answer arriving is what this waits for; sit is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, pendingState])
  const choose = (id) => { setChosen(id); if (pending && pending !== id) setPending(null) }
  const gateDeck = gate ? inFormat.find((d) => d.id === gate) ?? null : null
  const gateCheck = gate ? checks.get(gate) : null
  const playAlone = (deck) => { setGate(null); navigate({ tab: 'game', gameDeckId: deck.id, gameRoom: null, gameEngine: null }) }
  const playWithout = (deck, names) => { setGate(null); agreeToLeaveOut(engine, deck.id, names); start(deck) }
  // The Wildcard at the engine's table draws from the decks it fully knows,
  // once any have been checked, so a random press lands on a game.
  const known = engine ? shown.filter((d) => checks.get(d.id)?.state === 'complete') : []
  const wildcards = known.length ? known : shown

  const pickFormat = (id) => { setFormat(id); setChosen(null); setWanted(new Set()); setPending(null); setGate(null) }

  return (
    <div className="lobby">
      <header className="lobby__head">
        <h1 className="lobby__title">
          <span className="lobby__mode">{engine ? 'Rules enforced:' : room ? 'Together:' : 'Solo:'}</span> {FORMATS[format]?.name ?? format}
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
              onClick={() => {
                // Chosen as well as sat with, so a press held for the engine's
                // answer shows on the footer and is not cancelled by the shelf.
                const pick = wildcards[Math.floor(Math.random() * wildcards.length)]
                setChosen(pick.id)
                sit(pick)
              }}
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
                    check={checks.get(deck.id)}
                    onChoose={() => choose(deck.id)}
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

        <Seats room={room} engine={engine} />
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
          aria-busy={Boolean(chosenDeck && pending === chosenDeck.id)}
          onClick={() => chosenDeck && pending !== chosenDeck.id && sit(chosenDeck)}
        >
          {chosenDeck && pending === chosenDeck.id
            ? `Asking the engine about ${chosenDeck.name}…`
            : room || engine
            ? (chosenDeck ? `Sit down with ${chosenDeck.name} →` : 'Sit down →')
            : (chosenDeck ? `Start game with ${chosenDeck.name} →` : 'Start game →')}
        </button>
      </footer>
      {gateDeck && gateCheck && (
        <DeckGate
          deck={gateDeck}
          check={gateCheck}
          onWithout={(names) => playWithout(gateDeck, names)}
          onAlone={() => playAlone(gateDeck)}
          onClose={() => setGate(null)}
        />
      )}
      {/* The shelf shows paintings cropped from their cards, so the credit the crop lost is said here. */}
      <p className="faint tiny lobby__credit">
        Deck art is the property of Wizards of the Coast and the artists named on each card,
        shown under the Fan Content Policy. Unofficial, and not endorsed by Wizards.
      </p>
    </div>
  )
}

/**
 * One deck on the shelf: painting behind, name, commander and size, pips.
 * The painting is decoration and the pips are spoken by ManaCost, so a
 * screen reader hears "white, green" where a sighted person sees two dots.
 */
function DeckTile({ deck, info, chosen, check, onChoose }) {
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
        <DeckCheck check={check} />
      </span>
      {chosen && <span className="lobby__tick" aria-hidden="true">✓</span>}
    </button>
  )
}

/**
 * What the engine said about a deck, on its tile. Every number is the deck's
 * own count or the engine's answer; the one thing worked out here, that some
 * cards did not load, is said as that. The cards it does not know are named a
 * line per reason, each reason from the engine's own set list (verdictOf), so
 * a deck of twenty cards from a set it has not got says that once.
 */
function DeckCheck({ check }) {
  if (!check) return null
  const { state, total, known, unknown = [], unloaded } = check
  const lines = []
  if (state === 'asking') lines.push('Asking the engine about these cards…')
  else if (state === 'complete') lines.push(total === 1 ? 'The engine knows its one card.' : `The engine knows all ${total} cards.`)
  else if (state === 'short') {
    if (unknown.length) {
      lines.push(`The engine knows ${known} of ${total} cards.`)
      for (const group of byReason(unknown)) {
        lines.push(`${reasonText(group.reason, group.cards.length > 1)}: ${nameList(group.cards.map((u) => u.name))}.`)
      }
    }
    if (unloaded) lines.push(unloaded === 1 ? 'One card did not load, so the engine was not asked about it.' : `${unloaded} cards did not load, so the engine was not asked about them.`)
  } else if (state === 'cannot-check') lines.push('This relay cannot check a deck, so this one has not been checked.')
  else if (state === 'no-engine') lines.push('The relay has no engine now, so this deck cannot be checked.')
  else if (state === 'failed') lines.push(`The engine could not check this deck: ${check.message}`)
  else if (state === 'unreadable') lines.push("The relay's answer could not be read, so this deck has not been checked.")
  else lines.push('The relay did not answer, so this deck has not been checked.')
  // Not a reason to stop: the owner chose (2026-09-21) that a sideboard card the
  // engine does not know is left out and said, since only a wish could fetch it.
  const side = check.unknownSideboard ?? []
  if (side.length) lines.push(`Left out of the sideboard, as the engine does not know ${side.length === 1 ? 'it' : 'them'}: ${nameList(side.map((u) => u.name))}.`)
  return (
    <span className={`lobby__deckcheck faint tiny${state === 'short' ? ' lobby__deckcheck--short' : ''}`}>
      {lines.map((line) => <span key={line}>{line}</span>)}
    </span>
  )
}

/**
 * Sit was pressed with a deck the engine cannot fully hold. The house dialog:
 * the title is the situation, the body what each choice does, and every
 * button says what pressing it does (src/components/Confirm.jsx). The owner's
 * choice (2026-09-21) is to offer both ways on: the engine without the cards
 * it does not know, the table then saying which were left out, or the whole
 * deck played by hand. Without is offered only when every card loaded, since
 * a card that did not load has no name to leave out, and only when something
 * would be left to deal. The cards are listed under their reasons, as on the
 * tile, when the engine's set list gave any; otherwise one list, as before.
 */
function DeckGate({ deck, check, onWithout, onAlone, onClose }) {
  const unknown = check.unknown ?? []
  const copies = unknown.reduce((sum, u) => sum + u.count, 0)
  const groups = byReason(unknown)
  const reasoned = groups.some((g) => g.reason)
  const item = (u) => <li key={u.name}>{u.count} {u.name}</li>
  const canGoWithout = unknown.length > 0 && !check.unloaded && check.known > 0
  const actions = [
    ...(canGoWithout ? [{ label: `Play the engine without ${copies === 1 ? 'it' : 'them'}`, kind: 'primary', onPress: () => onWithout(unknown.map((u) => u.name)) }] : []),
    { label: 'Play it alone instead', kind: canGoWithout ? 'ghost' : 'primary', onPress: onAlone },
    { label: 'Choose another deck', kind: 'ghost', onPress: onClose },
  ]
  return (
    <Confirm
      open
      title={unknown.length ? `The engine does not know every card in ${deck.name}` : `Not every card in ${deck.name} has loaded`}
      actions={actions}
      onClose={onClose}
    >
      <div className="lobby__gate">
        {unknown.length > 0 && (
          <>
            <p>It does not know {copies === 1 ? 'this one' : 'these'}, so it cannot hold a game with the whole deck:</p>
            <ul className={`lobby__unknown${reasoned ? ' lobby__unknown--grouped' : ''}`} role="list" tabIndex={0} aria-label="Cards the engine does not know">
              {reasoned
                ? groups.map((g) => (
                  <li key={g.cards[0].name}>
                    {reasonText(g.reason, g.cards.length > 1)}:
                    <ul>{g.cards.map(item)}</ul>
                  </li>
                ))
                : unknown.map(item)}
            </ul>
          </>
        )}
        {check.unloaded > 0 && (
          <p>{check.unloaded === 1 ? 'One card did not load, so the engine was not asked about it.' : `${check.unloaded} cards did not load, so the engine was not asked about them.`}</p>
        )}
        {canGoWithout && (
          <p>Without {copies === 1 ? 'it' : 'them'}, the engine deals the other {check.known} cards, and the table says what was left out.</p>
        )}
        <p>Played alone, the whole deck is dealt and you play it by hand: nobody sits opposite, and nothing checks whether a play is legal.</p>
      </div>
    </Confirm>
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
