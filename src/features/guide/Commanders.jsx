import { useEffect, useState } from 'react'
import { getSets, searchCards } from '../../lib/scryfall.js'
import { findSeason } from '../../lib/season.js'
import { EXAMPLE_DECKS, exampleDecksFor, exampleSize, unverifiedIn } from '../../data/example-decks.js'
import CardImage from '../../components/CardImage.jsx'
import './commanders.css'

/**
 * The commanders from the newest sets, so a beginner has somewhere to start.
 *
 * Which sets those are comes from the same season engine that drives the
 * banner, and the commanders themselves come from a Scryfall query, so this
 * works for sets that do not exist yet and needs no maintenance.
 */
export default function Commanders({ onOpenCard, onBuild }) {
  const [sets, setSets] = useState(null)
  const [active, setActive] = useState(null)
  const [cards, setCards] = useState([])
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    getSets({ signal: controller.signal })
      .then((all) => {
        if (cancelled) return
        const season = findSeason(all)
        // Both the set that is coming and the one people are playing now: one
        // is exciting, the other is what is actually on the shelf.
        const options = [season.next, season.current].filter(Boolean)
        setSets(options)
        setActive(options[0]?.code ?? null)
      })
      .catch(() => { if (!cancelled) setSets([]) })
    return () => { cancelled = true; controller.abort() }
  }, [])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const controller = new AbortController()
    setStatus('loading')
    // is:commander is Scryfall's own test for "this can lead a deck", so it
    // handles the odd cases — planeswalkers that say they can, partners — for us.
    searchCards(`set:${active} is:commander`, { order: 'name', signal: controller.signal })
      .then((result) => {
        if (cancelled) return
        setCards(result.cards)
        setStatus('done')
      })
      .catch(() => { if (!cancelled) { setCards([]); setStatus('error') } })
    return () => { cancelled = true; controller.abort() }
  }, [active])

  if (!sets?.length) return null

  return (
    <section className="stack">
      <div className="section-title"><h2>Commanders to start from</h2></div>
      <p className="muted tiny" style={{ marginTop: -4 }}>
        A Commander deck is built around one legendary creature. These are the ones from the
        newest sets — pick one you like the look of and the deck builder will keep you inside
        its colours.
      </p>

      {sets.length > 1 && (
        <div className="row row--wrap">
          {sets.map((set) => (
            <button
              key={set.code}
              className={`chip ${active === set.code ? 'chip--active' : ''}`}
              onClick={() => setActive(set.code)}
            >
              {set.name}
            </button>
          ))}
        </div>
      )}

      {status === 'loading' && <p className="faint">Looking up commanders…</p>}
      {status === 'error' && (
        <p className="faint tiny">
          Commanders need a connection. Everything else on this page works offline.
        </p>
      )}

      {cards.length > 0 && (
        <div className="commander-grid">
          {cards.map((card) => {
            const examples = exampleDecksFor(card.name)
            return (
              <div className="commander" key={card.id}>
                <CardImage card={card} size="normal" onClick={() => onOpenCard(card)} />
                <div className="commander__foot">
                  <span className="commander__name">{card.name}</span>
                  {examples.length > 0 ? (
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => onBuild?.(examples[0])}
                    >
                      See a deck ({exampleSize(examples[0])})
                    </button>
                  ) : (
                    <button className="btn btn--sm" onClick={() => onBuild?.(null, card)}>
                      Build with this
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {EXAMPLE_DECKS.length === 0 && cards.length > 0 && (
        <p className="faint tiny">
          No example decklists are shipped yet. Real lists cannot be read from deck sites
          automatically, so they are added by hand — paste one into a deck&rsquo;s
          Import&nbsp;/&nbsp;export tab and use &ldquo;Copy as example&rdquo;.
        </p>
      )}

      {/*
        The examples above only appear when a shipped deck happens to share a
        commander with the set being browsed, which for most sets is none of
        them. Without this list the decks exist and cannot be reached.
      */}
      {EXAMPLE_DECKS.length > 0 && (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <div className="section-title"><h3>Example decks</h3></div>
          <p className="muted tiny" style={{ marginTop: -4 }}>
            Complete lists, exactly as they were built. Open one to read every card, see what
            the deck is trying to do, and change anything you disagree with — nothing here is
            precious.
          </p>
          <div className="row row--wrap">
            {EXAMPLE_DECKS.map((example) => {
              const unresolved = unverifiedIn(example).length
              return (
                <button
                  key={example.id}
                  className="chip"
                  onClick={() => onBuild?.(example)}
                  // Saying so up front beats the importer reporting it as a
                  // surprise: the reader knows before opening that some lines
                  // will not match, and that it is the list's fault not theirs.
                  title={example.note || undefined}
                >
                  {example.name}
                  <span className="faint">&nbsp;({exampleSize(example)})</span>
                  {unresolved > 0 && (
                    <span className="faint">&nbsp;· {unresolved} won&rsquo;t match</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
