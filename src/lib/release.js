import { today } from './season.js'
// Whether a printing is out yet.
//
// Scryfall lists a set's cards as they are previewed, weeks before release,
// each with the `released_at` date its set comes out. So a card can be in
// Scryfall, in search results and in a deck while it is not yet in anyone's
// hands. Everything here is worked out from that date and today's, each time
// it is asked: nothing about release is stored, no set or date is written
// into the code, and on release day every label that depends on it simply
// stops appearing. `today()` is the season engine's, so the whole app agrees
// on what day it is.

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The day a printing comes out, when that is after `now`; otherwise null.
 * A missing or malformed date counts as released: the app never withholds a
 * card on the strength of a date it cannot read.
 */
export function notOutUntil(card, now = today()) {
  const date = card?.released_at
  if (typeof date !== 'string' || !DATE.test(date)) return null
  return date > now ? date : null
}

/** A printing that is out, and printed on paper: what a player can hold. */
export function isReleasedPaper(card, now = today()) {
  if (!card || notOutUntil(card, now)) return false
  if (card.digital === true) return false
  return Array.isArray(card.games) ? card.games.includes('paper') : true
}

/** "13 Nov 2026", read in UTC so the day never shifts with the viewer's zone. */
export function releaseLabel(date) {
  if (typeof date !== 'string' || !DATE.test(date)) return ''
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** The words for a printing that is not out: "Not out until 13 Nov 2026". */
export function notOutText(date) {
  return `Not out until ${releaseLabel(date)}`
}
