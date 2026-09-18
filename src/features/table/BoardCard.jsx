import { useRef, useState } from 'react'
import { artUrl, treatmentOf, treatmentName } from '../../lib/board/art.js'
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
  card, inst, name, size = 'field', selected = false, onPointerDown, onClick, dragging = false, tilt = false,
}) {
  const art = artUrl(card)
  const type = inst?.custom?.typeLine ?? typeLineOf(card ?? {})
  const stats = statOf(card, inst)
  const treatment = card ? treatmentName(card) : null
  const finish = card ? finishOf(card, inst) : 'normal'
  const lean = useLean(tilt && !dragging)
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
    finish !== 'normal' && !inst?.faceDown ? `bcard--${finish}` : '',
    treatment && !inst?.faceDown ? `bcard--${treatment.replace(/\s+/g, '')}` : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      data-identity={identityOf(card)}
      aria-pressed={selected}
      aria-label={describe({ card, inst, name, type, stats, counters, finish, treatment })}
      onPointerDown={onPointerDown}
      onClick={onClick}
      {...lean.handlers}
      style={lean.style}
    >
      <span className="bcard__art" style={art && !inst?.faceDown ? { backgroundImage: `url("${art}")` } : undefined} aria-hidden="true">
        {(!art || inst?.faceDown) && <span className="bcard__glyph">{inst?.faceDown ? '★' : glyphFor(type)}</span>}
      </span>
      <span className="bcard__name">{inst?.faceDown ? 'Face down' : (name ?? card?.name ?? 'Card')}</span>
      {stats && !inst?.faceDown && <span className="bcard__stats">{stats}</span>}
      {counters.length > 0 && (
        <span className="bcard__counters">{counters.map(([label, n]) => `${n > 0 ? '+' : ''}${n} ${label}`).join(' · ')}</span>
      )}
      {finish !== 'normal' && !inst?.faceDown && <span className="bcard__sheen" aria-hidden="true" />}
    </button>
  )
}

/**
 * What a screen reader says: the card, then everything done to it. A foil is
 * said out loud, because a sheen that only exists as a moving highlight is
 * not something everyone can see.
 */
function describe({ card, inst, name, type, stats, counters, finish, treatment }) {
  if (inst?.faceDown) return 'A face-down card'
  const parts = [name ?? card?.name ?? 'Card']
  if (stats) parts.push(stats)
  if (type) parts.push(type)
  if (finish && finish !== 'normal') parts.push(finish)
  if (treatment) parts.push(treatment)
  if (inst?.tapped) parts.push('tapped')
  for (const [label, n] of counters) parts.push(`${n} ${label} counter${Math.abs(n) === 1 ? '' : 's'}`)
  if (inst?.note) parts.push(`note: ${inst.note}`)
  return parts.join(', ')
}

/** The finish, as long as the printing could actually exist in it. */
function finishOf(card, inst) {
  const wanted = inst?.finish ?? 'normal'
  if (wanted === 'normal') return 'normal'
  const t = treatmentOf(card)
  if (wanted === 'foil' && t.foilable) return 'foil'
  if (wanted === 'etched' && t.etchable) return 'etched'
  return 'normal'
}

/**
 * A card leaning toward the pointer, which is how you look at a foil.
 *
 * Only ever on a card being hovered, never during a drag, and never at all
 * when motion is reduced — the caller decides that. The lean is two custom
 * properties rather than a transform written here, so the stylesheet can
 * combine it with the rotation of a tapped card.
 */
function useLean(on) {
  const [lean, setLean] = useState(null)
  const box = useRef(null)
  if (!on) {
    return { handlers: {}, style: undefined }
  }
  return {
    style: lean ? { '--lean-x': `${lean.x}deg`, '--lean-y': `${lean.y}deg` } : undefined,
    handlers: {
      onPointerEnter: (e) => { box.current = e.currentTarget.getBoundingClientRect() },
      onPointerMove: (e) => {
        if (e.buttons) return // a press is a drag, not a look
        const rect = box.current ?? e.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        setLean({
          y: ((e.clientX - rect.left) / rect.width - 0.5) * 16,
          x: (0.5 - (e.clientY - rect.top) / rect.height) * 16,
        })
      },
      onPointerLeave: () => { setLean(null); box.current = null },
    },
  }
}

function statOf(card, inst) {
  if (inst?.custom) {
    const { power, toughness } = inst.custom
    return power != null && toughness != null && power !== '' ? `${power}/${toughness}` : null
  }
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
