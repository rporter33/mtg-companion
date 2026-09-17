// What a card does, read from its rules text.
//
// The coach, the first-deck flow and the Add cards tab all sort a deck into
// roles — ramp, draw, removal, creatures — and they must agree, so the
// reading lives here once. scripts/measure-coach.mjs scores these against
// Scryfall's community tags; they are the least verified rules in the app,
// and the measurement is the honest answer to how good they are.

import { oracleTextOf, typeLineOf } from './formats.js'
import { isLandCard } from './deck.js'

const textOf = (card) => `${oracleTextOf(card)}`.toLowerCase()

// Oracle-text signatures. Deliberately broad: a coach that misses a removal
// spell is annoying, one that demands you add removal you already have is
// actively wrong, so these err toward counting.
export const IS_REMOVAL = (card) => {
  const text = textOf(card)
  return /\bdestroy target\b/.test(text)
    || /\bexile target\b/.test(text)
    // "damage to any target" and "damage to target creature" are both removal;
    // an earlier version required "to target" and so missed Lightning Bolt.
    // Note the lowercase x: the text has already been lowercased, so "X damage"
    // arrives as "x damage".
    || /\bdeals? [\dx]+ damage to (any target|target (creature|permanent|planeswalker|battle))/.test(text)
    || /\btarget (creature|player) sacrifices\b/.test(text)
    || /\bcounter target spell\b/.test(text)
    || /\bdestroy all\b/.test(text)
    || /\bexile all\b/.test(text)
    // Fight and bite: green kills things without ever saying "destroy".
    || /\bfights? target\b/.test(text)
    // A negative pump is removal; a positive one is not, so the sign matters.
    || /\b(target creature|all creatures|each creature)[^.]{0,60}?gets? -[\dx]+\/-[\dx]+/.test(text)
}

export const IS_DRAW = (card) => {
  // "Whenever you draw a card, ..." is a card that rewards drawing, not one
  // that draws. Counting those told players they had card draw when what they
  // had was a payoff with nothing to pay it off — the exact failure this check
  // exists to catch. Strip trigger conditions, then look at what is left.
  const text = textOf(card).replace(/whenever [^,]*?draws? (a card|\w+ cards)/g, '')
  return /\bdraws? (a card|\w+ cards)\b/.test(text) && !/\bopponent draws\b/.test(text)
}

export const IS_RAMP = (card) => {
  const text = textOf(card)
  if (isLandCard(card)) return false
  // Two wordings, and the brace one alone missed Arcane Signet — "Add one mana
  // of any color" contains no mana symbol at all. That rock is in essentially
  // every Commander deck, and it was counting for nothing.
  return /\badd \{/.test(text)
    || /\badd\b[^.]{0,40}\bmana\b/.test(text)
    // The old pattern demanded "for a basic land", which is not how the most
    // played ramp in Commander is worded: Cultivate searches "for up to two
    // basic land cards", Farseek names the types, Nature's Lore says "a Forest
    // card". All three were uncounted. Allow any wording up to the land, and
    // accept a basic land type as well as the word "land".
    || /\bsearch(es)? your library for [^.]{0,60}?\b(lands?|plains|island|swamp|mountain|forest)\b/
      .test(text)
    || /\bput a[n]? .*land.* onto the battlefield\b/.test(text)
}

export const IS_CREATURE = (card) => /\bCreature\b/.test(typeLineOf(card))

/**
 * The classifiers, named, so they can be scored against real cards.
 *
 * These are the least verified thing in the app: every other rule here is
 * arithmetic, but these are guesses about how Magic writes its cards, checked
 * only against cards I thought of while writing them. scripts/measure-coach.mjs
 * scores them against Scryfall's community card tags.
 */
export const CLASSIFIERS = { removal: IS_REMOVAL, draw: IS_DRAW, ramp: IS_RAMP }
