/**
 * How a person plays at the engine's table (src/lib/engine/pace.js), and what
 * a step is for when they asked for the steps to be explained
 * (src/lib/engine/teach.js).
 *
 * What each preset sets, which is the whole of what a preset is; the owner's
 * default; a reading of whatever storage or a relay hands back that never
 * throws and never guesses; the wait each speed makes of the room's own pace;
 * the log's words for where the game stops, in each way a room can answer; and
 * the teaching, which is the turn's own reference and nothing else, counted so
 * it is said the first few times and then not.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PRESET, EXPLAIN_TIMES, PRESETS, PRESET_CHIPS, PRESET_LINES, PRESET_NAMES, PRESET_SETTINGS, PRESET_TAGLINES,
  RELAXED_TIMES, SPEEDS, STOPS, answered, chosenPace, fixedLine, lobbyStopsLine, paceWith, presetFor, roomPaceOf, speedLine, speedMs, stopsLine, waitWords,
} from '../src/lib/engine/pace.js'
import {
  TURN_PANEL_LINE, taughtAny, taughtAt, taughtEnough, taughtOnce, teachesHere, teachingBody, teachingFor, teachingHead, teachingWords, timesTaught,
} from '../src/lib/engine/teach.js'
import { STEPS } from '../src/data/turn-structure.js'

describe('the presets', () => {
  it('are Fast, Controlled and Learning, and a first game is Controlled', () => {
    expect(PRESETS).toEqual(['fast', 'controlled', 'learning'])
    // The owner's choice, 2026-09-25 (HANDOFF.md §3 item 24).
    expect(DEFAULT_PRESET).toBe('controlled')
    for (const words of [PRESET_NAMES, PRESET_TAGLINES, PRESET_CHIPS, PRESET_LINES, PRESET_SETTINGS]) expect(Object.keys(words)).toEqual(PRESETS)
  })

  it('each set the settings this table has, and nothing else', () => {
    expect(PRESET_SETTINGS.fast).toEqual({ stops: 'playable', speed: 'brisk', explain: false })
    expect(PRESET_SETTINGS.controlled).toEqual({ stops: 'every', speed: 'brisk', explain: false })
    expect(PRESET_SETTINGS.learning).toEqual({ stops: 'every', speed: 'relaxed', explain: true })
    for (const s of Object.values(PRESET_SETTINGS)) {
      expect(STOPS).toContain(s.stops)
      expect(SPEEDS).toContain(s.speed)
      expect(typeof s.explain).toBe('boolean')
    }
    // No two presets are the same bundle, so a bundle always names its preset.
    for (const p of PRESETS) expect(presetFor(PRESET_SETTINGS[p])).toBe(p)
  })

  it('say what each actually does, and none claims to have you tap your own mana', () => {
    expect(PRESET_LINES.fast).toMatch(/only where you hold something you can play/)
    expect(PRESET_LINES.controlled).toMatch(/every priority window, both turns/)
    expect(PRESET_LINES.learning).toMatch(/first three times/)
    expect(EXPLAIN_TIMES).toBe(3)
    for (const line of Object.values(PRESET_LINES)) expect(line).not.toMatch(/mana/i)
  })
})

describe('the choice as it is kept', () => {
  it('is Controlled, and not yet asked, where nothing readable was kept', () => {
    for (const junk of [undefined, null, 'fast', 7, [], { preset: 'Fast' }, { preset: 'turbo', stops: 'sometimes', speed: 'ludicrous', explain: 'yes' }]) {
      expect(chosenPace(junk)).toEqual({ preset: 'controlled', stops: 'every', speed: 'brisk', explain: false, asked: false })
    }
  })

  it('takes a preset as its bundle, whatever was kept beside it', () => {
    expect(chosenPace({ preset: 'fast', stops: 'every', speed: 'instant', explain: true, asked: true }))
      .toEqual({ preset: 'fast', stops: 'playable', speed: 'brisk', explain: false, asked: true })
    expect(chosenPace({ preset: 'learning' }).asked).toBe(false)
  })

  it('takes a mix of the player\'s own setting by setting, each unreadable one from the default', () => {
    expect(chosenPace({ preset: null, stops: 'playable', speed: 'instant', explain: true, asked: true }))
      .toEqual({ preset: null, stops: 'playable', speed: 'instant', explain: true, asked: true })
    expect(chosenPace({ stops: 'playable', speed: 'fast-ish', explain: true })).toEqual({ preset: null, stops: 'playable', speed: 'brisk', explain: true, asked: false })
    // A mix that happens to be a bundle is that preset.
    expect(chosenPace({ stops: 'playable', speed: 'brisk', explain: false }).preset).toBe('fast')
  })

  it('changes by a preset or by one setting, keeping whether it was answered', () => {
    const kept = answered(undefined)
    expect(kept).toEqual({ preset: 'controlled', stops: 'every', speed: 'brisk', explain: false, asked: true })
    expect(paceWith(kept, { preset: 'learning' })).toEqual({ preset: 'learning', stops: 'every', speed: 'relaxed', explain: true, asked: true })
    // One setting changed makes a mix of the player's own, and changed back, the preset again.
    const own = paceWith(kept, { speed: 'instant' })
    expect(own).toEqual({ preset: null, stops: 'every', speed: 'instant', explain: false, asked: true })
    expect(paceWith(own, { speed: 'brisk' }).preset).toBe('controlled')
    expect(paceWith(kept, { stops: 'playable' }).preset).toBe('fast')
    // A change nobody can read changes nothing.
    expect(paceWith(kept, { stops: 'sometimes', preset: 'turbo' })).toEqual(kept)
    expect(paceWith(undefined, { preset: 'fast' }).asked).toBe(false)
  })
})

describe('the speed', () => {
  it('is the room\'s own pace at Brisk, twice it at Relaxed, and nothing at Instant', () => {
    expect(RELAXED_TIMES).toBe(2)
    expect(speedMs('brisk', 600)).toBe(600)
    expect(speedMs('relaxed', 600)).toBe(1200)
    expect(speedMs('instant', 600)).toBe(0)
    // Nobody asked is Brisk.
    expect(speedMs(null, 600)).toBe(600)
  })

  it('never waits past the longest pace a room may have', () => {
    expect(speedMs('relaxed', 8000, 10_000)).toBe(10_000)
    expect(speedMs('brisk', 12_000, 10_000)).toBe(10_000)
  })

  it('makes no wait at all at a room with no pace, which plays the engine\'s turn in one go', () => {
    for (const base of [0, -1, NaN, null, undefined]) for (const s of SPEEDS) expect(speedMs(s, base)).toBe(0)
  })

  it('says each wait in words', () => {
    expect(waitWords(1200)).toBe('1.2 s')
    expect(waitWords(600)).toBe('600 ms')
    expect(waitWords(0)).toBe('no wait')
    expect(waitWords(undefined)).toBeNull()
    expect(speedLine('relaxed', 1200)).toMatch(/twice as long as Brisk\. Here: 1\.2 s\.$/)
    expect(speedLine('instant')).toMatch(/each still arrives on its own\.$/)
    expect(speedLine('brisk', 600)).toMatch(/Here: 600 ms\.$/)
  })
})

describe('what the room says', () => {
  it('is read forgivingly', () => {
    expect(roomPaceOf({ stops: 'every', speed: 'relaxed', ms: 1200, paced: true })).toEqual({ stops: 'every', speed: 'relaxed', ms: 1200, paced: true, fixed: false })
    expect(roomPaceOf({ stops: 'playable', speed: 'warp', ms: -3, paced: 'yes', fixed: true })).toEqual({ stops: 'playable', speed: null, ms: null, paced: false, fixed: true })
    for (const junk of [undefined, null, 'every', [], {}, { stops: 'always' }]) expect(roomPaceOf(junk)).toBeNull()
  })

  it('is said in the log as where the game stops, once at the deal', () => {
    expect(stopsLine({ stops: 'every' }, { stops: 'every' })).toBe('The game stops for you at every priority window, both turns: pass with Pass or Space.')
    expect(stopsLine({ stops: 'playable' }, { stops: 'playable' })).toBe('The game stops for you only where you can play; the engine passes every other window for you, and says how many.')
  })

  it('says a change that reached the engine as from the next window', () => {
    expect(stopsLine({ stops: 'playable' }, { stops: 'playable' }, { changed: true })).toBe('From the next window, the game stops for you only where you can play.')
  })

  it('says an engine older than stopping at every window as that, where every window was asked', () => {
    // A relay deals every person at such an engine Law 1 (scripts/relay-engine.mjs).
    expect(stopsLine({ stops: 'playable', fixed: true }, { stops: 'every' })).toBe('This table’s engine is older than stopping you at every window, so the game stops for you only where you can play, whatever is chosen.')
    expect(stopsLine({ stops: 'playable', fixed: true }, { stops: 'every' })).toBe(fixedLine('playable'))
  })

  it('says a change the engine cannot make as that, naming where it goes on stopping, for a room dealt every window before', () => {
    expect(stopsLine({ stops: 'every', fixed: true }, { stops: 'playable' })).toBe('This table’s engine cannot change where it stops once the game is dealt, so the game goes on stopping for you at every priority window, both turns, until your next table.')
    // Where the room already does what was asked, there is nothing fixed to say.
    expect(stopsLine({ stops: 'playable', fixed: true }, { stops: 'playable' })).toBe('The game stops for you only where you can play; the engine passes every other window for you, and says how many.')
  })

  it('says in the lobby the preset kept, and Controlled in force only where it is Controlled that is kept, or nothing', () => {
    expect(lobbyStopsLine(undefined)).toBe('the game stops for you at every priority window, as Controlled does until you choose at the table.')
    expect(lobbyStopsLine({ preset: 'controlled', asked: false })).toBe('the game stops for you at every priority window, as Controlled does until you choose at the table.')
    // Learning picked at the table and the question left unanswered: kept, and named.
    expect(lobbyStopsLine({ preset: 'learning', asked: false })).toBe('the game stops for you at every priority window, as Learning does, picked at the table.')
    expect(lobbyStopsLine({ stops: 'every', speed: 'instant', explain: true, asked: false })).toBe('the game stops for you at every priority window, as your own mix at the table does.')
    expect(lobbyStopsLine({ preset: 'learning', asked: true })).toBe('the game stops for you at every priority window, as you chose.')
    expect(lobbyStopsLine({ preset: 'fast', asked: false })).toBe('the engine never stops you where you have nothing to do.')
    expect(lobbyStopsLine('learning')).toMatch(/as Controlled does until you choose/)
  })

  it('says a relay older than the choice only where the choice is not what it does anyway', () => {
    expect(stopsLine(undefined, { stops: 'every', speed: 'brisk' })).toMatch(/^This relay is older than choosing how you play/)
    expect(stopsLine(undefined, { stops: 'playable', speed: 'relaxed' })).toMatch(/^This relay is older/)
    expect(stopsLine(undefined, { stops: 'playable', speed: 'brisk' })).toBeNull()
    expect(stopsLine(null, { stops: 'every' })).toBeNull()
  })
})

describe('what a step is for', () => {
  it('is the turn\'s own reference for every step a person can be stopped in, with its rule numbers', () => {
    for (const step of STEPS.filter((s) => s.priority)) {
      const t = teachingFor(step.id)
      expect(t).toMatchObject({ id: step.id, phase: step.phaseName, step: step.name, rule: step.rule })
      // The note first, since it says what may be done there, then the reference's
      // own lines in its order, less those it scopes to other games.
      const does = step.does.filter((d) => !d.only).map((d) => ({ text: d.text, rule: d.rule }))
      expect(t.lines).toEqual([...(step.note ? [{ text: step.note, rule: null }] : []), ...does])
      expect(t.lines.length, step.id).toBeGreaterThan(0)
    }
    expect(teachingWords(teachingFor('upkeep'))).toBe(
      'Beginning phase, Upkeep (503.): Abilities that triggered during untap and “at beginning of upkeep” abilities go on the stack together. (503.1a)',
    )
    expect(teachingWords(teachingFor('main1'))).toBe(
      'First main phase, Precombat main (505.): While the stack is empty the active player may cast sorcery-speed spells and play one land. A land does not use the stack and cannot be responded to. Sagas get a lore counter. (505.4) Attractions are rolled for. (505.5)',
    )
  })

  it('leaves out at a table of two what the reference scopes to other games', () => {
    // 507.1 is the multiplayer game's, and 505.3 the Archenemy's: neither can happen at the engine's table.
    const combat = teachingFor('beginCombat')
    expect(combat.lines).toEqual([{ text: '“At beginning of combat” abilities trigger.', rule: '500.6' }])
    expect(teachingWords(combat)).not.toMatch(/multiplayer|507\.1/)
    expect(teachingWords(teachingFor('main1'))).not.toMatch(/Archenemy|505\.3/)
    // At a table of more, the multiplayer line is the reference's again; the Archenemy's never, as no game here is one.
    expect(teachingFor('beginCombat', { seats: 4 }).lines.map((l) => l.rule)).toEqual(['507.1', '500.6'])
    expect(teachingFor('main1', { seats: 4 }).lines.map((l) => l.rule)).toEqual([null, '505.4', '505.5'])
  })

  it('says only the note where the turn panel stands beside the prompt, or where to look for a step with none', () => {
    const attackers = teachingFor('attackers')
    expect(teachingHead(attackers)).toBe('Combat phase · Declare attackers (508.)')
    expect(teachingBody(attackers, { beside: true })).toBe('If nothing attacks, declare blockers and combat damage are skipped entirely.')
    expect(teachingBody(attackers)).toBe('If nothing attacks, declare blockers and combat damage are skipped entirely. The active player declares attackers, and what each is attacking. (508.1)')
    expect(teachingBody(teachingFor('upkeep'), { beside: true })).toBe(TURN_PANEL_LINE)
    expect(teachingBody(null)).toBe('')
    expect(teachingHead(null)).toBeNull()
  })

  it('is the person’s only in their own turn, or at a block they are asked to declare in the other’s', () => {
    expect(teachesHere({ active: 'e0', me: 'e0' })).toBe(true)
    expect(teachesHere({ active: 'e1', me: 'e0' })).toBe(false)
    expect(teachesHere({ active: 'e1', me: 'e0', blocking: { type: 'DeclareBlockers' } })).toBe(true)
    expect(teachesHere({ active: undefined, me: 'e0' })).toBe(false)
    expect(teachesHere({ active: undefined, me: undefined })).toBe(false)
  })

  it('is nothing for a step nobody gets priority in, or one this build does not know', () => {
    expect(teachingFor('untap')).toBeNull()
    expect(teachingFor('cleanup')).toBeNull()
    expect(teachingFor('UPKEEP')).toBeNull()
    expect(teachingFor(undefined)).toBeNull()
    expect(teachingWords(null)).toBeNull()
  })

  it('is counted a step at a time, forgivingly, and said the first three times', () => {
    let kept = null
    expect(timesTaught(kept, 'upkeep')).toBe(0)
    expect(taughtAny(kept)).toBe(false)
    for (let i = 1; i <= 3; i++) {
      expect(taughtEnough(kept, 'upkeep')).toBe(false)
      kept = taughtOnce(kept, 'upkeep', `ABCDE:${i}`)
      expect(timesTaught(kept, 'upkeep')).toBe(i)
      expect(taughtAt(kept)).toBe(`ABCDE:${i}`)
    }
    expect(taughtEnough(kept, 'upkeep')).toBe(true)
    expect(taughtEnough(kept, 'draw')).toBe(false)
    expect(taughtAny(kept)).toBe(true)
  })

  it('reads a count no build could have written as none, and keeps only the readable ones', () => {
    const odd = { times: { upkeep: 'twice', draw: -1, end: 2, main1: 1.5 }, at: 7 }
    expect(timesTaught(odd, 'upkeep')).toBe(0)
    expect(timesTaught(odd, 'draw')).toBe(0)
    expect(timesTaught(odd, 'end')).toBe(2)
    expect(taughtAt(odd)).toBeNull()
    expect(taughtOnce(odd, 'upkeep', 'X:1')).toEqual({ times: { end: 2, upkeep: 1 }, at: 'X:1' })
    for (const junk of [undefined, 'upkeep', [], { times: [3] }]) expect(timesTaught(junk, 'upkeep')).toBe(0)
  })
})
