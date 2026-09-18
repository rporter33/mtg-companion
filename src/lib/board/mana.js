/**
 * What is still untapped, and what colours it reaches.
 *
 * Moxgate shows "available mana" and can be exact about it, because its engine
 * knows what every card does. This table does not, and will not: it holds
 * where cards are, never what they do (`docs/MOXGATE_STUDY.md`).
 *
 * What can be had honestly is narrower and still worth having. Scryfall states
 * `produced_mana` on every printing, so for anything untapped on your side of
 * the table we can say: here are the sources you have not used yet, and here
 * are the colours between them. That is a fact about the cards, not a claim
 * about the rules.
 *
 * The two things it deliberately does not do:
 *
 * - It counts *sources*, not mana. A Sol Ring is one source. Saying "two" for
 *   it would mean reading an ability, and reading abilities is the line this
 *   table does not cross.
 * - It ignores every condition. A land that only makes mana while you control
 *   a Swamp counts the same as a Mountain. The screen says so rather than the
 *   count pretending otherwise.
 */

/** The order colours are shown in, which is the order Magic prints them in. */
const WUBRG = ['W', 'U', 'B', 'R', 'G']

/** Colourless is a colour of mana for this purpose, and sorts after the five. */
const ORDER = [...WUBRG, 'C']

/**
 * The untapped things on a player's battlefield that Scryfall says make mana.
 *
 * `cardFor` takes an instance and returns its Scryfall card, or nothing when
 * the cache has not filled yet — in which case that card simply is not
 * counted, rather than the whole readout refusing to appear.
 */
export function untappedSources(board, player = 'you', cardFor = () => null) {
  const ids = board?.zones?.[player]?.battlefield ?? []
  const sources = []
  const colours = new Set()

  for (const id of ids) {
    const inst = board?.cards?.[id]
    if (!inst || inst.tapped) continue
    const card = cardFor(inst)
    const makes = producedBy(card)
    if (!makes.length) continue
    sources.push({ id, cardId: inst.cardId, makes })
    for (const colour of makes) colours.add(colour)
  }

  return {
    count: sources.length,
    colours: ORDER.filter((colour) => colours.has(colour)),
    sources,
  }
}

/**
 * What a printing says it produces.
 *
 * Both faces are read, because a modal double-faced land makes mana on the
 * side you have not turned to yet and a player counting their colours is
 * thinking about the card, not the face.
 */
export function producedBy(card) {
  if (!card) return []
  const direct = card.produced_mana ?? []
  const faces = (card.card_faces ?? []).flatMap((face) => face.produced_mana ?? [])
  const all = [...direct, ...faces].filter((symbol) => ORDER.includes(symbol))
  return ORDER.filter((colour) => all.includes(colour))
}

/**
 * A rough reading of whether a cost is within reach of what is untapped.
 *
 * This is arithmetic on two numbers and nothing more. It is wrong about cost
 * reduction, alternative costs, additional costs, anything that taps for more
 * than one, and every land that only works under a condition — so it is only
 * ever shown as a hint that says on screen what it ignores.
 *
 * Returns `'yes'`, `'no'`, or `null` when there is nothing to compare, which
 * is the case for a land, a card with no cost, and a card whose data has not
 * arrived.
 */
export function withinReach(card, pool) {
  const cost = card?.mana_cost ?? card?.card_faces?.[0]?.mana_cost ?? ''
  if (!cost || !pool) return null
  const symbols = cost.match(/\{[^}]+\}/g) ?? []
  if (!symbols.length) return null
  // X costs nothing on their own, so a card with one is never out of reach.
  const needed = symbols.filter((symbol) => !/^\{X+\}$/i.test(symbol)).length
  const generic = symbols.find((symbol) => /^\{\d+\}$/.test(symbol))
  const total = (generic ? Number(generic.slice(1, -1)) - 1 : 0) + needed
  return pool.count >= total ? 'yes' : 'no'
}
