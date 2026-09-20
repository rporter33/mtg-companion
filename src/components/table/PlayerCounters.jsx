import { useState } from 'react'
import { COUNTER_TYPES } from '../../lib/game.js'

/**
 * The counters that sit beside a player rather than on a card.
 *
 * The reducer has been able to do this since the board was written — there is
 * a `playerCounter` action and a `counters` map per seat — and nothing has
 * ever called it. Moxgate's dialog is the missing half: a grid of the
 * counters a player can have, each a minus, a number and a plus, and a field
 * for the one the list did not think of.
 *
 * The list is `COUNTER_TYPES` from the play companion rather than a second
 * list written here, so the two screens cannot drift apart about what a
 * player might be keeping track of.
 *
 * Custom counters are the important part and the reason this is not seven
 * fixed rows. Magic prints new player counters every year or two, and a table
 * that only knows the ones that existed when it was written is a table you
 * stop using the week a set comes out.
 */
export default function PlayerCounters({ board, player = 'you', onChange, onClose }) {
  const [custom, setCustom] = useState('')
  const held = board?.counters?.[player] ?? {}
  const known = new Set(COUNTER_TYPES.map((type) => type.id))
  const extra = Object.keys(held).filter((name) => !known.has(name)).sort()

  const add = (event) => {
    event.preventDefault()
    const name = custom.trim().toLowerCase()
    if (!name) return
    onChange(name, 1)
    setCustom('')
  }

  return (
    <div className="counters">
      <div className="counters__grid">
        {COUNTER_TYPES.map((type) => (
          <Dial
            key={type.id}
            name={type.id}
            label={type.label}
            hint={type.hint}
            value={held[type.id] ?? 0}
            max={type.max}
            onChange={onChange}
          />
        ))}
      </div>

      {extra.length > 0 && (
        <>
          <h3 className="counters__head">Yours</h3>
          <div className="counters__grid">
            {extra.map((name) => (
              <Dial key={name} name={name} label={name} value={held[name]} onChange={onChange} />
            ))}
          </div>
        </>
      )}

      <form className="counters__add" onSubmit={add}>
        <label className="counters__head" htmlFor="counter-name">Something else</label>
        <div className="row">
          <input
            id="counter-name"
            className="input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Counter name…"
            maxLength={24}
          />
          <button className="btn btn--sm" type="submit" disabled={!custom.trim()}>Add</button>
        </div>
      </form>

      <p className="faint tiny m0">
        These sit beside you, not on a card. To put a counter on a permanent, press the card itself.
      </p>

      {onClose && (
        <div className="row">
          <button className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      )}
    </div>
  )
}

/** One counter: minus, the number, plus. Nothing goes below nothing. */
function Dial({ name, label, hint, value = 0, max = null, onChange }) {
  const at = value ?? 0
  const lethal = name === 'poison' && at >= 10
  return (
    <div className={`counters__one${lethal ? ' counters__one--lethal' : ''}`}>
      <span className="counters__label">{label}</span>
      <div className="row counters__row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange(name, -1)}
          disabled={at <= 0}
          aria-label={`One fewer ${label} counter`}
        >−</button>
        <output className="counters__value" aria-label={`${at} ${label}`}>{at}</output>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange(name, 1)}
          disabled={max !== null && at >= max}
          aria-label={`One more ${label} counter`}
        >+</button>
      </div>
      {hint && at > 0 && <span className="counters__hint faint tiny">{hint}</span>}
    </div>
  )
}
