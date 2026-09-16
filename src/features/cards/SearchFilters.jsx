import { useState } from 'react'
import {
  COLOR_LETTERS, COLOR_MODES, RARITIES, hasActiveFilters, clearFilters,
} from '../../lib/query.js'
import { COLOR_NAMES } from '../../lib/mana.js'
import { FORMAT_IDS, FORMATS } from '../../lib/formats.js'
import Term from '../../components/Term.jsx'
import './filters.css'

const COLOR_VAR = { w: 'var(--mtg-w)', u: 'var(--mtg-u)', b: 'var(--mtg-b)', r: 'var(--mtg-r)', g: 'var(--mtg-g)' }

const TYPES = [
  'creature', 'instant', 'sorcery', 'artifact',
  'enchantment', 'planeswalker', 'land', 'battle',
]

/**
 * Filter controls that write into the query rather than around it.
 *
 * Every change produces a new Scryfall query string, which the caller shows in
 * the search box. There is one source of truth, so the controls can never
 * disagree with what was actually searched — and editing the box by hand feeds
 * straight back into the controls.
 */
export default function SearchFilters({ filters, onChange, onClear, locked }) {
  const [showMore, setShowMore] = useState(false)
  const active = hasActiveFilters(filters)

  const patch = (changes) => onChange({ ...filters, ...changes })

  const toggleColor = (group, letter) => {
    const current = filters[group]
    const values = current.values.includes(letter)
      ? current.values.filter((l) => l !== letter)
      : COLOR_LETTERS.filter((l) => l === letter || current.values.includes(l))
    patch({ [group]: { ...current, values, colorless: false } })
  }

  const toggleColorless = (group) => {
    const current = filters[group]
    patch({ [group]: { ...current, colorless: !current.colorless, values: [] } })
  }

  return (
    <div className="filters">
      <ColorGroup
        legend="Colour"
        help="colorIdentity"
        group="colors"
        state={filters.colors}
        onToggle={toggleColor}
        onToggleColorless={toggleColorless}
        onMode={(mode) => patch({ colors: { ...filters.colors, mode } })}
        description="The colours a card actually is."
      />

      <ColorGroup
        legend="Colour identity"
        help="colorIdentity"
        group="identity"
        state={filters.identity}
        onToggle={toggleColor}
        onToggleColorless={toggleColorless}
        onMode={(mode) => patch({ identity: { ...filters.identity, mode } })}
        description="Every colour a card mentions, including in its rules text. This is the one Commander cares about."
        locked={locked}
      />

      <div className="row">
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => setShowMore(!showMore)}
          aria-expanded={showMore}
        >
          {showMore ? 'Fewer filters' : 'More filters'}
        </button>
        <span className="spacer" />
        {active && (
          <button className="btn btn--sm btn--ghost" onClick={onClear}>Clear filters</button>
        )}
      </div>

      {showMore && (
        <div className="filters__more stack">
          <fieldset className="filters__group">
            <legend>Card type</legend>
            <div className="row row--wrap">
              {TYPES.map((type) => (
                <button
                  key={type}
                  className={`chip ${filters.types.includes(type) ? 'chip--active' : ''}`}
                  onClick={() => patch({
                    types: filters.types.includes(type)
                      ? filters.types.filter((t) => t !== type)
                      : [...filters.types, type],
                  })}
                >
                  {type}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="filters__group">
            <legend><Term id="manaValue">Mana value</Term></legend>
            <div className="row row--wrap">
              <select
                aria-label="Mana value comparison"
                value={filters.manaValue?.op ?? '<='}
                onChange={(e) => patch({
                  manaValue: { op: e.target.value, value: filters.manaValue?.value ?? 3 },
                })}
                style={{ width: 'auto' }}
              >
                <option value="<=">at most</option>
                <option value="=">exactly</option>
                <option value=">=">at least</option>
              </select>
              <input
                type="number"
                min="0"
                max="20"
                aria-label="Mana value"
                value={filters.manaValue?.value ?? ''}
                placeholder="any"
                onChange={(e) => {
                  const value = e.target.value === '' ? null : Number(e.target.value)
                  patch({ manaValue: value === null ? null : { op: filters.manaValue?.op ?? '<=', value } })
                }}
                style={{ width: 90 }}
              />
            </div>
          </fieldset>

          <fieldset className="filters__group">
            <legend>Legal in</legend>
            <div className="row row--wrap">
              {FORMAT_IDS.map((id) => {
                const key = FORMATS[id].legalityKey
                return (
                  <button
                    key={id}
                    className={`chip ${filters.format === key ? 'chip--active' : ''}`}
                    onClick={() => patch({ format: filters.format === key ? null : key })}
                  >
                    {FORMATS[id].name}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="filters__group">
            <legend>Rarity</legend>
            <div className="row row--wrap">
              {RARITIES.map((rarity) => (
                <button
                  key={rarity}
                  className={`chip ${filters.rarities.includes(rarity) ? 'chip--active' : ''}`}
                  onClick={() => patch({
                    rarities: filters.rarities.includes(rarity)
                      ? filters.rarities.filter((r) => r !== rarity)
                      : [...filters.rarities, rarity],
                  })}
                >
                  {rarity}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="filters__group">
            <legend>Budget</legend>
            <div className="row">
              <span className="faint tiny">No more than $</span>
              <input
                type="number"
                min="0"
                step="0.5"
                aria-label="Maximum price in dollars"
                value={filters.maxPrice ?? ''}
                placeholder="any"
                onChange={(e) => patch({
                  maxPrice: e.target.value === '' ? null : Number(e.target.value),
                })}
                style={{ width: 100 }}
              />
            </div>
            <p className="faint tiny" style={{ margin: '6px 0 0' }}>
              Scryfall prices are a daily aggregate, and cards with no price are excluded
              by this filter rather than treated as free.
            </p>
          </fieldset>
        </div>
      )}
    </div>
  )
}

function ColorGroup({
  legend, group, state, onToggle, onToggleColorless, onMode, description, help, locked,
}) {
  const mode = COLOR_MODES.find((m) => m.id === state.mode) ?? COLOR_MODES[0]

  return (
    <fieldset className="filters__group" disabled={locked}>
      <legend>{help ? <Term id={help}>{legend}</Term> : legend}</legend>

      <div className="row row--wrap">
        {COLOR_LETTERS.map((letter) => {
          const on = state.values.includes(letter)
          return (
            <button
              key={letter}
              className={`pip ${on ? 'pip--on' : ''}`}
              style={{ '--pip': COLOR_VAR[letter] }}
              aria-pressed={on}
              aria-label={COLOR_NAMES[letter.toUpperCase()]}
              title={COLOR_NAMES[letter.toUpperCase()]}
              onClick={() => onToggle(group, letter)}
            >
              {letter.toUpperCase()}
            </button>
          )
        })}
        <button
          className={`pip pip--colorless ${state.colorless ? 'pip--on' : ''}`}
          aria-pressed={state.colorless}
          aria-label="Colorless"
          title="Colorless"
          onClick={() => onToggleColorless(group)}
        >
          C
        </button>
      </div>

      {(state.values.length > 0 || state.colorless) && (
        <div className="row row--wrap" style={{ marginTop: 'var(--space-2)' }}>
          {COLOR_MODES.map((option) => (
            <button
              key={option.id}
              className={`chip ${state.mode === option.id ? 'chip--active' : ''}`}
              onClick={() => onMode(option.id)}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <p className="faint tiny filters__hint">
        {state.values.length || state.colorless ? mode.hint : description}
      </p>
    </fieldset>
  )
}
