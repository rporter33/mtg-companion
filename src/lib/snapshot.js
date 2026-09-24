// Legality snapshots and change detection.
//
// THE BUG THIS FIXES — a deck stores card ids and re-derives legality live, so
// when a ban announcement lands, a deck you built and registered silently
// becomes illegal with no record that it ever was legal. That is the same class
// of problem as a repriced catalog rewriting a bid already sitting with a
// customer, and it takes the same fix: capture the verdict at save time and
// never let history mutate underneath the user.
//
// THE FEATURE THIS ENABLES — once verdicts are captured, the diff between the
// stored one and today's is the interesting part. Ban lists change on a rolling
// schedule and nobody tells you that the change touched *your* deck. The full
// snapshot is just how you compute the delta; the delta is the product.

import { getFormat, formatLabel, cardLegality, listedInPaper } from './formats.js'
import { allCardIds } from './deck.js'
import { releaseStart, releaseLabel } from './release.js'
import { CARD_TTL_MS } from './cache.js'

export const SNAPSHOT_VERSION = 1

/**
 * Captures how every card in a deck stands in its format, right now.
 * Stored on the deck, so it travels with an export.
 *
 * A not_legal read from a record that lists the card in no paper format, as
 * Scryfall lists a card before its release, is marked `listedNowhere`: it
 * says the record came before Scryfall's word on the card, whenever the
 * snapshot itself was taken (see cameOut). Only such entries carry the mark,
 * so a snapshot stays the size it was.
 */
export function captureSnapshot(deck, cardsById) {
  const format = getFormat(deck.formatId)
  if (!format) return null

  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  const cards = {}

  for (const id of allCardIds(deck)) {
    const card = lookup(id)
    // A card we could not load is deliberately omitted rather than recorded as
    // unknown: recording it would later read as "this card changed from unknown
    // to legal", which is noise, not news.
    if (!card) continue
    const status = cardLegality(card, format)
    cards[id] = status === 'not_legal' && !listedInPaper(card)
      ? { name: card.name, status, listedNowhere: true }
      : { name: card.name, status }
  }

  return {
    version: SNAPSHOT_VERSION,
    formatId: deck.formatId,
    capturedAt: new Date().toISOString(),
    cards,
  }
}

const RANK = { legal: 0, restricted: 1, not_legal: 2, banned: 3 }

/** Did this change make the card less playable? */
function isDowngrade(from, to) {
  return (RANK[to] ?? 0) > (RANK[from] ?? 0)
}

/**
 * Compares a stored snapshot against current card data.
 *
 * Returns only what changed. A deck whose legality is unchanged produces an
 * empty list, which is the common case and must stay cheap and silent — an app
 * that announces "nothing happened" on every launch trains you to ignore it.
 */
export function diffSnapshot(snapshot, deck, cardsById) {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return []

  const format = getFormat(deck.formatId)
  if (!format) return []

  // A deck moved between formats has no meaningful legality delta — everything
  // would read as changed. That is a different event, reported as its own kind.
  if (snapshot.formatId !== deck.formatId) {
    return [{
      kind: 'format_changed',
      from: snapshot.formatId,
      to: deck.formatId,
      severity: 'info',
      message: `This deck moved from ${formatLabel(snapshot.formatId)} to ${format.name}, so its legality was re-checked from scratch.`,
    }]
  }

  const lookup = (id) => (cardsById instanceof Map ? cardsById.get(id) : cardsById?.[id])
  const changes = []

  for (const [cardId, before] of Object.entries(snapshot.cards)) {
    const card = lookup(cardId)
    if (!card) continue                      // not loaded now; say nothing
    const after = cardLegality(card, format)
    if (after === before.status) continue
    if (after === 'unknown') continue        // data gap, not a rules change
    if (cameOut(snapshot, before, card, after)) continue

    const down = isDowngrade(before.status, after)
    changes.push({
      kind: 'legality_changed',
      cardId,
      name: card.name ?? before.name,
      from: before.status,
      to: after,
      severity: down ? 'error' : 'good',
      message: describeChange(card.name ?? before.name, before.status, after, format.name),
    })
  }

  // Worst news first: a ban is what you need to act on before an unban.
  const order = { error: 0, info: 1, good: 2 }
  return changes.sort((a, b) => (order[a.severity] - order[b.severity])
    || a.name.localeCompare(b.name))
}

/**
 * A card coming out is not news. Scryfall lists a new card as not_legal
 * everywhere until its release, so a snapshot taken before then records
 * not_legal, and the first look after it finds the card legal. That is the
 * card being released, not a ruling, and announcing it would put every
 * spoiler-season card in the banner as "became more playable". So a change
 * from not_legal to legal is not announced when the entry was read from a
 * record that listed the card nowhere (`listedNowhere`, see captureSnapshot):
 * that is the data judged, not the save, so a snapshot taken again after
 * release from a record saved before it, offline or when a refresh failed,
 * does not let the card's coming out through later. Nor, for an entry
 * without the mark, as every snapshot from an older build is, when the
 * snapshot was taken before the card's release day ended its first week
 * (CARD_TTL_MS): before release, or in the week after it, when the record it
 * was taken from may still have been one saved before release. A ban or an
 * unban is a different change and is always announced. An unmarked entry in a
 * snapshot whose time cannot be read, or of a card with no release date, is
 * announced as before.
 */
function cameOut(snapshot, before, card, to) {
  if (before?.status !== 'not_legal' || to !== 'legal') return false
  if (before.listedNowhere === true) return true
  const taken = Date.parse(snapshot?.capturedAt)
  const start = releaseStart(card)
  if (!Number.isFinite(taken) || start === null) return false
  return taken < start + CARD_TTL_MS
}

function describeChange(name, from, to, formatName) {
  if (to === 'banned') return `${name} has been banned in ${formatName}.`
  if (to === 'restricted') return `${name} is now restricted in ${formatName} — one copy only.`
  if (to === 'not_legal') return `${name} has rotated out of ${formatName}.`
  if (from === 'banned' && to === 'legal') return `${name} has been unbanned in ${formatName}.`
  if (from === 'restricted' && to === 'legal') return `${name} is no longer restricted in ${formatName}.`
  if (from === 'not_legal' && to === 'legal') return `${name} is now legal in ${formatName}.`
  return `${name} changed from ${from} to ${to} in ${formatName}.`
}

/** Runs the diff across every deck, returning only decks that actually changed. */
export function diffAllDecks(decks, cardsByDeckId) {
  const report = []
  for (const deck of decks) {
    const cards = cardsByDeckId[deck.id]
    if (!deck.snapshot || !cards) continue
    const changes = diffSnapshot(deck.snapshot, deck, cards)
    if (changes.length) {
      report.push({ deckId: deck.id, deckName: deck.name, formatId: deck.formatId, changes })
    }
  }
  return report
}

/**
 * When the oldest of the compared records was fetched, from cache records
 * ({ card, fetchedAt }), as a time in milliseconds. Null when there are none,
 * or when any of them has no readable time, as a record from an older build
 * may not: then the oldest is not known, and no date is better than a wrong
 * one.
 */
export function oldestFetch(records) {
  let oldest = null
  for (const record of records ?? []) {
    if (!Number.isFinite(record?.fetchedAt)) return null
    if (oldest === null || record.fetchedAt < oldest) oldest = record.fetchedAt
  }
  return oldest
}

/**
 * The banner's line about its source. The data is what this device fetched
 * from Scryfall, and a refresh can fail, so the line gives the day the oldest
 * of it was fetched rather than calling it current.
 */
export function checkedAgainst(oldest) {
  const when = new Date(Number.isFinite(oldest) ? oldest : NaN)
  const day = Number.isFinite(when.getTime()) ? releaseLabel(when.toISOString().slice(0, 10)) : ''
  return day
    ? `Checked against Scryfall data from ${day}, not a list baked into this app.`
    : 'Checked against the Scryfall data saved on this device, not a list baked into this app.'
}

/** Summarises a report for a one-line banner. */
export function summarise(report) {
  const changes = report.flatMap((entry) => entry.changes)
  const bad = changes.filter((c) => c.severity === 'error')
  const good = changes.filter((c) => c.severity === 'good')

  if (!changes.length) return null
  const deckWord = report.length === 1 ? 'deck' : 'decks'

  if (bad.length && good.length) {
    return `${bad.length} card${bad.length === 1 ? '' : 's'} restricted or banned and ${good.length} freed up across ${report.length} ${deckWord}.`
  }
  if (bad.length) {
    return `${bad.length} card${bad.length === 1 ? '' : 's'} in your ${deckWord} ${bad.length === 1 ? 'is' : 'are'} no longer playable.`
  }
  return `${good.length} card${good.length === 1 ? '' : 's'} in your ${deckWord} became more playable.`
}
