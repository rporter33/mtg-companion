import Chip from '../../components/Chip.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchCards } from '../../lib/scryfall.js'
import { addCard, setCommanders } from '../../lib/deck.js'
import { getFormat, canBeCommander, legalityStatus, poolQuery, effectiveCopyLimit } from '../../lib/formats.js'
import { combinedCounts, unionColorIdentity, deckSize, gameCardCounts, gameCardKey } from '../../lib/deck.js'
import { parseQuery, serialiseQuery, clearFilters, hasActiveFilters, SORT_OPTIONS, getSort } from '../../lib/query.js'
import { getPrefs, setPref } from '../../lib/storage.js'
import { priceLabel, priceFor } from '../../lib/prices.js'
import { useCollection } from '../../lib/collection-store.js'
import { ownedOf } from '../../lib/collection.js'
import { roleCounts } from '../../lib/skeleton.js'
import { artUrl } from '../../lib/deck-art.js'
import SearchFilters from '../cards/SearchFilters.jsx'
import '../cards/filters.css'
import { pinCards } from '../../lib/cache.js'
import ManaCost from '../../components/ManaCost.jsx'
import DeckArt from '../../components/DeckArt.jsx'
import NotOutChip from '../../components/NotOutChip.jsx'
import { identityAttr } from '../../components/CardFace.jsx'

/**
 * In-deck search. Scopes the query to the deck's format by default, since 90%
 * of the time while building you only want cards you can actually play — and
 * shows why a card is blocked rather than just hiding it.
 *
 * Results are sorted by how played each card is unless asked otherwise,
 * because "what do people run in these colours" is the question a builder
 * is asking; every row carries its price in the deck's market and its type,
 * so the value of a pick is visible before it is added. The quick chips
 * write into the same query the search box shows, so nothing hidden is
 * filtering; "Not in deck" and "Owned" are the two exceptions, and they are
 * applied here to what came back rather than sent to Scryfall, since Scryfall
 * does not know your deck.
 */
const TYPE_CHIPS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Planeswalker']
const PRICE_CHIPS = [1, 4, 10]
/** Role queries, in the coach's own wording, so a chip and the coach agree. */
const ROLE_QUERIES = {
  lands: 't:land',
  ramp: '(o:"add {" or o:"search your library for a basic land") -t:land',
  draw: 'o:"draw" -o:"opponent draws" -t:land',
  removal: '(o:"destroy target" or o:"exile target" or o:"destroy all" or o:"deals damage to any target") -t:land',
  theme: '-t:land',
}
/** A query that names a set or a date, which is how someone asks after the next set. */
const ASKS_SET_OR_DATE = /(?:^|[\s(])(?:set|s|e|edition|date|year)[:=<>]/i

export default function DeckSearch({ deck, onChange, onOpenCard, offline, cards, seedQuery, onSeeded, market = 'usd', art = false }) {
  const [query, setQuery] = useState('')
  const [scoped, setScoped] = useState(true)
  const [identityScoped, setIdentityScoped] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState(null)
  // Whether the results on screen came from a format-scoped search, which
  // can differ from the box while a toggle waits for a query to run.
  const [ranScoped, setRanScoped] = useState(false)
  const [ranQuery, setRanQuery] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [sortId, setSortId] = useState(() => getPrefs().deckSortId ?? 'edhrec')
  const [dir, setDir] = useState(() => getPrefs().deckSortDir ?? null)
  const [hideInDeck, setHideInDeck] = useState(false)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [collection] = useCollection()
  const abortRef = useRef(null)

  const format = getFormat(deck.formatId)
  const pool = poolQuery(format)
  const counts = useMemo(() => combinedCounts(deck), [deck])
  // A copy limit counts the card, not the printing, so a result is "in deck"
  // however many of it the deck holds in other printings, and the + stops
  // where validateDeck would call it a problem. The printing's own count
  // covers a deck card that has not loaded yet.
  const byCard = useMemo(() => gameCardCounts(deck, cards), [deck, cards])
  const inDeckOf = useCallback(
    (card) => Math.max(counts.get(card.id) ?? 0, byCard.get(gameCardKey(card))?.quantity ?? 0),
    [counts, byCard],
  )
  const filters = useMemo(() => parseQuery(query), [query])
  const seededRef = useRef(null)
  const sort = getSort(sortId)
  const direction = dir ?? sort.defaultDir
  const lookup = useCallback((id) => cards?.get?.(id), [cards])
  const needs = useMemo(() => (format.group === 'commander' ? roleCounts(deck, lookup, format) : null), [deck, lookup, format])
  const total = deckSize(deck, format)
  const target = format?.deck.max ?? format?.deck.min ?? 60

  /**
   * A commander fixes what the deck may legally contain, so searching inside
   * one starts scoped to its colour identity. Cards you could not play simply
   * do not appear — with a visible chip saying so, because a filter you cannot
   * see is a filter you will blame the search for.
   */
  const commanderIdentity = useMemo(() => {
    if (!format.commander?.colorIdentity || !deck.commanders.length) return null
    const commanderCards = deck.commanders.map((id) => cards?.get?.(id)).filter(Boolean)
    if (!commanderCards.length) return null
    const identity = unionColorIdentity(commanderCards)
    return {
      letters: identity.map((c) => c.toLowerCase()),
      names: commanderCards.map((c) => c.name).join(' and '),
    }
  }, [deck.commanders, cards, format])

  /**
   * Scoping and sorting are passed in rather than read from state.
   *
   * A toggle that calls `setX(false)` and then `run(query)` in the same handler
   * runs the *previous* callback, which still closes over the old value — so
   * the search goes out with the setting the user just turned off. Explicit
   * overrides remove the race entirely.
   */
  const run = useCallback(async (raw, overrides = {}) => {
    const q = raw.trim()
    if (!q) return
    const useFormatScope = overrides.scoped ?? scoped
    const useIdentityScope = overrides.identityScoped ?? identityScoped
    const useSort = getSort(overrides.sortId ?? sortId)
    const useDir = overrides.dir ?? dir ?? useSort.defaultDir

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setError(null)

    const parts = [q]
    if (useFormatScope) parts.push(pool)
    if (useIdentityScope && commanderIdentity) {
      // A colourless commander still restricts the deck to colourless cards.
      parts.push(commanderIdentity.letters.length
        ? `id<=${commanderIdentity.letters.join('')}`
        : 'id<=c')
    }

    try {
      const result = await searchCards(parts.join(' '), { order: useSort.order, dir: useDir, signal: controller.signal })
      setResults(result)
      setRanScoped(useFormatScope)
      setRanQuery(q)
      setStatus('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err)
      setStatus('error')
    }
  }, [scoped, identityScoped, commanderIdentity, pool, sortId, dir])

  const rewrite = (next) => {
    const rewritten = serialiseQuery(next)
    setQuery(rewritten)
    if (rewritten.trim()) run(rewritten)
  }
  const chooseSort = (id) => {
    setSortId(id); setDir(null); setPref('deckSortId', id); setPref('deckSortDir', null)
    if (query.trim()) run(query, { sortId: id, dir: null })
  }
  const flipDir = () => {
    const next = direction === 'asc' ? 'desc' : 'asc'
    setDir(next); setPref('deckSortDir', next)
    if (query.trim()) run(query, { dir: next })
  }
  const askRole = (roleId) => {
    const q = ROLE_QUERIES[roleId] ?? ROLE_QUERIES.theme
    setQuery(q)
    run(q)
  }

  const add = (card, asCommander = false) => {
    onChange(asCommander
      ? setCommanders(deck, [...deck.commanders, card.id])
      : addCard(deck, card.id, 1))
    pinCards([card.id])
  }

  // A query handed over by the coach or the deck list runs once on arrival,
  // then is handed back consumed, so the next visit to this tab starts
  // clean. The coach already scopes to format and colour identity, so its
  // query goes out as written.
  useEffect(() => {
    if (!seedQuery || seededRef.current === seedQuery) return
    seededRef.current = seedQuery
    setQuery(seedQuery)
    setScoped(false)
    setIdentityScoped(false)
    run(seedQuery, { scoped: false, identityScoped: false })
    onSeeded?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery])

  const shown = useMemo(() => (results?.cards ?? []).filter((card) => {
    if (hideInDeck && inDeckOf(card) > 0) return false
    if (ownedOnly && ownedOf(collection, card) === 0) return false
    return true
  }), [results, hideInDeck, ownedOnly, inDeckOf, collection])
  const hiddenCount = (results?.cards?.length ?? 0) - shown.length
  const shownValue = shown.reduce((n, c) => n + (priceFor(c, market).value ?? 0), 0)

  return (
    <div className="stack">
      {needs && (
        <div className="needs" role="group" aria-label="What this deck still needs">
          <span className={`chip ${total === target ? 'chip--ok' : ''}`} title="Cards in the deck, commander included">{total}/{target}</span>
          {needs.map((role) => (
            <button
              key={role.id}
              className={`chip needs__chip ${role.short === 0 ? 'chip--ok' : ''}`}
              onClick={() => askRole(role.id)}
              title={role.short === 0 ? `${role.label}: the usual count is met` : `${role.label}: ${role.short} short of the usual ${role.target}. Search for some.`}
            >
              {role.label} {role.have}/{role.target}
            </button>
          ))}
        </div>
      )}

      <form className="search" onSubmit={(e) => { e.preventDefault(); run(query) }} role="search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search cards for ${format.name}`}
          aria-label="Search cards to add"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button className="btn btn--primary" type="submit" disabled={!query.trim()}>Search</button>
      </form>

      <div className="row row--wrap">
        <button
          className={`btn btn--sm ${hasActiveFilters(filters) ? 'chip--active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          Filters{hasActiveFilters(filters) ? ' · on' : ''}
        </button>
        <label
          className="row tiny muted row--fit"
          title={format.legalityKey === 'standard'
            ? "Includes cards not out yet that Scryfall's Future Standard lists"
            : undefined}
        >
          <input
            type="checkbox"
            checked={scoped}
            onChange={(e) => {
              setScoped(e.target.checked)
              if (query.trim()) run(query, { scoped: e.target.checked })
            }}
            style={{ width: 'auto' }}
          />
          Legal in {format.name}
        </label>
        <span className="spacer" />
        <label className="row tiny muted row--fit row--tight">
          Sort
          <select className="chip" aria-label="Sort results" value={sortId} onChange={(e) => chooseSort(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <button
          className="chip"
          onClick={flipDir}
          aria-label={`Sort direction: ${direction === 'asc' ? 'ascending' : 'descending'}`}
          title={direction === 'asc' ? 'Ascending — press for descending' : 'Descending — press for ascending'}
        >
          {direction === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Quick chips write into the query itself; nothing hidden is filtering. */}
      <div className="quick" role="group" aria-label="Quick filters">
        <span className="quick__group">
          {TYPE_CHIPS.map((type) => {
            const on = filters.types.some((t) => t.toLowerCase() === type.toLowerCase())
            return (
              <Chip
                key={type}
                small
                pressed={on}
                onClick={() => rewrite({
                  ...filters,
                  types: on ? filters.types.filter((t) => t.toLowerCase() !== type.toLowerCase()) : [...filters.types, type.toLowerCase()],
                })}
              >
                {type}
              </Chip>
            )
          })}
        </span>
        <span className="quick__group">
          {PRICE_CHIPS.map((cap) => (
            <Chip
              key={cap}
              small
              pressed={filters.maxPrice === cap}
              onClick={() => rewrite({ ...filters, maxPrice: filters.maxPrice === cap ? null : cap })}
              title={`Only cards under $${cap} (Scryfall's USD price)`}
            >
              ≤ ${cap}
            </Chip>
          ))}
        </span>
        <span className="quick__group">
          <Chip small pressed={hideInDeck} onClick={() => setHideInDeck(!hideInDeck)}>Not in deck</Chip>
          <Chip small pressed={ownedOnly} onClick={() => setOwnedOnly(!ownedOnly)} title="Only cards in your collection">Owned</Chip>
        </span>
      </div>

      {commanderIdentity && identityScoped && (
        <div className="row row--wrap">
          <span className="scope-chip">
            Within {commanderIdentity.names}&rsquo;s colours
            <button
              onClick={() => {
                setIdentityScoped(false)
                if (query.trim()) run(query, { identityScoped: false })
              }}
              aria-label="Stop restricting to the commander's colour identity"
              title="Show cards outside this commander's colours too"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {commanderIdentity && !identityScoped && (
        <button
          className="btn btn--sm btn--ghost self-start"
          onClick={() => {
            setIdentityScoped(true)
            if (query.trim()) run(query, { identityScoped: true })
          }}
        >
          Restrict to {commanderIdentity.names}&rsquo;s colours again
        </button>
      )}

      {showFilters && (
        <>
          <SearchFilters
            filters={filters}
            onChange={rewrite}
            onClear={() => rewrite(clearFilters(filters))}
            locked={identityScoped && !!commanderIdentity}
          />
          {identityScoped && commanderIdentity && (
            <p className="faint tiny m0">
              Colour identity is set by your commander. Remove the chip above to filter it
              yourself.
            </p>
          )}
        </>
      )}

      {status === 'error' && (
        <div className="banner banner--error tiny">
          {offline ? 'Card search needs a connection. Cards already in this deck still work.' : error?.message}
        </div>
      )}

      {status === 'loading' && <p className="faint tiny m0">Searching…</p>}

      {results && status === 'done' && (
        <p className="faint tiny results-line m0">
          {results.cards.length === 0
            ? 'No cards matched.'
            : `${shown.length} shown${hiddenCount ? ` (${hiddenCount} hidden by Not in deck or Owned)` : ''}${results.totalCards > results.cards.length ? ` of ${results.totalCards}` : ''} · sorted by ${sort.label.toLowerCase()}${direction === 'desc' ? ', descending' : ''} · ${priceLabel({ prices: { [market]: String(shownValue) } }, market)} shown in total`}
        </p>
      )}
      {/* Outside Standard nothing says ahead of release which new cards a
          format will take, so a scoped search finds none of them. Nothing
          here knows that is why a search came back empty (a typo is likelier)
          or thin (a set's reprints and none of its new cards), so it is asked
          rather than told: after an empty search, or one naming a set or a
          date, which is how someone looks for the next set. */}
      {results && status === 'done' && ranScoped && format.legalityKey !== 'standard'
        && (results.cards.length === 0 || ASKS_SET_OR_DATE.test(ranQuery)) && (
        <p className="faint tiny m0 not-out-hint">
          Looking for cards that are not out yet? Scryfall adds new cards to its {format.name} pool
          only once they are released, so turn off &ldquo;Legal in {format.name}&rdquo; to see them.
        </p>
      )}

      <div className="stack stack--tight">
        {shown.map((card) => {
          const inDeck = inDeckOf(card)
          const owned = ownedOf(collection, card)
          const limit = effectiveCopyLimit(card, format)
          // A card that is not out yet adds like any other; the NotOutChip
          // on its row says why it is not plainly legal.
          const legality = legalityStatus(card, format)
          const blocked = legality === 'banned' || legality === 'not_legal'
          const atLimit = inDeck >= limit
          const commanderOk = format.commander?.required
            && deck.commanders.length < format.commander.max
            && canBeCommander(card, format).ok
          const artSrc = art ? artUrl(card) : null

          return (
            <div className={`deck-row search-row ${inDeck ? 'search-row--in' : ''} ${artSrc ? 'deck-row--art' : ''}`} key={card.id} data-identity={identityAttr(card)}>
              {artSrc && <DeckArt src={artSrc} cardId={card.id} className="deck-art--row" />}
              <button
                className="btn btn--sm btn--primary"
                onClick={() => add(card)}
                disabled={blocked || atLimit}
                aria-label={`Add ${card.name}`}
                title={
                  blocked ? `${legality === 'banned' ? 'Banned' : 'Not legal'} in ${format.name}`
                    : atLimit ? `Already at the limit of ${limit}` : undefined
                }
              >
                +
              </button>
              {commanderOk && (
                <button className="btn btn--sm" onClick={() => add(card, true)} title="Set as commander">★</button>
              )}
              <span className="search-row__main">
                <button className="deck-row__name" onClick={() => onOpenCard(card)}>{card.name}</button>
                <span className="search-row__type faint tiny">{card.type_line}</span>
              </span>
              <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost || ''} />
              <span className="deck-row__price faint tiny" title="Scryfall's daily price in the deck's market">{priceLabel(card, market)}</span>
              {inDeck > 0 && <span className="chip chip--sm chip--ok" title="Already in this deck">{inDeck} in deck</span>}
              {owned > 0 && <span className="chip chip--sm" title="In your collection">own {owned}</span>}
              <NotOutChip card={card} />
              {blocked && (
                <span className="chip chip--error tiny">{legality === 'banned' ? 'banned' : 'not legal'}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
