import { useState } from 'react'
import { listDecks, saveDeck } from '../../lib/storage.js'
import { addCard, setCommanders, validateDeck, NOT_OUT_CODES } from '../../lib/deck.js'
import { getFormat, canBeCommander, legalityStatus } from '../../lib/formats.js'
import { pinCards } from '../../lib/cache.js'
import NotOutChip from '../../components/NotOutChip.jsx'

/**
 * Adds a card to a deck from anywhere in the app, and says up front whether it
 * is actually legal there — telling someone *after* they have built 90 cards is
 * too late to be useful.
 */
export default function AddToDeck({ card }) {
  const [decks, setDecks] = useState(() => listDecks())
  const [message, setMessage] = useState(null)

  // Whether the card is out goes first, beside the card and before any deck
  // is chosen, so nobody finds out after adding it. It only informs: adding
  // is never held back by it.
  if (!decks.length) {
    return (
      <div className="stack stack--snug">
        <NotOutChip card={card} />
        <p className="faint tiny">Create a deck to start adding cards to it.</p>
      </div>
    )
  }

  const add = (deck, asCommander = false) => {
    const next = asCommander
      ? setCommanders(deck, [...deck.commanders, card.id])
      : addCard(deck, card.id, 1)
    saveDeck(next)
    pinCards([card.id])
    setDecks(listDecks())

    const result = validateDeck(next, new Map([[card.id, card]]))
    const about = (v) => (v.cardIds ?? [v.cardId]).includes(card.id)
    const problem = result.violations.find((v) => v.severity === 'error' && about(v))
    const notOut = result.violations.find((v) => NOT_OUT_CODES.has(v.code) && about(v))
    setMessage(problem
      ? { tone: 'warn', text: `Added to ${deck.name}, but ${problem.message.replace(/^.*?: /, '')}` }
      : notOut
        ? { tone: 'warn', text: `Added to ${deck.name}. ${notOut.message}` }
        : { tone: 'ok', text: `Added to ${deck.name}.` })
  }

  return (
    <div className="stack stack--snug">
      <NotOutChip card={card} />
      <span className="faint tiny">Add to a deck</span>
      {decks.map((deck) => {
        const format = getFormat(deck.formatId)
        const status = legalityStatus(card, format)
        const blocked = status === 'banned' || status === 'not_legal'
        // Not out yet is not illegal: Scryfall has not ruled on the card in
        // this format, so the row says that and nothing more.
        const notOut = status === 'future_legal' || status === 'pending'
        const commanderOk = format.commander?.required && canBeCommander(card, format).ok

        return (
          <div className="row stack--tight" key={deck.id}>
            <button
              className="btn btn--sm"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => add(deck)}
              title={blocked ? `${card.name} is not legal in ${format.name}`
                : status === 'future_legal' ? `Not out yet. Scryfall's Future Standard lists ${card.name}.`
                  : notOut ? `Not out yet. Scryfall sets its ${format.name} legality at release.`
                    : undefined}
            >
              {deck.name}
              <span className="faint tiny" style={{ marginLeft: 6 }}>{format.name}</span>
              {blocked && <span className="chip chip--error tiny ml-auto">illegal</span>}
              {notOut && <NotOutChip card={card} short className="tiny ml-auto" />}
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
