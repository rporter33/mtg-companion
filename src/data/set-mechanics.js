// Curated set mechanics.
//
// THIS IS THE ONE PLACE IN THIS APP THAT HARDCODES SET-SPECIFIC CONTENT, and it
// does so deliberately. Everything else — legality, prices, set names, release
// dates, colour profiles — is fetched, because it changes. New mechanics cannot
// be fetched: Scryfall publishes reminder text on individual cards but nothing
// that says "here is what is new this set and why it matters to a new player".
//
// So each entry is hand-written, dated, and sourced, and the UI says when it was
// written. An entry that is stale is visibly stale rather than quietly wrong.
//
// Entries added during spoiler season are marked provisional: previewed
// mechanics occasionally change wording before release.

export const SET_MECHANICS = {
  fra: {
    setCode: 'fra',
    setName: 'Reality Fracture',
    curatedAt: '2026-09-16',
    provisional: true,
    premise:
      'Jace Beleren imagined a Multiverse without its catastrophes — no Phyrexians, no Eldrazi, no Bolas — and when his own identity fractured, the self that remained, the Theorist, built it: the Echoverse, a mirrored reality where familiar people and places return as elegant but unstable opposites. He means to lay it over the old one. The set is full of "what if?" versions of familiar characters, and its question is what remains of a person when the suffering that shaped them is removed — and who gets to decide.',
    sources: [
      'https://magic.wizards.com/en/news/feature/reality-fracture-mechanics',
      'https://magic.wizards.com/en/news/feature/enter-the-echoverse-with-reality-fracture-design',
      'https://magic.wizards.com/en/news/feature/collecting-reality-fracture',
    ],
    mechanics: [
      {
        id: 'empowerJace',
        term: 'Empower Jace',
        short: 'Creates a Jace planeswalker token, or grows the one you have.',
        long: '"Empower Jace N" puts N loyalty counters on a Jace token you control. If you do not control one, you first create a blue Jace planeswalker token with "−1: Surveil 1" and "−3: Draw a card". The tokens are not legendary, so nothing stops you having several if you make them some other way — but empower Jace itself will only ever make the first one. It appears at every rarity, commons included, so expect to see it constantly.',
        forNewPlayers:
          'A planeswalker token is a real planeswalker: it can be attacked, and you may activate one of its abilities on each of your turns.',
        seeAlso: ['planeswalker'],
      },
      {
        id: 'heartwood',
        term: 'Heartwood token',
        short: 'A new predefined artifact token that makes mana.',
        long: 'Heartwood tokens are artifacts that tap for mana, so they act as extra mana sources that are not lands. In deckbuilding terms they behave like a mana rock you did not have to draw.',
        forNewPlayers:
          'This app counts anything that produces mana toward your mana base, not just lands — so a deck making Heartwood tokens genuinely needs fewer lands.',
        seeAlso: ['ramp', 'artifact'],
      },
      {
        id: 'prepare',
        term: 'Prepare',
        short: 'A creature that carries a spell it can cast later.',
        long: 'A preparation card is a creature with a second, smaller spell printed on it. When the creature becomes prepared, a copy of that spell waits in exile until you cast it, until the creature leaves the battlefield, or until it becomes unprepared. The creature, its prepared state and the waiting copy belong together, so the app shows them together.',
        forNewPlayers:
          'Think of it as training: the creature has learned a trick, and the trick stays learned until the creature is gone.',
        seeAlso: ['exile'],
      },
      {
        id: 'echoedPairs',
        term: 'Echoed pair',
        short: 'A card and its Echoverse counterpart, designed as a set.',
        long: 'Echoed pairs show the original Multiverse version of a character alongside the Echoverse version of the same subject. Echoverse cards carry the Echoverse sigil watermark. Some are printed as borderless pairs whose artwork spans both cards.',
        forNewPlayers:
          'A watermark is decoration. It has no effect on how a card plays, though some cards elsewhere in Magic do care about watermarks.',
      },
      {
        id: 'colorShifted',
        term: 'Colour-shifted card',
        short: 'A familiar card rebuilt in a different colour.',
        long: 'Colour-shifted cards take the design of an iconic card from an earlier set and move it into another colour. They are new cards with new names, not reprints — so their legality and their colour identity are their own.',
        forNewPlayers:
          'Worth checking the mana cost rather than assuming: a colour-shifted card will not fit the deck the original fitted.',
        seeAlso: ['colorIdentity'],
      },
    ],
    art: {
      headline: 'Shattered Mirror',
      description:
        'The signature treatment centres the Echoverse version of a subject, with broken mirror fragments around the edges showing glimpses of the original. The premium Facet Foil finish is reflective, to play up the shards of broken reality.',
    },
  },
}

export function mechanicsForSet(code) {
  return SET_MECHANICS[String(code ?? '').toLowerCase()] ?? null
}

/** How stale an entry is, so the UI can say so rather than implying freshness. */
export function curationAgeDays(entry, now = new Date().toISOString().slice(0, 10)) {
  if (!entry?.curatedAt) return null
  const a = Date.parse(`${entry.curatedAt}T00:00:00Z`)
  const b = Date.parse(`${now}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}
