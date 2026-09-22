import { useEffect, useState } from 'react'

/**
 * Which curated set theme, if any, the shell is wearing right now.
 *
 * App.jsx decides (from the season engine) and writes data-theme-set on the
 * root element, with the set's release date beside it in
 * data-theme-set-released; components that choose an asset or lore by theme — the
 * empty-state illustration, the card back, the schools in the first-deck
 * flow — read it here rather than each asking the season engine again.
 */
export const THEME_SET_EVENT = 'mtg:theme-set'

/**
 * The set whose curated theme the shell should wear for a season theme from
 * buildSeasonTheme: the focus set when someone designed a theme for it, and
 * otherwise none, because a derived accent is not art direction.
 */
export function themeSetFor(theme) {
  return theme?.derivedFrom === 'curated' ? theme.set?.code ?? null : null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function currentThemeSet() {
  if (typeof document === 'undefined') return null
  return document.documentElement.dataset.themeSet ?? null
}

/**
 * The release date of the set whose theme the shell wears, 'YYYY-MM-DD', as
 * Scryfall's set list gave it to the season engine, or null when there is no
 * theme or no date. Lore shown under the theme says from it how current it is
 * (see curation.js).
 */
export function currentThemeRelease() {
  if (typeof document === 'undefined') return null
  const date = document.documentElement.dataset.themeSetReleased
  return typeof date === 'string' && DATE.test(date) ? date : null
}

export function applyThemeSet(code, releasedAt = null) {
  const root = document.documentElement
  if (code) root.dataset.themeSet = code
  else delete root.dataset.themeSet
  const released = code && typeof releasedAt === 'string' && DATE.test(releasedAt) ? releasedAt : null
  if (released) root.dataset.themeSetReleased = released
  else delete root.dataset.themeSetReleased
  window.dispatchEvent(new CustomEvent(THEME_SET_EVENT, { detail: { code: code ?? null, releasedAt: released } }))
}

export function useThemeSet() {
  const [code, setCode] = useState(currentThemeSet)
  useEffect(() => {
    const on = (e) => setCode(e.detail?.code ?? null)
    window.addEventListener(THEME_SET_EVENT, on)
    return () => window.removeEventListener(THEME_SET_EVENT, on)
  }, [])
  return code
}

/** The theme set's release date (see currentThemeRelease), kept current. */
export function useThemeRelease() {
  const [date, setDate] = useState(currentThemeRelease)
  useEffect(() => {
    const on = () => setDate(currentThemeRelease())
    window.addEventListener(THEME_SET_EVENT, on)
    return () => window.removeEventListener(THEME_SET_EVENT, on)
  }, [])
  return date
}

/** Asset paths, relative to the app's base, for the shell in force. */
export function decorFor(code) {
  const theme = code === 'fra' ? 'reality-fracture' : 'core'
  const base = `${import.meta.env.BASE_URL}mtg-assets/assets/`
  return {
    theme,
    emptyState: `${base}${theme}/decor/empty-state.svg`,
    cardBack: `${base}${theme}/decor/card-back.svg`,
    divider: `${base}${theme}/decor/divider.svg`,
    colorEmblem: (color) => `${base}shared/color-emblems/${{ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless', M: 'multicolor' }[color] ?? 'colorless'}.svg`,
    coreHero: {
      wide: { src: `${base}core/art/worlds-hero.webp`, srcset: `${base}core/art/worlds-hero-768.webp 768w, ${base}core/art/worlds-hero-1280.webp 1280w, ${base}core/art/worlds-hero.webp 1672w`, width: 1672, height: 941 },
      portrait: { src: `${base}core/art/atlas-portrait-768.webp`, srcset: `${base}core/art/atlas-portrait-480.webp 480w, ${base}core/art/atlas-portrait-768.webp 768w`, width: 1122, height: 1402 },
    },
  }
}
