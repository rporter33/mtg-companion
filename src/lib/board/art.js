/**
 * What a printing looks like.
 *
 * A card is not one object: Sol Ring has been printed dozens of times, and
 * the differences — a full-art frame, a borderless showcase, an etched foil —
 * are most of why people care which copy is in their deck. Scryfall describes
 * all of it in fields, so none of this is guesswork and none of it needs a
 * table of set codes kept up to date by hand.
 *
 * Nothing here reproduces a card frame, a set symbol or any printed artwork:
 * it reads which treatment a printing is, so the app can draw its own frame
 * differently and show the painting Scryfall serves inside it.
 */
import { artUrl } from '../deck-art.js'
import { notOutUntil } from '../release.js'
import { today } from '../season.js'

/** The finishes a player might own a copy in. The board keeps one per card. */
export const FINISHES = ['normal', 'foil', 'etched']

/**
 * The treatment of a printing, from Scryfall's own fields.
 *
 * `frame_effects` is the interesting one: "showcase", "extendedart",
 * "inverted" and the rest are exactly the words printed on the marketing, and
 * a card with none of them is an ordinary copy.
 */
export function treatmentOf(card) {
  const effects = card?.frame_effects ?? []
  const promos = card?.promo_types ?? []
  const finishes = card?.finishes ?? ['nonfoil']
  return {
    finishes,
    foilable: finishes.includes('foil'),
    etchable: finishes.includes('etched'),
    foilOnly: finishes.length > 0 && !finishes.includes('nonfoil'),
    showcase: effects.includes('showcase'),
    extended: effects.includes('extendedart'),
    borderless: card?.border_color === 'borderless',
    fullArt: Boolean(card?.full_art),
    textless: Boolean(card?.textless),
    retro: effects.includes('legendary') ? false : promos.includes('retro') || card?.frame === '1997',
    promo: Boolean(card?.promo) || promos.length > 0,
    serialized: promos.includes('serialized'),
  }
}

/** The one word worth putting on a chip, or null when it is an ordinary copy. */
export function treatmentName(card) {
  const t = treatmentOf(card)
  if (t.borderless) return 'borderless'
  if (t.showcase) return 'showcase'
  if (t.extended) return 'extended art'
  if (t.fullArt) return 'full art'
  if (t.retro) return 'retro frame'
  if (t.textless) return 'textless'
  if (t.promo) return 'promo'
  return null
}

/** A line a person can read: where the printing is from and what it is. */
export function describePrinting(card) {
  if (!card) return ''
  const parts = [card.set_name ?? card.set?.toUpperCase() ?? 'Unknown set']
  if (card.collector_number) parts.push(`#${card.collector_number}`)
  const treatment = treatmentName(card)
  if (treatment) parts.push(treatment)
  const t = treatmentOf(card)
  if (t.foilOnly) parts.push('foil only')
  else if (t.foilable) parts.push('foil available')
  return parts.join(' · ')
}

/**
 * Printings worth offering, best first.
 *
 * Four rules, in order. The copy already in the deck comes first, because
 * that is the one the person is changing away from and it should be obvious
 * which it is. Then anything with a painting to show, because a printing
 * whose image never arrives is not an art choice. Among those, printings
 * that are out come before ones Scryfall lists ahead of release: Scryfall
 * sends the newest first, so a set still in previews would otherwise head
 * the list with copies nobody can hold yet. Digital-only printings go after
 * both rather than being dropped: an Arena player may well want one.
 * Nothing is hidden, and within each group Scryfall's order stands.
 *
 * `now` is only there so a test can fix the day.
 */
export function orderPrintings(printings, currentId = null, now = today()) {
  const seen = new Set()
  const rank = (card) => {
    if (card.id === currentId) return 0
    if (!artUrl(card)) return 4
    if (card.digital) return 3
    if (notOutUntil(card, now)) return 2
    return 1
  }
  return (printings ?? [])
    .filter((card) => {
      if (!card?.id || seen.has(card.id)) return false
      seen.add(card.id)
      return true
    })
    .map((card, i) => ({ card, i }))
    .sort((a, b) => rank(a.card) - rank(b.card) || a.i - b.i)
    .map(({ card }) => card)
}

/**
 * The finish to use after swapping printings.
 *
 * Someone who chose a foil and then picks a printing that was never foiled
 * should get the ordinary copy rather than a sheen the card cannot have.
 */
export function finishFor(card, wanted = 'normal') {
  const t = treatmentOf(card)
  if (wanted === 'foil' && t.foilable) return 'foil'
  if (wanted === 'etched' && t.etchable) return 'etched'
  if (t.foilOnly && t.foilable) return 'foil'
  return 'normal'
}

export { artUrl }
