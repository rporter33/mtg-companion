import { useEffect, useState } from 'react'

/**
 * Which curated set theme, if any, the shell is wearing right now.
 *
 * App.jsx decides (from the season engine) and writes data-theme-set on the
 * root element; components that choose an asset by theme — the empty-state
 * illustration, the card back — read it here rather than each asking the
 * season engine again.
 */
export const THEME_SET_EVENT = 'mtg:theme-set'

export function currentThemeSet() {
  if (typeof document === 'undefined') return null
  return document.documentElement.dataset.themeSet ?? null
}

export function applyThemeSet(code) {
  const root = document.documentElement
  if (code) root.dataset.themeSet = code
  else delete root.dataset.themeSet
  window.dispatchEvent(new CustomEvent(THEME_SET_EVENT, { detail: { code: code ?? null } }))
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
