import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FirstDeck from '../src/features/decks/FirstDeck.jsx'
import { applyThemeSet, currentThemeRelease } from '../src/lib/theme-set.js'
import { releaseLabel } from '../src/lib/release.js'
import { SET_THEMES } from '../src/data/set-themes.js'

/**
 * Hexhaven's schools beside the colours follow the season. The first-deck
 * flow learns the focus from the theme the shell is wearing, which App.jsx
 * writes from the season engine (tests/set-themes.test.js follows that chain
 * across the release dates); here the flow is given each answer directly.
 * The colours step opens on Selesnya, green and white, whose school is
 * Vigorbloom.
 */

const render = (themeSet, releasedAt = null) => {
  const root = document.documentElement
  if (themeSet) root.dataset.themeSet = themeSet
  else delete root.dataset.themeSet
  if (releasedAt) root.dataset.themeSetReleased = releasedAt
  else delete root.dataset.themeSetReleased
  return renderToStaticMarkup(<FirstDeck onOpenCard={() => {}} />)
}

/** The page's text, with the markup and its entities taken out. */
const textOf = (html) => {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent.replace(/\s+/g, ' ')
}

afterEach(() => {
  delete document.documentElement.dataset.themeSet
  delete document.documentElement.dataset.themeSetReleased
  vi.useRealTimers()
})

describe('the schools in the first-deck flow', () => {
  it('are shown, with their set, while the shell wears that set’s theme', () => {
    const html = render('fra')
    expect(html).toContain('Vigorbloom')
    expect(html).toContain('Reality Fracture')
    expect(html).toContain('At Hexhaven')
  })

  it('are not shown once the season has moved to a set with none written', () => {
    for (const html of [render('trk'), render(null)]) {
      expect(html).not.toContain('Vigorbloom')
      expect(html).not.toContain('Hexhaven')
      expect(html).not.toContain('Reality Fracture')
      expect(html).not.toContain('own reading of the set')
      // The colours themselves are still all there.
      expect(html).toContain('Cares about')
    }
  })
})

describe('the note under the schools', () => {
  // "17 Sep 2026" or "17 Sept 2026", as the runtime's own British date data
  // abbreviates September; tests/release.test.js checks the format itself.
  const WRITTEN = releaseLabel(SET_THEMES.fra.curatedAt)
  const on = (day, releasedAt) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${day}T10:00:00Z`))
    return textOf(render('fra', releasedAt))
  }

  it('says the schools are the app’s reading, and provisional while the set is not out', () => {
    const text = on('2026-09-21', '2026-10-02')
    expect(text).toContain(`Provisional. The schools are this app’s own reading of the set’s lore, not official. Written on ${WRITTEN} from previews; the set comes out on 2 Oct 2026`)
  })

  it('says from release day that they were written before and not checked since, as the banner does', () => {
    const text = on('2026-10-02', '2026-10-02')
    expect(text).toContain(`not official. Written on ${WRITTEN} from previews, before release on 2 Oct 2026;`)
    expect(text).not.toContain('Provisional.')
  })

  it('gives only the day they were written when the release date is not known, not the entry’s own provisional', () => {
    const text = on('2026-10-20', null)
    expect(SET_THEMES.fra.provisional).toBe(true)
    expect(text).toContain(`not official. Written on ${WRITTEN}.`)
    expect(text).not.toMatch(/Provisional\.|from previews/)
  })
})

describe('the theme set’s release date', () => {
  it('goes on the root beside the theme, and away with it', () => {
    applyThemeSet('fra', '2026-10-02')
    expect(document.documentElement.dataset.themeSetReleased).toBe('2026-10-02')
    expect(currentThemeRelease()).toBe('2026-10-02')
    applyThemeSet(null, '2026-10-02')
    expect(document.documentElement.dataset.themeSetReleased).toBeUndefined()
    expect(currentThemeRelease()).toBeNull()
  })

  it('is read forgivingly: a date it cannot read is no date', () => {
    applyThemeSet('fra', 'soon')
    expect(currentThemeRelease()).toBeNull()
    document.documentElement.dataset.themeSetReleased = 'someday'
    expect(currentThemeRelease()).toBeNull()
    applyThemeSet(null)
  })
})
