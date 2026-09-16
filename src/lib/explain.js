// Reads a real card's rules text and explains it, line by line.
//
// This works on patterns rather than on a list of cards, so it covers every
// card in Magic including ones printed next week. The patterns come from how
// Magic's rules text is actually templated, and the templating is remarkably
// regular — which is the thing nobody tells beginners:
//
//   A line beginning "When", "Whenever" or "At" is a triggered ability.
//   A line of the form "cost: effect" is an activated ability.
//   Anything else on a permanent is simply true while it is there.
//
// Learn those three and you can read a card you have never seen.
//
// DELIBERATE LIMIT: this explains *structure*, not strategy or interactions.
// It will tell you that a line is a mandatory trigger and what fires it. It
// will not tell you whether the card is good, or how it behaves alongside
// another card, because getting that subtly wrong would be worse than silence.

import { typeLineOf, oracleTextOf, frontTypeLine } from './formats.js'
import { parseManaCost, classifySymbol } from './mana.js'

/** Keyword text as printed -> glossary key. */
export const KEYWORD_TERMS = {
  flying: 'flying',
  trample: 'trample',
  'first strike': 'firstStrike',
  'double strike': 'doubleStrike',
  deathtouch: 'deathtouch',
  lifelink: 'lifelink',
  vigilance: 'vigilance',
  haste: 'haste',
  reach: 'reach',
  menace: 'menace',
  defender: 'defender',
  flash: 'flash',
  hexproof: 'hexproof',
  indestructible: 'indestructible',
  ward: 'ward',
  protection: 'protection',
  scry: 'scry',
  surveil: 'surveil',
  cycling: 'cycling',
  kicker: 'kicker',
  flashback: 'flashback',
  convoke: 'convoke',
  prowess: 'prowess',
}

/**
 * Ability words carry no rules meaning. Scryfall prints them ahead of an em
 * dash, which is exactly how you spot one.
 */
export const ABILITY_WORDS = [
  'landfall', 'raid', 'delirium', 'constellation', 'metalcraft', 'threshold',
  'morbid', 'revolt', 'ferocious', 'spell mastery', 'formidable', 'coven',
  'magecraft', 'battalion', 'heroic', 'undergrowth', 'adamant', 'addendum',
  'eminence', 'hellbent', 'domain', 'corrupted', 'descend', 'valiant',
]

const TRIGGER_START = /^(when|whenever|at)\b/i
const ABILITY_WORD_PREFIX = /^([A-Za-z][A-Za-z' ]*?)\s+—\s+(.*)$/
const REFLEXIVE = /\bwhen you do\b|\bwhen you don't\b|\bwhen they do\b/i

/** Splits a cost:effect line, ignoring colons that appear inside reminder text. */
function splitActivated(line) {
  const withoutReminder = line.replace(/\([^)]*\)/g, '')
  const index = withoutReminder.indexOf(':')
  if (index <= 0) return null
  const cost = withoutReminder.slice(0, index).trim()
  const effect = withoutReminder.slice(index + 1).trim()
  // An activated ability's cost is short and made of costs, not prose. A long
  // left side is almost always a sentence that happens to contain a colon.
  if (!cost || cost.length > 60 || !effect) return null
  if (/\b(when|whenever|at the beginning)\b/i.test(cost)) return null
  return { cost, effect }
}

/** Is this line nothing but keywords separated by commas? */
function keywordOnlyLine(line) {
  const bare = line.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '')
  if (!bare) return null
  const parts = bare.split(/,\s*/).map((p) => p.trim().toLowerCase())
  const matched = parts.map((part) => {
    // "ward {2}" and "protection from red" carry a parameter.
    const base = Object.keys(KEYWORD_TERMS).find((keyword) =>
      part === keyword || part.startsWith(`${keyword} `))
    return base ?? null
  })
  if (matched.some((m) => m === null)) return null
  return matched.map((keyword) => KEYWORD_TERMS[keyword])
}

/** Every keyword mentioned anywhere in a line, for cross-linking. */
function keywordsIn(line) {
  const lower = line.toLowerCase()
  return Object.entries(KEYWORD_TERMS)
    .filter(([keyword]) => new RegExp(`\\b${keyword}\\b`).test(lower))
    .map(([, term]) => term)
}

function describeTrigger(line) {
  const word = line.match(TRIGGER_START)[1].toLowerCase()
  const optional = /\byou may\b/i.test(line)
  const reflexive = REFLEXIVE.test(line)

  // The condition runs to the first comma outside any parenthesis.
  const withoutReminder = line.replace(/\([^)]*\)/g, '')
  const comma = withoutReminder.indexOf(',')
  const condition = comma > 0 ? withoutReminder.slice(0, comma).trim() : null
  const effect = comma > 0 ? withoutReminder.slice(comma + 1).trim() : null

  const lead = word === 'at'
    ? 'This happens automatically at a particular point in a turn.'
    : word === 'when'
      ? 'This happens automatically, once, when its condition is met.'
      : 'This happens automatically, every time its condition is met.'

  const notes = []
  notes.push(optional
    ? 'It says "may", so you choose whether to take it.'
    : 'There is no "may", so it is not optional — it happens whether you want it to or not.')

  return {
    kind: 'triggered',
    triggerWord: word,
    condition,
    effect,
    optional,
    explanation: `${lead} Anything starting with When, Whenever or At is a triggered ability. ${notes.join(' ')}`,
    terms: ['triggeredAbility', ...(optional ? ['mayKeyword'] : [])],
  }
}

/**
 * The reflexive trigger — "you may do X. When you do, Y" — is the case most
 * worth catching and the easiest to miss, because it sits in the *second*
 * sentence of a line whose first sentence looks like an ordinary instruction.
 * Detected separately from how the line as a whole classifies.
 */
const REFLEXIVE_NOTE = '"When you do" is a second, reflexive trigger: it only fires if you actually took the optional action in the sentence before it. Decline, and nothing further happens. It is written this way so the reward cannot be taken without paying the cost.'

function reflexiveIn(line) {
  return REFLEXIVE.test(line)
}

function describeActivated({ cost, effect }) {
  const taps = /\{T\}/.test(cost)
  const sacrifices = /\bsacrifice\b/i.test(cost)
  const notes = []
  if (taps) notes.push('The {T} in the cost means you tap it to use this, so it can only be done once per turn and not at all the turn it arrives unless it has haste.')
  if (sacrifices) notes.push('Part of the cost is sacrificing something, which you cannot take back once you have started.')

  return {
    kind: 'activated',
    cost,
    effect,
    explanation: `Anything written as "cost: effect" is an activated ability, and you choose when to use it. Pay ${cost} to get the effect, as often as you can afford it. ${notes.join(' ')}`.trim(),
    terms: ['activatedAbility', ...(taps ? ['tapped', 'summoningSickness'] : [])],
  }
}

/** Explains one line of rules text. */
export function explainLine(rawLine, { isPermanent = true } = {}) {
  const line = rawLine.trim()
  if (!line) return null

  const base = { text: line, terms: [] }

  // An ability word sits ahead of an em dash and means nothing on its own.
  const prefixed = line.match(ABILITY_WORD_PREFIX)
  const abilityWord = prefixed && ABILITY_WORDS.includes(prefixed[1].toLowerCase())
    ? prefixed[1]
    : null
  const body = abilityWord ? prefixed[2] : line

  let detail
  if (TRIGGER_START.test(body)) detail = describeTrigger(body)
  else {
    const activated = splitActivated(body)
    if (activated) detail = describeActivated(activated)
    else {
      const keywordsOnly = keywordOnlyLine(body)
      if (keywordsOnly) {
        detail = {
          kind: 'keywords',
          explanation: 'These are keyword abilities — single words that stand in for a rule. Tap any of them to see what it does.',
          terms: keywordsOnly,
        }
      } else {
        detail = isPermanent
          ? {
            kind: 'static',
            explanation: 'No trigger and no cost, so this is simply true the whole time this is on the battlefield. It never uses the stack and cannot be responded to.',
            terms: ['staticAbility'],
          }
          : {
            kind: 'instruction',
            explanation: 'This is what the spell does when it resolves. Once it has finished, the card goes to your graveyard.',
            terms: ['stack', 'graveyard'],
          }
      }
    }
  }

  const reflexive = reflexiveIn(body)
  const merged = [...new Set([
    ...detail.terms,
    ...keywordsIn(body),
    ...(reflexive ? ['reflexiveTrigger', 'mayKeyword'] : []),
  ])]

  return {
    ...base,
    ...detail,
    reflexive,
    explanation: reflexive
      ? `${detail.explanation} ${REFLEXIVE_NOTE}`
      : detail.explanation,
    abilityWord,
    abilityWordNote: abilityWord
      ? `"${abilityWord}" is an ability word. It has no rules meaning at all — delete it and the card behaves identically. The real rule is everything after the dash.`
      : null,
    terms: abilityWord ? [...new Set([...merged, 'abilityWord'])] : merged,
  }
}

/** Plain-language reading of a mana cost. */
export function explainCost(cost) {
  const symbols = parseManaCost(cost)
  if (!symbols.length) return null

  let generic = 0
  const colored = []
  let variable = false
  for (const body of symbols) {
    const { kind, colors, generic: amount } = classifySymbol(body)
    if (kind === 'generic') generic += amount
    else if (kind === 'variable') variable = true
    else if (colors.length) colored.push(...colors)
  }

  const parts = []
  if (generic) parts.push(`${generic} mana of any kind`)
  if (colored.length) {
    const counted = {}
    for (const c of colored) counted[c] = (counted[c] ?? 0) + 1
    const names = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }
    for (const [color, n] of Object.entries(counted)) {
      parts.push(`${n} ${names[color] ?? color}`)
    }
  }
  if (variable) parts.push('plus however much you choose to pay for X')
  if (!parts.length) return null

  return `Costs ${parts.join(', ')}.`
}

/**
 * The full breakdown for a card.
 *
 * Returns null when there is nothing useful to say, so the caller renders
 * nothing rather than an empty panel.
 */
export function explainCard(card) {
  if (!card) return null

  const typeLine = frontTypeLine(card) || typeLineOf(card)
  const text = oracleTextOf(card)
  const isPermanent = !/\b(Instant|Sorcery)\b/.test(typeLine)

  const lines = text
    .split('\n')
    .map((line) => explainLine(line, { isPermanent }))
    .filter(Boolean)

  const face = card.card_faces?.[0]
  const power = card.power ?? face?.power
  const toughness = card.toughness ?? face?.toughness
  const loyalty = card.loyalty ?? face?.loyalty

  const stats = power != null && toughness != null
    ? `${power}/${toughness} means it deals ${power} damage in combat and dies once it has taken ${toughness}. Damage wears off at the end of each turn.`
    : loyalty != null
      ? `It arrives with ${loyalty} loyalty counters. You may activate one of its abilities on each of your turns, and your opponents can attack it directly.`
      : null

  return {
    typeLine,
    costNote: explainCost(card.mana_cost ?? face?.mana_cost ?? ''),
    lines,
    stats,
    vanillaNote: lines.length
      ? null
      : 'This card has no rules text at all. Everything it does is on its type line and in its numbers — which makes it a perfectly good card to learn on.',
  }
}
