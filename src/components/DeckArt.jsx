import { useEffect, useState } from 'react'

/**
 * A card's painting used as a backdrop: behind a deck's name, behind a row.
 *
 * An image element rather than a CSS background, for two reasons that
 * matter at a hundred rows: it lazy-loads, so only the rows on screen cost
 * anything, and it can report failure, so a painting that cannot be fetched
 * leaves a plain row rather than a broken frame. It is decoration — the
 * name is right there in text — so it is hidden from assistive technology.
 */
export default function DeckArt({ src, cardId, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return null
  return (
    <img
      className={`deck-art ${className}`}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable="false"
      data-art-of={cardId}
      onError={() => setFailed(true)}
    />
  )
}
