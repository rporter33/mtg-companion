import { useEffect, useId, useMemo, useState } from 'react'
import { FORMATS, getFormat } from '../../lib/formats.js'
import { libraryOf } from '../../lib/board/deck.js'
import { unionColorIdentity } from '../../lib/deck.js'
import { artUrl, faceIdFor } from '../../lib/deck-art.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { navigate } from '../../lib/router.js'
import { EXAMPLE_DECKS } from '../../data/example-decks.js'
import { byReason, nameList, reasonText, withArticle } from '../../lib/engine/deck.js'
import Confirm from '../../components/Confirm.jsx'
import DeckArt from '../../components/DeckArt.jsx'
import ManaCost from '../../components/ManaCost.jsx'
import useShelfCards from './useShelfCards.js'
import useEngineCheck from './useEngineCheck.js'
import useDeckReadings from './useDeckReadings.js'
import {
  BRACKET_LINE, FLOORS, PLAN_LINE, PLANS, READING_LINE, UNREAD_SENTENCE,
  bracketSentence, floorBadge, floorChip, floorWords, planName, planSentence, shelfLine,
} from '../../lib/deck-reading.js'
import { agreeToLeaveOut, chooseEngineDeck } from './useEngineRoom.js'
import { chosenOpponent, colourWords, engineDeckRecord } from '../../lib/engine/opponent.js'
import { gameName, leaderProblem, leaderWords } from '../../lib/engine/commander.js'
import { standInOffer, standInTileLine } from '../../lib/engine/stand-in.js'
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
 * deck to say.
 *
 * The archetype and bracket are not facts a deck carries, so they are this app's
 * reading of its cards (lib/deck-reading.js), and said to be, above the shelf and
 * beside each filter: the plan most of a deck's cards fit, from the app's own
 * plans for a first deck, and, on the Commander tab, the lowest bracket its Game
 * Changers allow. A deck whose cards have not all arrived is not read, and a filter
 * with no deck read behind it is not offered, since a filter with nothing behind it
 * is not a filter.
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
  const [wantedPlans, setWantedPlans] = useState(() => new Set())
  const [wantedFloors, setWantedFloors] = useState(() => new Set())

  const inFormat = useMemo(() => decks.filter((d) => d.formatId === format), [decks, format])
  const cards = useShelfCards(inFormat)
  const showImages = getPrefs().showCardImages !== false
  const commanderFamily = getFormat(format)?.group === 'commander'
  // The brackets are Wizards' for the Commander format, so they are read on its tab alone.
  const readings = useDeckReadings(inFormat, { brackets: format === 'commander' })

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

  // The same for what this app reads of each deck: a deck counts under each plan
  // it reads as (several where they tie), under "No plan" where it was read and
  // fits none, and under the one bracket its Game Changers allow at the lowest. A
  // deck not read is under none of them, as a deck of unknown colours is.
  const planFacet = useMemo(() => {
    const counts = new Map()
    for (const deck of inFormat) {
      const plan = readings.get(deck.id)?.plan
      if (!plan) continue
      for (const id of plan.top.length ? plan.top : ['none']) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    // Most decks first, as Moxgate's chips run, and the vocabulary's order between equals.
    const order = [...PLANS.map((p) => p.id), 'none']
    return [...counts].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([id, count]) => ({ id, count, text: id === 'none' ? 'No plan' : planName(id) }))
  }, [inFormat, readings])
  const floorFacet = useMemo(() => {
    const read = inFormat.map((d) => readings.get(d.id)?.bracket).filter(Boolean)
    if (!read.length) return []
    return FLOORS.map((floor) => ({ id: floor, count: read.filter((b) => b.floor === floor).length, text: floorChip(floor) }))
  }, [inFormat, readings])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inFormat
      .filter((d) => !q
        || d.name.toLowerCase().includes(q)
        || (info.get(d.id)?.commanderName ?? '').toLowerCase().includes(q))
      .filter((d) => matchesColours(info.get(d.id)?.identity, wanted, exactly))
      .filter((d) => matchesPlan(readings.get(d.id)?.plan, wantedPlans))
      .filter((d) => matchesFloor(readings.get(d.id)?.bracket, wantedFloors))
  }, [inFormat, info, readings, query, wanted, exactly, wantedPlans, wantedFloors])
  const unknownHidden = wanted.size
    ? inFormat.filter((d) => !info.get(d.id)?.identity && !matchesColours(null, wanted, exactly)).length
    : 0
  const unreadHidden = inFormat.filter((d) => (wantedPlans.size && !readings.get(d.id)?.plan)
    || (wantedFloors.size && !readings.get(d.id)?.bracket)).length
  const readingShown = shown.some((d) => readings.get(d.id)?.plan?.top.length || readings.get(d.id)?.bracket)

  const chosenDeck = shown.find((d) => d.id === chosen) ?? null
  const rest = Object.keys(FORMATS).filter((id) => !FRONT.includes(id))
  const guide = useMemo(() => pickGuide(format), [format])

  // At the engine's table every deck on the shelf is asked about before anyone
  // sits: one the engine cannot fully hold says so on its tile, and pressing
  // Sit with it says why and offers what can be done instead.
  const checks = useEngineCheck({ address: engine ? relayAddress() : null, decks: inFormat, first: chosen })

  // What the engine's seat plays (M5): a copy of the player's deck, one of
  // their decks from this shelf, or one the engine builds, remembered with the
  // player's other table preferences as the level is. Offered in the seats
  // panel, and recorded with the table when the player sits down.
  const [opponent, setOpponent] = useState(() => chosenOpponent(getPrefs().engineOpponent))
  const chooseOpponent = (change) => {
    const next = { ...opponent, ...change }
    setOpponent(next)
    setPref('engineOpponent', next)
  }
  const engineDeckChosen = engine && opponent.kind === 'deck' ? inFormat.find((d) => d.id === opponent.deckId) ?? null : null
  const engineCheck = engineDeckChosen ? checks.get(engineDeckChosen.id) : null

  /**
   * What the engine's seat is to play at this table, as the sit will send it
   * (`engineDeckRecord`, lib/engine/opponent.js): the names of a deck of the
   * player's are exactly those the engine was asked about (`seat`,
   * useEngineCheck), as the player's own deck's are. A deck that cannot be sent
   * goes as the copy, with the reason, which the table says. The seat list says
   * the same before anybody sits, from the same function.
   */
  const start = (deck) => {
    if (engine) chooseEngineDeck(engine, engineDeckRecord({ choice: opponent, chosen: engineDeckChosen, check: engineCheck }))
    navigate({ tab: 'game', gameDeckId: deck.id, gameRoom: room, gameEngine: engine })
  }

  const [pending, setPending] = useState(null)
  const [gate, setGate] = useState(null)
  const sit = (deck) => {
    if (!engine) { start(deck); return }
    const check = checks.get(deck.id)
    // No answer at all means nothing was asked, which is a lobby with no relay
    // address: sit as before, and the table says the relay is not set.
    if (!check) { start(deck); return }
    // The engine's deck is waited for as the player's is, so what is sent for
    // it is what the engine said it knows.
    if (check.state === 'asking' || engineCheck?.state === 'asking') { setPending(deck.id); return }
    setPending(null)
    // A card the engine does not know, or a Commander deck it cannot deal as a
    // Commander game (M6): said, and what can be done instead offered.
    if (check.state === 'short' || leaderProblem(check.seat, check)) { setGate(deck.id); return }
    // Complete, or not checkable: sit as before. The engine still refuses a
    // card it does not know, by name, so nothing is dealt short unremarked.
    start(deck)
  }
  // A press made while the answer was still coming is carried out when it
  // arrives, rather than refused or asked for again: one press, one sit.
  const playerState = pending ? checks.get(pending)?.state : null
  const pendingState = playerState ? `${playerState}|${engineCheck?.state ?? ''}` : null
  const pendingFor = playerState === 'asking' ? chosenDeck?.name : engineDeckChosen?.name
  useEffect(() => {
    if (!pending || !pendingState || pendingState.split('|').includes('asking')) return
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
  // Without the cards the engine does not know, and led by the stand-in the player
  // chose in the gate where they chose one (§3 item 19), or by nothing: recorded with
  // the table together, so a later sit without one does not keep an earlier choice.
  const playWithout = (deck, names, lead = null) => { setGate(null); agreeToLeaveOut(engine, deck.id, names, lead); start(deck) }
  // The Wildcard at the engine's table draws from the decks it fully knows,
  // once any have been checked, so a random press lands on a game.
  const known = engine ? shown.filter((d) => checks.get(d.id)?.state === 'complete') : []
  const wildcards = known.length ? known : shown

  const pickFormat = (id) => {
    setFormat(id); setChosen(null); setWanted(new Set()); setWantedPlans(new Set()); setWantedFloors(new Set()); setPending(null); setGate(null)
  }

  return (
    <div className="lobby">
      <header className="lobby__head">
        <h1 className="lobby__title">
          <span className="lobby__mode">{engine ? 'Rules enforced:' : room ? 'Together:' : 'Solo:'}</span> {getFormat(format)?.name ?? format}
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
            {planFacet.length > 0 && (
              <ReadingFilter label="Archetype" chips={planFacet} wanted={wantedPlans} onWanted={setWantedPlans} note={PLAN_LINE} />
            )}
            {floorFacet.length > 0 && (
              <ReadingFilter label="Bracket" chips={floorFacet} wanted={wantedFloors} onWanted={setWantedFloors} note={BRACKET_LINE}
                summary={(ids) => ids.map(floorBadge).join(', ')} />
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
              {query.trim() || wanted.size || wantedPlans.size || wantedFloors.size ? 'No deck here matches.' : `You have no ${getFormat(format)?.name ?? format} decks yet.`}
            </p>
          ) : (
            <>
              {readingShown && <p className="faint tiny lobby__readnote">{shelfLine({ brackets: floorFacet.length > 0 })}</p>}
              <ul className="lobby__shelf" role="list">
                {shown.map((deck) => (
                  <li key={deck.id}>
                    <DeckTile
                      deck={deck}
                      info={info.get(deck.id)}
                      reading={readings.get(deck.id)}
                      chosen={chosen === deck.id}
                      check={checks.get(deck.id)}
                      onChoose={() => choose(deck.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          {unknownHidden > 0 && (
            <p className="faint tiny" role="status">
              {unknownHidden === 1 ? 'One deck is' : `${unknownHidden} decks are`} not shown because
              {unknownHidden === 1 ? ' its' : ' their'} colours are not known yet.
            </p>
          )}
          {unreadHidden > 0 && (
            <p className="faint tiny" role="status">
              {unreadHidden === 1 ? 'One deck is' : `${unreadHidden} decks are`} not shown because not all
              {unreadHidden === 1 ? ' its' : ' their'} cards have arrived, so this app has not read {unreadHidden === 1 ? 'it' : 'them'}.
            </p>
          )}
        </section>

        <Seats
          room={room}
          engine={engine}
          engineDeck={{ choice: opponent, onChoose: chooseOpponent, format, decks: inFormat, checks, yours: chosenDeck }}
        />
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
            ? `Asking the engine about ${pendingFor ?? chosenDeck.name}…`
            : room || engine
            ? (chosenDeck ? `Sit down with ${chosenDeck.name} →` : 'Sit down →')
            : (chosenDeck ? `Start game with ${chosenDeck.name} →` : 'Start game →')}
        </button>
      </footer>
      {gateDeck && gateCheck && (
        <DeckGate
          // Its own for each deck, so a stand-in chosen for one is never carried to another.
          key={gateDeck.id}
          deck={gateDeck}
          check={gateCheck}
          onWithout={(names, lead) => playWithout(gateDeck, names, lead)}
          onOrdinary={() => { setGate(null); start(gateDeck) }}
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
 * One deck on the shelf: painting behind, name, commander and size, pips, and
 * what this app reads of it — the plan as a tag, and the bracket's floor as a
 * badge, as Moxgate's shelf carries an archetype tag and a bracket badge. The
 * painting is decoration and the pips are spoken by ManaCost, so a screen reader
 * hears "white, green" where a sighted person sees two dots; the tags are said as
 * the sentences they stand for, each saying it is this app's reading.
 */
function DeckTile({ deck, info, reading = null, chosen, check, onChoose }) {
  const pips = info?.identity ? (info.identity.length ? info.identity.map((c) => `{${c}}`).join('') : '{C}') : null
  const plan = reading?.plan ?? null
  const bracket = reading?.bracket ?? null
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
        {/* Three states a sighted player can tell apart, as the Archetype filter's
            "No plan" chip needs: read as a plan, read as none ("No plan", the chip's
            own words), and not read because a card never arrived ("Not read"). Before
            the cards are here at all, nothing: the reading is on its way. */}
        {reading && (
          <span className="lobby__tags">
            {plan?.top.map((id) => <span key={id} className="lobby__tag" aria-hidden="true" title={planSentence(plan)}>{planName(id)}</span>)}
            {plan && !plan.top.length && <span className="lobby__tag lobby__tag--none" aria-hidden="true" title={planSentence(plan)}>No plan</span>}
            {!plan && <span className="lobby__tag lobby__tag--none" aria-hidden="true" title={UNREAD_SENTENCE}>Not read</span>}
            {bracket && (
              <span className="lobby__tag lobby__tag--bracket" aria-hidden="true" title={floorWords(bracket.floor)}>{floorBadge(bracket.floor)}</span>
            )}
            <span className="sr-only">{[plan ? planSentence(plan) : UNREAD_SENTENCE, bracket && bracketSentence(bracket)].filter(Boolean).join(' ')}</span>
          </span>
        )}
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
  // A Commander deck the engine cannot deal as a Commander game (M6), and why;
  // and, where the rules allow one, what could lead it instead (§3 item 19).
  const led = leaderWords(leaderProblem(check.seat, check), check.seat?.commander?.name, check.seat?.game)
  if (led) lines.push(led)
  const standIn = led ? standInTileLine(check.standIns) : null
  if (standIn) lines.push(standIn)
  return (
    <span className={`lobby__deckcheck faint tiny${state === 'short' || led ? ' lobby__deckcheck--short' : ''}`}>
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
 *
 * A Commander deck the engine cannot deal as a Commander game (M6) — its
 * commander unknown, two commanders, or none — says why, citing the rule, and
 * what it deals instead: without the unknown cards, commander among them, or
 * with its library alone, the ordinary game, since there is no Commander game
 * without a commander. The owner's M1 answer, both ways on, carried over.
 *
 * And where the commander is a card the engine does not know, one of the deck's
 * own legendary creatures the rules allow may lead it as a stand-in (HANDOFF.md
 * §3 item 19; lib/engine/stand-in.js): offered as a choice of the player's, each
 * with its rules cited, none chosen until they choose one, and played by a
 * button that names it. Where none is allowed, the gate is as M6 left it.
 */
function DeckGate({ deck, check, onWithout, onOrdinary = null, onAlone, onClose }) {
  const unknown = check.unknown ?? []
  const copies = unknown.reduce((sum, u) => sum + u.count, 0)
  const groups = byReason(unknown)
  const reasoned = groups.some((g) => g.reason)
  const item = (u) => <li key={u.name}>{u.count} {u.name}{u.commander ? ', its commander' : ''}</li>
  const canGoWithout = unknown.length > 0 && !check.unloaded && check.known > 0
  // A Commander deck the engine cannot deal as a Commander game (M6): its
  // commander unknown, two commanders, or none. Without a commander there is
  // no Commander game, so what the engine can deal instead is the ordinary one.
  const problem = leaderProblem(check.seat, check)
  // Whatever is left out, a deck the engine cannot lead is dealt the ordinary game.
  const leaderless = unknown.some((u) => u.commander) || Boolean(problem)
  const canGoOrdinary = !unknown.length && Boolean(problem) && !check.unloaded && Boolean(onOrdinary)
  // Or, where the commander is what the engine does not know, one of the deck's own
  // legendary creatures the rules allow to lead it, as a stand-in (§3 item 19),
  // chosen here by the player and never for them: nothing is chosen until they do,
  // and the press that plays it names the one chosen.
  const real = unknown.find((u) => u.commander)?.name ?? null
  const offered = canGoWithout && real && Array.isArray(check.standIns) ? check.standIns : []
  const [lead, setLead] = useState(null)
  const chosenLead = offered.find((s) => s.name === lead) ?? null
  const names = unknown.map((u) => u.name)
  const actions = [
    ...(chosenLead ? [{ label: `Play the engine led by ${chosenLead.name}`, kind: 'primary', onPress: () => onWithout(names, chosenLead.name) }] : []),
    ...(canGoWithout ? [{ label: `Play the engine without ${copies === 1 ? 'it' : 'them'}`, kind: chosenLead ? 'ghost' : 'primary', onPress: () => onWithout(names) }] : []),
    ...(canGoOrdinary ? [{ label: 'Play the engine by the ordinary rules', kind: 'primary', onPress: onOrdinary }] : []),
    { label: 'Play it alone instead', kind: canGoWithout || canGoOrdinary ? 'ghost' : 'primary', onPress: onAlone },
    { label: 'Choose another deck', kind: 'ghost', onPress: onClose },
  ]
  return (
    <Confirm
      open
      title={unknown.length ? `The engine does not know every card in ${deck.name}` : problem ? `The engine cannot deal ${withArticle(gameName(check.seat?.game))} game with ${deck.name}` : `Not every card in ${deck.name} has loaded`}
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
        {problem && <p>{leaderWords(problem, check.seat?.commander?.name, check.seat?.game)}</p>}
        {canGoWithout && (leaderless
          ? <p>Without {copies === 1 ? 'it' : 'them'}, the engine deals the other {check.known} cards by the ordinary rules: 20 life each, and no command zone. The table says what was left out.</p>
          : <p>Without {copies === 1 ? 'it' : 'them'}, the engine deals the other {check.known} cards, and the table says what was left out.</p>)}
        {offered.length > 0 && (
          <fieldset className="lobby__levels lobby__standins">
            <legend className="lobby__label">Or lead it with a stand-in</legend>
            <p>{standInOffer({ offered, real, known: check.known, game: check.seat?.game })}</p>
            {offered.map((s) => (
              <label key={s.name} className={`lobby__level${lead === s.name ? ' lobby__level--on' : ''}`}>
                <input type="radio" name="stand-in" value={s.name} checked={lead === s.name} onChange={() => setLead(s.name)} />
                <span className="lobby__levelname">{s.name}</span>
                <span className="lobby__levelline faint tiny">A stand-in for {real}, its colour identity {colourWords(s.identity)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {canGoOrdinary && (
          <p>By the ordinary rules the engine deals the {check.seat?.total - (check.seat?.leaders ?? 0)} cards of its library: 20 life each, and no command zone.</p>
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

/**
 * The archetype and bracket dropdowns, in the colours filter's shape: a chip per
 * value carrying how many decks are behind it, fixed while you pick, several chips
 * at once meaning any of them — a deck reads as one plan and has one floor, so
 * "all of them" would find nothing. Under the chips, one line saying they are this
 * app's reading, and how it was read behind "How this is read": written out every
 * time, the two paragraphs stood between the chips and the shelf with both open.
 */
function ReadingFilter({ label, chips, wanted, onWanted, note, summary = null }) {
  const [open, setOpen] = useState(false)
  const [how, setHow] = useState(false)
  const howId = useId()
  const toggle = (id) => {
    const next = new Set(wanted)
    if (next.has(id)) next.delete(id); else next.add(id)
    onWanted(next)
  }
  const picked = chips.filter((c) => wanted.has(c.id)).map((c) => c.id)
  const said = summary ? summary(picked) : picked.map((id) => chips.find((c) => c.id === id).text).join(', ')
  return (
    <div className="lobby__filter">
      <button type="button" className={`chip lobby__tab${wanted.size ? ' lobby__tab--on' : ''}`}
        aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {picked.length ? `${label} · ${said}` : `${label} ·`}
      </button>
      {open && (
        <div className="lobby__facets" role="group" aria-label={label}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip lobby__facet${wanted.has(c.id) ? ' lobby__tab--on' : ''}`}
              aria-pressed={wanted.has(c.id)}
              onClick={() => toggle(c.id)}
            >
              {c.text}
              <span className="lobby__count">{c.count}</span>
            </button>
          ))}
          <p className="lobby__facetnote faint tiny">
            {READING_LINE}{' '}
            <button type="button" className="lobby__howread" aria-expanded={how} aria-controls={howId} onClick={() => setHow((h) => !h)}>
              How this is read
            </button>
          </p>
          <p id={howId} className="lobby__facetnote faint tiny" hidden={!how}>{note}</p>
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
      {getFormat(id)?.name ?? id}
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

/** Any of the plans wanted, or "No plan" for a deck read that fits none; a deck not read, never. */
function matchesPlan(plan, wanted) {
  if (!wanted.size) return true
  if (!plan) return false
  return plan.top.length ? plan.top.some((id) => wanted.has(id)) : wanted.has('none')
}

/** Any of the floors wanted; a deck whose bracket was not read, never. */
function matchesFloor(bracket, wanted) {
  if (!wanted.size) return true
  return Boolean(bracket) && wanted.has(bracket.floor)
}

/** One line under the title, the way Moxgate's says "100-card singleton". */
function blurb(format) {
  switch (format) {
    case 'commander': return '100-card singleton.'
    case 'pauper': return 'Sixty cards, commons only.'
    // The app's Brawl and Duel Commander are Scryfall's, a hundred cards each (lib/formats.js):
    // Brawl said sixty here until §3 item 20, which is the Comprehensive Rules' Brawl (903.12d).
    case 'brawl': return '100-card singleton with a commander.'
    case 'duel': return '100-card singleton, one against one.'
    default: return getFormat(format) ? 'Sixty cards.' : ''
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

/**
 * Open on the first front tab that has decks, so the shelf is never empty by
 * default. A deck in a format this build does not know has no tab here (see
 * getFormat), so its format is never the one opened on — an id such as
 * "constructor" in a hand-edited backup included.
 */
function firstWithDecks(counts) {
  return FRONT.find((id) => counts[id]) ?? Object.keys(counts).find((id) => getFormat(id)) ?? 'commander'
}
