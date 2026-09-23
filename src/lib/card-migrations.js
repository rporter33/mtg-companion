// Following Scryfall when it stops having a printing.
//
// Almost everything in Scryfall's database is additive, but not quite: it
// sometimes finds that a card it listed does not really exist, or a digital
// card is deleted for good, and then the id it gave goes away. Preview cards
// are the ones it happens to most, which is exactly what a deck built during a
// spoiler season is full of — so a deck can hold a printing id that no longer
// resolves, and until now that left a row with no name, no price, no legality
// and nothing to send the rules engine.
//
// Scryfall documents the repair itself: /migrations lists what became of each
// id it discarded (https://scryfall.com/docs/api/migrations, read 2026-09-23).
// A `merge` gives the id that replaces it — the same card under a new id — and
// a `delete` gives nothing, because there is nothing to point at. This file is
// the pure part: reading that list, and the sentences the app says about it.
// scryfall.js asks for it, and only ever for an id a deck holds that Scryfall
// has just said it has no card for.
//
// A migration also carries `metadata`, which happens to include the old card's
// name — but Scryfall's own documentation calls that field human-read only, so
// nothing here reads a name out of it. The name a deck shows is the one it
// stamped while the card was in hand (stampNames in deck.js).

/** The query-store key for the migrations read from Scryfall, kept a day. */
export const MIGRATIONS_KEY = 'migrations:recent'

/**
 * The one request this makes. Page one is 350 migrations, newest first, which
 * on 2026-09-23 reached back to 2025-02-28 — so a preview printing merged this
 * season is on it, which is the case this exists for. Nothing pages further:
 * an id that is not on page one is left as what the collection call already
 * proved it to be, a printing Scryfall no longer has, and the app says that
 * and no more.
 */
export const MIGRATIONS_PATH = '/migrations?page=1'

/**
 * Scryfall's list of migrations, keyed by the id each one replaced:
 * `{ strategy: 'merge', newId, at }` or `{ strategy: 'delete', at }`.
 *
 * Read forgivingly, as everything off the wire is. A merge with no new id to
 * follow is kept as the deletion it amounts to, since there is nothing to
 * point the deck at either way. The list is newest first, so where the same
 * old id has more than one record the first of them wins, which is the newest.
 *
 * An id merged into a record that was itself later migrated is a different
 * thing: two records, two different old ids, a chain. Both are kept here as
 * they were given, and migrationFor walks it.
 */
export function indexMigrations(payload) {
  const out = {}
  for (const record of Array.isArray(payload?.data) ? payload.data : []) {
    const from = typeof record?.old_scryfall_id === 'string' ? record.old_scryfall_id : ''
    if (!from || out[from]) continue
    const at = typeof record?.performed_at === 'string' ? record.performed_at : null
    const to = typeof record?.new_scryfall_id === 'string' && record.new_scryfall_id ? record.new_scryfall_id : null
    if (record?.migration_strategy === 'merge' && to) out[from] = { strategy: 'merge', newId: to, at }
    else if (record?.migration_strategy === 'merge' || record?.migration_strategy === 'delete') {
      out[from] = { strategy: 'delete', at }
    }
  }
  return out
}

/**
 * What an index says became of one id, or null when it says nothing.
 *
 * A merge can point at an id Scryfall has since migrated in its turn — a
 * preview record merged into a second preview record in March, and that one
 * merged into the released printing in June. Stopping at the first hop would
 * hand back an id that no longer resolves either, and the app would report a
 * card as gone for good while holding, in the very same index, the record that
 * says where it went. So the chain is walked to its end: the last id nothing
 * further is said about, or a deletion if the chain ends in one, since then
 * there is genuinely nothing to point the deck at. `seen` guards a list that
 * loops back on itself, which Scryfall should never send and which would
 * otherwise spin here for ever.
 */
export function migrationFor(index, id) {
  if (!index || typeof index !== 'object' || typeof id !== 'string' || !id) return null
  const seen = new Set()
  let at = id
  let found = null
  while (at && !seen.has(at)) {
    seen.add(at)
    const record = index[at]
    if (!record || typeof record !== 'object') break
    if (record.strategy === 'merge' && typeof record.newId === 'string' && record.newId) {
      // A hop back to an id already walked is a loop, so the chain stops where
      // it was: whatever the last hop pointed at, which either resolves or is
      // asked about again another time.
      if (seen.has(record.newId)) break
      found = { strategy: 'merge', newId: record.newId, at: record.at ?? null }
      at = record.newId
      continue
    }
    // A chain that ends in a deletion is a deletion: the record the deck's id
    // was folded into is itself gone, and nothing replaced it.
    if (record.strategy === 'delete') found = { strategy: 'delete', at: record.at ?? null }
    break
  }
  return found
}

/**
 * What the app says when it has followed a merge. The app changed the deck, so
 * it says so, whose word it acted on, and what the deck holds now. One
 * sentence per card, because a deck may hold several of a season's previews.
 */
export function movedNote(moved) {
  const said = (m) => `Scryfall has replaced its record of ${m.name}: this deck now holds its new printing.`
  return (moved ?? []).filter((m) => m?.name).map(said)
}

/**
 * The same thing said at the table, where the deck is not being written.
 *
 * Only the deck editor writes a merge into the deck, because only there is
 * there a save to hang it on. The table is still playing the replacement — it
 * is the card the deck's id now resolves to, painting, set and collector number
 * and all — so it says that, and says the deck itself is unchanged, rather than
 * substituting a printing without a word.
 */
export function movedTableNote(moved) {
  const said = (m) => `Scryfall has replaced its record of ${m.name}: this table is playing its new printing. The deck still holds the old one until you open it in the editor.`
  return (moved ?? []).filter((m) => m?.name).map(said)
}

/**
 * A printing Scryfall has dropped, said at the table.
 *
 * The same fact as goneNote, about what the player is actually looking at: the
 * copies are dealt, because the deck lists them, but there is no record to draw
 * a face from. Price and legality, which the deck's own banner mentions, are not
 * what is in front of anybody here.
 */
export function goneTableNote(gone) {
  return (gone ?? []).filter(Boolean).map(({ cardId, name }) => (name
    ? `Scryfall no longer has a record of this deck's printing of ${name}, so its copies are on the table with no painting and no printed face. They are still in the deck, under the name saved with it.`
    : `Scryfall no longer has a record of one of this deck's printings (${String(cardId).slice(0, 8)}), and this device never saved its name, so its copies are on the table without one.`))
}

/**
 * What the app says about a printing Scryfall no longer has and has given
 * nothing to follow. The deck is left exactly as it is — the entry, its
 * quantity and its place all stay — and the name is the one the deck stamped
 * while the card was in hand. Where it never stamped one there is nothing to
 * name it by, so the id says which row is meant.
 */
export function goneNote(gone) {
  return (gone ?? []).filter(Boolean).map(({ cardId, name }) => (name
    ? `Scryfall no longer has a record of the printing of ${name} in this deck, so its price and legality cannot be read. The deck keeps it under the name saved with it.`
    : `Scryfall no longer has a record of one of this deck's printings (${String(cardId).slice(0, 8)}), and this device never saved its name.`))
}
