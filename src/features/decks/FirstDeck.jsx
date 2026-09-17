import { useEffect, useMemo, useState } from 'react'
import { COLOR_PAGES, PAIRS, STYLE_AXES, FIRST_COMMANDERS, WHEEL } from '../../data/colors.js'
import {
  DIAL_MAX, dialToColors, colorsToDial, describeColors, suggestColors, commanderQuery,
  stapleQueries, ROLES, roleCounts, fillPlan,
} from '../../lib/first-deck.js'
import { searchCards, getCardsByNames, getCardByName } from '../../lib/scryfall.js'
import { createDeck, addCard, setCommanders } from '../../lib/deck.js'
import { saveDeck, getPrefs, setPref } from '../../lib/storage.js'
import { pinCards } from '../../lib/cache.js'
import { navigate } from '../../lib/router.js'
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

export default function FirstDeck({ onOpenCard }) {
  const [step, setStep] = useState(0)
  const [dial, setDial] = useState(() => colorsToDial(getPrefs().firstDeckColors ?? 'GW') ?? 0)
  const [picked, setPicked] = useState(() => getPrefs().firstDeckColors ?? null) // an enemy pair the dial cannot show
  const [answers, setAnswers] = useState(() => getPrefs().firstDeckStyle ?? {})
  const [deck, setDeck] = useState(null)
  const [cards, setCards] = useState(() => new Map())
  const [cap, setCap] = useState(4)

  const colors = picked && colorsToDial(picked) === null ? picked : dialToColors(dial)
  const chosen = describeColors(colors)
  useEffect(() => { setPref('firstDeckColors', colors) }, [colors])

  const lookup = (id) => cards.get(id)
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

  const startWith = (card) => {
    const fresh = createDeck({ name: `${card.name.split(',')[0]} deck`, formatId: 'commander' })
    const next = setCommanders(fresh, [card.id])
    remember([card])
    pinCards([card.id])
    commit(next)
    setStep(3)
  }

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
        {STEPS.map((label, i) => (
          <li key={label} className={`steps__item ${i === step ? 'steps__item--current' : ''} ${i < step ? 'steps__item--done' : ''}`} aria-current={i === step ? 'step' : undefined}>
            <button
              className="steps__button"
              onClick={() => setStep(i)}
              disabled={i === 3 && !deck}
              title={i === 3 && !deck ? 'Choose a commander first' : undefined}
            >
              <span className="steps__num">{i < step ? '✓' : i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <ColourStep dial={dial} colors={colors} chosen={chosen} onDial={chooseDial} onPair={choosePair} onOpenCard={onOpenCard} onNext={() => setStep(1)} />
      )}
      {step === 1 && (
        <StyleStep answers={answers} colors={colors} onAnswer={(axis, id) => {
          const next = { ...answers, [axis]: id }
          setAnswers(next)
          setPref('firstDeckStyle', next)
        }} onSuggest={applySuggestion} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <CommanderStep colors={colors} onOpenCard={onOpenCard} onStart={startWith} remember={remember} />
      )}
      {step === 3 && deck && (
        <StaplesStep deck={deck} colors={colors} lookup={lookup} cap={cap} onCap={setCap} remember={remember} onChange={commit} onOpenCard={onOpenCard} />
      )}
    </div>
  )
}

// --- step 1: the dial --------------------------------------------------------

const SWATCH = { W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)' }

function ColourStep({ dial, colors, chosen, onDial, onPair, onOpenCard, onNext }) {
  const label = chosen.kind === 'mono'
    ? COLOR_PAGES[chosen.id].name
    : `${COLOR_PAGES[chosen.id[0]].name} and ${COLOR_PAGES[chosen.id[1]].name} — ${chosen.pair?.name ?? ''}`
  const pages = chosen.kind === 'mono' ? [COLOR_PAGES[chosen.id]] : chosen.id.split('').map((c) => COLOR_PAGES[c])

  return (
    <div className="stack">
      <section className="panel stack">
        <h3>Pick a colour, or the pair between two</h3>
        <p className="muted tiny" style={{ margin: 0 }}>
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
          <h2 style={{ margin: 0 }}>{label}</h2>
        </div>
        {chosen.kind === 'pair' && chosen.pair && (
          <p className="colour-pages__does">{chosen.pair.does}</p>
        )}
        <div className={`colour-pages__grid ${pages.length === 2 ? 'colour-pages__grid--two' : ''}`}>
          {pages.map((page) => (
            <article key={page.id} className="colour-page" style={{ '--swatch': SWATCH[page.id] }}>
              <h3><span className="colour-page__dot" aria-hidden="true" />{page.name}</h3>
              <dl className="facts">
                <div><dt>Cares about</dt><dd>{page.values}</dd></div>
                <div><dt>Wins by</dt><dd>{page.wins}</dd></div>
                <div><dt>Bad at</dt><dd>{page.weak}</dd></div>
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

function StyleStep({ answers, colors, onAnswer, onSuggest, onNext }) {
  const suggestion = suggestColors(answers)
  const name = (key) => (key.length === 1 ? COLOR_PAGES[key].name : `${PAIRS[key]?.name} (${key.split('').map((c) => COLOR_PAGES[c].name).join(' and ')})`)
  return (
    <div className="stack">
      <section className="panel stack">
        <h3>Four questions, no wrong answers</h3>
        <p className="muted tiny" style={{ margin: 0 }}>Each answer leans toward the colours that play that way. You can always drag the dial somewhere else.</p>
        {STYLE_AXES.map((axis) => (
          <div key={axis.id} className="stack" style={{ gap: 'var(--space-1)' }} role="group" aria-label={axis.question}>
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
        <div className="row row--wrap" style={{ alignItems: 'center' }}>
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
        <button className="btn btn--primary" onClick={onNext}>Next: commanders in {name(colors)}</button>
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
          <p className="muted tiny" style={{ margin: 0 }}>
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
        <p className="muted tiny" style={{ margin: 0 }}>Live from Scryfall, ordered by how many Commander decks run each one.</p>
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
      <div className="stack" style={{ gap: 'var(--space-1)', minWidth: 0 }}>
        <strong className="commander-pick__name">{card.name}</strong>
        <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
        <span className="faint tiny">{card.type_line}</span>
        {why && <p className="tiny" style={{ margin: 0 }}>{why}</p>}
        <div>
          <button className="btn btn--sm btn--primary" onClick={() => onStart(card)}>Start with {card.name.split(',')[0]}</button>
        </div>
      </div>
    </div>
  )
}

// --- step 4: staples by role --------------------------------------------------

function StaplesStep({ deck, colors, lookup, cap, onCap, remember, onChange, onOpenCard }) {
  const [role, setRole] = useState('lands')
  const [lists, setLists] = useState({}) // roleId -> { status, cards }
  const [filling, setFilling] = useState(false)
  const counts = useMemo(() => roleCounts(deck, lookup), [deck, lookup])
  const total = deck.main.reduce((n, e) => n + e.quantity, 0)
  const inDeck = new Set(deck.main.map((e) => e.cardId))

  /** Loads a role's staples once per cap; tries each query until one answers. */
  const load = async (roleId, signal) => {
    for (const query of stapleQueries(colors, roleId, { capUsd: cap })) {
      try {
        const result = await searchCards(query, { order: 'edhrec', signal })
        if (result.cards.length) return result.cards.slice(0, 40)
      } catch (error) {
        if (error.name === 'AbortError') throw error
      }
    }
    return []
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLists({})
    ;(async () => {
      for (const r of ROLES) {
        const cards = await load(r.id, controller.signal).catch(() => [])
        if (cancelled) return
        remember(cards)
        setLists((prev) => ({ ...prev, [r.id]: { status: 'done', cards } }))
      }
    })()
    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, cap])

  const add = (card, quantity = 1) => onChange(addCard(deck, card.id, quantity, 'main'))
  const remove = (card) => onChange(addCard(deck, card.id, -1, 'main'))

  const fill = async () => {
    setFilling(true)
    try {
      const candidates = Object.fromEntries(ROLES.map((r) => [r.id, lists[r.id]?.cards ?? []]))
      candidates.colors = colors
      const plan = fillPlan({ ...deck, colors }, lookup, candidates)
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
        <div className="row row--wrap" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>A starting list for {deck.name}</h3>
          <span className="spacer" />
          <span className={`chip ${total === 99 ? 'chip--ok' : ''}`}>{total}/99</span>
          <select className="chip" aria-label="Price cap per card" value={cap} onChange={(e) => onCap(Number(e.target.value))}>
            {CAPS.map((c) => <option key={c} value={c}>Under ${c} a card</option>)}
          </select>
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>
          A Commander deck is 99 cards plus the commander. This is the usual skeleton; the numbers are a guide, not a rule.
        </p>
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
        <p className="tiny" style={{ margin: 0 }}>{ROLES.find((r) => r.id === role)?.blurb}</p>
        {!current && <p className="faint tiny">Looking up popular {ROLES.find((r) => r.id === role)?.label.toLowerCase()} in your colours…</p>}
        {current && current.cards.length === 0 && <p className="faint tiny">Nothing came back under this price. Try a higher cap.</p>}
        <div className="staples">
          {(current?.cards ?? []).map((card) => {
            const have = deck.main.find((e) => e.cardId === card.id)?.quantity ?? 0
            return (
              <div key={card.id} className={`staple ${have ? 'staple--in' : ''}`}>
                <button className="staple__name" onClick={() => onOpenCard?.(card)}>{card.name}</button>
                <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
                <span className="faint tiny">{priceLabel(card, 'usd')}</span>
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
          disabled={filling || total >= 99 || ROLES.some((r) => !lists[r.id])}
          title="Adds the most played cards in each role until the skeleton is full, then basic lands"
        >
          {filling ? 'Filling…' : 'Fill the rest with staples'}
        </button>
        <button className="btn btn--primary" onClick={() => navigate({ tab: 'decks', deckId: deck.id, deckTab: null, starting: false })}>
          Open the deck{total < 99 ? ` (${99 - total} short)` : ''}
        </button>
      </div>
      <p className="faint tiny" style={{ margin: 0 }}>
        The editor&rsquo;s Coach tab checks the same skeleton and says what is still missing. {inDeck.size > 0 ? 'Everything here is saved as you go.' : ''}
      </p>
    </div>
  )
}
