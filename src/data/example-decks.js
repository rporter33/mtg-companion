// Example decks.
//
// Real decklists cannot be fetched: no deckbuilding site publishes a browser-
// readable API, and inventing a hundred-card list and presenting it as a good
// deck would be worse than shipping none. So examples are supplied by a person
// who plays, and the app makes that easy — paste a deck in, mark it as an
// example, and export the file contents to be shipped here.
//
// FORMAT: card NAMES, never printing ids. A printing id pins an example to one
// art from one set and breaks when that printing is not in the cache; a name
// resolves against whatever printing the player has. Names are also the thing a
// human can read and check.
//
// Each entry carries who chose it and when, because an example deck is an
// opinion and the reader deserves to know whose.

export const EXAMPLE_DECKS = [
  // Nothing shipped yet. Paste a deck into the importer, open its Import /
  // export tab and use "Copy as example" to produce an entry to paste here.
]

export function exampleDecksFor(commanderName) {
  if (!commanderName) return []
  const needle = commanderName.toLowerCase()
  return EXAMPLE_DECKS.filter((deck) =>
    deck.commanders.some((name) => name.toLowerCase() === needle))
}

/**
 * Turns a deck plus its resolved cards into a shippable entry.
 *
 * Emits names rather than ids, and sorts the list so a re-export of an
 * unchanged deck produces an identical file — otherwise every export looks
 * like a change.
 */
export function toExampleEntry(deck, lookup, { credit = '', note = '' } = {}) {
  const nameOf = (id) => lookup(id)?.name ?? null
  const entry = (list) => list
    .map(({ cardId, quantity }) => ({ name: nameOf(cardId), quantity }))
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    id: deck.id,
    name: deck.name,
    formatId: deck.formatId,
    commanders: deck.commanders.map(nameOf).filter(Boolean),
    signatureSpell: deck.signatureSpell ? nameOf(deck.signatureSpell) : null,
    main: entry(deck.main),
    sideboard: entry(deck.sideboard),
    credit,
    note,
    addedAt: new Date().toISOString().slice(0, 10),
  }
}

/** The plain text an example entry would import as. */
export function exampleToDecklist(example) {
  const lines = []
  if (example.commanders?.length) {
    lines.push('Commander')
    for (const name of example.commanders) lines.push(`1 ${name}`)
    if (example.signatureSpell) lines.push(`1 ${example.signatureSpell}`)
    lines.push('')
  }
  lines.push('Deck')
  for (const { name, quantity } of example.main ?? []) lines.push(`${quantity} ${name}`)
  if (example.sideboard?.length) {
    lines.push('', 'Sideboard')
    for (const { name, quantity } of example.sideboard) lines.push(`${quantity} ${name}`)
  }
  return lines.join('\n')
}

/** Total card count, for showing a list is complete before opening it. */
export function exampleSize(example) {
  const main = (example.main ?? []).reduce((n, c) => n + c.quantity, 0)
  return main + (example.commanders?.length ?? 0) + (example.signatureSpell ? 1 : 0)
}
