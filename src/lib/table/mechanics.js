/**
 * What the practice table's model can do, written down.
 *
 * The table is not a rules engine. It is a small deterministic model that
 * covers a listed set of mechanics for a listed pool of cards, and refuses
 * everything else out loud. This file is that list. A card whose `rules`
 * block asks for anything not here is not playable on the table, and the
 * screen says so rather than approximating.
 *
 * Section numbers refer to the Comprehensive Rules.
 */

export const MECHANICS = Object.freeze({
  land: 'Playing one land a turn, in a main phase with an empty stack (305.1, 305.2). Lands do not use the stack.',
  mana: 'Mana abilities of basic lands and of creatures with {T}: Add {colour}; a creature’s needs it to have been under your control since your turn began (302.6, 605). Mana empties at the end of each step and phase (500.4).',
  creature: 'Creature spells cast at sorcery speed (307.1 as applied to permanents, 601.2), summoning sick until their controller’s next turn begins (302.6). Vanilla creatures only, plus the keywords listed here.',
  instant: 'Instants cast whenever you have priority (117, 304.1). The listed effects only.',
  sorcery: 'Sorceries cast in your main phase with the stack empty (307.1). The listed effects only.',
  haste: 'The creature ignores summoning sickness (702.10).',
  pump: 'Target creature gets +N/+N until end of turn (611.2, 514.2).',
  damage: 'N damage to any target: a creature or a player (120). Marked damage stays until cleanup (514.2).',
  stack: 'Spells go on the stack and resolve one at a time, top first, when both players pass in succession (117.4, 405, 608).',
  priority: 'The active player gets priority at the start of most steps and after each resolution; a player who casts a spell gets it back (117.3).',
  combat: 'One combat phase with declare attackers, declare blockers and combat damage steps (506–510); attacking taps, blocking does not (508.1f, 509.1).',
  stateBased: 'Lethal damage, zero toughness and zero life are checked before priority is given (704).',
  turn: 'Untap, upkeep, draw, first main, combat, second main, end, cleanup (500.1). The player who goes first skips their first draw (103.8a).',
})

export const SUPPORTED_KEYWORDS = Object.freeze(['haste'])
export const SUPPORTED_EFFECTS = Object.freeze(['pump', 'damage'])
export const SUPPORTED_KINDS = Object.freeze(['land', 'creature', 'instant', 'sorcery'])

/**
 * Why a card cannot be on the table, or null when it can. The check is
 * exhaustive over the rules block, so a new field added without a handler
 * is caught here rather than silently ignored.
 */
export function unsupportedReason(card) {
  const rules = card?.rules
  if (!rules) return 'has no rules block'
  if (!SUPPORTED_KINDS.includes(rules.kind)) return `is a ${rules.kind ?? 'card of unknown kind'}`
  for (const key of Object.keys(rules)) {
    if (!['kind', 'mana', 'keywords', 'effect'].includes(key)) return `uses "${key}", which the table does not model`
  }
  for (const keyword of rules.keywords ?? []) {
    if (!SUPPORTED_KEYWORDS.includes(keyword)) return `has ${keyword}, which the table does not model`
  }
  if (rules.effect && !SUPPORTED_EFFECTS.includes(rules.effect.kind)) return `has an effect the table does not model`
  if (rules.effect && !['creature', 'any'].includes(rules.effect.target)) return `targets something the table does not model`
  for (const ability of rules.mana ?? []) {
    if (!Array.isArray(ability.produces) || !ability.produces.length) return 'has a mana ability with no colour'
  }
  if ((rules.kind === 'instant' || rules.kind === 'sorcery') && !rules.effect) return 'is a spell with no effect'
  return null
}
