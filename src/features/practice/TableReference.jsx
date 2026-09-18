import { STEPS, STEP_LABELS } from '../../lib/table/model.js'
import { lookupTerm } from '../../data/glossary.js'
import { navigate } from '../../lib/router.js'
import Term from '../../components/Term.jsx'

/**
 * A turn and the zones, on one screen, to keep open beside a real game.
 * Each step gets one line on what happens and whether anyone gets priority.
 * It is a reference, not a judge: what it does not mention, it does not
 * rule on.
 */
const STEP_NOTES = {
  untap: 'Your permanents untap. Nobody gets priority.',
  upkeep: 'Upkeep triggers happen. Priority: you first.',
  draw: 'Draw a card (the first player skips this on turn one). Priority.',
  main1: 'Play a land, cast creatures and sorceries with the stack empty. Priority.',
  beginCombat: 'Last chance to act before attackers. Priority.',
  declareAttackers: 'Choose attackers; they tap. Then priority.',
  declareBlockers: 'The defender chooses blocks; blocking does not tap. Then priority, before damage.',
  combatDamage: 'All combat damage at once. Lethal damage kills before anyone gets priority.',
  endCombat: 'Creatures leave combat. Priority.',
  main2: 'A second main phase, same as the first. Priority.',
  end: '"At the beginning of your end step" triggers. Priority.',
  cleanup: 'Discard to seven, damage is removed, "until end of turn" ends. No priority unless something triggers.',
}
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack', 'commandZone']

export default function TableReference() {
  return (
    <div className="stack reference">
      <button className="btn btn--ghost btn--sm self-start" onClick={() => navigate({ scenarioId: null })}>← Practice</button>
      <div>
        <h1>Table reference</h1>
        <p className="muted">A turn and the zones, to keep open beside a real game. Words with dotted underlines open the glossary.</p>
      </div>
      <section className="panel">
        <h2 className="m0">A turn</h2>
        <ol className="reference__steps">
          {STEPS.map((step) => (
            <li key={step}>
              <strong>{STEP_LABELS[step]}</strong>
              <span className="muted tiny"> {STEP_NOTES[step]}</span>
            </li>
          ))}
        </ol>
        <p className="tiny muted m0">
          Both players passing in succession with the stack empty ends the step; with something on the stack it resolves the top object, and priority goes round again.
        </p>
      </section>
      <section className="panel">
        <h2 className="m0">Zones</h2>
        <ul className="reference__zones">
          {ZONES.map((key) => {
            const entry = lookupTerm(key)
            return <li key={key}><Term id={key} as="span"><strong>{entry.term}</strong></Term> <span className="muted tiny">{entry.short}</span></li>
          })}
        </ul>
      </section>
      <p className="faint tiny m0">
        A reference, not a judge. For a rule this page does not mention, the official rules are the answer, not this app.
      </p>
    </div>
  )
}
