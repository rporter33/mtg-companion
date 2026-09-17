import { useCallback, useMemo, useRef, useState } from 'react'
import { setQuantity, removeCard, setCommanders } from '../../../lib/deck.js'
import {
  setCategory, renameCategory, clearCategory, moveCategory, categoryNames, COMMANDER_CATEGORY,
} from '../../../lib/categories.js'
import { getPrefs, setPref } from '../../../lib/storage.js'
import { formatPrice } from '../../../lib/prices.js'
import { ownedOf } from '../../../lib/collection.js'
import { artUrl } from '../../../lib/deck-art.js'
import DeckRow from './DeckRow.jsx'
import DeckTile from './DeckTile.jsx'
import TextRow from './TextRow.jsx'
import DeckPreview from './DeckPreview.jsx'
import SectionMenu from './SectionMenu.jsx'

/**
 * The deck as a list, a grid or text, with the sections shared by all three.
 *
 * Split out of the editor once it passed seven hundred lines: the editor
 * owns the header, tabs and the commit path; this file owns how a deck is
 * read and edited in place, and the row components beside it own one card
 * each. The row contract is the same for every view: a card, its entry,
 * the deck's market, what is owned, and the one stable `act` dispatcher.
 */
export default function DeckList({ deck, groups, format, market, lookup, collection, onChange, onOpenCard, validation, art = false, artSwitch = null }) {
  const problemIds = new Set(
    validation.violations.filter((v) => v.severity === 'error' && v.cardId).map((v) => v.cardId),
  )

  // Once per render. This used to be computed inside the row loop — a hundred
  // full scans of the deck on every render, and a quantity tap re-renders the
  // list — which the profiler put at 145 ms a tap on a throttled phone.
  const sections = useMemo(() => categoryNames(deck, lookup), [deck, lookup])

  // One stable handler for every row, reading the latest deck and onChange
  // through refs. Rows are memoised below; an inline arrow per row would be a
  // new function each render and defeat that, so a tap would still re-render
  // all hundred rows instead of the one it touched.
  const latest = useRef({ deck, onChange })
  latest.current = { deck, onChange }
  const act = useCallback((kind, cardId, zone, arg) => {
    const { deck: d, onChange: change } = latest.current
    if (kind === 'set') change(setQuantity(d, cardId, arg, zone))
    else if (kind === 'category') change(setCategory(d, cardId, arg))
    else if (kind === 'remove') {
      change(arg
        ? setCommanders(d, d.commanders.filter((id) => id !== cardId))
        : removeCard(d, cardId, zone))
    }
  }, [])

  // Three ways to read the same deck. The list is faster to edit and survives
  // a narrow screen; the grid is how a deck is actually recognised, because
  // players know their cards by art long before they read the name; the text
  // view is the whole deck on one screen, sections flowing into columns, with
  // the card under the pointer shown large beside it.
  const [view, setView] = useState(() => {
    const saved = getPrefs().deckView
    return VIEWS.some(([id]) => id === saved) ? saved : 'list'
  })
  const chooseView = (next) => { setView(next); setPref('deckView', next) }

  // The card the text view is showing large. It stays on the last card the
  // pointer or focus touched rather than emptying when it leaves, so the
  // panel is something to read, not something to chase.
  const [previewId, setPreviewId] = useState(null)
  const onPreview = useCallback((cardId) => setPreviewId(cardId), [])
  const previewCard = previewId ? lookup(previewId) ?? null : null

  if (!groups.length) {
    return (
      <div className="empty">
        <h3>Empty deck</h3>
        <p>Use <strong>Add cards</strong> to search and build.</p>
      </div>
    )
  }

  const rowsClass = { grid: 'deck-grid', text: 'text-rows', list: 'deck-rows' }[view]
  const sectionsMarkup = groups.map(({ name, entries, count, price, chosen }) => (
        <section key={name} className={view === 'text' ? 'text-section' : ''}>
          <div className="section-title">
            <h2>{name}</h2>
            <span className="faint">{count}</span>
            <span className="spacer" />
            <span className="faint tiny">{formatPrice(price.total, market)}</span>
            {name !== COMMANDER_CATEGORY && name !== 'Sideboard' && (
              <SectionMenu
                name={name}
                chosen={chosen}
                onRename={(to) => onChange(renameCategory(
                  deck, name, to, entries.map((e) => e.cardId),
                ))}
                onMove={(delta) => onChange(moveCategory(
                  deck, name, delta, groups.map((g) => g.name),
                ))}
                onDissolve={() => onChange(clearCategory(deck, name))}
              />
            )}
          </div>
          <div className={rowsClass}>
            {entries.map(({ cardId, quantity, card, zone, isCommander }) => {
              const key = `${zone}:${cardId}`
              if (view === 'grid') {
                return (
                  <DeckTile
                    key={key}
                    card={card}
                    art={art ? artUrl(card) : null}
                    cardId={cardId}
                    quantity={quantity}
                    zone={zone}
                    market={market}
                    owned={ownedOf(collection, card)}
                    isCommander={isCommander}
                    flagged={problemIds.has(cardId)}
                    act={act}
                    onOpenCard={onOpenCard}
                  />
                )
              }
              if (view === 'text') {
                return (
                  <TextRow
                    key={key}
                    card={card}
                    cardId={cardId}
                    quantity={quantity}
                    zone={zone}
                    isCommander={isCommander}
                    flagged={problemIds.has(cardId)}
                    previewed={previewId === cardId}
                    act={act}
                    onPreview={onPreview}
                    onOpenCard={onOpenCard}
                  />
                )
              }
              return (
                <DeckRow
                  key={key}
                  card={card}
                  art={art ? artUrl(card) : null}
                  market={market}
                  owned={ownedOf(collection, card)}
                  section={name}
                  sections={sections}
                  cardId={cardId}
                  quantity={quantity}
                  zone={zone}
                  isCommander={isCommander}
                  flagged={problemIds.has(cardId)}
                  act={act}
                  onOpenCard={onOpenCard}
                />
              )
            })}
          </div>
        </section>
  ))

  return (
    <div className="stack">
      <div className="row">
        <span className="spacer" />
        <div className="row" role="group" aria-label="How to show the deck">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              className={`chip ${view === id ? 'chip--active' : ''}`}
              aria-pressed={view === id}
              onClick={() => chooseView(id)}
            >
              {label}
            </button>
          ))}
          {artSwitch && view !== 'text' && (
            <button
              className={`chip ${art ? 'chip--active' : ''}`}
              aria-pressed={art}
              title="Show each card's painting behind its row or tile"
              onClick={artSwitch}
            >
              Art
            </button>
          )}
        </div>
      </div>

      {view === 'text' ? (
        <div className="deck-text-layout">
          <DeckPreview
            card={previewCard}
            market={market}
            owned={previewCard ? ownedOf(collection, previewCard) : 0}
            onOpenCard={onOpenCard}
          />
          <div className="deck-text">{sectionsMarkup}</div>
        </div>
      ) : sectionsMarkup}
    </div>
  )
}

const VIEWS = [['list', 'List'], ['grid', 'Grid'], ['text', 'Text']]
