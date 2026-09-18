import { describe, it, expect } from 'vitest'
import { TUTORIAL, PHASES, LEGACY_BEAT_IDS, beatIndexFor } from '../src/data/tutorial.js'
import { TUTORIAL_CARDS } from '../src/data/tutorial-cards.js'
import { parseManaCost } from '../src/lib/mana.js'
import { GLOSSARY, GLOSSARY_KEYS, GLOSSARY_SECTIONS } from '../src/data/glossary.js'

const cardIds = new Set(Object.keys(TUTORIAL_CARDS))
const cardsIn = (beat) => [
  ...beat.you.hand,
  ...beat.you.board.map((p) => p.id),
  ...beat.you.graveyard,
  ...beat.foe.board.map((p) => p.id),
  ...beat.foe.graveyard,
]

describe('tutorial script', () => {
  it('has unique beat ids', () => {
    const ids = TUTORIAL.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only ever references bundled cards', () => {
    // The tutorial must work with no network, so every card it shows has to be
    // one we ship. A typo here would render an empty frame mid-lesson.
    for (const beat of TUTORIAL) {
      for (const id of cardsIn(beat)) {
        expect(cardIds.has(id), `${beat.id} references unknown card "${id}"`).toBe(true)
      }
    }
  })

  it('always asks the player to click something that is actually there', () => {
    for (const beat of TUTORIAL) {
      if (beat.action.type !== 'click') continue
      const zone = beat.action.zone === 'hand'
        ? beat.you.hand
        : beat.you.board.map((p) => p.id)
      expect(
        zone.includes(beat.action.cardId),
        `${beat.id} asks for "${beat.action.cardId}" in your ${beat.action.zone}, which is not there`,
      ).toBe(true)
    }
  })

  it('resolves every glossary reference', () => {
    for (const beat of TUTORIAL) {
      if (!beat.term) continue
      expect(GLOSSARY[beat.term], `${beat.id} cites unknown term "${beat.term}"`).toBeTruthy()
    }
  })

  it('gives every beat coach text and an action', () => {
    for (const beat of TUTORIAL) {
      expect(beat.coach?.length, `${beat.id} has no coach text`).toBeGreaterThan(20)
      expect(['continue', 'click']).toContain(beat.action.type)
      expect(beat.action.label, `${beat.id} action has no label`).toBeTruthy()
    }
  })

  it('never shows a negative life total, and ends with the opponent at zero', () => {
    for (const beat of TUTORIAL) {
      expect(beat.you.life).toBeGreaterThanOrEqual(0)
      expect(beat.foe.life).toBeGreaterThanOrEqual(0)
    }
    const last = TUTORIAL[TUTORIAL.length - 1]
    expect(last.won).toBe(true)
    expect(last.foe.life).toBe(0)
  })

  it('never lets a life total increase — nothing in this script gains life', () => {
    // A rising life total would mean a scripting slip, since no card here has lifelink.
    let you = TUTORIAL[0].you.life
    let foe = TUTORIAL[0].foe.life
    for (const beat of TUTORIAL) {
      expect(beat.you.life, `${beat.id} raised your life`).toBeLessThanOrEqual(you)
      expect(beat.foe.life, `${beat.id} raised their life`).toBeLessThanOrEqual(foe)
      you = beat.you.life
      foe = beat.foe.life
    }
  })

  it('never shrinks a graveyard — cards do not come back in this script', () => {
    let you = 0
    let foe = 0
    for (const beat of TUTORIAL) {
      expect(beat.you.graveyard.length, `${beat.id} shrank your graveyard`).toBeGreaterThanOrEqual(you)
      expect(beat.foe.graveyard.length, `${beat.id} shrank their graveyard`).toBeGreaterThanOrEqual(foe)
      you = beat.you.graveyard.length
      foe = beat.foe.graveyard.length
    }
  })

  it('never plays more than one land per turn', () => {
    // The tutorial teaches this rule, so it had better not break it.
    const landsByTurn = new Map()
    for (const beat of TUTORIAL) {
      const lands = beat.you.board.filter((p) => p.id === 'forest').length
      const previous = landsByTurn.get(beat.turn) ?? lands
      landsByTurn.set(beat.turn, Math.max(previous, lands))
    }
    const turns = [...landsByTurn.keys()].sort((a, b) => a - b)
    for (let i = 1; i < turns.length; i++) {
      const growth = landsByTurn.get(turns[i]) - landsByTurn.get(turns[i - 1])
      const turnsElapsed = turns[i] - turns[i - 1]
      expect(growth, `lands grew by ${growth} across ${turnsElapsed} turn(s)`).toBeLessThanOrEqual(turnsElapsed)
    }
  })
})

describe('tutorial rules kept by the script', () => {
  const byId = (board) => board.map((p) => p.id)
  const isLand = (id) => /Land/.test(TUTORIAL_CARDS[id].type_line)
  const manaOf = (board) => board.filter((p) => !p.tapped && !(p.sick && !isLand(p.id)) && TUTORIAL_CARDS[p.id].produced_mana).length

  it('shows a phase for every beat of the game and a known one', () => {
    for (const beat of TUTORIAL) {
      if (beat.turn === 0) continue
      expect(PHASES[beat.phase], `${beat.id} has phase "${beat.phase}"`).toBeTruthy()
    }
  })

  it('asks for each action in the step it belongs to', () => {
    for (const beat of TUTORIAL) {
      if (beat.action.type !== 'click') continue
      const card = TUTORIAL_CARDS[beat.action.cardId]
      const label = beat.action.label
      if (/^Play a/.test(label)) expect(['main1', 'main2'], `${beat.id} plays a land in ${beat.phase}`).toContain(beat.phase)
      if (/^Cast/.test(label) && /Creature/.test(card.type_line)) expect(['main1', 'main2'], `${beat.id} casts a creature in ${beat.phase}`).toContain(beat.phase)
      if (/^Attack/.test(label)) expect(beat.phase, `${beat.id} attacks in ${beat.phase}`).toBe('attack')
      if (/^Block/.test(label)) expect(beat.phase, `${beat.id} blocks in ${beat.phase}`).toBe('block')
      if (/^Block/.test(label)) expect(beat.active, `${beat.id} blocks on your own turn`).toBe('foe')
      if (/^Attack/.test(label)) expect(beat.active, `${beat.id} attacks on their turn`).toBe('you')
    }
  })

  it('says "select" for the gesture and keeps "tap" for the rules action', () => {
    for (const beat of TUTORIAL) {
      if (beat.action.type !== 'click') continue
      expect(beat.action.hint, `${beat.id}: "${beat.action.hint}"`).toMatch(/^Select /)
      expect(beat.action.hint).not.toMatch(/\btap\b/i)
    }
  })

  it('untaps a permanent only in its controller\'s untap step', () => {
    // Between two beats, a permanent of yours may go from tapped to untapped
    // only when your turn number has advanced; theirs only when their turn
    // number has. A beat is "their turn" when active === 'foe'.
    for (let i = 1; i < TUTORIAL.length; i++) {
      const prev = TUTORIAL[i - 1]
      const beat = TUTORIAL[i]
      for (const side of ['you', 'foe']) {
        const before = prev[side].board
        const after = beat[side].board
        const wasTapped = before.filter((p) => p.tapped).length
        const nowTapped = after.filter((p) => p.tapped).length
        const stayed = after.filter((p) => byId(before).includes(p.id)).length
        const untapped = Math.max(0, wasTapped - nowTapped)
        if (!untapped) continue
        const sideTurnBegan = side === 'you'
          ? beat.active === 'you' && (prev.active === 'foe' || beat.turn > prev.turn)
          : beat.active === 'foe' && (prev.active === 'you' || beat.turn > prev.turn)
        const lostCards = stayed < before.length
        expect(sideTurnBegan || lostCards, `${prev.id} → ${beat.id}: ${side} untapped ${untapped} permanent(s) outside an untap step`).toBe(true)
      }
    }
  })

  it('taps enough mana for every spell the player casts, in the beat it arrives', () => {
    for (let i = 1; i < TUTORIAL.length; i++) {
      const prev = TUTORIAL[i - 1]
      const beat = TUTORIAL[i]
      if (prev.action.type !== 'click' || !/^Cast/.test(prev.action.label)) continue
      const card = TUTORIAL_CARDS[prev.action.cardId]
      const cost = parseManaCost(card.mana_cost).length
      const available = manaOf(prev.you.board)
      expect(available, `${prev.id}: ${card.name} costs ${card.mana_cost} with ${available} mana untapped`).toBeGreaterThanOrEqual(cost)
      const newlyTapped = beat.you.board.filter((p) => p.tapped).length - prev.you.board.filter((p) => p.tapped).length
      expect(newlyTapped, `${beat.id}: ${card.name} cost ${cost} but ${newlyTapped} source(s) tapped`).toBeGreaterThanOrEqual(cost)
    }
  })

  it('shows a cast creature as summoning sick in the beat it arrives', () => {
    for (let i = 1; i < TUTORIAL.length; i++) {
      const prev = TUTORIAL[i - 1]
      const beat = TUTORIAL[i]
      if (prev.action.type !== 'click' || !/^Cast/.test(prev.action.label)) continue
      const card = TUTORIAL_CARDS[prev.action.cardId]
      if (!/Creature/.test(card.type_line)) continue
      const arrived = beat.you.board.find((p) => p.id === prev.action.cardId && !prev.you.board.some((q) => q.id === p.id))
      expect(arrived?.sick, `${beat.id}: ${card.name} arrived without summoning sickness`).toBe(true)
    }
  })

  it('never lets a summoning-sick creature attack', () => {
    for (const beat of TUTORIAL) {
      for (const side of ['you', 'foe']) {
        for (const p of beat[side].board) {
          if (p.attacking) expect(p.sick, `${beat.id}: ${p.id} attacks while summoning sick`).toBe(false)
        }
      }
    }
  })

  it('never lets a life total change on a beat where nothing attacked', () => {
    for (let i = 1; i < TUTORIAL.length; i++) {
      const prev = TUTORIAL[i - 1]
      const beat = TUTORIAL[i]
      if (beat.turn - prev.turn > 1) continue // a summary beat that skips turns
      if (beat.you.life !== prev.you.life) expect(prev.foe.board.some((p) => p.attacking), `${beat.id}: your life changed with no attacker`).toBe(true)
      if (beat.foe.life !== prev.foe.life) expect(prev.you.board.some((p) => p.attacking) || beat.you.board.some((p) => p.attacking), `${beat.id}: their life changed with no attacker`).toBe(true)
    }
  })

  it('says what a combat trick buys without mislabelling the trade', () => {
    const titles = TUTORIAL.map((b) => b.title).join('\n')
    expect(titles).not.toMatch(/two-for-one/i)
  })

  it('maps a saved place from the first release to the same moment', () => {
    expect(LEGACY_BEAT_IDS).toHaveLength(27)
    expect(beatIndexFor(0)).toBe(0)
    expect(beatIndexFor(LEGACY_BEAT_IDS.indexOf('t3-stack'))).toBe(TUTORIAL.findIndex((b) => b.id === 't3-stack'))
    expect(beatIndexFor(LEGACY_BEAT_IDS.indexOf('foe-t4-shock'))).toBe(TUTORIAL.findIndex((b) => b.id === 'foe-t3'))
    expect(beatIndexFor('t5-wurm')).toBe(TUTORIAL.findIndex((b) => b.id === 't5-wurm'))
    expect(beatIndexFor('nonsense')).toBe(0)
    expect(beatIndexFor(999)).toBe(0)
    expect(beatIndexFor(null)).toBe(0)
  })

  it('carries a source block on every bundled card', () => {
    for (const card of Object.values(TUTORIAL_CARDS)) {
      expect(card.source).toBeTruthy()
      for (const key of ['oracleId', 'scryfallId', 'set', 'collectorNumber', 'checkedAt']) expect(key in card.source).toBe(true)
    }
  })
})

describe('glossary', () => {
  it('resolves every see-also cross reference', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      for (const related of entry.seeAlso ?? []) {
        expect(GLOSSARY[related], `${key} points at missing term "${related}"`).toBeTruthy()
      }
    }
  })

  it('files every term under exactly one section', () => {
    const filed = GLOSSARY_SECTIONS.flatMap((s) => s.keys)
    expect(new Set(filed).size, 'a term is filed twice').toBe(filed.length)
    for (const key of GLOSSARY_KEYS) {
      expect(filed.includes(key), `"${key}" is not in any section`).toBe(true)
    }
    for (const key of filed) {
      expect(GLOSSARY[key], `section lists unknown term "${key}"`).toBeTruthy()
    }
  })

  it('gives every term a short and a long form', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.term, `${key} has no display name`).toBeTruthy()
      expect(entry.short.length, `${key} short form too short`).toBeGreaterThan(10)
      expect(entry.long.length, `${key} long form too short`).toBeGreaterThan(40)
    }
  })
})
