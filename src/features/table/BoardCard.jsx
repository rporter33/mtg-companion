import { artUrl } from '../../lib/deck-art.js'
import { typeLineOf } from '../../lib/formats.js'

/**
 * A card as it sits on the table.
 *
 * Deliberately not the app's CardFace, which is a readable rendition of a
 * card's text and is the right thing in a deck list. On a table you are
 * looking at twenty of them at once and you need to recognise them, not read
 * them: so this is the painting, the name, and whatever number matters. The
 * text is one tap away in the card sheet.
 *
 * It is a real button with a spoken label, because rotating a card ninety
 * degrees says "tapped" to someone who can see it and nothing at all to
 * anyone else.
 */
export default function BoardCard({
  card, inst, name, size = 'field', selected = false, onPointerDown, onClick, dragging = false,
}) {
  const art = artUrl(card)
  const type = typeLineOf(card ?? {})
  const stats = statOf(card)
  const counters = Object.entries(inst?.counters ?? {}).filter(([, n]) => n)
  // "tapped" is said in the spoken label and printed beside the card by
  // whatever is laying it out, never inside the card: the card is rotated,
  // and a rotated word is not a word anyone reads.
  const classes = [
    'bcard', `bcard--${size}`,
    inst?.tapped ? 'bcard--tapped' : '',
    inst?.faceDown ? 'bcard--down' : '',
    selected ? 'bcard--selected' : '',
    dragging ? 'bcard--dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      data-identity={identityOf(card)}
      aria-pressed={selected}
      aria-label={describe({ card, inst, name, type, stats, counters })}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <span className="bcard__art" style={art && !inst?.faceDown ? { backgroundImage: `url("${art}")` } : undefined} aria-hidden="true">
        {(!art || inst?.faceDown) && <span className="bcard__glyph">{inst?.faceDown ? '★' : glyphFor(type)}</span>}
      </span>
      <span className="bcard__name">{inst?.faceDown ? 'Face down' : (name ?? card?.name ?? 'Card')}</span>
      {stats && !inst?.faceDown && <span className="bcard__stats">{stats}</span>}
      {counters.length > 0 && (
        <span className="bcard__counters">{counters.map(([label, n]) => `${n > 0 ? '+' : ''}${n} ${label}`).join(' · ')}</span>
      )}
    </button>
  )
}

/** What a screen reader says: the card, then everything done to it. */
function describe({ card, inst, name, type, stats, counters }) {
  if (inst?.faceDown) return 'A face-down card'
  const parts = [name ?? card?.name ?? 'Card']
  if (stats) parts.push(stats)
  if (type) parts.push(type)
  if (inst?.tapped) parts.push('tapped')
  for (const [label, n] of counters) parts.push(`${n} ${label} counter${Math.abs(n) === 1 ? '' : 's'}`)
  if (inst?.note) parts.push(`note: ${inst.note}`)
  return parts.join(', ')
}

function statOf(card) {
  if (!card) return null
  const face = card.card_faces?.[0] ?? {}
  const power = card.power ?? face.power
  const toughness = card.toughness ?? face.toughness
  if (power != null && toughness != null) return `${power}/${toughness}`
  const loyalty = card.loyalty ?? face.loyalty
  return loyalty != null ? String(loyalty) : null
}

function identityOf(card) {
  const identity = card?.color_identity ?? []
  if (identity.length === 1) return identity[0]
  if (identity.length > 1) return 'M'
  return 'C'
}

/** The same pictograms CardFace uses, for a card whose art never arrived. */
function glyphFor(type) {
  if (/\bLand\b/.test(type)) return '⛰'
  if (/\bPlaneswalker\b/.test(type)) return '✦'
  if (/\bCreature\b/.test(type)) return '⚔'
  if (/\bInstant\b/.test(type)) return '⚡'
  if (/\bSorcery\b/.test(type)) return '✷'
  if (/\bArtifact\b/.test(type)) return '⚙'
  if (/\bEnchantment\b/.test(type)) return '❖'
  return '◈'
}
