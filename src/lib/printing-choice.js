import { notOutUntil, releaseLabel } from './release.js'
import { today } from './season.js'

// What the import review says about each line's printing: which printing will
// land and, when the app chose it rather than the person, why that one. The
// words are built from what resolvePrintings reported and from Scryfall's own
// fields (set name, collector number, release date). A choice the app made
// says it was the app's, and none of it is an opinion of a printing.

/** "The Hobbit #195", from the card record, with whatever of it is there. */
export function printingLabel(card) {
  const set = card?.set_name || (typeof card?.set === 'string' ? card.set.toUpperCase() : '')
  const number = card?.collector_number ? `#${card.collector_number}` : ''
  return [set, number].filter(Boolean).join(' ')
}

/** "ZZZ 9" as the line typed it, or "ZZZ" for a line that named a set alone. */
const typedText = ({ set, number }) => [String(set ?? '').toUpperCase(), number].filter(Boolean).join(' ')

/**
 * Why Scryfall's pick for a name was passed over. It is called its pick, not
 * its newest printing: Scryfall chooses it by its own lights, and a newer
 * printing can exist. What the app took is what it searched for, the newest
 * paper printing that is out.
 */
function passedOver(pick, now) {
  const set = pick?.set_name ? `, ${pick.set_name},` : ''
  const date = notOutUntil(pick, now)
  return date
    ? `Scryfall's pick for the name${set} is not out until ${releaseLabel(date)}, so the app took the newest paper printing that is out.`
    : `Scryfall's pick for the name${set} is digital only, so the app took the newest paper printing that is out.`
}

/**
 * The review line for one resolved import line: `printing` names the printing
 * that will land, and `note` (or null) says why the app chose it. `line` is
 * what was typed ({ set, number }) together with what resolvePrintings
 * reported ({ card, how, byName, newest, unchecked, unasked }). A printing
 * the person typed gets no note: it is theirs, and the chip beside it says if
 * it is not out.
 *
 * A typed printing Scryfall answered not found is one it has no record of,
 * and the note says so. One whose request failed is not: Scryfall was never
 * asked, and the note says only that.
 */
export function describeChoice(line, now = today()) {
  const card = line?.card
  const label = printingLabel(card)
  const fallback = line?.how === 'fallback'
  const rule = fallback ? line.byName : line?.how
  const notes = []
  if (fallback) {
    const used = label || "Scryfall's pick for the name"
    notes.push(line.unasked
      ? `Scryfall could not be asked for ${line.number ? typedText(line) : `the ${typedText(line)} printing`}; the app used ${used} instead.`
      : `Scryfall has no ${line.number ? typedText(line) : `${typedText(line)} printing of it`}; the app used ${used} instead.`)
  }
  if (rule === 'released' && line.newest) notes.push(passedOver(line.newest, now))
  else if (rule === 'unreleased-only') {
    // The search asked for paper printings only, so that is all this says.
    notes.push(notOutUntil(card, now)
      ? 'Scryfall lists no paper printing of it that is out yet.'
      : 'Scryfall lists no paper printing of it.')
  } else if (line?.unchecked) notes.push('Scryfall could not be asked for a printing that is out.')
  return { printing: fallback ? '' : label, note: notes.join(' ') || null }
}
