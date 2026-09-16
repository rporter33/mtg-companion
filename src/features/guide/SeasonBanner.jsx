import { useEffect, useState } from 'react'
import { getSets, getSetColorProfile } from '../../lib/scryfall.js'
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
  const [iconFailed, setIconFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      try {
        const sets = await getSets({ signal: controller.signal })
        // Render immediately from the code-hash accent, then refine once the
        // set's real colour distribution arrives. Five extra queries should not
        // hold up a banner.
        const initial = buildSeasonTheme(sets)
        if (cancelled || !initial) return
        setTheme(initial)

        const profile = await getSetColorProfile(initial.set.code, { signal: controller.signal })
        if (cancelled || !profile) return
        setTheme(buildSeasonTheme(sets, undefined, profile))
      } catch {
        // Offline, or Scryfall unreachable. Show nothing rather than a shell.
      }
    })()

    return () => { cancelled = true; controller.abort() }
  }, [])

  if (!theme) return null
  const { set, isUpcoming, countdown, accent, accentDim } = theme

  return (
    <section
      className="season"
      style={{ '--season-accent': accent, '--season-dim': accentDim }}
    >
      {set.iconSvgUri && !iconFailed && (
        // A broken-image glyph is worse than no icon at all, and a set icon is
        // decoration — the banner reads perfectly without one.
        <img
          className="season__icon"
          src={set.iconSvgUri}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setIconFailed(true)}
        />
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
