import { parseManaCost, classifySymbol } from '../lib/mana.js'
import './mana.css'

const COLOR_VAR = {
  W: 'var(--mtg-w)', U: 'var(--mtg-u)', B: 'var(--mtg-b)',
  R: 'var(--mtg-r)', G: 'var(--mtg-g)',
}

const SPOKEN = {
  W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
  C: 'colorless', S: 'snow', X: 'X', T: 'tap', Q: 'untap', E: 'energy',
}

/**
 * Mana symbols drawn in CSS rather than fetched as images.
 *
 * Scryfall hosts symbol SVGs, but drawing them here means the guide, the deck
 * builder and the play companion all render correctly with no network at all —
 * which is the whole point of a local-first app you open at a game store.
 */
function Symbol({ body }) {
  const { kind, colors, generic } = classifySymbol(body)
  const label = describe(body, kind, colors, generic)

  if (kind === 'hybrid' && colors.length === 2) {
    return (
      <span
        className="mana mana--hybrid"
        style={{ '--half-a': COLOR_VAR[colors[0]], '--half-b': COLOR_VAR[colors[1]] }}
        role="img"
        aria-label={label}
      >
        <span className="mana__glyph">{colors[0]}/{colors[1]}</span>
      </span>
    )
  }

  if (kind === 'monocolor-hybrid') {
    return (
      <span
        className="mana mana--hybrid"
        style={{ '--half-a': 'var(--mtg-c)', '--half-b': COLOR_VAR[colors[0]] }}
        role="img"
        aria-label={label}
      >
        <span className="mana__glyph">{generic}/{colors[0]}</span>
      </span>
    )
  }

  if (kind === 'phyrexian') {
    return (
      <span
        className="mana"
        style={{ '--symbol-bg': colors.length ? COLOR_VAR[colors[0]] : 'var(--mtg-c)' }}
        role="img"
        aria-label={label}
      >
        <span className="mana__glyph">Φ</span>
      </span>
    )
  }

  const background = kind === 'colored' ? COLOR_VAR[colors[0]] : 'var(--mtg-c)'
  const glyph = kind === 'generic' ? String(generic) : body.toUpperCase()

  return (
    <span className="mana" style={{ '--symbol-bg': background }} role="img" aria-label={label}>
      <span className="mana__glyph">{glyph}</span>
    </span>
  )
}

function describe(body, kind, colors, generic) {
  const sym = String(body).toUpperCase()
  if (kind === 'generic') return `${generic} generic mana`
  if (kind === 'hybrid') return `${SPOKEN[colors[0]]} or ${SPOKEN[colors[1]]} mana`
  if (kind === 'monocolor-hybrid') return `${generic} generic or one ${SPOKEN[colors[0]]} mana`
  if (kind === 'phyrexian') return `phyrexian ${colors.map((c) => SPOKEN[c]).join(' or ')} mana`
  return `${SPOKEN[sym] ?? sym} mana`
}

export default function ManaCost({ cost, className = '' }) {
  const symbols = parseManaCost(cost)
  if (!symbols.length) return null
  return (
    <span className={`mana-cost ${className}`}>
      {symbols.map((body, i) => <Symbol key={`${body}-${i}`} body={body} />)}
    </span>
  )
}

/**
 * Renders oracle text with its inline mana symbols drawn, and its reminder
 * text de-emphasised — reminder text is exactly what a new player needs and
 * exactly what an experienced one wants to skim past.
 */
export function OracleText({ text, className = '' }) {
  if (!text) return null
  return (
    <div className={`oracle ${className}`}>
      {text.split('\n').map((line, i) => (
        <p key={i} className="oracle__line">{renderInline(line)}</p>
      ))}
    </div>
  )
}

function renderInline(line) {
  // Split on mana symbols and on parenthesised reminder text in one pass.
  const parts = line.split(/(\{[^}]+\}|\([^)]*\))/g).filter(Boolean)
  return parts.map((part, i) => {
    if (/^\{[^}]+\}$/.test(part)) {
      return <Symbol key={i} body={part.slice(1, -1)} />
    }
    if (/^\([^)]*\)$/.test(part)) {
      return <em key={i} className="oracle__reminder">{part}</em>
    }
    return <span key={i}>{part}</span>
  })
}
