// Recognising decklist URLs from the sites people actually use.
//
// THE CONSTRAINT: this app has no backend, so every request comes from the
// user's browser. A site can only be read directly if it sends CORS headers
// permitting it. Most deckbuilding sites do not, and that is their choice to
// make — there is no client-side way around it and no honest reason to look for
// one. Spoofing a user agent or routing through a scraping proxy would be
// fragile, would work against what the service has signalled, and is not
// something that belongs in a public repository.
//
// So each source declares whether a browser may read it. Where it may not, the
// app says exactly which button to press on that site instead, with the paste
// box already open. A URL field that explains itself beats one that silently
// fails.

import { decklistLine } from './decklist.js'

export const SOURCES = [
  {
    id: 'moxfield',
    name: 'Moxfield',
    match: /^https?:\/\/(www\.)?moxfield\.com\/decks\/([\w-]+)/i,
    // Moxfield publishes no official public API. The third-party wrappers that
    // exist spoof a user agent to get in, which is signal enough.
    browserReadable: false,
    instructions: 'Open the deck on Moxfield, use the ⋯ menu and choose Export, then paste the list below.',
  },
  {
    id: 'archidekt',
    name: 'Archidekt',
    match: /^https?:\/\/(www\.)?archidekt\.com\/decks\/(\d+)/i,
    // Archidekt does publish an API. Whether it permits browser origins is
    // something we find out at runtime rather than assert here.
    browserReadable: 'attempt',
    api: (id) => `https://archidekt.com/api/decks/${id}/`,
    parse: parseArchidekt,
    instructions: 'Open the deck on Archidekt, choose Export, and paste the text list below.',
  },
  {
    id: 'edhrec',
    name: 'EDHREC',
    match: /^https?:\/\/(www\.)?edhrec\.com\/(precon|deckpreview|decks)\//i,
    // Not tried. Whether EDHREC would permit a browser origin is not something
    // this repo has checked, and not fetching someone else's site until you
    // have is the right default rather than a limitation.
    browserReadable: false,
    instructions: 'Open the deck on EDHREC and copy its card list, then paste it below. A list with no quantity numbers is fine — it will be read as one of each.',
  },
  {
    id: 'deckstats',
    name: 'Deckstats',
    match: /^https?:\/\/(www\.)?deckstats\.net\/decks\//i,
    browserReadable: false,
    instructions: 'On Deckstats, open the deck, choose Export and pick the plain text format, then paste it below.',
  },
  {
    id: 'tappedout',
    name: 'TappedOut',
    match: /^https?:\/\/(www\.)?tappedout\.net\/mtg-decks\//i,
    browserReadable: false,
    instructions: 'On TappedOut, open the deck and use the Export / Download button to copy a text list, then paste it below.',
  },
  {
    id: 'mtggoldfish',
    name: 'MTGGoldfish',
    match: /^https?:\/\/(www\.)?mtggoldfish\.com\/deck/i,
    browserReadable: false,
    instructions: 'On MTGGoldfish, open the deck and use Download / Copy to clipboard, then paste the list below.',
  },
]

/** Does this text look like a URL rather than a decklist? */
export function looksLikeUrl(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed || /\n/.test(trimmed)) return false
  return /^https?:\/\//i.test(trimmed)
}

/** Which site is this, if any? */
export function identifySource(url) {
  const trimmed = String(url ?? '').trim()
  for (const source of SOURCES) {
    const match = trimmed.match(source.match)
    if (match) return { source, id: match[2] ?? null }
  }
  return null
}

/**
 * What the app can do with a pasted URL.
 *
 * Returns a plan rather than performing anything, so the UI can explain itself
 * before any request is made.
 */
export function planForUrl(url) {
  if (!looksLikeUrl(url)) return null
  const identified = identifySource(url)

  if (!identified) {
    return {
      kind: 'unknown',
      message: 'That looks like a link, but not one from a deck site this app recognises.',
      hint: 'Most sites have an Export or Download button that produces a plain text list. Paste that instead.',
    }
  }

  const { source, id } = identified
  if (source.browserReadable === false) {
    return {
      kind: 'manual',
      source,
      message: `${source.name} does not let other sites read decks directly from your browser.`,
      hint: source.instructions,
    }
  }

  return { kind: 'fetch', source, id, message: `Reading this deck from ${source.name}…` }
}

/**
 * Attempts to read a deck from a source that may permit it.
 *
 * A CORS refusal surfaces as a TypeError with no status, indistinguishable from
 * being offline — so the failure message covers both and points at the export
 * route either way rather than guessing which happened.
 */
export async function fetchFromSource({ source, id }, { signal } = {}) {
  if (!source?.api) throw new Error('That source cannot be read directly.')
  let response
  try {
    response = await fetch(source.api(id), { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    const refusal = new Error(
      `Could not read the deck from ${source.name}. Either it does not allow other sites to read decks from a browser, or the connection failed.`,
    )
    refusal.code = 'blocked'
    refusal.instructions = source.instructions
    throw refusal
  }

  if (!response.ok) {
    const failure = new Error(
      response.status === 404
        ? `${source.name} has no deck at that address. Check the link, or that the deck is public.`
        : `${source.name} returned an error (${response.status}).`,
    )
    failure.code = response.status === 404 ? 'not_found' : 'error'
    failure.instructions = source.instructions
    throw failure
  }

  const payload = await response.json()
  return source.parse(payload)
}

/**
 * Archidekt's deck shape: a flat `cards` array where each entry carries the
 * card, a quantity, and the categories it was filed under.
 */
export function parseArchidekt(payload) {
  const entries = payload?.cards ?? []
  const main = []
  const sideboard = []
  const commanders = []

  for (const entry of entries) {
    const name = entry?.card?.oracleCard?.name ?? entry?.card?.name
    if (!name) continue
    const quantity = Number(entry.quantity) || 1
    const categories = (entry.categories ?? []).map((c) => String(c).toLowerCase())

    if (categories.includes('commander')) commanders.push({ name, quantity: 1 })
    else if (categories.includes('sideboard') || categories.includes('maybeboard')) {
      sideboard.push({ name, quantity })
    } else main.push({ name, quantity })
  }

  return {
    name: payload?.name ?? 'Imported deck',
    commanders,
    main,
    sideboard,
  }
}

/**
 * MOXFIELD IS NEVER FETCHED BY THE APP. This parser exists for the offline
 * curation script (scripts/fetch-deck.mjs), which runs on a maintainer's own
 * machine where CORS does not apply. It lives here so it can be tested beside
 * the other deck shapes, not so the browser can use it.
 *
 * Moxfield's deck payload has changed shape at least once, and neither shape is
 * documented. Rather than assert one, walk whichever board containers exist and
 * pull anything that looks like {quantity, card:{name}}.
 */
export function parseMoxfield(payload) {
  const boards = payload?.boards ?? payload
  const pick = (key) => {
    const board = boards?.[key]
    const cards = board?.cards ?? board
    if (!cards || typeof cards !== 'object') return []
    return Object.values(cards)
      .map((entry) => ({
        name: entry?.card?.name ?? entry?.name ?? null,
        quantity: Number(entry?.quantity) || 1,
      }))
      .filter((entry) => entry.name)
  }

  return {
    name: payload?.name ?? 'Imported deck',
    commanders: pick('commanders').map((e) => ({ ...e, quantity: 1 })),
    main: pick('mainboard'),
    sideboard: pick('sideboard'),
  }
}

/**
 * Renders a parsed deck back into the plain text the importer already reads.
 * An entry that carries its printing ({ set, number }) keeps it, written the
 * way the importer reads it back; one with a name alone is written as a name.
 */
export function toDecklistText({ commanders = [], main = [], sideboard = [] }) {
  const lines = []
  if (commanders.length) {
    lines.push('Commander')
    for (const entry of commanders) lines.push(decklistLine(1, entry.name, entry))
    lines.push('')
  }
  lines.push('Deck')
  for (const entry of main) lines.push(decklistLine(entry.quantity, entry.name, entry))
  if (sideboard.length) {
    lines.push('', 'Sideboard')
    for (const entry of sideboard) lines.push(decklistLine(entry.quantity, entry.name, entry))
  }
  return lines.join('\n')
}
