// Curated set themes.
//
// The season engine derives a set's accent from its colour distribution, or
// from a hash of its code — honest, automatic, and carrying no art direction.
// A set someone has actually designed for deserves better, so this is the one
// place a theme is written by hand: an accent, a display face, and the lore
// hooks the rest of the app can show. Like set-mechanics.js, every entry is
// dated and sourced, and the UI can say when it was written.
//
// PRECEDENCE, while the set is the season's focus: curated → colour profile
// → code hash. When the season moves on to a set with no entry here, the
// derived accent returns on its own; nothing has to be undone.
//
// Values come from docs/REALITY_FRACTURE_SET_REFERENCE.md, which states that
// its colours are an implementation palette inferred from public promotional
// imagery, not an official brand guide. The screen says the same.

const ASSETS = 'mtg-assets/assets/'

export const SET_THEMES = {
  fra: {
    setCode: 'fra',
    setName: 'Reality Fracture',
    // The reference asks that this alias be accepted as input, never shown.
    aliases: ['Shattered Reality'],
    curatedAt: '2026-09-17',
    provisional: true,
    sources: [
      'docs/REALITY_FRACTURE_SET_REFERENCE.md',
      'https://magic.wizards.com/en/products/reality-fracture',
      'https://magic.wizards.com/en/news/magic-story/planeswalkers-guide-to-reality-fracture',
    ],
    // §15 starter tokens: cyan is the one accent inside an indigo/silver shell.
    accent: '#77E4EF',
    accentDim: '#77e4ef22',
    displayFont: '"Cinzel", "Cormorant SC", Georgia, serif',
    headingFont: '"Cormorant Garamond", "Source Serif 4", Georgia, serif',
    // Original artwork from the asset pack (docs/ART_DIRECTION.md); the wide
    // image keeps its left 35% quiet for text, the portrait its bottom.
    art: {
      wide: { src: `${ASSETS}reality-fracture/art/echoverse-hero.webp`, srcset: `${ASSETS}reality-fracture/art/echoverse-hero-768.webp 768w, ${ASSETS}reality-fracture/art/echoverse-hero-1280.webp 1280w, ${ASSETS}reality-fracture/art/echoverse-hero.webp 1672w`, width: 1672, height: 941 },
      portrait: { src: `${ASSETS}reality-fracture/art/sanctum-portrait-768.webp`, srcset: `${ASSETS}reality-fracture/art/sanctum-portrait-480.webp 480w, ${ASSETS}reality-fracture/art/sanctum-portrait-768.webp 768w`, width: 1122, height: 1402 },
      alt: '',
    },
    // §13 set voice, original lines from the reference.
    voice: {
      tagline: 'One world. Another possibility.',
      lines: [
        'Compare the life that was with the life that should have been.',
        'One variable remains unresolved.',
        'Select a counterpart to reveal the deviation.',
      ],
    },
    // §5.3 and §8: Hexhaven's five schools are the five allied pairs, in wheel
    // order. Each carries its discipline, its virtue and its horror, because
    // the reference is explicit that the academy is not a playful reskin.
    schools: {
      WU: { id: 'fatehold', name: 'Fatehold', discipline: 'Future History', virtue: 'Foresight in service of society.', horror: 'Individual futures manipulated for an imposed optimum.', accents: ['#E9E1C8', '#72A9D8', '#B8A064'], emblem: `${ASSETS}reality-fracture/schools/fatehold.svg` },
      UB: { id: 'theorix', name: 'Theorix', discipline: 'Esoteric Mathematics', virtue: 'Fearless inquiry and powerful problem-solving.', horror: 'Sanity and other realities treated as expendable research material.', accents: ['#3158B8', '#15111E', '#764FC2'], emblem: `${ASSETS}reality-fracture/schools/theorix.svg` },
      BR: { id: 'stingerquill', name: 'Stingerquill', discipline: 'Painful Words', virtue: 'Expressive power, charisma, speed, self-sufficiency.', horror: 'Humiliation, emotional coercion, pain made spectacle.', accents: ['#21151F', '#B83D4A', '#D86A83'], emblem: `${ASSETS}reality-fracture/schools/stingerquill.svg` },
      RG: { id: 'konstrari', name: 'Konstrari', discipline: 'Constructive Arts', virtue: 'Audacious creativity grounded in nature.', horror: 'Bodily exertion, dangerous scale, a lifelong tether, catastrophic prototypes.', accents: ['#B75537', '#426C45', '#D08B3D'], emblem: `${ASSETS}reality-fracture/schools/konstrari.svg` },
      GW: { id: 'vigorbloom', name: 'Vigorbloom', discipline: 'Invasive Healing', virtue: 'Communal care, resilience, life preserved through nature.', horror: 'Consent overridden for collective health; healing becomes infestation.', accents: ['#5D8A55', '#E8E2CE', '#B9C95A'], emblem: `${ASSETS}reality-fracture/schools/vigorbloom.svg` },
    },
  },
}

/** The set whose lore the app shows beside the colours; the season's focus, moving forward. */
export const LORE_SET = 'fra'

/** A theme worth applying: an entry with at least an accent. */
export function curatedThemeFor(code) {
  const entry = SET_THEMES[code?.toLowerCase?.()]
  if (!entry?.accent) return null
  return {
    accent: entry.accent,
    accentDim: entry.accentDim ?? `color-mix(in srgb, ${entry.accent} 13%, transparent)`,
    displayFont: entry.displayFont ?? null,
    headingFont: entry.headingFont ?? null,
    art: entry.art ?? null,
    voice: entry.voice ?? null,
    derivedFrom: 'curated',
    curatedAt: entry.curatedAt,
    provisional: !!entry.provisional,
  }
}

/** The schools for a set, keyed by allied pair in wheel order, or null when none are written. */
export function schoolsFor(code = LORE_SET) {
  return SET_THEMES[code]?.schools ?? null
}

/** The schools a single colour belongs to — two, one on each side of it on the wheel. */
export function schoolsForColor(color, code = LORE_SET) {
  const schools = schoolsFor(code)
  if (!schools) return []
  return Object.entries(schools).filter(([pair]) => pair.includes(color)).map(([pair, school]) => ({ pair, ...school }))
}

/** The proper title for a set name a person typed, so an alias is never shown. */
export function canonicalSetName(name) {
  const needle = String(name ?? '').trim().toLowerCase()
  for (const entry of Object.values(SET_THEMES)) {
    if (entry.setName.toLowerCase() === needle || (entry.aliases ?? []).some((a) => a.toLowerCase() === needle)) return entry.setName
  }
  return name
}
