import { useEffect, useMemo, useState } from 'react'
import { COLOR_PAGES, PAIRS, STYLE_AXES, FIRST_COMMANDERS, WHEEL } from '../../data/colors.js'
import { schoolsFor, schoolsForColor, SET_THEMES, LORE_SET } from '../../data/set-themes.js'
import { decorFor, useThemeSet } from '../../lib/theme-set.js'
import {
  DIAL_MAX, dialToColors, colorsToDial, describeColors, suggestColors, commanderQuery,
  stapleQueries, roleCounts, rolesForFormat, fillPlan, identityKeyOf, fitsIdentity, whyFor, FIRST_FORMATS,
} from '../../lib/first-deck.js'
import { getFormat } from '../../lib/formats.js'
import { targetsFor } from '../../lib/skeleton.js'
import { strategiesFor, strategyById } from '../../data/strategies.js'
import { useCollection } from '../../lib/collection-store.js'
import { ownedOf, missingFor, missingCost } from '../../lib/collection.js'
import { formatPrice } from '../../lib/prices.js'
import { searchCards, getCardsByNames, getCardByName } from '../../lib/scryfall.js'
import { createDeck, addCard, setCommanders } from '../../lib/deck.js'
import { saveDeck, getDeck, getPrefs, setPref } from '../../lib/storage.js'
import { pinCards } from '../../lib/cache.js'
import { navigate, useRoute, STEP_SLUGS } from '../../lib/router.js'
import useDeckCards from './useDeckCards.js'
import { priceLabel } from '../../lib/prices.js'
import CardImage from '../../components/CardImage.jsx'
import ManaCost from '../../components/ManaCost.jsx'
import './first-deck.css'

/**
 * Your first deck, in four steps: pick colours, say how you like to play,
 * choose a commander, build a starting list by role.
 *
 * Everything shown about the colours is this app's own writing and says so.
 * The commanders and staples are live from Scryfall, ordered by its
 * popularity rank, with a short recommended list on top that was chosen
 * for being easy to pilot and cheap to build — a recommendation, marked as
 * one. Nothing is invented: a name Scryfall does not know simply does not
 * appear.
 */
const STEPS = ['Colours', 'How you play', 'Commander', 'Starting list']
const CAPS = [2, 4, 10]
const BUDGETS = [0, 25, 50, 100, 200] // for the cards you do not own; 0 is none
/** "Selesnya (Green and White)", or "Green" for a single colour. */
const name = (key) => (key.length === 1 ? COLOR_PAGES[key].name : `${PAIRS[key]?.name} (${key.split('').map((c) => COLOR_PAGES[c].name).join(' and ')})`)

export default function FirstDeck({ onOpenCard }) {
  // The step lives in the URL (#/decks/new/<step>), so a reload keeps it and
  // the back button retraces the steps. The deck being built and the step
  // reached are remembered in prefs, so coming back later resumes rather
  // than starting a second deck; the deck itself stays the only copy of its
  // cards. A remembered deck that has since been deleted is simply forgotten.
  const route = useRoute()
  const step = Math.max(0, STEP_SLUGS.indexOf(route.step))
  const go = (i) => navigate({ step: STEP_SLUGS[i] })
  const [restored] = useState(() => {
    const saved = getPrefs().firstDeck
    return saved?.deckId ? getDeck(saved.deckId) : null
  })
  // The bare address resumes: with a deck being built, it goes to the step
  // reached; without one, to the colours. Navigating to the same hash is a
  // no-op, so a fresh start does not loop.
  useEffect(() => {
    if (route.step) return
    const saved = getPrefs().firstDeck
    const at = restored && saved?.step && STEP_SLUGS.includes(saved.step) ? saved.step : STEP_SLUGS[0]
    navigate({ step: at }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.step])

  // Which kind of deck. Commander first, because that is the recommendation;
  // a sixty-card format skips the commander and starts from the colours. Once
  // a deck exists its own format is the law, and a change of mind is a
  // start-over, said out loud like a change of colours.
  const [formatId, setFormatId] = useState(() => {
    const saved = getPrefs().firstDeckFormat
    return FIRST_FORMATS.includes(saved) ? saved : 'commander'
  })
  const chooseFormat = (id) => { setFormatId(id); setPref('firstDeckFormat', id) }
  const commanderFormat = getFormat(formatId)?.group === 'commander'

  const [dial, setDial] = useState(() => colorsToDial(getPrefs().firstDeckColors ?? 'GW') ?? 0)
  const [picked, setPicked] = useState(() => getPrefs().firstDeckColors ?? null) // an enemy pair the dial cannot show
  const [answers, setAnswers] = useState(() => getPrefs().firstDeckStyle ?? {})
  const [deck, setDeck] = useState(restored)
  const [cards, setCards] = useState(() => new Map())
  const [cap, setCap] = useState(4)
  // The plan and the purchase budget are remembered like the colours; a plan
  // is only honoured while it belongs to the colours the list is built for.
  const [strategyId, setStrategyId] = useState(() => getPrefs().firstDeckStrategy ?? null)
  const chooseStrategy = (id) => { setStrategyId(id); setPref('firstDeckStrategy', id) }
  const [budget, setBudget] = useState(() => getPrefs().firstDeckBudget ?? 0)
  const chooseBudget = (n) => { setBudget(n); setPref('firstDeckBudget', n) }
  const [collection] = useCollection()
  // A restored deck's cards are fetched once; cards chosen in this visit are
  // remembered as they arrive.
  const restoredCards = useDeckCards(restored)

  const colors = picked && colorsToDial(picked) === null ? picked : dialToColors(dial)
  const chosen = describeColors(colors)
  useEffect(() => { setPref('firstDeckColors', colors) }, [colors])
  useEffect(() => {
    setPref('firstDeck', { deckId: deck?.id ?? null, step: STEP_SLUGS[step] })
  }, [deck?.id, step])
  // The list step needs a deck; a link to it without one goes to the commanders.
  useEffect(() => {
    if (step === 3 && !deck) navigate({ step: STEP_SLUGS[2] }, { replace: true })
  }, [step, deck])

  const lookup = (id) => cards.get(id) ?? restoredCards.lookup(id)
  const remember = (list) => setCards((prev) => {
    const next = new Map(prev)
    for (const card of list) next.set(card.id, card)
    return next
  })
  const commit = (next) => { setDeck(next); saveDeck(next) }

  const chooseDial = (value) => { setDial(Number(value)); setPicked(null) }
  const choosePair = (key) => {
    const spot = colorsToDial(key)
    if (spot === null) setPicked(key)
    else { setDial(spot); setPicked(null) }
  }
  const applySuggestion = () => {
    const suggestion = suggestColors(answers)
    if (suggestion) choosePair(suggestion)
  }

  // Choosing a commander never makes a second copy of a deck already being
  // built: the same commander again just continues, and a different one on
  // a deck with no cards yet takes the commander's seat. Only a deck with
  // cards in it is left alone, and a new one started beside it.
  const startWith = (card) => {
    remember([card])
    pinCards([card.id])
    if (deck?.commanders?.[0] === card.id) { go(3); return }
    const title = `${card.name.split(',')[0]} deck`
    if (deck && deck.main.length === 0 && deck.formatId === formatId) {
      commit(setCommanders({ ...deck, name: title }, [card.id]))
    } else {
      commit(setCommanders(createDeck({ name: title, formatId }), [card.id]))
    }
    go(3)
  }
  // A sixty-card deck has no commander: it starts from the colours and the format.
  const startPlain = () => {
    if (deck && deck.formatId === formatId) { go(3); return }
    const pair = colors.length === 1 ? COLOR_PAGES[colors].name : PAIRS[colors]?.name ?? colors
    commit(createDeck({ name: `${pair} ${getFormat(formatId).name} deck`, formatId }))
    go(3)
  }

  // Once a commander exists, its colour identity is the law for the starting
  // list, whatever the dial says: the steps can be revisited, and a dial
  // moved to new colours after a commander was chosen would otherwise fetch
  // staples the deck cannot play. The clash is shown and resolved out loud,
  // never by quietly dropping the commander or the cards.
  const commander = deck ? lookup(deck.commanders?.[0]) : null
  const identityKey = commander ? identityKeyOf(commander) : null
  const clash = Boolean(identityKey) && !fitsIdentity(colors, identityKey)
  const keepCommander = () => { if (identityKey !== 'C') choosePair(identityKey) }
  const startOver = () => { setDeck(null); go(2) }
  const formatClash = Boolean(deck) && deck.formatId !== formatId
  const keepFormat = () => chooseFormat(deck.formatId)

  return (
    <div className="stack first-deck">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate({ tab: 'decks', starting: false })}>← Decks</button>
        <span className="spacer" />
      </div>
      <div>
        <h1>Your first deck</h1>
        <p className="muted">Four short steps. Nothing is saved until you choose a commander, and you can change any of it later.</p>
      </div>

      <ol className="steps" aria-label="Steps">
        {STEPS.map((fixed, i) => {
          const label = i === 2 && !commanderFormat ? 'Start' : fixed
          return (
          <li key={fixed} className={`steps__item ${i === step ? 'steps__item--current' : ''} ${i < step ? 'steps__item--done' : ''}`} aria-current={i === step ? 'step' : undefined}>
            <button
              className="steps__button"
              onClick={() => go(i)}
              disabled={i === 3 && !deck}
              title={i === 3 && !deck ? (commanderFormat ? 'Choose a commander first' : 'Start the deck first') : undefined}
            >
              <span className="steps__num">{i < step ? '✓' : i + 1}</span> {label}
            </button>
          </li>
          )
        })}
      </ol>

      {formatClash && (
        <div className="banner banner--warn stack stack--snug" role="status">
          <span>
            <strong>{deck.name}</strong> is a {getFormat(deck.formatId)?.name} deck, and a deck keeps its format.
            Keep it as {getFormat(deck.formatId)?.name}, or start over as {getFormat(formatId)?.name}. The deck you started stays in your list.
          </span>
          <div className="row row--wrap">
            <button className="btn btn--sm" onClick={keepFormat}>Keep {getFormat(deck.formatId)?.name}</button>
            <button className="btn btn--sm btn--ghost" onClick={startOver}>Start over as {getFormat(formatId)?.name}</button>
          </div>
        </div>
      )}

      {clash && (
        <div className="banner banner--warn stack stack--snug" role="status">
          <span>
            <strong>{commander.name}</strong> is {identityKey === 'C' ? 'colourless' : name(identityKey)}, and the
            starting list follows the commander, not the dial. Keep {commander.name.split(',')[0]} and the colours
            go back, or start over with a new commander in {name(colors)}. The deck you started stays in your list.
          </span>
          <div className="row row--wrap">
            {identityKey !== 'C' && (
              <button className="btn btn--sm" onClick={keepCommander}>Keep {commander.name.split(',')[0]}</button>
            )}
            <button className="btn btn--sm btn--ghost" onClick={startOver}>Start over in {name(colors)}</button>
          </div>
        </div>
      )}
      {step === 0 && (
        <ColourStep dial={dial} colors={colors} chosen={chosen} onDial={chooseDial} onPair={choosePair} onOpenCard={onOpenCard} onNext={() => go(1)} formatId={formatId} onFormat={chooseFormat} />
      )}
      {step === 1 && (
        <StyleStep answers={answers} colors={colors} onAnswer={(axis, id) => {
          const next = { ...answers, [axis]: id }
          setAnswers(next)
          setPref('firstDeckStyle', next)
        }} onSuggest={applySuggestion} onNext={() => go(2)} commanderFormat={commanderFormat} />
      )}
      {step === 2 && commanderFormat && (
        <CommanderStep colors={colors} onOpenCard={onOpenCard} onStart={startWith} remember={remember} />
      )}
      {step === 2 && !commanderFormat && (
        <StartStep colors={colors} formatId={formatId} deck={deck} onStart={startPlain} />
      )}
      {step === 3 && deck && (
        <StaplesStep
          deck={deck} colors={identityKey ?? colors} lookup={lookup} cap={cap} onCap={setCap}
          strategy={strategyById(identityKey ?? colors, strategyId)} onStrategy={chooseStrategy}
          format={getFormat(deck.formatId) ?? getFormat('commander')}
          budget={budget} onBudget={chooseBudget} collection={collection}
          remember={remember} onChange={commit} onOpenCard={onOpenCard}
        />
      )}
    </div>
  )
}

// --- step 1: the dial --------------------------------------------------------

const SWATCH = { W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)' }

function ColourStep({ dial, colors, chosen, onDial, onPair, onOpenCard, onNext, formatId, onFormat }) {
  // Hexhaven's schools are the five allied pairs, so a pair shows its school
  // and a single colour shows the two it belongs to. Every emblem carries the
  // school's name beside it; the emblem alone never says which school.
  const schools = schoolsFor()
  const school = chosen.kind === 'pair' ? schools?.[chosen.id] : null
  const decor = decorFor(useThemeSet())
  const withBase = (path) => `${import.meta.env.BASE_URL}${path}`
  const setName = SET_THEMES[LORE_SET]?.setName ?? 'the current set'
  const label = chosen.kind === 'mono'
    ? COLOR_PAGES[chosen.id].name
    : `${COLOR_PAGES[chosen.id[0]].name} and ${COLOR_PAGES[chosen.id[1]].name} — ${chosen.pair?.name ?? ''}`
  const pages = chosen.kind === 'mono' ? [COLOR_PAGES[chosen.id]] : chosen.id.split('').map((c) => COLOR_PAGES[c])

  return (
    <div className="stack">
      <section className="panel stack stack--snug" aria-label="What kind of deck">
        <div className="row row--wrap row--middle">
          <strong>What kind of deck?</strong>
          <div className="row row--wrap" role="group" aria-label="Format">
            {FIRST_FORMATS.map((id) => (
              <button
                key={id}
                type="button"
                className={`chip ${formatId === id ? 'chip--active' : ''}`}
                aria-pressed={formatId === id}
                onClick={() => onFormat(id)}
              >
                {getFormat(id)?.name}
              </button>
            ))}
          </div>
        </div>
        <p className="tiny m0 muted">
          {getFormat(formatId)?.group === 'commander'
            ? 'Commander is the recommendation for a first deck: one commander, ninety-nine other cards, one of each, played at a table of friends.'
            : `${getFormat(formatId)?.name} is a sixty-card, two-player format: at least sixty cards, up to four copies of a card, and no commander. The commander step becomes a start button.`}
        </p>
      </section>
      <section className="panel stack">
        <h3>Pick a colour, or the pair between two</h3>
        <p className="muted tiny m0">
          Drag along the wheel. Between two colours you get the pair, which is where most first decks should be.
          The writing here is this app&rsquo;s own summary of each colour, not anything official.
        </p>
        <div className="dial">
          <div className="dial__strip" aria-hidden="true" />
          <input
            className="dial__input"
            type="range"
            min={0}
            max={DIAL_MAX}
            step={1}
            value={dial}
            aria-label="Colour dial"
            aria-valuetext={label}
            onChange={(e) => onDial(e.target.value)}
          />
          <div className="dial__labels" aria-hidden="true">
            {[...WHEEL, 'W'].map((c, i) => <span key={i} style={{ '--swatch': SWATCH[c] }}>{COLOR_PAGES[c].name}</span>)}
          </div>
        </div>
        <div className="row row--wrap" role="group" aria-label="Any pair">
          {Object.values(PAIRS).map((pair) => (
            <button
              key={pair.id}
              className={`chip pair-chip ${colors === pair.id ? 'chip--active' : ''}`}
              aria-pressed={colors === pair.id}
              onClick={() => onPair(pair.id)}
              style={{ '--a': SWATCH[pair.id[0]], '--b': SWATCH[pair.id[1]] }}
            >
              <span className="pair-chip__dot" aria-hidden="true" />{pair.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack colour-pages" data-colors={colors}>
        <div className="row">
          <h2 className="m0">{label}</h2>
        </div>
        {chosen.kind === 'pair' && chosen.pair && (
          <p className="colour-pages__does">{chosen.pair.does}</p>
        )}
        {school && (
          <aside className="school" style={{ '--school-a': school.accents[0], '--school-b': school.accents[1], '--school-c': school.accents[2] }}>
            <img className="school__emblem" src={withBase(school.emblem)} alt="" aria-hidden="true" width="48" height="48" />
            <div className="stack stack--tight min0">
              <div className="school__name">
                <strong>{school.name}</strong>
                <span className="faint tiny"> · {school.discipline} · {setName}</span>
              </div>
              <div className="tiny"><span className="muted">Virtue:</span> {school.virtue}</div>
              <div className="tiny"><span className="muted">Horror:</span> {school.horror}</div>
            </div>
          </aside>
        )}
        <div className={`colour-pages__grid ${pages.length === 2 ? 'colour-pages__grid--two' : ''}`}>
          {pages.map((page) => (
            <article key={page.id} className="colour-page" style={{ '--swatch': SWATCH[page.id] }}>
              <h3>
                <img className="colour-page__emblem" src={decor.colorEmblem(page.id)} alt="" aria-hidden="true" width="28" height="28" />
                {page.name}
              </h3>
              <dl className="facts">
                <div><dt>Cares about</dt><dd>{page.values}</dd></div>
                <div><dt>Wins by</dt><dd>{page.wins}</dd></div>
                <div><dt>Bad at</dt><dd>{page.weak}</dd></div>
                {schoolsForColor(page.id).length > 0 && (
                  <div className="colour-page__school">
                    <dt>At Hexhaven</dt>
                    <dd>
                      {schoolsForColor(page.id).map((sc, i) => (
                        <span key={sc.id}>
                          {i > 0 && ' and '}
                          <img className="school__emblem school__emblem--inline" src={withBase(sc.emblem)} alt="" aria-hidden="true" width="18" height="18" />
                          <strong>{sc.name}</strong> ({sc.discipline})
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="row row--wrap">
                {page.signature.map((name) => (
                  <SignatureCard key={name} name={name} onOpenCard={onOpenCard} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="row">
        <button className="btn btn--primary" onClick={onNext}>Next: how you play</button>
      </div>
    </div>
  )
}

function SignatureCard({ name, onOpenCard }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="chip"
      disabled={busy}
      title="Open this card"
      onClick={() => {
        setBusy(true)
        getCardByName(name, { exact: true }).then((card) => onOpenCard?.(card)).catch(() => {}).finally(() => setBusy(false))
      }}
    >
      {name}
    </button>
  )
}

// --- step 2: how you play -----------------------------------------------------

function StyleStep({ answers, colors, onAnswer, onSuggest, onNext, commanderFormat = true }) {
  const suggestion = suggestColors(answers)
  return (
    <div className="stack">
      <section className="panel stack">
        <h3>Four questions, no wrong answers</h3>
        <p className="muted tiny m0">Each answer leans toward the colours that play that way. You can always drag the dial somewhere else.</p>
        {STYLE_AXES.map((axis) => (
          <div key={axis.id} className="stack stack--tight" role="group" aria-label={axis.question}>
            <span className="tiny">{axis.question}</span>
            <div className="row row--wrap">
              {axis.options.map((o) => (
                <button
                  key={o.id}
                  className={`chip ${answers[axis.id] === o.id ? 'chip--active' : ''}`}
                  aria-pressed={answers[axis.id] === o.id}
                  onClick={() => onAnswer(axis.id, o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="row row--wrap row--middle">
          {suggestion ? (
            <>
              <span className="tiny">Your answers lean <strong>{name(suggestion)}</strong>.</span>
              <button className="btn btn--sm" onClick={onSuggest} disabled={suggestion === colors}>
                {suggestion === colors ? 'That is what the dial says' : 'Move the dial there'}
              </button>
            </>
          ) : <span className="faint tiny">Answer any question and a suggestion appears.</span>}
        </div>
      </section>
      <div className="row">
        <button className="btn btn--primary" onClick={onNext}>
          {commanderFormat ? `Next: commanders in ${name(colors)}` : `Next: start a deck in ${name(colors)}`}
        </button>
      </div>
    </div>
  )
}

// --- step 3: a commander ------------------------------------------------------

function CommanderStep({ colors, onOpenCard, onStart, remember }) {
  const [picks, setPicks] = useState([])
  const [popular, setPopular] = useState({ status: 'loading', cards: [] })

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const wanted = FIRST_COMMANDERS[colors] ?? []
    setPicks([])
    getCardsByNames(wanted.map((p) => ({ name: p.name })), { signal: controller.signal })
      .then((found) => {
        if (cancelled) return
        const resolved = wanted.map((p) => ({ ...p, card: found.get(p.name) })).filter((p) => p.card)
        remember(resolved.map((p) => p.card))
        setPicks(resolved)
      })
      .catch(() => {})
    setPopular({ status: 'loading', cards: [] })
    searchCards(commanderQuery(colors), { order: 'edhrec', signal: controller.signal })
      .then((result) => {
        if (cancelled) return
        const cards = result.cards.slice(0, 12)
        remember(cards)
        setPopular({ status: 'done', cards })
      })
      .catch(() => { if (!cancelled) setPopular({ status: 'error', cards: [] }) })
    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors])

  return (
    <div className="stack">
      {picks.length > 0 && (
        <section className="panel stack">
          <h3>Good first commanders</h3>
          <p className="muted tiny m0">
            Chosen for this app because the plan fits on one line and the deck is cheap to build. A recommendation, not a ranking.
          </p>
          <div className="commander-picks">
            {picks.map(({ card, why }) => (
              <CommanderCard key={card.id} card={card} why={why} onOpenCard={onOpenCard} onStart={onStart} />
            ))}
          </div>
        </section>
      )}
      <section className="panel stack">
        <h3>Most played in these colours</h3>
        <p className="muted tiny m0">Live from Scryfall, ordered by how many Commander decks run each one.</p>
        {popular.status === 'loading' && <p className="faint tiny">Looking them up…</p>}
        {popular.status === 'error' && <p className="faint tiny">Scryfall could not be reached. The recommended list above still works offline once seen.</p>}
        {popular.status === 'done' && popular.cards.length === 0 && <p className="faint tiny">Nothing came back for exactly these colours.</p>}
        <div className="commander-picks">
          {popular.cards.map((card) => (
            <CommanderCard key={card.id} card={card} onOpenCard={onOpenCard} onStart={onStart} />
          ))}
        </div>
      </section>
    </div>
  )
}

function CommanderCard({ card, why, onOpenCard, onStart }) {
  return (
    <div className="commander-pick">
      <CardImage card={card} size="small" onClick={() => onOpenCard?.(card)} />
      <div className="stack stack--tight min0">
        <strong className="commander-pick__name">{card.name}</strong>
        <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
        <span className="faint tiny">{card.type_line}</span>
        {why && <p className="tiny m0">{why}</p>}
        <div>
          <button className="btn btn--sm btn--primary" onClick={() => onStart(card)}>Start with {card.name.split(',')[0]}</button>
        </div>
      </div>
    </div>
  )
}

// --- step 3, sixty-card: start from the colours ------------------------------

function StartStep({ colors, formatId, deck, onStart }) {
  const format = getFormat(formatId)
  const t = targetsFor(format)
  const same = deck && deck.formatId === formatId
  return (
    <section className="panel stack">
      <h2 className="m0">A {format?.name} deck in {name(colors)}</h2>
      <p className="m0">
        No commander in {format?.name}: the deck is {t.size} cards with up to four copies of a card,
        so the starting list leans on the cards that do its thing. The colours are yours to change until
        cards go in.
      </p>
      <p className="tiny muted m0">
        The skeleton: {t.lands} lands, {t.draw} card draw, {t.removal} removal, the rest what the deck does.
        A guide, not a rule.
      </p>
      <div>
        <button className="btn btn--primary" onClick={onStart}>
          {same ? `Continue ${deck.name}` : `Start a ${format?.name} deck in ${name(colors)}`}
        </button>
      </div>
    </section>
  )
}

// --- step 4: staples by role --------------------------------------------------

function StaplesStep({
  deck, colors, lookup, cap, onCap, strategy, onStrategy, budget, onBudget, collection, format,
  remember, onChange, onOpenCard,
}) {
  const [role, setRole] = useState('lands')
  const [lists, setLists] = useState({}) // roleId -> { status, cards, fromPlan }
  const [filling, setFilling] = useState(false)
  // The deck's own format decides the skeleton, the searches and the size.
  const ROLES = useMemo(() => rolesForFormat(format.id), [format.id])
  const LIST = targetsFor(format).list
  const copies = format.maxCopies ?? 1
  const commander = format.group === 'commander'
  const counts = useMemo(() => roleCounts(deck, lookup, format.id), [deck, lookup, format.id])
  const total = deck.main.reduce((n, e) => n + e.quantity, 0)
  const inDeck = new Set(deck.main.map((e) => e.cardId))
  const plans = strategiesFor(colors)

  // What the list would cost to complete from what you own, as distinct from
  // what it is worth: quantities against owned copies, unpriced cards counted
  // apart. Scryfall's prices are a daily estimate, never a checkout total.
  const toBuy = useMemo(() => {
    const missing = missingFor(deck, lookup, collection)
    return { ...missingCost(missing, 'usd'), cards: missing.reduce((n, m) => n + m.quantity, 0) }
  }, [deck, lookup, collection])
  const overBy = budget > 0 && toBuy.total > budget ? toBuy.total - budget : 0

  /**
   * Loads a role's staples once per cap and plan; tries each query until one
   * answers, and remembers whether it was the plan's own search that did.
   */
  const load = async (roleId, signal) => {
    const queries = stapleQueries(colors, roleId, { capUsd: cap, strategy, formatId: format.id })
    const planQueries = roleId === 'theme' ? (strategy?.queries?.length ?? 0) : 0
    for (const [i, query] of queries.entries()) {
      try {
        const result = await searchCards(query, { order: 'edhrec', signal })
        if (result.cards.length) return { cards: result.cards.slice(0, 40), fromPlan: i < planQueries }
      } catch (error) {
        if (error.name === 'AbortError') throw error
      }
    }
    return { cards: [], fromPlan: false }
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLists({})
    ;(async () => {
      for (const r of ROLES) {
        const { cards, fromPlan } = await load(r.id, controller.signal).catch(() => ({ cards: [], fromPlan: false }))
        if (cancelled) return
        remember(cards)
        setLists((prev) => ({ ...prev, [r.id]: { status: 'done', cards, fromPlan } }))
      }
    })()
    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, cap, strategy?.id, format.id])

  const add = (card, quantity = 1) => onChange(addCard(deck, card.id, quantity, 'main'))
  const remove = (card) => onChange(addCard(deck, card.id, -1, 'main'))

  const fill = async () => {
    setFilling(true)
    try {
      const candidates = Object.fromEntries(ROLES.map((r) => [r.id, lists[r.id]?.cards ?? []]))
      candidates.colors = colors
      const plan = fillPlan({ ...deck, colors }, lookup, candidates, {
        max: LIST, copies, formatId: format.id, nonbasicLands: commander ? 6 : 8,
      })
      const basicNames = [...new Set(plan.filter((a) => a.basic).map((a) => a.basic))]
      const basics = basicNames.length ? await getCardsByNames(basicNames) : new Map()
      remember([...basics.values()])
      let next = deck
      for (const item of plan) {
        const card = item.card ?? basics.get(item.basic)
        if (!card) continue
        next = addCard(next, card.id, item.quantity, 'main')
      }
      pinCards(next.main.map((e) => e.cardId))
      onChange(next)
    } finally {
      setFilling(false)
    }
  }

  const current = lists[role]
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row row--wrap row--middle">
          <h3 className="m0">A starting list for {deck.name}</h3>
          <span className="spacer" />
          <span className={`chip ${total === LIST ? 'chip--ok' : ''}`}>{total}/{LIST}</span>
          <select className="chip" aria-label="Price cap per card" value={cap} onChange={(e) => onCap(Number(e.target.value))}>
            {CAPS.map((c) => <option key={c} value={c}>Under ${c} a card</option>)}
          </select>
        </div>
        <p className="muted tiny m0">
          {commander
            ? `A Commander deck is ${LIST} cards plus the commander.`
            : `A ${format.name} deck is ${LIST} cards, up to ${copies} copies of a card.`}
          {' '}This is the usual skeleton; the numbers are a guide, not a rule.
        </p>
        {plans.length > 0 && (
          <div className="stack stack--tight">
            <div className="row row--wrap" role="group" aria-label="Your plan">
              <span className="tiny muted">Your plan:</span>
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${strategy?.id === p.id ? 'chip--active' : ''}`}
                  aria-pressed={strategy?.id === p.id}
                  title={p.does}
                  onClick={() => onStrategy(strategy?.id === p.id ? null : p.id)}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                className={`chip ${!strategy ? 'chip--active' : ''}`}
                aria-pressed={!strategy}
                onClick={() => onStrategy(null)}
              >
                Any
              </button>
            </div>
            <p className="tiny m0">
              {strategy
                ? <><strong>{strategy.name}.</strong> {strategy.does} Look for: {strategy.look} This app&rsquo;s own suggestion, not a ranking.</>
                : 'Pick a plan and the “does your thing” role searches for cards that fit it. Or leave it open and see what is popular.'}
            </p>
          </div>
        )}
        <div className="row row--wrap row--middle">
          <select className="chip" aria-label="Budget for cards you do not own" value={budget} onChange={(e) => onBudget(Number(e.target.value))}>
            {BUDGETS.map((b) => <option key={b} value={b}>{b ? `Budget $${b} to buy` : 'No budget'}</option>)}
          </select>
          <span className={`chip ${overBy ? 'chip--warn' : ''}`} title="What the cards you do not own would cost, from Scryfall's daily estimate">
            To buy: {formatPrice(toBuy.total, 'usd')} for {toBuy.cards} card{toBuy.cards === 1 ? '' : 's'}
            {toBuy.unpriced ? ` · ${toBuy.unpriced} unpriced` : ''}
            {overBy ? ` · ${formatPrice(overBy, 'usd')} over` : ''}
          </span>
        </div>
        <div className="roles" role="tablist" aria-label="Roles">
          {counts.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={role === r.id}
              className={`role ${role === r.id ? 'role--active' : ''} ${r.short === 0 ? 'role--done' : ''}`}
              onClick={() => setRole(r.id)}
            >
              <span className="role__label">{r.label}</span>
              <span className="role__count">{r.have}/{r.target}</span>
              <span className="role__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (r.have / r.target) * 100)}%` }} /></span>
            </button>
          ))}
        </div>
        <p className="tiny m0">
          {ROLES.find((r) => r.id === role)?.blurb}
          {role === 'theme' && strategy && current?.fromPlan && ` These fit ${strategy.name.toLowerCase()}.`}
          {role === 'theme' && strategy && current && !current.fromPlan && ` Nothing under this price matched ${strategy.name.toLowerCase()}, so these are simply popular in your colours.`}
        </p>
        {!current && <p className="faint tiny">Looking up popular {ROLES.find((r) => r.id === role)?.label.toLowerCase()} in your colours…</p>}
        {current && current.cards.length === 0 && <p className="faint tiny">Nothing came back under this price. Try a higher cap.</p>}
        <div className="staples">
          {(current?.cards ?? []).map((card) => {
            const have = deck.main.find((e) => e.cardId === card.id)?.quantity ?? 0
            const why = whyFor({
              role: ROLES.find((r) => r.id === role)?.label,
              strategy: role === 'theme' ? strategy : null,
              matchedPlan: role === 'theme' && current?.fromPlan,
              owned: ownedOf(collection, card),
            })
            return (
              <div key={card.id} className={`staple ${have ? 'staple--in' : ''}`}>
                <button className="staple__name" onClick={() => onOpenCard?.(card)}>{card.name}</button>
                <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
                <span className="faint tiny">{priceLabel(card, 'usd')}</span>
                <span className="staple__why faint tiny">{why}</span>
                {have
                  ? <button className="btn btn--sm btn--ghost" onClick={() => remove(card)} aria-label={`Remove ${card.name}`}>In deck ✓</button>
                  : <button className="btn btn--sm" onClick={() => add(card)} aria-label={`Add ${card.name}`}>Add</button>}
              </div>
            )
          })}
        </div>
      </section>

      <div className="row row--wrap">
        <button
          className="btn"
          onClick={fill}
          disabled={filling || total >= LIST || ROLES.some((r) => !lists[r.id])}
          title="Adds the most played cards in each role until the skeleton is full, then basic lands"
        >
          {filling ? 'Filling…' : 'Fill the rest with staples'}
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            // A finished list is done with the flow; a short one can be come back to.
            if (total >= LIST) setPref('firstDeck', null)
            navigate({ tab: 'decks', deckId: deck.id, deckTab: null, starting: false, step: null })
          }}
        >
          Open the deck{total < LIST ? ` (${LIST - total} short)` : ''}
        </button>
      </div>
      <p className="faint tiny m0">
        The editor&rsquo;s Coach tab checks the same skeleton and says what is still missing. {inDeck.size > 0 ? 'Everything here is saved as you go.' : ''}
      </p>
    </div>
  )
}
