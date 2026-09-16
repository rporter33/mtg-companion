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

import { getFormat, cardLegality } from './formats.js'
import { allCardIds } from './deck.js'

export const SNAPSHOT_VERSION = 1

/**
 * Captures how every card in a deck stands in its format, right now.
 * Stored on the deck, so it travels with an export.
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
    cards[id] = { name: card.name, status: cardLegality(card, format) }
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
      message: `This deck moved from ${getFormat(snapshot.formatId)?.name ?? snapshot.formatId} to ${format.name}, so its legality was re-checked from scratch.`,
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
