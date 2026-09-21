import { useState } from 'react'
import { COLOR_PAGES, WHEEL, PAIRS } from '../../data/colors.js'
import { pairKey } from '../../lib/first-deck.js'
import { getCardsByNames } from '../../lib/scryfall.js'
import { navigate } from '../../lib/router.js'
import { setPref } from '../../lib/storage.js'

/**
 * The five colours, to explore before any deck exists.
 *
 * Five labelled controls that toggle, any number at once, and a drawn ring
 * that shows the same choice and can be pressed too, so nothing here needs
 * a drag. What is said about a colour is this app's own summary and the
 * screen says so; the one card named for each is a real card, opened from
 * Scryfall. Handing the choice to the first-deck flow only sets the colours
 * that flow starts from: nothing is created until a deck is started there,
 * and the flow starts from one or two colours, so three or more are shown
 * here and not handed on.
 */
const SWATCH = { W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)', R: 'var(--mtg-r)', G: 'var(--mtg-g)' }

export default function ColourExplorer({ onOpenCard }) {
  const [picked, setPicked] = useState([])
  const toggle = (c) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...WHEEL.filter((w) => w === c || p.includes(w))]))
  const key = picked.length === 2 ? pairKey(picked[0], picked[1]) : picked.length === 1 ? picked[0] : null
  const pair = picked.length === 2 ? PAIRS[key] ?? null : null
  const handoff = () => {
    setPref('firstDeckColors', key)
    navigate({ tab: 'decks', starting: true, step: 'colours' })
  }

  return (
    <div className="stack explorer">
      <button className="btn btn--ghost btn--sm self-start" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
      <div>
        <h1>Explore colours</h1>
        <p className="muted">
          Choose any colours to read what each one cares about. Real decks run any number; the writing here is
          this app’s own summary of each, not anything official.
        </p>
      </div>

      <div className="explorer__layout">
        <Ring picked={picked} onToggle={toggle} />
        <div className="stack stack--tight" role="group" aria-label="Colours">
          {WHEEL.map((c) => (
            <button key={c} type="button" className={`chip explorer__toggle ${picked.includes(c) ? 'chip--active' : ''}`}
              aria-pressed={picked.includes(c)} onClick={() => toggle(c)} style={{ '--swatch': SWATCH[c] }}>
              <span className="explorer__dot" aria-hidden="true" />
              {COLOR_PAGES[c].name}
            </button>
          ))}
        </div>
      </div>

      {picked.length === 0 && <p className="faint tiny">Nothing chosen yet. Press a colour.</p>}
      {pair && (
        <section className="panel">
          <h2 className="m0">{pair.name} <span className="faint tiny">{COLOR_PAGES[picked[0]].name} and {COLOR_PAGES[picked[1]].name}</span></h2>
          <p className="m0">{pair.does}</p>
        </section>
      )}
      {picked.length >= 3 && (
        <p className="tiny muted banner banner--info m0">
          Three or more colours is a real way to build, with more lands to get right. The pages below cover each colour on its own; the pair summaries stop at two.
        </p>
      )}

      {picked.map((c) => {
        const page = COLOR_PAGES[c]
        return (
          <section className="panel stack stack--snug colour-page" key={c} style={{ '--swatch': SWATCH[c] }}>
            <h2 className="m0"><span className="explorer__dot" aria-hidden="true" /> {page.name}</h2>
            <p className="m0"><strong>Cares about</strong> {page.values}</p>
            <p className="m0"><strong>Tends to win by</strong> {page.wins}</p>
            <p className="m0"><strong>Struggles with</strong> {page.weak}</p>
            <div className="row row--wrap row--middle">
              <span className="faint tiny">A card that sums it up</span>
              <ExampleCard name={page.signature[0]} onOpenCard={onOpenCard} />
              <span className="faint tiny">· a small decision it likes: {decision(page)}</span>
            </div>
          </section>
        )
      })}

      <section className="panel stack stack--snug">
        <h3 className="m0">Take these colours to a first deck</h3>
        <p className="tiny muted m0">
          This only sets the colours the first-deck flow starts from. Nothing is created or saved until you start a deck there,
          and choosing colours here is not a colour identity: that comes from a commander, later.
        </p>
        <div className="row row--wrap">
          <button className="btn btn--primary" onClick={handoff} disabled={!key}>
            {key ? `Start from ${picked.map((c) => COLOR_PAGES[c].name).join(' and ')}` : 'Choose one or two colours first'}
          </button>
          {picked.length >= 3 && <span className="faint tiny">The first-deck flow starts from one or two colours.</span>}
        </div>
      </section>
    </div>
  )
}

/** One sentence per colour on the kind of small choice it rewards, drawn from its style, so the commentary stays the app's own. */
function decision(page) {
  const { pace, threat } = page.style
  if (pace === 'fast' && threat === 'creatures') return 'attack now rather than wait for a better board.'
  if (pace === 'fast') return 'point the spell at the player, not the creature, when the race is on.'
  if (threat === 'spells') return 'leave mana open and let the opponent guess.'
  return 'spend the early turns on mana, and cast the biggest thing later.'
}

function ExampleCard({ name, onOpenCard }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className="chip" disabled={busy} title="Open this card" onClick={() => {
      setBusy(true)
      // By the importer's rule, so the card opens on a printing that is out.
      getCardsByNames([name])
        .then((found) => { const card = found.get(name); if (card) onOpenCard?.(card) })
        .catch(() => {})
        .finally(() => setBusy(false))
    }}>
      {name}
    </button>
  )
}

/** A ring of five arcs, one per colour, that reflects the choice and can be pressed. The buttons beside it are the accessible controls. */
function Ring({ picked, onToggle }) {
  const r = 70
  const c = 100
  const arc = (i) => {
    const a0 = ((i * 72) - 90) * Math.PI / 180
    const a1 = (((i + 1) * 72) - 90) * Math.PI / 180
    const x0 = c + r * Math.cos(a0)
    const y0 = c + r * Math.sin(a0)
    const x1 = c + r * Math.cos(a1)
    const y1 = c + r * Math.sin(a1)
    // A wedge from the centre, so the whole slice is a press target; the centre disc drawn over it makes it read as a ring.
    return `M ${c} ${c} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
  }
  const label = (i) => {
    const a = (((i + 0.5) * 72) - 90) * Math.PI / 180
    return { x: c + (r + 22) * Math.cos(a), y: c + (r + 22) * Math.sin(a) }
  }
  return (
    <svg className="explorer__ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      {WHEEL.map((col, i) => (
        <path key={col} d={arc(i)} className={`explorer__arc ${picked.includes(col) ? 'explorer__arc--on' : ''}`}
          style={{ fill: SWATCH[col] }} onClick={() => onToggle(col)} />
      ))}
      {WHEEL.map((col, i) => {
        const { x, y } = label(i)
        return <text key={col} x={x} y={y} className="explorer__label" textAnchor="middle" dominantBaseline="middle">{col}</text>
      })}
      <circle cx={c} cy={c} r={r - 26} className="explorer__centre" />
      <text x={c} y={c} className="explorer__count" textAnchor="middle" dominantBaseline="middle">{picked.length || ''}</text>
    </svg>
  )
}
