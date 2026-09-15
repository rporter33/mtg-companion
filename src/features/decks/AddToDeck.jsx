import { useState } from 'react'
import { listDecks, saveDeck } from '../../lib/storage.js'
import { addCard, setCommanders, validateDeck } from '../../lib/deck.js'
import { getFormat, canBeCommander, cardLegality } from '../../lib/formats.js'
import { pinCards } from '../../lib/cache.js'

/**
 * Adds a card to a deck from anywhere in the app, and says up front whether it
 * is actually legal there — telling someone *after* they have built 90 cards is
 * too late to be useful.
 */
export default function AddToDeck({ card }) {
  const [decks, setDecks] = useState(() => listDecks())
  const [message, setMessage] = useState(null)

  if (!decks.length) {
    return <p className="faint tiny">Create a deck to start adding cards to it.</p>
  }

  const add = (deck, asCommander = false) => {
    const next = asCommander
      ? setCommanders(deck, [...deck.commanders, card.id])
      : addCard(deck, card.id, 1)
    saveDeck(next)
    pinCards([card.id])
    setDecks(listDecks())

    const result = validateDeck(next, new Map([[card.id, card]]))
    const problem = result.violations.find((v) => v.severity === 'error' && v.cardId === card.id)
    setMessage(problem
      ? { tone: 'warn', text: `Added to ${deck.name}, but ${problem.message.replace(/^.*?: /, '')}` }
      : { tone: 'ok', text: `Added to ${deck.name}.` })
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <span className="faint tiny">Add to a deck</span>
      {decks.map((deck) => {
        const format = getFormat(deck.formatId)
        const status = cardLegality(card, format)
        const blocked = status === 'banned' || status === 'not_legal'
        const commanderOk = format.commander?.required && canBeCommander(card, format).ok

        return (
          <div className="row" key={deck.id} style={{ gap: 'var(--space-1)' }}>
            <button
              className="btn btn--sm"
              style={{ flex: 1, justifyContent: 'flex-start' }}
              onClick={() => add(deck)}
              title={blocked ? `${card.name} is not legal in ${format.name}` : undefined}
            >
              {deck.name}
              <span className="faint tiny" style={{ marginLeft: 6 }}>{format.name}</span>
              {blocked && <span className="chip chip--error tiny" style={{ marginLeft: 'auto' }}>illegal</span>}
            </button>
            {commanderOk && (
              <button className="btn btn--sm" onClick={() => add(deck, true)} title="Set as commander">
                ★
              </button>
            )}
          </div>
        )
      })}
      {message && (
        <div className={`banner banner--${message.tone === 'ok' ? 'info' : 'warn'} tiny`}>
          {message.text}
        </div>
      )}
    </div>
  )
}
