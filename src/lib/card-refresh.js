// When a saved card record is due to be fetched again.
//
// A deck's cards are pinned in the cache so the deck opens with no signal,
// and for a long time nothing ever asked Scryfall about them again: a card
// saved before its set came out kept Scryfall's pre-release not_legal for
// ever, and the launch legality watch, which exists to announce bans,
// compared one frozen record with another. This is the rule for which records
// are old enough to ask about again. It is pure, with the clock passed in, so
// it can be tested on any day; getCardsByIds and refreshCards in scryfall.js
// apply it.

import { CARD_TTL_MS, QUERY_TTL_MS } from './cache.js'
import { releaseStart } from './release.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The UTC day of a time, 'YYYY-MM-DD', as season.js's today() gives it, or
 * '' for a time that is not one.
 */
export function dayOf(time) {
  const when = new Date(Number.isFinite(time) ? time : NaN)
  return Number.isFinite(when.getTime()) ? when.toISOString().slice(0, 10) : ''
}

/**
 * Whether a cached record, { card, fetchedAt, checkedAt? } as getCardRecords
 * gives it, should be fetched again.
 *
 * - After CARD_TTL_MS, a week, any record: prices and legality move, and a
 *   ban announced this week has to reach a deck saved last month.
 * - Once its card's release day has come, a record fetched before that day
 *   began (UTC): it says what Scryfall said of a card that was not out, and a
 *   new card is not_legal everywhere until it is.
 * - In the week after its card's release, a record more than a day old,
 *   QUERY_TTL_MS. When Scryfall gives a new set its legalities after
 *   release has not been checked, so one fetch on release day may still
 *   bring the word from before it; asking daily for that week is the app's
 *   own choice, not a figure from Scryfall.
 * - Not a record Scryfall said, within CARD_TTL_MS, it has no card for
 *   (`checkedAt`, see markCardsChecked in cache.js): it is asked about again
 *   a week on, as any record is, not every day.
 *
 * `now` is a time in milliseconds and `day` the date it falls on, which may
 * be given separately. A record with no readable fetchedAt, as an older build
 * may have left, is read as old, and so is one fetched after `now`, which
 * only a clock set back since can produce: asking once more costs one
 * request, and trusting it could keep the record for as long as the clock is
 * behind. A checkedAt that is not a time, or is after `now`, is ignored for
 * the same reason.
 */
export function refreshDue(record, now = Date.now(), day = dayOf(now)) {
  const checkedAt = record?.checkedAt
  if (Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= CARD_TTL_MS) return false
  const fetchedAt = record?.fetchedAt
  if (!Number.isFinite(fetchedAt) || fetchedAt > now) return true
  const age = now - fetchedAt
  if (age > CARD_TTL_MS) return true

  const start = releaseStart(record?.card)
  if (start === null || typeof day !== 'string' || !DATE.test(day)) return false
  if (record.card.released_at > day) return false
  if (fetchedAt < start) return true
  return now - start < CARD_TTL_MS && age > QUERY_TTL_MS
}
