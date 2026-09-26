import { useMemo, useState } from 'react'
import { parseFind, matchesFind } from '../../lib/deck-find.js'
import { typeGroupOf } from '../../lib/grouping.js'

/** A card with no data yet is filed here rather than left out of the pile. */
const OTHER = { id: 'other', label: 'Other' }

/*
 * Display order, matching every other view in this app: lands last, because
 * that is where a player looks for them.
 */
const DISPLAY = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery',
  'artifact', 'enchantment', 'land', 'other']
const order = (id) => {
  const at = DISPLAY.indexOf(id)
  return at === -1 ? DISPLAY.length : at
}

/**
 * Looking through a pile.
 *
 * A graveyard in turn twelve is thirty cards and a library is ninety-nine, and
 * until now the only way through either was a flat list of names or, for the
 * library, nothing at all. At a paper table you fan the pile out on the
 * carpet; this is that.
 *
 * Taken from Moxgate, including the placeholder that teaches its own syntax:
 * the prefixes are `t:` for the type line, `o:` for rules text, `name:` for
 * the name alone, and they are Scryfall's, so anyone who has typed a search
 * into a deck site already knows them. Grouped by type with counts, because a
 * pile you are searching is one you are counting — how many creatures are
 * left, how many lands went — as much as reading.
 *
 * The library is searchable here on purpose. It is exactly the thing an
 * enforced game will not let you do idly and a paper table always allows,
 * because at a paper table you are the one holding the deck.
 *
 * `glowOf` is what the engine is asking about a card right now, at the table
 * it holds (src/lib/engine/glow.js): a card in a graveyard can be the legal
 * target of a trigger, and is tapped here to answer it. Its edge is drawn and
 * its words written beside its name, because a pile is a list and a glow on
 * a list is easily missed.
 */
export default function ZoneBrowser({ instances, cardFor, nameFor, selected, onSelect, label, glowOf = () => null }) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const find = parseFind(query)
    const kept = instances.filter((inst) => {
      const card = cardFor(inst)
      // A token or a card whose data has not arrived has no fields to search,
      // so it shows with no query and hides with one rather than pretending.
      if (!card) return !query.trim()
      return matchesFind(card, find)
    })
    // `typeGroupOf` hands back the whole group — `{ id, label }` — so the
    // label is what gets shown and the id is what decides the order.
    const by = new Map()
    for (const inst of kept) {
      const card = cardFor(inst)
      const group = card ? typeGroupOf(card) : OTHER
      if (!by.has(group.id)) by.set(group.id, { label: group.label, list: [] })
      by.get(group.id).list.push(inst)
    }
    return [...by.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([id, group]) => [id, group.label, group.list])
  }, [instances, query, cardFor])

  const shown = groups.reduce((n, [, , list]) => n + list.length, 0)

  return (
    <div className="zonebrowse">
      <label className="sr-only" htmlFor={`find-${label}`}>{`Search the ${label}`}</label>
      <input
        id={`find-${label}`}
        className="input zonebrowse__find"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search — name, t: type, o: text"
        autoComplete="off"
      />

      {query.trim() && (
        <p className="faint tiny m0" role="status">
          {shown === 0 ? 'Nothing here matches.' : `${shown} of ${instances.length}`}
        </p>
      )}

      {groups.map(([id, label, list]) => (
        <section className="zonebrowse__group" key={id}>
          <h3 className="zonebrowse__head">
            {label} <span className="chip tiny">{list.length}</span>
          </h3>
          <ul className="pile__cards" role="list">
            {list.map((inst) => {
              const glow = glowOf(inst.id)
              return (
                <li key={inst.id}>
                  <button
                    className={`pile__card${selected === inst.id ? ' pile__card--selected' : ''}${glow?.kind === 'target' || glow?.kind === 'chosen' ? ' pile__card--target' : glow ? ' pile__card--playable' : ''}`}
                    onClick={() => onSelect(inst.id)}
                    aria-pressed={selected === inst.id}
                  >
                    {nameFor(inst)}
                    {/* A commander the engine marks (M6), in a graveyard as much as in the command zone;
                        one standing in for a commander the engine does not know says for which (§3 item 19). */}
                    {inst.commander && <span className="pile__glow"> · {inst.standsFor ? `a commander, standing in for ${inst.standsFor}` : 'a commander'}</span>}
                    {glow?.says && <span className="pile__glow"> · {glow.says}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
