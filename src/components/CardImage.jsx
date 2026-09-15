import { useState } from 'react'
import CardFace from './CardFace.jsx'

/** Picks the best available Scryfall image, including on the back of a DFC. */
export function imageUrl(card, size = 'normal', faceIndex = 0) {
  if (!card) return null
  const face = card.card_faces?.[faceIndex]
  return face?.image_uris?.[size] ?? card.image_uris?.[size] ?? null
}

export function hasBackFace(card) {
  return (card?.card_faces?.length ?? 0) > 1 && !!card.card_faces[1]?.image_uris
}

/**
 * Shows Scryfall's card image, falling back to the CSS-rendered face when there
 * is no image, the image fails to load, or the user has images switched off.
 *
 * The fallback is not a placeholder — it is a fully readable card, so the app
 * stays usable on bad venue wifi rather than showing a grid of broken frames.
 */
export default function CardImage({
  card, size = 'normal', preferImages = true, onClick, faceIndex = 0, className = '',
}) {
  const [failed, setFailed] = useState(false)
  const url = preferImages && !failed ? imageUrl(card, size, faceIndex) : null

  if (!url) {
    return <CardFace card={card} size={size === 'small' ? 'sm' : 'md'} onClick={onClick} />
  }

  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className={`cardimage ${className}`}
      onClick={onClick}
      {...(onClick ? { type: 'button' } : {})}
    >
      <img
        src={url}
        alt={card.name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </Tag>
  )
}
