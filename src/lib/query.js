// Scryfall query parsing and serialisation.
//
// The filter controls and the search box are two views of one query. That only
// works if the translation goes both ways, so this module parses a query string
// into structured filters and writes filters back out as a query.
//
// THE RULE THAT MATTERS: anything we do not model is preserved verbatim.
// If someone types `o:"draw a card" is:commander` and then toggles a colour,
// their query must still contain both of those terms. A filter UI that silently
// deletes the parts it does not understand is worse than no filter UI, because
// you cannot see what it took away.
//
// Operators are emitted explicitly (`c>=rg`, not `c:rg`) so the meaning is
// unambiguous on the page, while parsing accepts the shorthand people type.

export const COLOR_LETTERS = ['w', 'u', 'b', 'r', 'g']

export const COLOR_MODES = [
  { id: 'includes', op: '>=', label: 'Includes', hint: 'Cards that contain these colours, and may contain others.' },
  { id: 'exactly', op: '=', label: 'Exactly', hint: 'Cards that are precisely these colours, no more and no fewer.' },
  { id: 'atMost', op: '<=', label: 'At most', hint: 'Cards that use only these colours, or fewer of them.' },
]

const OP_TO_MODE = { '>=': 'includes', ':': 'includes', '=': 'exactly', '<=': 'atMost' }
const MODE_TO_OP = Object.fromEntries(COLOR_MODES.map((m) => [m.id, m.op]))

// For colour identity the useful default is "within these colours", because
// that is the Commander question: what may this deck legally contain.
const IDENTITY_OP_TO_MODE = { '<=': 'atMost', ':': 'atMost', '=': 'exactly', '>=': 'includes' }

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic']

export function emptyFilters() {
  return {
    text: '',
    colors: { mode: 'includes', values: [], colorless: false },
    identity: { mode: 'atMost', values: [], colorless: false },
    types: [],
    manaValue: null,      // { op: '<=' | '>=' | '=', value: number }
    format: null,
    rarities: [],
    maxPrice: null,
    raw: [],              // operators we do not model, kept exactly as written
  }
}

/** Splits a query into tokens, keeping quoted strings and parenthesised groups whole. */
export function tokenize(query) {
  const tokens = []
  let current = ''
  let quote = null
  let depth = 0

  for (const char of String(query ?? '')) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '(') { depth++; current += char; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); current += char; continue }
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

const COLOR_WORDS = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
  azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw',
  orzhov: 'wb', izzet: 'ur', golgari: 'bg', boros: 'rw', simic: 'gu',
  esper: 'wub', grixis: 'ubr', jund: 'brg', naya: 'rgw', bant: 'gwu',
  abzan: 'wbg', jeskai: 'urw', sultai: 'bgu', mardu: 'rwb', temur: 'gur',
}

/** Expands "esper" or "wu" into ['w','u']. Returns null if it is not a colour set. */
export function parseColorSet(value) {
  const raw = String(value ?? '').toLowerCase().replace(/^["']|["']$/g, '')
  if (!raw) return null
  if (raw === 'c' || raw === 'colorless' || raw === 'colourless') return { colors: [], colorless: true }

  const expanded = COLOR_WORDS[raw] ?? raw
  const letters = [...expanded]
  if (!letters.length || !letters.every((l) => COLOR_LETTERS.includes(l))) return null
  // Preserve WUBRG order rather than the order typed, so the query is stable.
  return { colors: COLOR_LETTERS.filter((l) => letters.includes(l)), colorless: false }
}

/** Matches `key`, then an operator, then a value. */
function splitOperator(token) {
  const match = token.match(/^(-?[a-z]+)(>=|<=|!=|[:=<>])(.*)$/i)
  if (!match) return null
  return { key: match[1].toLowerCase(), op: match[2], value: match[3] }
}

/**
 * Parses a Scryfall query into structured filters.
 *
 * Unrecognised tokens go into `raw` untouched, including negations
 * (`-t:creature`) and anything using an operator we do not model.
 */
export function parseQuery(query) {
  const filters = emptyFilters()
  const freeText = []

  for (const token of tokenize(query)) {
    const parsed = splitOperator(token)
    if (!parsed) {
      freeText.push(token)
      continue
    }

    const { key, op, value } = parsed
    // A negated operator is never folded into a positive control.
    if (key.startsWith('-')) { filters.raw.push(token); continue }

    switch (key) {
      case 'c': case 'color': case 'colour': {
        const set = parseColorSet(value)
        const mode = OP_TO_MODE[op]
        if (!set || !mode) { filters.raw.push(token); break }
        filters.colors = { mode, values: set.colors, colorless: set.colorless }
        break
      }
      case 'id': case 'identity': case 'commander': {
        const set = parseColorSet(value)
        const mode = IDENTITY_OP_TO_MODE[op]
        if (!set || !mode) { filters.raw.push(token); break }
        filters.identity = { mode, values: set.colors, colorless: set.colorless }
        break
      }
      case 't': case 'type': {
        if (op !== ':' || !value) { filters.raw.push(token); break }
        filters.types.push(value.toLowerCase().replace(/^["']|["']$/g, ''))
        break
      }
      case 'cmc': case 'mv': case 'manavalue': {
        const number = Number(value)
        if (!Number.isFinite(number) || ![':', '=', '<=', '>='].includes(op)) {
          filters.raw.push(token); break
        }
        filters.manaValue = { op: op === ':' ? '=' : op, value: number }
        break
      }
      case 'f': case 'format': case 'legal': {
        if (op !== ':' || !value) { filters.raw.push(token); break }
        filters.format = value.toLowerCase()
        break
      }
      case 'r': case 'rarity': {
        const rarity = value.toLowerCase()
        if (op !== ':' || !RARITIES.includes(rarity)) { filters.raw.push(token); break }
        filters.rarities.push(rarity)
        break
      }
      case 'usd': {
        const number = Number(value)
        if (!Number.isFinite(number) || !['<=', '<'].includes(op)) { filters.raw.push(token); break }
        filters.maxPrice = number
        break
      }
      default:
        filters.raw.push(token)
    }
  }

  filters.text = freeText.join(' ')
  return filters
}

function serialiseColorSet({ mode, values, colorless }, key, modeMap) {
  if (colorless) return `${key}${modeMap[mode] === '>=' ? ':' : modeMap[mode]}c`
  if (!values?.length) return null
  return `${key}${modeMap[mode]}${values.join('')}`
}

/** Writes filters back out as a Scryfall query. */
export function serialiseQuery(filters) {
  const parts = []

  const colors = serialiseColorSet(filters.colors ?? {}, 'c', MODE_TO_OP)
  if (colors) parts.push(colors)

  const identity = serialiseColorSet(filters.identity ?? {}, 'id', MODE_TO_OP)
  if (identity) parts.push(identity)

  for (const type of filters.types ?? []) {
    parts.push(/\s/.test(type) ? `t:"${type}"` : `t:${type}`)
  }

  if (filters.manaValue && Number.isFinite(filters.manaValue.value)) {
    parts.push(`cmc${filters.manaValue.op}${filters.manaValue.value}`)
  }

  if (filters.format) parts.push(`f:${filters.format}`)

  const rarities = filters.rarities ?? []
  if (rarities.length === 1) parts.push(`r:${rarities[0]}`)
  else if (rarities.length > 1) parts.push(`(${rarities.map((r) => `r:${r}`).join(' or ')})`)

  if (Number.isFinite(filters.maxPrice)) parts.push(`usd<=${filters.maxPrice}`)

  // Unmodelled operators are restored exactly as they were written.
  for (const token of filters.raw ?? []) parts.push(token)

  const text = (filters.text ?? '').trim()
  if (text) parts.unshift(text)

  return parts.join(' ').trim()
}

/** True when the filters would narrow a search at all. */
export function hasActiveFilters(filters) {
  if (!filters) return false
  return Boolean(
    filters.colors?.values?.length || filters.colors?.colorless
    || filters.identity?.values?.length || filters.identity?.colorless
    || filters.types?.length
    || filters.manaValue
    || filters.format
    || filters.rarities?.length
    || Number.isFinite(filters.maxPrice),
  )
}

/** Clears the controls but keeps free text and anything we do not model. */
export function clearFilters(filters) {
  return { ...emptyFilters(), text: filters?.text ?? '', raw: [...(filters?.raw ?? [])] }
}

// --- sorting --------------------------------------------------------------

export const SORT_OPTIONS = [
  { id: 'name', label: 'Name', order: 'name', defaultDir: 'asc' },
  { id: 'cmc', label: 'Mana value', order: 'cmc', defaultDir: 'asc' },
  { id: 'usd', label: 'Price', order: 'usd', defaultDir: 'asc' },
  { id: 'released', label: 'Release date', order: 'released', defaultDir: 'desc' },
  { id: 'set', label: 'Set', order: 'set', defaultDir: 'asc' },
]

export function getSort(id) {
  return SORT_OPTIONS.find((option) => option.id === id) ?? SORT_OPTIONS[0]
}
