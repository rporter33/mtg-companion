/**
 * Which section of a deck is open, remembered per deck.
 *
 * The deck list is an accordion: one section open at a time, or every
 * section open when nothing is chosen. The choice lives in prefs, never on
 * the deck document, because every deck mutator stamps `updatedAt` and the
 * commit path re-snapshots legality, and folding a section is not an edit.
 *
 * Shape: `prefs.deckOpen = { [deckId]: sectionName }`. A deck with nothing
 * remembered has no key, so the map cannot grow with taps; `deleteDeck`
 * drops the key with the deck.
 */

/** The remembered open section for a deck, or null for everything open. */
export function openSectionFor(prefs, deckId) {
  const name = prefs?.deckOpen?.[deckId]
  return typeof name === 'string' && name ? name : null
}

/** The `deckOpen` map with this deck's choice set, or removed when null. */
export function withOpenSection(prefs, deckId, name) {
  const next = { ...(prefs?.deckOpen ?? {}) }
  if (name) next[deckId] = name
  else delete next[deckId]
  return next
}

/** A rename keeps the section open under its new name; a stale name is left alone. */
export function openAfterRename(prefs, deckId, from, to) {
  return openSectionFor(prefs, deckId) === from ? withOpenSection(prefs, deckId, to) : prefs?.deckOpen ?? {}
}

/**
 * What is actually open given what exists. A remembered section that no
 * longer exists (its last card left, it was dissolved, a version restored
 * without it) means everything open rather than a blank screen; the memory
 * is left in place so the section reopens if it comes back.
 */
export function resolveOpen(remembered, names) {
  return remembered && names.includes(remembered) ? remembered : null
}

/** The next state after tapping a section button: open it, or reopen everything. */
export function toggledOpen(current, name) {
  return current === name ? null : name
}
