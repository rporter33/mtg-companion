import { useMemo, useState } from 'react'
import { coachDeck } from '../../lib/coach.js'
import Term from '../../components/Term.jsx'
import './coach.css'

const TONE = { ok: 'ok', warn: 'warn', error: 'error' }

/**
 * Live advice beside the real deck builder, rather than a separate wizard.
 *
 * A wizard is easy to follow once and useless afterwards. This keeps helping on
 * your second and third decks, lets you wander and backtrack, and never blocks
 * you from doing something it disagrees with — the numbers are what most decks
 * do, not rules.
 */
export default function DeckCoach({ deck, lookup, cardCount, onSearch }) {
  const report = useMemo(() => coachDeck(deck, lookup), [deck, cardCount])
  const [openId, setOpenId] = useState(null)

  if (!report) return null

  const { checks, headline, progress } = report
  const passed = checks.filter((c) => c.severity === 'ok').length

  return (
    <section className="coach">
      <div className="coach__head">
        <div className="row">
          <h2 style={{ flex: 1 }}>Deck coach</h2>
          <span className="faint tiny">{passed}/{checks.length}</span>
        </div>
        <div className="meter" style={{ marginTop: 'var(--space-2)' }}>
          <div
            className="meter__fill"
            style={{ width: `${progress * 100}%`, background: progress === 1 ? 'var(--ok)' : 'var(--accent)' }}
          />
        </div>
        <p className="coach__headline">{headline}</p>
      </div>

      <ul className="coach__list">
        {checks.map((item) => {
          const open = openId === item.id
          return (
            <li key={item.id} className={`coach__item coach__item--${TONE[item.severity]}`}>
              <button
                className="coach__row"
                onClick={() => setOpenId(open ? null : item.id)}
                aria-expanded={open}
              >
                <span className={`coach__dot coach__dot--${TONE[item.severity]}`} aria-hidden="true">
                  {item.severity === 'ok' ? '✓' : item.severity === 'warn' ? '!' : '•'}
                </span>
                <span className="coach__label">{item.label}</span>
                <span className="coach__count mono">
                  {item.scored ? (
                    <>
                      {item.have}
                      <span className="faint">/{item.want}</span>
                    </>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </span>
                <span className="coach__chevron faint" aria-hidden="true">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="coach__detail">
                  <p className="coach__message">{item.message}</p>
                  <p className="faint tiny coach__why">{item.why}</p>
                  {item.query && onSearch && (
                    <button className="btn btn--sm" onClick={() => onSearch(item.query)}>
                      Find {item.label.toLowerCase()} to add
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="faint tiny coach__footer">
        These are what most decks do, not rules. A deck that breaks one of them on purpose is
        called a <Term id="curve">deckbuilding decision</Term>; a deck that breaks three by
        accident is usually just slow.
      </p>
    </section>
  )
}
