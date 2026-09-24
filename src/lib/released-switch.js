import { notOutUntil, releaseLabel } from './release.js'
import { today } from './season.js'
import { allCardIds, swapPrinting, stampNames } from './deck.js'
import { captureVersion } from './versions.js'
import { printingLabel } from './printing-choice.js'

// Moving a deck off printings that are not out yet.
//
// Before the released-first rule (2026-09-21) a card imported by name took
// Scryfall's pick for it, which in a preview season can be a set not out: a
// bare "Island" became Star Trek's, due 13 November 2026. Those decks are not
// wrong. Each such row says "Not out until …", and the label goes on release
// day, so this is an offer for a player who would rather hold what is in the
// shops now, not a repair.
//
// The owner's decisions, 2026-09-24: nothing in a deck is rewritten behind the
// player's back, so the editor offers, shows each switch and changes nothing
// until the player says; the offer keeps no state ("Not now" lasts until the
// deck is next opened, and nothing is stored); and a replacement is chosen by
// the importer's own rule, the newest paper printing of the same card that is
// out, found by oracle id (findReleasedFor in scryfall.js). A printing the
// player typed is offered like any other, since the deck does not say who
// chose it. This file is the plan and the edit; the asking is scryfall.js's,
// and the words around it are ReleasedPrintings.jsx's.

/** The label of the History checkpoint taken before the switch. */
export const SWITCH_LABEL = 'Before switching to released printings'

/**
 * Every printing in the deck that is not out by `now`, each once whatever
 * zones it sits in: { cardId, card, date }. A card that has not loaded is not
 * among them: its release date is not known, and its row carries no label
 * either.
 */
export function notOutPrintings(deck, lookup, now = today()) {
  if (!deck || typeof lookup !== 'function') return []
  const held = []
  for (const cardId of allCardIds(deck)) {
    const card = lookup(cardId)
    const date = notOutUntil(card, now)
    if (date) held.push({ cardId, card, date })
  }
  return held
}

const joinAnd = (parts) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/**
 * "2 printings in this deck are not out until 13 Nov 2026.", or, when they
 * come out on different days, "3 printings in this deck are not out yet: 2
 * until 2 Oct 2026 and 1 until 13 Nov 2026.", earliest first. Printings, not
 * copies: twenty of one Island is one printing to switch.
 */
export function notOutSummary(held) {
  const n = held?.length ?? 0
  if (!n) return ''
  const byDate = new Map()
  for (const { date } of held) byDate.set(date, (byDate.get(date) ?? 0) + 1)
  const dates = [...byDate.keys()].sort()
  const subject = n === 1 ? '1 printing in this deck is' : `${n} printings in this deck are`
  if (dates.length === 1) return `${subject} not out until ${releaseLabel(dates[0])}.`
  return `${subject} not out yet: ${joinAnd(dates.map((d) => `${byDate.get(d)} until ${releaseLabel(d)}`))}.`
}

// The zones whose rows swapPrinting merges, each named as the screen says it.
const ZONE_NAME = { main: 'the main deck', sideboard: 'the sideboard' }
const JOIN_ZONES = Object.keys(ZONE_NAME)

/**
 * What "Find released printings" would do, from the printings not out
 * (notOutPrintings) and Scryfall's answer for each (findReleasedFor, given
 * the same cards in the same order). Nothing is written here.
 *
 * `switches` are { fromId, from, to, joins }. `joins` lists each zone where
 * the switched rows become one with rows of the printing switched to, as
 * { zone, already }: `already` when the deck holds that printing there now,
 * and not when an earlier switch in the plan brings it in. swapPrinting merges
 * rows within the main deck and within the sideboard, never across them, so a
 * printing held only in the other zone is no join. `kept` are { cardId, card,
 * answer } for every printing with nothing to switch to, each with the reason
 * Scryfall gave; the screen names every one. A printing that turns out to be
 * out already, or is itself the answer, has nothing to switch and nothing to
 * say, so it is in neither.
 */
export function switchPlan(deck, held, answers) {
  // Each zone's printings as the switches so far leave them, beside what the
  // deck holds there now.
  const zones = JOIN_ZONES.map((zone) => {
    const ids = new Set((Array.isArray(deck?.[zone]) ? deck[zone] : []).map((e) => e?.cardId))
    return { zone, now: new Set(ids), ids }
  })
  const switches = []
  const kept = []
  for (const [i, { cardId, card }] of (held ?? []).entries()) {
    const found = answers?.[i]
    if (found?.answer === 'out') continue
    const to = found?.answer === 'released' ? found.released : null
    if (typeof to?.id === 'string') {
      // The very printing the deck holds is nothing to switch.
      if (to.id === cardId) continue
      const joins = []
      for (const { zone, now, ids } of zones) {
        if (!ids.has(cardId)) continue
        if (ids.has(to.id)) joins.push({ zone, already: now.has(to.id) })
        ids.delete(cardId)
        ids.add(to.id)
      }
      switches.push({ fromId: cardId, from: card, to, joins })
      continue
    }
    // An answer that is missing, or not one of Scryfall's, is one nobody
    // gave: "could not be asked" claims that much and no more.
    const answer = KEPT.includes(found?.answer) ? found.answer : 'unchecked'
    kept.push({ cardId, card, answer })
  }
  return { switches, kept }
}

const nameOf = (card) => (typeof card?.name === 'string' && card.name ? card.name : 'A card')

/** "Island: Star Trek #319 → The Hobbit #195" */
export function switchLine({ from, to }) {
  return `${nameOf(from)}: ${printingLabel(from)} → ${printingLabel(to)}`
}

/**
 * Where a switch's rows join others, from its `joins` (see switchPlan):
 * "joins the copies already in the main deck", "joins the copies another
 * switch brings into the sideboard", or '' when they join none.
 */
export function joinNote(joins) {
  const where = (already) => joinAnd((Array.isArray(joins) ? joins : [])
    // Own keys only: "constructor" is on every object (see getFormat, and
    // why it calls hasOwnProperty rather than Object.hasOwn).
    .filter((j) => Object.prototype.hasOwnProperty.call(ZONE_NAME, j?.zone) && Boolean(j.already) === already)
    .map((j) => ZONE_NAME[j.zone]))
  const parts = []
  const already = where(true)
  const brought = where(false)
  if (already) parts.push(`the copies already in ${already}`)
  if (brought) parts.push(`the copies another switch brings into ${brought}`)
  return parts.length ? `joins ${parts.join(' and ')}` : ''
}

// Each in Scryfall's terms, and claiming no more than its answer did (see
// findReleasedFor for what each answer means).
const KEPT_BECAUSE = {
  none: 'Scryfall lists no paper printing of it that is out yet.',
  ahead: 'Scryfall already counts a printing of it as out, though its release day has not begun here.',
  unchecked: 'Scryfall could not be asked about it just now.',
  unasked: "Scryfall's record of it gives nothing to search by.",
}
const KEPT = Object.keys(KEPT_BECAUSE)

/** "Darklight Phoenix stays as Reality Fracture #53: Scryfall lists no paper printing of it that is out yet." */
export function keptLine({ card, answer }) {
  const label = printingLabel(card)
  return `${nameOf(card)} stays${label ? ` as ${label}` : ''}: ${KEPT_BECAUSE[answer] ?? KEPT_BECAUSE.unchecked}`
}

/**
 * The deck with the switches made, after a History checkpoint of it as it
 * stood (captureVersion, as an import and a restore take one), so the whole
 * switch is one restore away. Each switch goes through swapPrinting, which
 * reaches every zone, the chosen art and the command zone's stamped names;
 * then each new printing's name is stamped from the card in hand, since a deck
 * imported before names were stamped has its only record of them in its
 * snapshot, under the old ids. A switch whose printing the deck no longer holds
 * (it was edited while the offer was open) does nothing, and when none does
 * anything the deck comes back as it was, with no checkpoint.
 */
export function applySwitches(deck, switches, { at } = {}) {
  if (!deck || !switches?.length) return deck
  const captured = captureVersion(deck, { label: SWITCH_LABEL, auto: true, ...(at ? { at } : {}) })
  let next = captured
  const arrived = new Map()
  for (const { fromId, to } of switches) {
    if (typeof to?.id !== 'string') continue
    const after = swapPrinting(next, fromId, to.id)
    if (after !== next) arrived.set(to.id, to)
    next = after
  }
  if (next === captured) return deck
  return stampNames(next, (id) => arrived.get(id) ?? null)
}
