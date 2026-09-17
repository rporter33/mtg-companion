import Chip from '../../../components/Chip.jsx'
import SectionHeader from '../../../components/SectionHeader.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setQuantity, removeCard, setCommanders, unionColorIdentity } from '../../../lib/deck.js'
import {
  setCategory, renameCategory, clearCategory, moveCategory, categoryNames, COMMANDER_CATEGORY,
} from '../../../lib/categories.js'
import { getPrefs, setPref } from '../../../lib/storage.js'
import { formatPrice } from '../../../lib/prices.js'
import { ownedOf, keyOf } from '../../../lib/collection.js'
import { artUrl } from '../../../lib/deck-art.js'
import DeckRow from './DeckRow.jsx'
import DeckTile from './DeckTile.jsx'
import TextRow from './TextRow.jsx'
import DeckPreview from './DeckPreview.jsx'
import SectionMenu from './SectionMenu.jsx'
import DeckFind from './DeckFind.jsx'
import SectionButtons from './SectionButtons.jsx'
import { termsOf, matches, filterSections, statusLine } from '../../../lib/deck-find.js'
import { openSectionFor, withOpenSection, openAfterRename, resolveOpen, toggledOpen } from '../../../lib/folds.js'

/**
 * The deck as a list, a grid or text, with the sections shared by all three.
 *
 * Split out of the editor once it passed seven hundred lines: the editor
 * owns the header, tabs and the commit path; this file owns how a deck is
 * read and edited in place, and the row components beside it own one card
 * each. The row contract is the same for every view: a card, its entry,
 * the deck's market, what is owned, and the one stable `act` dispatcher.
 */
export default function DeckList({
  deck, groups, format, market, lookup, collection, onChange, onOpenCard, validation,
  art = false, artSwitch = null, onFindElsewhere = null, needed = null, loading = false, arrived = NONE,
}) {
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

  // Finding a card, and narrowing to what is still to buy. Both are state
  // here and nowhere else: this component unmounts when another tab opens
  // and is keyed by deck, so a deck never comes back silently filtered to
  // three cards. The filter runs over the groups the editor already built
  // and hands back the same array when idle, so the memoised rows see
  // identical props and a keystroke costs a walk over a hundred strings,
  // not a hundred re-renders.
  const [query, setQuery] = useState('')
  const [needOnly, setNeedOnly] = useState(false)
  const findRef = useRef(null)
  const listRef = useRef(null)
  const terms = useMemo(() => termsOf(query), [query])
  // "Not owned" follows the deck-wide need the header chip already reports
  // (copies wanted across every zone against copies owned), so the same card
  // in the main deck and the sideboard is judged once, not once per row.
  const keep = useMemo(() => {
    if (!terms.length && !needOnly) return null
    return (entry) => (!terms.length || matches(entry.card, terms))
      && (!needOnly || (needed?.has(keyOf(entry.card)) ?? false))
  }, [terms, needOnly, needed])
  const found = useMemo(() => filterSections(groups, keep), [groups, keep])
  const clearFind = () => { setQuery(''); findRef.current?.focus() }

  // The hairline under the bar: the commander's identity where there is one,
  // otherwise the colours of whatever is in the deck.
  const identity = useMemo(() => (validation.colorIdentity?.length
    ? validation.colorIdentity
    : unionColorIdentity(groups.flatMap((g) => g.entries.map((e) => e.card)))),
  [validation.colorIdentity, groups])

  // "/" focuses the box while focus is anywhere in the list — a row, a
  // chip, or the list itself, which takes focus on a click so the key works
  // after clicking a blank spot. It is not a page-wide shortcut: a
  // single-key shortcut that fires from anywhere cannot be turned off, and
  // people who type by voice or with a tremor hit keys they did not mean.
  const onListKey = (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    event.preventDefault()
    findRef.current?.focus()
  }

  // Enter lands on the first match, which on a phone also puts the keyboard
  // away; with nothing matched it lands on the way out of the empty state.
  const focusFirstMatch = () => {
    const first = listRef.current?.querySelector(
      'button.deck-row__name, button.text-row__name, .deck-grid button, .deck-find__empty button',
    )
    first?.focus()
    if (document.activeElement !== first) findRef.current?.blur()
  }

  // What a screen reader hears as the filter changes. The chip-only case has
  // its own wording, because "No cards match" when nothing was typed sounds
  // like a failed search rather than the good news it is.
  const status = !found.active ? ''
    : terms.length ? statusLine(found)
      : found.matched === 0 ? 'You own every card in this deck'
        : `${found.matched} of ${found.total} cards still needed`

  // The cascade. One section open at a time, or all of them when nothing
  // is chosen; remembered per deck in prefs, never on the deck document,
  // because folding a section is not an edit. A remembered section that no
  // longer exists means everything open, not a blank screen. Commander is
  // never part of it: the commander stays above the cascade in every state.
  const [openName, setOpenName] = useState(() => openSectionFor(getPrefs(), deck.id))
  const names = useMemo(() => groups.map((g) => g.name).filter((n) => n !== COMMANDER_CATEGORY), [groups])
  const open = resolveOpen(openName, names)
  const snapTo = useRef(null)
  const chooseOpen = (name, { snap = true } = {}) => {
    setOpenName(name)
    setPref('deckOpen', withOpenSection(getPrefs(), deck.id, name))
    if (snap && name) snapTo.current = name
  }
  const pickSection = (name) => chooseOpen(toggledOpen(open, name))
  const sectionEl = (name) => listRef.current?.querySelector(`section[data-section="${CSS.escape(name)}"]`)
  const jumpTo = (name) => sectionEl(name)?.scrollIntoView({ block: 'start' })
  // After a tap the opened section lands under the bar, where the thumb is.
  useEffect(() => {
    if (!snapTo.current) return
    const name = snapTo.current
    snapTo.current = null
    sectionEl(name)?.scrollIntoView({ block: 'start' })
  })

  // A card added from another tab, or from the card sheet, arrives into a
  // section that may be folded: that section opens and the row is marked
  // for a moment, so the person always sees where it landed. Cards that
  // arrive into several sections at once — a restore, an import — open
  // everything instead, because hiding most of what just came back would
  // be the wrong answer to "what changed".
  const [marked, setMarked] = useState(NONE)
  useEffect(() => {
    if (!arrived.length) return undefined
    const homes = groups
      .filter((g) => g.name !== COMMANDER_CATEGORY && g.entries.some((e) => arrived.includes(e.cardId)))
      .map((g) => g.name)
    if (homes.length === 1 && names.includes(homes[0])) chooseOpen(homes[0])
    else if (homes.length > 1) chooseOpen(null, { snap: false })
    setMarked(arrived)
    const timer = setTimeout(() => setMarked(NONE), 2400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived])

  // What the list shows: everything the search matched; else the one open
  // section with the commander above it; else the whole deck.
  const visible = found.active ? found.sections
    : open ? groups.filter((g) => g.name === COMMANDER_CATEGORY || g.name === open)
      : groups

  // What each button says. Counts follow the search; the dot and the number
  // are the section's problems and cards still to buy, so a fold never hides
  // either. Held back until the cards have loaded, because until then every
  // card files under "Other" and the row would reshuffle a moment later.
  const buttons = useMemo(() => {
    if (loading) return null
    const shownBy = new Map(found.sections.map((g) => [g.name, g.shownCount ?? g.count]))
    return groups.filter((g) => g.name !== COMMANDER_CATEGORY).map((g) => ({
      name: g.name,
      count: g.count,
      shownCount: shownBy.get(g.name) ?? 0,
      problems: g.entries.filter((e) => problemIds.has(e.cardId)).length,
      need: needed ? g.entries.filter((e) => needed.has(keyOf(e.card))).length : 0,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, found, needed, validation, loading])

  // In the text view the big panel follows the top match as you type, so a
  // search reads like a lookup. Pointing at a row still overrides it.
  const firstMatch = found.active ? found.sections[0]?.shown[0]?.cardId ?? null : null
  useEffect(() => {
    if (view === 'text' && firstMatch) setPreviewId(firstMatch)
  }, [firstMatch, view])

  if (!groups.length) {
    return (
      <div className="empty">
        <h3>Empty deck</h3>
        <p>Use <strong>Add cards</strong> to search and build.</p>
      </div>
    )
  }

  const rowsClass = { grid: 'deck-grid', text: 'text-rows', list: 'deck-rows' }[view]
  const solo = !found.active && open !== null
  const sectionsMarkup = visible.map(({ name, entries, shown, count, shownCount, price, chosen }) => (
        <section
          key={name}
          data-section={name}
          className={`${view === 'text' ? 'text-section' : ''} ${solo && name === open ? 'deck-section--solo' : ''}`}
        >
          <SectionHeader title={name} count={found.active ? `${shownCount} of ${count}` : count}>
            {!found.active && <span className="faint tiny">{formatPrice(price.total, market)}</span>}
            {name !== COMMANDER_CATEGORY && name !== 'Sideboard' && (
              <SectionMenu
                name={name}
                chosen={chosen}
                onRename={(to) => {
                  onChange(renameCategory(deck, name, to, entries.map((e) => e.cardId)))
                  if (open === name && to.trim()) {
                    setOpenName(to.trim())
                    setPref('deckOpen', openAfterRename(getPrefs(), deck.id, name, to.trim()))
                  }
                }}
                onMove={(delta) => onChange(moveCategory(
                  deck, name, delta, groups.map((g) => g.name),
                ))}
                onDissolve={() => {
                  onChange(clearCategory(deck, name))
                  if (open === name) chooseOpen(null, { snap: false })
                }}
              />
            )}
          </SectionHeader>
          <div className={rowsClass}>
            {(shown ?? entries).map(({ cardId, quantity, card, zone, isCommander }) => {
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
                    marked={marked.includes(cardId)}
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
                    marked={marked.includes(cardId)}
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
                  marked={marked.includes(cardId)}
                  act={act}
                  onOpenCard={onOpenCard}
                />
              )
            })}
          </div>
        </section>
  ))

  const nothing = found.active && found.sections.length === 0
  return (
    <div className="stack" ref={listRef} tabIndex={-1} onKeyDown={onListKey}>
      <div className="row">
        <span className="spacer" />
        <div className="row" role="group" aria-label="How to show the deck">
          {VIEWS.map(([id, label]) => (
            <Chip key={id} pressed={view === id} onClick={() => chooseView(id)}>{label}</Chip>
          ))}
          {artSwitch && view !== 'text' && (
            <Chip pressed={art} title="Show each card's painting behind its row or tile" onClick={artSwitch}>Art</Chip>
          )}
        </div>
      </div>

      <DeckFind
        value={query}
        onChange={setQuery}
        needOnly={needOnly}
        onNeedOnly={() => setNeedOnly(!needOnly)}
        status={status}
        identity={identity}
        inputRef={findRef}
        onEnter={focusFirstMatch}
      >
        {buttons && buttons.length > 0 && (
          <SectionButtons
            items={buttons}
            open={open}
            searching={found.active}
            onPick={pickSection}
            onJump={jumpTo}
          />
        )}
      </DeckFind>

      {nothing ? (
        <div className="empty deck-find__empty">
          <h3>
            {terms.length
              ? (needOnly ? `Nothing you still need matches “${query.trim()}”` : `Nothing in this deck matches “${query.trim()}”`)
              : 'You own every card in this deck'}
          </h3>
          <p>{terms.length ? 'The search reads card names and type lines.' : 'Nothing left to get.'}</p>
          <div className="row row--fit deck-find__actions">
            {terms.length > 0 && <button className="btn btn--sm" onClick={clearFind}>Clear search</button>}
            {terms.length > 0 && onFindElsewhere && (
              <button className="btn btn--sm" onClick={() => onFindElsewhere(query.trim())}>
                Search all cards for “{query.trim()}”
              </button>
            )}
            {!terms.length && (
              <button className="btn btn--sm" onClick={() => { setNeedOnly(false); findRef.current?.focus() }}>
                Show all cards
              </button>
            )}
          </div>
        </div>
      ) : view === 'text' ? (
        <div className="deck-text-layout">
          <DeckPreview
            card={previewCard}
            live={found.active ? 'off' : 'polite'}
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
const NONE = Object.freeze([])
