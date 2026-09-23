// Deck history.
//
// A version is the lists — commanders, main, sideboard — as they stood, with
// a label and a time. Not the cards: ids and quantities only, so a hundred-card
// version is a few kilobytes and a deck can carry thirty without troubling the
// storage cap. Names are resolved at display time from whatever is cached.
//
// WHEN A VERSION IS TAKEN. Explicitly, when the player asks, with a label they
// wrote. And automatically before the two things that rewrite a list wholesale:
// applying an import, and restoring an older version. Not on every edit — a
// history of "+1, −1, +1" is noise, and the incremental edits are already
// reversible by editing back. Automatic versions are the first to be pruned.
//
// RESTORE IS REVERSIBLE BY CONSTRUCTION. Restoring captures the current lists
// first, so the version you just left is one restore away. Undo needs nothing
// special because it is the same operation.

import { upgradeDeck } from './deck.js'

export const MAX_VERSIONS = 30

const LISTS = ['commanders', 'signatureSpell', 'main', 'sideboard', 'categoryOrder']

const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** The parts of a deck a version records, copied so later edits cannot reach in. */
export function listsOf(deck) {
  const out = {}
  for (const key of LISTS) out[key] = clone(deck?.[key] ?? (key === 'signatureSpell' ? null : []))
  return out
}

/**
 * The entries of a stored list, read forgivingly. A version was written by
 * whichever build took it, and a hand-edited file can hold anything; an entry
 * that is not an object has no card and no count to read, and reading one threw
 * where a version was compared, which took the editor down with it.
 */
const entriesOf = (list) => (Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : [])

/**
 * Do two sets of lists hold the same cards in the same quantities?
 *
 * Order-insensitive on purpose: sorting a list is not a change to a deck, and
 * a checkpoint that fires because two entries swapped places is a checkpoint
 * nobody asked for.
 */
export function sameLists(a, b) {
  const norm = (list) => entriesOf(list)
    .map((e) => `${e.cardId}:${e.quantity ?? 1}`)
    .sort()
    .join('|')
  return norm(a?.main) === norm(b?.main)
    && norm(a?.sideboard) === norm(b?.sideboard)
    && [...(a?.commanders ?? [])].sort().join('|') === [...(b?.commanders ?? [])].sort().join('|')
    && (a?.signatureSpell ?? null) === (b?.signatureSpell ?? null)
}

const newId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/**
 * Records the deck as it stands now. Newest first.
 *
 * A capture identical to the newest version is skipped: pressing "save
 * version" twice, or importing into a deck that did not change, should not
 * spend a slot on a duplicate.
 */
export function captureVersion(deck, { label = '', auto = false, at = new Date().toISOString() } = {}) {
  const versions = deck?.versions ?? []
  const lists = listsOf(deck)
  if (versions[0] && sameLists(versions[0], lists)) return deck

  const version = {
    id: newId(),
    at,
    label: String(label ?? '').trim(),
    auto: Boolean(auto),
    ...lists,
  }
  return { ...deck, versions: prune([version, ...versions]) }
}

/**
 * Keeps the history under the cap. Automatic checkpoints go first, oldest
 * first; only when none remain are labelled versions dropped, oldest first.
 * The newest entry is never pruned, whatever kind it is.
 */
export function prune(versions, max = MAX_VERSIONS) {
  if (versions.length <= max) return versions
  const keep = [...versions]
  const droppable = (v, i) => i > 0
  while (keep.length > max) {
    let idx = -1
    for (let i = keep.length - 1; i >= 0; i--) if (keep[i].auto && droppable(keep[i], i)) { idx = i; break }
    if (idx === -1) idx = keep.length - 1
    if (idx === 0) break
    keep.splice(idx, 1)
  }
  return keep
}

export function deleteVersion(deck, versionId) {
  return { ...deck, versions: (deck?.versions ?? []).filter((v) => v.id !== versionId) }
}

export function relabelVersion(deck, versionId, label) {
  return {
    ...deck,
    versions: (deck?.versions ?? []).map((v) => (v.id === versionId ? { ...v, label: String(label ?? '').trim() } : v)),
  }
}

/**
 * Puts an older version's lists back. The current lists are captured first,
 * automatically, so this is its own undo.
 */
export function restoreVersion(deck, versionId) {
  const version = (deck?.versions ?? []).find((v) => v.id === versionId)
  if (!version) return deck
  const checkpointed = captureVersion(deck, { label: 'Before restore', auto: true })
  // A version is state read back from storage as much as a deck is, and it may
  // have been written by a build ago, so the restored deck goes through the same
  // forgiving read (see upgradeDeck).
  return upgradeDeck({
    ...checkpointed,
    ...listsOf(version),
    updatedAt: new Date().toISOString(),
  })
}

const countOf = (list) => entriesOf(list).reduce((n, e) => n + (e.quantity ?? 1), 0)

/** How many cards a version holds, main plus commanders. */
export function versionSize(version) {
  return countOf(version?.main) + (version?.commanders?.length ?? 0) + (version?.signatureSpell ? 1 : 0)
}

/** Roughly what a version costs to store. */
export function versionBytes(version) {
  return new TextEncoder().encode(JSON.stringify(version ?? {})).length
}

/**
 * What changed between two sets of lists.
 *
 * `from` and `to` are anything with main/sideboard/commanders — a version or
 * the deck itself. Cards are keyed by id, which means a printing swap reads as
 * one card out and another in; that is what happened, and the names make it
 * obvious.
 */
export function diffVersions(from, to, lookup = () => undefined, marketId = 'usd', priceFor = null) {
  const tally = (lists) => {
    const m = new Map()
    for (const zone of ['main', 'sideboard']) {
      for (const e of entriesOf(lists?.[zone])) m.set(`${zone}:${e.cardId}`, (m.get(`${zone}:${e.cardId}`) ?? 0) + (e.quantity ?? 1))
    }
    return m
  }
  const before = tally(from)
  const after = tally(to)
  const name = (cardId) => lookup(cardId)?.name ?? `(unknown ${String(cardId).slice(0, 8)})`

  const added = []
  const removed = []
  const changed = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const [zone, cardId] = key.split(/:(.*)/s)
    const was = before.get(key) ?? 0
    const now = after.get(key) ?? 0
    if (was === now) continue
    const row = { cardId, name: name(cardId), zone, from: was, to: now, card: lookup(cardId) }
    if (was === 0) added.push(row)
    else if (now === 0) removed.push(row)
    else changed.push(row)
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  added.sort(byName); removed.sort(byName); changed.sort(byName)

  const cIn = (to?.commanders ?? []).filter((id) => !(from?.commanders ?? []).includes(id)).map((id) => ({ cardId: id, name: name(id) }))
  const cOut = (from?.commanders ?? []).filter((id) => !(to?.commanders ?? []).includes(id)).map((id) => ({ cardId: id, name: name(id) }))

  let price = null
  if (priceFor) {
    const total = (lists) => {
      let sum = 0
      for (const zone of ['main', 'sideboard']) {
        for (const e of entriesOf(lists?.[zone])) {
          const card = lookup(e.cardId)
          const { value } = card ? priceFor(card, marketId) : { value: null }
          if (value !== null) sum += value * (e.quantity ?? 1)
        }
      }
      return sum
    }
    const b = total(from)
    const a = total(to)
    price = { before: b, after: a, delta: a - b, marketId }
  }

  return {
    added, removed, changed, commandersIn: cIn, commandersOut: cOut, price,
    empty: !added.length && !removed.length && !changed.length && !cIn.length && !cOut.length,
  }
}
