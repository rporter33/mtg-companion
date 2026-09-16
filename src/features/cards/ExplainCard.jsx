import { explainCard } from '../../lib/explain.js'
import { OracleText } from '../../components/ManaCost.jsx'
import Term from '../../components/Term.jsx'
import { lookupTerm } from '../../data/glossary.js'
import './explain.css'

const KIND_LABEL = {
  triggered: 'Triggered ability',
  activated: 'Activated ability',
  static: 'Static ability',
  keywords: 'Keywords',
  instruction: 'What the spell does',
}

/**
 * Breaks a real card's rules text apart and says what each line is.
 *
 * It reads the templating rather than a list of cards, so it works on every
 * card in Magic — including whatever comes out next week. It explains structure
 * only: what kind of ability a line is, what fires it, whether you get a
 * choice. Not whether the card is good, and not how it interacts with another
 * card, because being subtly wrong about that would be worse than saying
 * nothing.
 */
export default function ExplainCard({ card }) {
  const explanation = explainCard(card)
  if (!explanation) return null

  const { costNote, lines, stats, vanillaNote, typeLine } = explanation

  return (
    <div className="explain stack">
      <p className="explain__intro">
        Every card is built the same way. Here is this one, a piece at a time.
      </p>

      {costNote && (
        <div className="explain__row">
          <span className="explain__label">Cost</span>
          <div>
            <p className="explain__text">{costNote}</p>
            <p className="faint tiny explain__note">
              The number is <Term id="manaValue">mana value</Term> — how much it costs in
              total, which is what people mean by a &ldquo;three-drop&rdquo;.
            </p>
          </div>
        </div>
      )}

      <div className="explain__row">
        <span className="explain__label">Type</span>
        <div>
          <p className="explain__text mono">{typeLine}</p>
          <p className="faint tiny explain__note">{describeType(typeLine)}</p>
        </div>
      </div>

      {vanillaNote && (
        <div className="explain__row">
          <span className="explain__label">Text</span>
          <p className="explain__text muted">{vanillaNote}</p>
        </div>
      )}

      {lines.map((line, i) => (
        <div className={`explain__line explain__line--${line.kind}`} key={i}>
          <div className="row row--wrap explain__kinds">
            <span className={`chip tiny chip--${line.kind}`}>{KIND_LABEL[line.kind] ?? line.kind}</span>
            {line.optional && <span className="chip tiny chip--ok">optional</span>}
            {line.optional === false && line.kind === 'triggered' && (
              <span className="chip tiny chip--warn">not optional</span>
            )}
            {line.reflexive && <span className="chip tiny chip--warn">reflexive trigger</span>}
          </div>

          <div className="explain__quote">
            <OracleText text={line.text} />
          </div>

          {line.abilityWordNote && (
            <p className="explain__ability-word">{line.abilityWordNote}</p>
          )}

          {line.condition && line.effect && (
            <div className="explain__split">
              <div>
                <span className="explain__label">What sets it off</span>
                <p className="explain__text">{line.condition}</p>
              </div>
              <div>
                <span className="explain__label">What happens</span>
                <p className="explain__text">{line.effect}</p>
              </div>
            </div>
          )}

          {line.cost && line.effect && line.kind === 'activated' && (
            <div className="explain__split">
              <div>
                <span className="explain__label">What you pay</span>
                <p className="explain__text mono">{line.cost}</p>
              </div>
              <div>
                <span className="explain__label">What you get</span>
                <p className="explain__text">{line.effect}</p>
              </div>
            </div>
          )}

          <p className="explain__text muted">{line.explanation}</p>

          {line.terms.length > 0 && (
            <div className="row row--wrap">
              <span className="faint tiny">Read more</span>
              {line.terms.map((id) => (
                lookupTerm(id) ? <Term key={id} id={id} as="span" /> : null
              ))}
            </div>
          )}
        </div>
      ))}

      {stats && (
        <div className="explain__row">
          <span className="explain__label">Numbers</span>
          <p className="explain__text">{stats}</p>
        </div>
      )}

      <p className="faint tiny">
        This explains how the card is <em>built</em> — what kind of ability each line is and
        what sets it off. It deliberately does not judge whether the card is good, or how it
        behaves alongside another card.
      </p>
    </div>
  )
}

function describeType(typeLine) {
  if (/\bLand\b/.test(typeLine)) return 'A land. Play one per turn; it makes mana rather than costing it.'
  if (/\bInstant\b/.test(typeLine)) return 'An instant — you may cast it almost any time, including on your opponent’s turn.'
  if (/\bSorcery\b/.test(typeLine)) return 'A sorcery — only on your own turn, in a main phase, with nothing else waiting to resolve.'
  if (/\bPlaneswalker\b/.test(typeLine)) return 'A planeswalker. It sticks around, and you use one of its abilities each of your turns.'
  if (/\bCreature\b/.test(typeLine)) return 'A creature. It can attack and block, but not attack the turn it arrives unless it has haste.'
  if (/\bEnchantment\b/.test(typeLine)) return 'An enchantment. It stays on the battlefield and keeps doing what it says.'
  if (/\bArtifact\b/.test(typeLine)) return 'An artifact. Colourless, so it fits in any deck.'
  if (/\bBattle\b/.test(typeLine)) return 'A battle. It enters with counters and must be attacked to be dealt with.'
  return 'Everything before the dash is what it is; everything after is flavour and tribal types.'
}
