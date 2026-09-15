import ManaCost, { OracleText } from './ManaCost.jsx'
import { typeLineOf, oracleTextOf } from '../lib/formats.js'
import './card.css'

const FRAME_BY_IDENTITY = {
  W: 'w', U: 'u', B: 'b', R: 'r', G: 'g',
}

/** Single-letter frame key: one colour uses that colour, 2+ uses gold, none grey. */
export function frameKey(card) {
  const identity = card?.color_identity ?? []
  if (identity.length === 1) return FRAME_BY_IDENTITY[identity[0]] ?? 'c'
  if (identity.length > 1) return 'm'
  return /\bLand\b/.test(typeLineOf(card)) ? 'l' : 'c'
}

export function identityAttr(card) {
  const identity = card?.color_identity ?? []
  if (identity.length === 1) return identity[0]
  if (identity.length > 1) return 'M'
  return 'C'
}

function statLine(card) {
  const face = card.card_faces?.[0]
  const power = card.power ?? face?.power
  const toughness = card.toughness ?? face?.toughness
  if (power != null && toughness != null) return `${power}/${toughness}`
  const loyalty = card.loyalty ?? face?.loyalty
  if (loyalty != null) return loyalty
  const defense = card.defense ?? face?.defense
  if (defense != null) return defense
  return null
}

/**
 * A card drawn entirely in CSS from its data.
 *
 * This exists for three reasons: the guide's tutorial needs real cards with no
 * network, card images fail to load more often than you would like on venue
 * wifi, and a text-first card is far more readable to a new player than a
 * 200-pixel-tall scan of one.
 */
export default function CardFace({ card, size = 'md', onClick, showFlavor = false }) {
  if (!card) return null

  const face = card.card_faces?.[0] ?? {}
  const cost = card.mana_cost || face.mana_cost || ''
  const type = typeLineOf(card)
  const text = oracleTextOf(card)
  const stats = statLine(card)
  const flavor = card.flavor_text ?? face.flavor_text
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      className={`cardface cardface--${size} cardface--${frameKey(card)}`}
      data-identity={identityAttr(card)}
      onClick={onClick}
      {...(onClick ? { type: 'button' } : {})}
    >
      <div className="cardface__titlebar">
        <span className="cardface__name">{card.name}</span>
        <ManaCost cost={cost} />
      </div>

      <div className="cardface__art" aria-hidden="true">
        <div className="cardface__art-glyph">{glyphFor(type)}</div>
      </div>

      <div className="cardface__typebar">
        <span className="cardface__type">{type}</span>
        {card.rarity && <span className={`cardface__rarity cardface__rarity--${card.rarity}`} title={card.rarity} />}
      </div>

      <div className="cardface__text">
        <OracleText text={text} />
        {showFlavor && flavor && <p className="cardface__flavor">{flavor}</p>}
      </div>

      {stats && <div className="cardface__stats">{stats}</div>}
    </Tag>
  )
}

/** A rough pictogram so the art box is not just an empty rectangle. */
function glyphFor(type) {
  if (/\bLand\b/.test(type)) return '⛰'
  if (/\bPlaneswalker\b/.test(type)) return '✦'
  if (/\bCreature\b/.test(type)) return '⚔'
  if (/\bInstant\b/.test(type)) return '⚡'
  if (/\bSorcery\b/.test(type)) return '✷'
  if (/\bArtifact\b/.test(type)) return '⚙'
  if (/\bEnchantment\b/.test(type)) return '❖'
  if (/\bBattle\b/.test(type)) return '🛡'
  return '◈'
}
