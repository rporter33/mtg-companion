import { useEffect, useState } from 'react'
import { getSets, getSetColorProfile } from '../../lib/scryfall.js'
import { buildSeasonTheme } from '../../lib/season.js'
import HeroArt from '../../components/HeroArt.jsx'
import { mechanicsForSet, curationAgeDays } from '../../data/set-mechanics.js'
import Sheet from '../../components/Sheet.jsx'
import Term from '../../components/Term.jsx'
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
  const [openMechanics, setOpenMechanics] = useState(false)

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
  // A curated theme brings its own art and voice (src/data/set-themes.js);
  // a derived one gets the plain banner, because a hash is not art direction.
  const curatedTheme = theme.derivedFrom === 'curated' ? theme : null
  const withBase = (art) => (art ? {
    ...art,
    src: `${import.meta.env.BASE_URL}${art.src}`,
    srcset: art.srcset.split(',').map((part) => `${import.meta.env.BASE_URL}${part.trim()}`).join(', '),
  } : null)

  // Art-direction treatment, only where we actually know the set's. A set with
  // no curated entry gets the plain banner rather than a guessed aesthetic.
  const curated = mechanicsForSet(set.code)
  const treatment = curated?.art?.headline === 'Shattered Mirror' ? 'fracture' : null

  return (
    // The sheet is a sibling of the banner, never a child. The fracture
    // treatment gives the banner a clip-path and overflow:hidden, and a
    // clipping ancestor clips its descendants even when they are fixed —
    // which rendered the modal as a clipped strip inside the banner.
    <>
    <section
      className={`season ${treatment ? `season--${treatment}` : ''} ${curatedTheme?.art ? 'season--art' : ''}`}
      style={{ '--season-accent': accent, '--season-dim': accentDim }}
      data-theme-source={theme.derivedFrom}
    >
      {curatedTheme?.art && <HeroArt wide={withBase(curatedTheme.art.wide)} portrait={withBase(curatedTheme.art.portrait)} className="season__art" />}
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
        {curatedTheme?.voice?.tagline && <p className="season__tagline">{curatedTheme.voice.tagline}</p>}
        <p className="muted tiny">
          {isUpcoming
            ? `Releases ${formatDate(set.releasedAt)}.`
            : `Released ${formatDate(set.releasedAt)}${set.cardCount ? ` · ${set.cardCount} cards` : ''}.`}
          {curatedTheme?.provisional && ' Colours and lore here are the app\u2019s own reading of public previews, not official.'}
        </p>
      </div>

      <div className="season__actions">
        {curated && (
          <button className="btn btn--sm season__cta" onClick={() => setOpenMechanics(true)}>
            What&rsquo;s new
          </button>
        )}
        <button className="btn btn--sm season__cta" onClick={() => onExplore?.(theme.searchQuery)}>
          {isUpcoming ? 'Spoilers so far' : 'Browse the set'}
        </button>
      </div>

    </section>

    <Sheet
      open={openMechanics}
      onClose={() => setOpenMechanics(false)}
      title={`New in ${set.name}`}
      size="lg"
    >
      {curated && (
        <div style={{ '--season-accent': accent }}>
          <SetMechanics entry={curated} />
        </div>
      )}
    </Sheet>
    </>
  )
}

function SetMechanics({ entry }) {
  const age = curationAgeDays(entry)

  return (
    <div className="stack">
      <p className="term__short">{entry.premise}</p>

      {entry.mechanics.map((mechanic) => (
        <section className="panel stack stack--snug" key={mechanic.id}>
          <h3>{mechanic.term}</h3>
          <p className="m0">{mechanic.short}</p>
          <p className="muted tiny m0">{mechanic.long}</p>
          {mechanic.forNewPlayers && (
            <p className="tiny" style={{ margin: 0, color: 'var(--season-accent, var(--accent))' }}>
              New to Magic? {mechanic.forNewPlayers}
            </p>
          )}
          {mechanic.seeAlso?.length > 0 && (
            <div className="row row--wrap">
              <span className="faint tiny">See also</span>
              {mechanic.seeAlso.map((id) => <Term key={id} id={id} as="span" />)}
            </div>
          )}
        </section>
      ))}

      {entry.art && (
        <section className="panel stack stack--snug">
          <h3>{entry.art.headline}</h3>
          <p className="muted tiny m0">{entry.art.description}</p>
        </section>
      )}

      {/* Say plainly how old this is and where it came from. Every other fact in
          this app is fetched live; this section is hand-written, so it is the
          one place that can quietly go stale. */}
      <div className="banner banner--warn tiny">
        {entry.provisional && <strong>Written during spoiler season. </strong>}
        Summarised by hand on {entry.curatedAt}
        {age != null && age > 0 && ` — ${age} day${age === 1 ? '' : 's'} ago`}
        {entry.provisional && ', and wording sometimes changes before release'}.
        {' '}Everything else in this app is read live from Scryfall; this section is not.
        {entry.sources?.length > 0 && (
          <div className="mt2">
            {entry.sources.map((url) => (
              <div key={url}>
                <a href={url} target="_blank" rel="noreferrer noopener">{shortHost(url)}</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function shortHost(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`
  } catch {
    return url
  }
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
