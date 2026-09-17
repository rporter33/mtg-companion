// Drawing sample hands from a real deck.
//
// The analysis tab computes what an opening hand SHOULD look like — the odds of
// two lands, of a turn-three drop. This is the other half: actually shuffling
// the ninety-nine and looking. Predictions describe a thousand games; a player
// deciding whether to cut a land wants to see seven cards.
//
// THE SHUFFLE IS SEEDED. Not for reproducibility in play — that would be a lie
// about randomness — but because a test that cannot fix the shuffle cannot
// check the mulligan arithmetic, and because "deal me that hand again" is the
// one thing people ask for when something surprising turns up.

/** mulberry32: small, fast, and good enough for shuffling cardboard. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, which is the only shuffle that is actually uniform. */
export function shuffle(items, random = Math.random) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The deck as a pile of individual cards.
 *
 * Commanders are NOT in it. They begin the game in the command zone, so a
 * hundred-card Commander deck shuffles ninety-nine — an off-by-one that would
 * quietly skew every number this produces.
 */
export function buildLibrary(deck, lookup) {
  const cards = []
  for (const { cardId, quantity } of deck?.main ?? []) {
    const card = lookup(cardId)
    if (!card) continue
    for (let i = 0; i < quantity; i++) cards.push(card)
  }
  return cards
}

export const OPENING_HAND = 7

/**
 * A fresh game.
 *
 * `onPlay` matters: in a two-player game the player going first does not
 * draw on turn one, which is one card of difference across a whole game and
 * the reason the analysis tab reports both columns. `multiplayer` matters
 * too: with three or more players nobody skips that draw (rule 103.8c), so a
 * Commander pod on the play still draws — and most Commander games are pods.
 */
export function newGame(deck, lookup, { seed = Date.now(), onPlay = true, multiplayer = false } = {}) {
  const library = shuffle(buildLibrary(deck, lookup), rng(seed))
  return {
    seed,
    onPlay,
    multiplayer,
    library: library.slice(OPENING_HAND),
    hand: library.slice(0, OPENING_HAND),
    bottomed: [],
    mulligans: 0,
    turn: 1,
    kept: false,
    drawn: 0,
  }
}

/**
 * London mulligan: draw a fresh seven every time, and put cards on the bottom
 * only when you keep. The count bottomed equals the number of mulligans taken,
 * which is why the number has to be carried rather than recomputed from the
 * hand size — the hand is always seven until the moment it is kept.
 */
export function mulligan(state, deck, lookup) {
  const next = newGame(deck, lookup, {
    seed: state.seed + state.mulligans + 1, onPlay: state.onPlay, multiplayer: state.multiplayer,
  })
  return { ...next, mulligans: state.mulligans + 1 }
}

/** How many cards this hand must put on the bottom to be kept. */
export const bottomCount = (state) => Math.min(state.mulligans, OPENING_HAND)

/**
 * Keeps the hand, putting the chosen cards on the bottom of the library.
 *
 * Refuses a wrong number rather than guessing which to bottom: choosing badly
 * is the mulligan decision, and silently picking for the player would remove
 * the thing being practised.
 */
export function keep(state, indices = []) {
  const needed = bottomCount(state)
  if (indices.length !== needed) {
    return { ...state, error: `Choose exactly ${needed} card${needed === 1 ? '' : 's'} to put on the bottom.` }
  }

  const chosen = new Set(indices)
  const bottomed = state.hand.filter((_, i) => chosen.has(i))
  const kept = {
    ...state,
    hand: state.hand.filter((_, i) => !chosen.has(i)),
    library: [...state.library, ...bottomed],
    bottomed,
    kept: true,
    error: null,
  }

  // Turn one begins the moment the hand is kept, and everyone but the first
  // player of a two-player game draws for it. Doing this here rather than in
  // newGame matters because a mulligan restarts the game, and that card
  // would otherwise be drawn twice.
  return skipsFirstDraw(state) ? kept : draw(kept, 1)
}

/** Only the first player of a two-player game skips the turn-one draw. */
export const skipsFirstDraw = (state) => Boolean(state.onPlay && !state.multiplayer)

/** Draws from the top. An empty library is reported, not silently survived. */
export function draw(state, count = 1) {
  const taken = state.library.slice(0, count)
  if (taken.length < count) {
    return {
      ...state,
      hand: [...state.hand, ...taken],
      library: [],
      drawn: state.drawn + taken.length,
      error: 'The library is empty — in a real game that loses it.',
    }
  }
  return {
    ...state,
    hand: [...state.hand, ...taken],
    library: state.library.slice(count),
    drawn: state.drawn + count,
    error: null,
  }
}

/**
 * Ends the turn and draws for the next one.
 *
 * Always draws. Turn one is the only turn whose draw step can be skipped, and
 * that is handled when the hand is kept — an earlier version tested "has
 * anything been drawn yet", which skipped the turn-two draw for anyone who had
 * cast a cantrip on turn one.
 */
export function nextTurn(state) {
  return draw({ ...state, turn: state.turn + 1 }, 1)
}

/** What is in a hand, by the categories a keep decision turns on. */
export function describeHand(hand, isLand) {
  const lands = hand.filter((card) => isLand(card)).length
  return {
    size: hand.length,
    lands,
    spells: hand.length - lands,
    // A hand with no lands, or nothing but lands, is the textbook mulligan.
    keepable: lands > 0 && lands < hand.length,
  }
}
