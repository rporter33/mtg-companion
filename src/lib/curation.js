import { releaseLabel } from './release.js'
import { today } from './season.js'
// How current a hand-written set entry is.
//
// Curated set content (src/data/set-mechanics.js, src/data/set-themes.js) is
// the one part of the app written by hand, and most of it is written from
// previews, before its set is out. So each time it is shown, the screen says
// which of these holds, worked out from the entry's own dates and the set's
// release date in Scryfall's set list:
//
//   preview    the set is not out: provisional, and wording may still change
//   unchecked  the set is out, the entry was written before, and nobody has
//              recorded checking it against the released cards since
//   checked    `checkedAt` records the day it was checked against them
//   written    written on or after release day, so from the released cards
//
// Nothing here is stored and no release date is written into the code, so
// the words change on release day with nobody editing anything. The entry's
// own `provisional` flag is the author's note, and stands only when the
// release date is not known.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const readDate = (value) => (typeof value === 'string' && DATE.test(value) ? value : null)

/**
 * Where `entry` stands against a release on `releasedAt`, by `now`'s day.
 * Forgiving of an entry with any field missing or malformed: a date it cannot
 * read is treated as not given.
 */
export function curationStatus(entry, releasedAt, now = today()) {
  const writtenOn = readDate(entry?.curatedAt)
  const releasedOn = readDate(releasedAt)
  const checkedOn = readDate(entry?.checkedAt)
  const base = { writtenOn, releasedOn, checkedOn: null }
  if (!releasedOn) {
    const provisional = entry?.provisional === true
    return { ...base, state: provisional ? 'preview' : 'written', provisional }
  }
  if (releasedOn > now) return { ...base, state: 'preview', provisional: true }
  // A check dated before release cannot have been against the released cards,
  // and one dated after today has not happened yet.
  if (checkedOn && checkedOn >= releasedOn && checkedOn <= now) return { ...base, checkedOn, state: 'checked', provisional: false }
  if (writtenOn && writtenOn >= releasedOn) return { ...base, state: 'written', provisional: false }
  return { ...base, state: 'unchecked', provisional: false }
}

/**
 * The sentence that says so: "Written on 16 Sep 2026 from previews, before
 * release on 2 Oct 2026; not yet checked against the released cards."
 * `ageDays`, when given, follows the date the entry was written.
 * `releaseShown`, for a line that has already given the release date (the
 * season banner's "Released 2 Oct 2026"), leaves the date out of the sentence
 * once the set is out, so one paragraph does not give it twice.
 */
export function curationNote(status, { ageDays = null, releaseShown = false } = {}) {
  if (!status) return ''
  const ago = ageDays > 0 ? ` (${ageDays} day${ageDays === 1 ? '' : 's'} ago)` : ''
  const written = status.writtenOn ? `Written on ${releaseLabel(status.writtenOn)}${ago}` : 'Written by hand'
  const released = status.releasedOn ? releaseLabel(status.releasedOn) : null
  const beforeRelease = !!(status.writtenOn && released && status.writtenOn < status.releasedOn)
  const on = released && !releaseShown ? ` on ${released}` : ''
  const releasedCards = on ? `the cards released${on}` : 'the released cards'

  switch (status.state) {
    case 'preview':
      return released
        ? `${written} from previews; the set comes out on ${released}, and wording sometimes changes before release.`
        : `${written} from previews; wording sometimes changes before release.`
    case 'unchecked':
      return beforeRelease
        ? `${written} from previews, before release${on}; not yet checked against the released cards.`
        : `${written}; not yet checked against ${releasedCards}.`
    case 'checked':
      return beforeRelease
        ? `${written} from previews, before release${on}; checked against the released cards on ${releaseLabel(status.checkedOn)}.`
        : `${written}; checked against the released cards on ${releaseLabel(status.checkedOn)}.`
    default:
      return released && status.writtenOn ? `${written}, after release${on}.` : `${written}.`
  }
}

/**
 * The season banner's line for a curated theme. Its colours are inferred from
 * promotional imagery and its lore is the app's summary, so it is never
 * official, before release or after; what changes is how current it is.
 * `options` go to curationNote.
 */
export function themeNote(status, options) {
  if (!status || status.state === 'preview') return 'Colours and lore here are the app’s own reading of public previews, not official.'
  return `Colours and lore here are the app’s own reading, not official. ${curationNote(status, options)}`
}
