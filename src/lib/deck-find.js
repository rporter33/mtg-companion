import { typeLineOf } from './formats.js'

/**
 * Finding a card in a deck you already have.
 *
 * This is a filter over cards in memory, not a query to Scryfall, so it is
 * deliberately smaller than the search on the Add cards tab: every word you
 * type has to appear somewhere in the card's name, its face names or its
 * type line, in any order, with accents and punctuation ignored. "jotun"
 * finds Jötun Grunt because a phone keyboard cannot type the umlaut, and
 * "druid elf" finds Llanowar Elves because nobody remembers word order.
 *
 * Rules text is left out on purpose: "draw" would light up half a deck and
 * make the counts meaningless. It can come back as an explicit prefix.
 */

const NONE = Object.freeze([])

/** Lowercase, accents stripped, punctuation dropped, spaces collapsed. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The words of a query. Blank queries share one frozen empty array so identity is stable. */
export function termsOf(query) {
  const clean = normalize(query)
  return clean ? clean.split(' ') : NONE
}

// One haystack per card object. The cards map keeps objects stable until the
// id set changes, so this is built once per card, not once per keystroke.
const HAY = new WeakMap()

/** Everything a search reads for a card, normalised. Empty for a card not loaded. */
export function haystackOf(card) {
  if (!card || typeof card !== 'object') return ''
  let hay = HAY.get(card)
  if (hay === undefined) {
    const names = [card.name, ...(Array.isArray(card.card_faces) ? card.card_faces.map((f) => f?.name) : [])]
    hay = normalize([...names, typeLineOf(card)].filter(Boolean).join(' '))
    HAY.set(card, hay)
  }
  return hay
}

/** True when every term appears in the card's haystack. No terms matches everything. */
export function matches(card, terms) {
  if (!terms?.length) return true
  const hay = haystackOf(card)
  return hay !== '' && terms.every((term) => hay.includes(term))
}

/**
 * The sections a filter leaves.
 *
 * With no filter (`keep` null) the very same `groups` array comes back, so
 * the rows downstream see identical props and their memo holds. With one,
 * every section with a surviving entry is returned with `shown` (the
 * entries that passed) and `shownCount` (by quantity) beside the original
 * `entries` and `count`, so headers can read "2 of 28". Entries whose card
 * has not loaded never match; they are counted in `unloaded` so the status
 * line can say they were not searched rather than pretend they were.
 */
export function filterSections(groups, keep) {
  const total = groups.reduce((n, g) => n + (g.count ?? 0), 0)
  if (!keep) return { sections: groups, active: false, matched: total, total, unloaded: 0 }

  const sections = []
  let matched = 0
  let unloaded = 0
  for (const group of groups) {
    const shown = []
    for (const entry of group.entries) {
      if (!entry.card) { unloaded += entry.quantity ?? 1; continue }
      if (keep(entry)) shown.push(entry)
    }
    if (!shown.length) continue
    const shownCount = shown.reduce((n, e) => n + (e.quantity ?? 1), 0)
    matched += shownCount
    sections.push({ ...group, shown, shownCount })
  }
  return { sections, active: true, matched, total, unloaded }
}

/** The one-line status a screen reader hears as the filter changes. */
export function statusLine({ active, matched, total, unloaded }) {
  if (!active) return ''
  const head = matched === 0 ? 'No cards match' : `${matched} of ${total} cards match`
  return unloaded ? `${head} · ${unloaded} not loaded, not searched` : head
}
