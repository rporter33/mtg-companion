/**
 * How strongly the engine plays: the three levels a player chooses between
 * in the lobby, as the app names them (HANDOFF.md, M3).
 *
 * Each level is one of Argentum's own named AI profiles, and which one is
 * the engine process's to say (`LEVELS` in engine/src/main/kotlin/companion/
 * Server.kt); the wire carries only the word. What is here is what the app
 * says about them, which is the app's own and says so on screen: a line on
 * what each level does, and what was measured when the three were set against
 * each other through the process (PLAN.md, "M3: easy, intermediate, hard"). A
 * level is never described as stronger than that measurement showed.
 *
 * Shared by the relay (scripts/relay-engine.mjs) and the app, so the room and
 * the lobby agree on what a level is called.
 */

export const LEVELS = ['easy', 'intermediate', 'hard']

/** The owner's choice for a first game (2026-09-24): intermediate, with easy and hard a choice away. */
export const DEFAULT_LEVEL = 'intermediate'

/**
 * A level from anything: storage written by another build, a relay's reply,
 * a room's setting. A word this build does not know is not guessed at; it is
 * no level at all, and the caller says so or falls back to the default.
 */
export const levelOf = (value) => (typeof value === 'string' && LEVELS.includes(value) ? value : null)

/** The level a player has chosen, or the default where nothing readable was kept. */
export const chosenLevel = (value) => levelOf(value) ?? DEFAULT_LEVEL

export const LEVEL_NAMES = { easy: 'Easy', intermediate: 'Intermediate', hard: 'Hard' }

/**
 * The log's one line about the level, once the deal has said what the engine
 * took. `took` is the room's word after the deal: a level, null where the
 * engine plays its one way, or undefined from a relay older than levels, which
 * sends no word at all; any other word is a newer relay's, and is not named.
 * `wanted` is the level this player chose. Each case is said as what it is, so
 * a level is never named that the engine is not playing.
 */
export function levelLine(took, wanted) {
  if (took !== undefined && took !== null && !levelOf(took)) return 'The engine is playing at a level this version of the app has no name for.'
  if (took) {
    return !wanted || wanted === took
      ? `The engine is playing at the ${took} level.`
      : `The engine is playing at the ${took} level, the one this table was dealt at; the ${wanted} level you have chosen since is for your next table.`
  }
  if (took === null) {
    return `This relay's engine is older than the levels and plays one way only${wanted ? `, so it is not playing at the ${wanted} level you chose` : ''}.`
  }
  return wanted ? `This relay is older than the levels, so the engine plays the one way it always has there, not at the ${wanted} level you chose.` : null
}

/**
 * Where an engine room stands, as its lobby can say it, from the room's own
 * report (`GET /rooms/<code>`, read forgivingly: any build of the relay may
 * have written it).
 *
 * `open` — nothing is dealt yet, and the level is still the lobby's to choose.
 * `dealing` — the engine has been started and is loading the corpus, which
 * takes seconds; the level it was asked for is `level`, and it is not yet the
 * game's. `dealt` — the game is under way, at `level` if the engine took one
 * and at none (null) where it plays its one way.
 *
 * A room says `dealt` outright since M3's review. One from M3 itself does not,
 * and there a room that names a `level` has dealt once it names what was
 * `played`; a relay from before levels names neither, and its "started" is
 * all there is to go by, as it always was.
 */
export function roomLevel(peek) {
  if (!peek || typeof peek !== 'object' || !peek.started) return { stage: 'open', level: levelOf(peek?.level) }
  const dealt = typeof peek.dealt === 'boolean' ? peek.dealt : !('level' in peek) || 'played' in peek
  if (!dealt) return { stage: 'dealing', level: levelOf(peek.level) }
  return { stage: 'dealt', level: levelOf(peek.played) }
}

/**
 * One line on each level, in the app's words. Each says what the level does,
 * from Argentum's own account of the profile behind it, and how long it
 * takes, as measured; none says how well it plays beyond what was measured.
 */
export const LEVEL_LINES = {
  easy: 'Weighs each play by the board it would leave, and answers at once.',
  intermediate: 'Also knows what many cards are for, and judges a race by how soon it would end. Answers as quickly as easy.',
  hard: 'Knows what intermediate knows, and plays its bigger choices out a turn or two ahead first, guessing at the cards it cannot see. Usually answers within a second, but a busy turn can take ten.',
}

/**
 * What the three measured against each other, said once under the choice.
 * The numbers are PLAN.md's (scripts/engine-levels.mjs, on the date given):
 * each range runs from one deck's result to the other's, and every one of
 * them was clear of an even split at 95%.
 */
export const LEVELS_MEASURED = 'Measured here on 24 September 2026, the engine playing itself with two decks, 400 to 1,000 games a pairing: hard won 58–63% of its games against easy and 53–54% against intermediate; intermediate won 54–59% against easy.'
