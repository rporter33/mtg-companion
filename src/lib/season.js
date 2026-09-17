import { curatedThemeFor } from '../data/set-themes.js'
// Set-aware theming.
//
// Magic releases a new set every few months, and the app should feel like it
// knows that. The naive way is to hardcode the current set's name and colours
// and update them four times a year — which is the same mistake as baking in a
// ban list, and it rots the same way.
//
// Instead the theme is *derived* from Scryfall's set list at runtime: which set
// is next, how long until it lands, and what its official icon is. That works
// for every future set with no code change, including sets nobody has announced
// yet.
//
// What cannot be derived is a set's art direction. Rather than invent a palette
// and claim it is the set's, the accent is computed deterministically from the
// set code, so each set gets a stable identity of its own without this file
// pretending to know what the set looks like.

const PAPER_TYPES = new Set(['expansion', 'core'])

export function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Splits the set list into what just came out and what is coming next.
 * Digital-only and supplemental products are excluded: this drives a
 * "what's next in paper" headline, not a release log.
 */
export function findSeason(sets, now = today()) {
  const paper = (sets ?? [])
    .filter((set) => PAPER_TYPES.has(set.setType) && !set.digital && set.releasedAt)

  const upcoming = paper
    .filter((set) => set.releasedAt > now)
    .sort((a, b) => a.releasedAt.localeCompare(b.releasedAt))

  const released = paper
    .filter((set) => set.releasedAt <= now)
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))

  const next = upcoming[0] ?? null
  const current = released[0] ?? null

  return {
    next,
    current,
    daysUntilNext: next ? daysBetween(now, next.releasedAt) : null,
    daysSinceCurrent: current ? daysBetween(current.releasedAt, now) : null,
  }
}

export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

// Where each colour sits on the hue wheel, matched to the app's existing
// WUBRG tokens so a set-tinted banner sits beside the rest of the interface
// rather than fighting it.
const COLOR_HUES = { W: 44, U: 205, B: 267, R: 5, G: 140 }

/**
 * Derives an accent from a set's actual colour distribution.
 *
 * This is strictly better than hashing the set code, because it is real
 * information: a set that skews blue gets a blue banner. Hues are averaged as
 * unit vectors rather than as numbers, because hue is circular and a naive mean
 * of red (5) and white (44) is fine while a naive mean of red (5) and black
 * (267) gives green — the exact bug that makes colour-averaging look broken.
 *
 * Returns null when there is nothing to derive from, so the caller can fall
 * back to the code hash.
 */
export function accentFromColorProfile(profile) {
  if (!profile?.total) return null

  let x = 0
  let y = 0
  for (const [color, count] of Object.entries(profile.counts)) {
    const hue = COLOR_HUES[color]
    if (hue === undefined || !count) continue
    const radians = (hue * Math.PI) / 180
    x += Math.cos(radians) * count
    y += Math.sin(radians) * count
  }

  if (x === 0 && y === 0) return null
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360

  // How lopsided the set is. An evenly-spread set produces a short resultant
  // vector, and leaning on a near-arbitrary hue there would be false precision,
  // so saturation drops toward neutral instead.
  const magnitude = Math.hypot(x, y) / profile.total
  const saturation = Math.round(38 + magnitude * 34)

  return {
    hue: Math.round(hue),
    accent: `hsl(${hue.toFixed(1)} ${saturation}% 62%)`,
    accentDim: `hsl(${hue.toFixed(1)} ${saturation}% 62% / 0.13)`,
    derivedFrom: 'colors',
    balance: Number(magnitude.toFixed(3)),
  }
}

/**
 * A stable accent hue for a set code.
 *
 * Deterministic from the code, so a set always looks the same, and spread
 * across the wheel so consecutive sets are visually distinct. Saturation and
 * lightness are fixed at values that stay legible on the dark base — the hue is
 * the only free variable, which is what keeps every set on-theme rather than
 * letting one render an unreadable near-black.
 */
export function accentForSet(code) {
  if (!code) return null
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0
  }
  // Golden-angle stepping spreads adjacent hashes far apart on the wheel.
  const hue = (hash * 137.508) % 360
  return {
    hue: Math.round(hue),
    accent: `hsl(${hue.toFixed(1)} 62% 62%)`,
    accentDim: `hsl(${hue.toFixed(1)} 62% 62% / 0.13)`,
  }
}

/** Human phrasing for the countdown. Vague on purpose beyond a month. */
export function describeCountdown(days) {
  if (days == null) return null
  if (days < 0) return 'out now'
  if (days === 0) return 'out today'
  if (days === 1) return 'out tomorrow'
  if (days <= 14) return `${days} days away`
  if (days <= 31) return `${Math.round(days / 7)} weeks away`
  const months = Math.round(days / 30)
  return `about ${months} month${months === 1 ? '' : 's'} away`
}

/**
 * Builds the theme. Returns null when there is nothing worth showing, so the
 * caller renders nothing rather than an empty shell.
 */
export function buildSeasonTheme(sets, now = undefined, colorProfile = null) {
  now = now ?? today()
  const season = findSeason(sets, now)
  const focus = season.next ?? season.current
  if (!focus) return null

  // A theme someone designed comes first; then the set's real colour
  // distribution; then the code hash, which is stable but carries no
  // information about the set itself.
  const accent = curatedThemeFor(focus.code)
    ?? accentFromColorProfile(colorProfile)
    ?? { ...accentForSet(focus.code), derivedFrom: 'code' }

  const isUpcoming = focus === season.next
  return {
    set: focus,
    isUpcoming,
    countdown: isUpcoming ? describeCountdown(season.daysUntilNext) : null,
    daysSinceRelease: isUpcoming ? null : season.daysSinceCurrent,
    ...accent,
    // A set-legality query, so the caller can ask "what is new for my deck"
    // without knowing anything about Scryfall syntax.
    searchQuery: `set:${focus.code}`,
  }
}
