/**
 * Presentation from events. The model emits what happened; this turns it
 * into two things the screen can use without touching a rule: a sentence
 * for the live region and the journal, and a short cue that a card or
 * control can animate for a moment. With motion reduced the cues are not
 * applied and the sentences carry everything, so the final state and the
 * information shown are the same either way.
 */
import { cardOf } from './model.js'
import { STEP_LABELS } from './model.js'

const COLOUR = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' }
const who = (player, cap = false) => (player === 'you' ? (cap ? 'You' : 'you') : (cap ? 'Your opponent' : 'your opponent'))
const name = (state, id) => (state.cards[id] ? cardOf(state.cards[id]).name : id === 'you' ? 'you' : id === 'foe' ? 'your opponent' : String(id))

/** One sentence per event, or null for events not worth a sentence. */
export function narrate(event, state) {
  switch (event.type) {
    case 'landPlayed': return `${who(event.player, true)} played ${name(state, event.instanceId)}.`
    case 'manaProduced': return `${name(state, event.instanceId)} tapped for ${COLOUR[event.colour]}.`
    case 'manaSpent': {
      const parts = Object.entries(event.spent).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${COLOUR[k]}`)
      return `${who(event.player, true)} paid ${parts.join(' and ')}.`
    }
    case 'spellCast': {
      const t = event.targets?.[0]
      return `${who(event.player, true)} cast ${name(state, event.instanceId)}${t ? `, targeting ${name(state, t.id)}` : ''}. It is on the stack.`
    }
    case 'passed': return `${who(event.player, true)} passed priority.`
    case 'spellResolved': return `${name(state, event.instanceId)} resolved.`
    case 'spellFizzled': return `${name(state, event.instanceId)} did not resolve: its target was gone.`
    case 'permanentEntered': return `${name(state, event.instanceId)} is on the battlefield${state.cards[event.instanceId]?.sick ? ', summoning sick' : ''}.`
    case 'pumped': return `${name(state, event.instanceId)} gets +${event.power}/+${event.toughness} until end of turn.`
    case 'damageDealt': return `${name(state, event.source)} dealt ${event.amount} damage to ${name(state, event.target)}.`
    case 'creatureDied': return `${name(state, event.instanceId)} died${event.why === 'damage' ? ' of lethal damage' : ''}.`
    case 'poolEmptied': return `${who(event.player, true)} lost ${event.amount} unspent mana as the step ended.`
    case 'stepBegan': return event.step === 'untap' ? null : `${STEP_LABELS[event.step]}${event.step === 'draw' || event.step === 'upkeep' ? '' : ' begins'}.`
    case 'turnBegan': return `${who(event.active, true)} begin${event.active === 'you' ? '' : 's'} turn ${event.ordinal}.`
    case 'untapped': return `${name(state, event.instanceId)} untapped.`
    case 'drew': return event.player === 'you' ? `You drew ${name(state, event.instanceId)}.` : 'Your opponent drew a card.'
    case 'drewFromEmpty': return `${who(event.player, true)} had to draw from an empty library.`
    case 'damageRemoved': return `${name(state, event.instanceId)}'s damage was removed.`
    case 'effectsEnded': return `${name(state, event.instanceId)} is back to its printed size.`
    case 'attackersDeclared': return event.attackers.length ? `${who(event.player, true)} attack${event.player === 'you' ? '' : 's'} with ${event.attackers.map((id) => name(state, id)).join(', ')}.` : `${who(event.player, true)} declared no attackers.`
    case 'blockersDeclared': {
      const pairs = Object.entries(event.blocks)
      return pairs.length ? pairs.map(([b, a]) => `${name(state, b)} blocks ${name(state, a)}`).join('; ') + '.' : `${who(event.player, true)} declared no blockers.`
    }
    case 'discarded': return `${who(event.player, true)} discarded ${name(state, event.instanceId)}.`
    case 'gameOver': return event.winner ? `${who(event.winner, true)} won.` : 'The game is a draw.'
    case 'mulliganed': return `${who(event.player, true)} took a mulligan (${event.count}).`
    case 'kept': return `${who(event.player, true)} kept ${event.size}${event.bottomed ? `, putting ${event.bottomed} on the bottom` : ''}.`
    case 'explained': return event.correct ? 'You answered the question correctly.' : 'You answered the question; not that one.'
    case 'predicted': return event.correct ? 'Your prediction was right.' : 'Your prediction was wrong.'
    default: return null
  }
}

/** Every sentence for a batch of events, in order, skipping the silent ones. */
export function narrateAll(events, state) {
  return events.map((e) => narrate(e, state)).filter(Boolean)
}

/**
 * Short cues for the screen: which card or control to mark for a moment.
 * The screen applies a class for the cue's duration and nothing more; the
 * cue carries no rule and no state.
 */
export function cuesFrom(events) {
  const cues = []
  for (const e of events) {
    switch (e.type) {
      case 'manaProduced': cues.push({ kind: 'tap', id: e.instanceId, seq: e.seq }); break
      case 'spellCast': cues.push({ kind: 'toStack', id: e.instanceId, seq: e.seq }); break
      case 'permanentEntered': cues.push({ kind: 'enter', id: e.instanceId, seq: e.seq }); break
      case 'landPlayed': cues.push({ kind: 'enter', id: e.instanceId, seq: e.seq }); break
      case 'damageDealt': cues.push({ kind: 'hit', id: e.target, seq: e.seq }); break
      case 'creatureDied': cues.push({ kind: 'leave', id: e.instanceId, seq: e.seq }); break
      case 'pumped': cues.push({ kind: 'grow', id: e.instanceId, seq: e.seq }); break
      case 'untapped': cues.push({ kind: 'untap', id: e.instanceId, seq: e.seq }); break
      case 'spellResolved': cues.push({ kind: 'resolve', id: e.instanceId, seq: e.seq }); break
      default: break
    }
  }
  return cues
}

/** How long a cue is shown, in milliseconds. Ordinary transitions in this app run 150–350ms. */
export const CUE_MS = 320

/** Whether motion should be reduced: the system setting or the app's own preference. */
export function prefersReducedMotion(pref = null) {
  if (pref === true || pref === false) return pref
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
