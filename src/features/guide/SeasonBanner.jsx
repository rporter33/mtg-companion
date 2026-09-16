import { useEffect, useState } from 'react'
import { getSets } from '../../lib/scryfall.js'
import { buildSeasonTheme } from '../../lib/season.js'
import './season.css'

/**
 * The upcoming-set banner.
 *
 * Everything here is derived from Scryfall at runtime — which set is next, when
 * it lands, its official icon — so it stays correct for sets that do not exist
 * yet, with no code change. The accent is computed from the set code rather
 * than hand-picked, because this app has no way to know a set's art direction
 * and should not pretend otherwise.
 *
 * Renders nothing at all when there is no data. A set banner is a nice touch,
 * not a load-bearing element, and it must never be the reason a screen is empty.
 */
export default function SeasonBanner({ onExplore }) {
  const [theme, setTheme] = useState(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    getSets({ signal: controller.signal })
      .then((sets) => { if (!cancelled) setTheme(buildSeasonTheme(sets)) })
      .catch(() => { /* offline, or Scryfall unreachable — show nothing */ })
    return () => { cancelled = true; controller.abort() }
  }, [])

  if (!theme) return null
  const { set, isUpcoming, countdown, accent, accentDim } = theme

  return (
    <section
      className="season"
      style={{ '--season-accent': accent, '--season-dim': accentDim }}
    >
      {set.iconSvgUri && (
        <img className="season__icon" src={set.iconSvgUri} alt="" aria-hidden="true" loading="lazy" />
      )}

      <div className="season__body">
        <div className="season__label">
          {isUpcoming ? 'Next set' : 'Latest set'}
          {countdown && <span className="season__countdown"> · {countdown}</span>}
        </div>
        <h2>{set.name}</h2>
        <p className="muted tiny">
          {isUpcoming
            ? `Releases ${formatDate(set.releasedAt)}.`
            : `Released ${formatDate(set.releasedAt)}${set.cardCount ? ` · ${set.cardCount} cards` : ''}.`}
        </p>
      </div>

      <button className="btn btn--sm season__cta" onClick={() => onExplore?.(theme.searchQuery)}>
        {isUpcoming ? 'Spoilers so far' : 'Browse the set'}
      </button>
    </section>
  )
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
