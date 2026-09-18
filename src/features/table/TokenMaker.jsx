import { useState } from 'react'
import { searchCards } from '../../lib/scryfall.js'
import { artUrl } from '../../lib/board/art.js'

/**
 * Making something that was never in the deck.
 *
 * Two different things, and they are here together because they are the same
 * gesture at a table — putting a piece of cardboard down that stands for
 * something. A real token, of which Scryfall has thousands with their own
 * paintings; or a blank card with a name written on it, which is what
 * everyone actually does when the token is at home in a box.
 *
 * The blank card needs no connection, on purpose: the moment you need one is
 * mid-game, and mid-game is exactly when the wifi in a shop gives out.
 */
export default function TokenMaker({ colors = [], onMake, onClose }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const [custom, setCustom] = useState({ name: '', typeLine: 'Token Creature', power: '', toughness: '' })

  const search = async (event) => {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    setSearching(true)
    setFailed(false)
    // Scoped to tokens and to the deck's colours, because "Bear" otherwise
    // returns every bear ever printed and none of them are tokens.
    const colour = colors.length ? ` (${colors.map((c) => `c:${c}`).join(' or ')} or c:c)` : ''
    try {
      const result = await searchCards(`t:token ${text}${colour}`, { unique: 'cards' })
      setFound(result.cards.slice(0, 12))
    } catch {
      setFailed(true)
      setFound([])
    } finally {
      setSearching(false)
    }
  }

  const makeBlank = (event) => {
    event.preventDefault()
    if (!custom.name.trim()) return
    onMake({
      custom: {
        name: custom.name.trim(),
        typeLine: custom.typeLine.trim(),
        power: custom.power.trim() || null,
        toughness: custom.toughness.trim() || null,
      },
    })
    setCustom({ name: '', typeLine: 'Token Creature', power: '', toughness: '' })
  }

  return (
    <section className="tokenmaker" aria-label="Make a token">
      <div className="row row--wrap">
        <h2 className="pile__title">Make a token</h2>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Done</button>
      </div>

      <form className="row row--wrap" onSubmit={search}>
        <label className="tokenmaker__field">
          <span className="faint tiny">A real token</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="treasure, soldier, beast…"
            aria-label="Search for a token"
          />
        </label>
        <button className="btn btn--sm" type="submit" disabled={searching || !query.trim()}>
          {searching ? 'Looking…' : 'Find it'}
        </button>
      </form>

      {failed && <p className="faint tiny">Tokens need a connection. A blank card with a name on it does not.</p>}
      {found?.length === 0 && !failed && <p className="faint tiny">Nothing matched. Try the creature type on its own.</p>}
      {found?.length > 0 && (
        <ul className="tokenmaker__found" role="list">
          {found.map((token) => {
            const art = artUrl(token)
            return (
              <li key={token.id}>
                <button className="tokenmaker__token" onClick={() => onMake({ cardId: token.id, card: token })}>
                  <span
                    className="printings__art"
                    style={art ? { backgroundImage: `url("${art}")` } : undefined}
                    aria-hidden="true"
                  >
                    {!art && '◈'}
                  </span>
                  <span className="printings__what">
                    <strong>{token.name}</strong>
                    <span className="faint tiny">
                      {token.type_line}
                      {token.power != null ? ` · ${token.power}/${token.toughness}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form className="tokenmaker__blank stack" onSubmit={makeBlank}>
        <span className="faint tiny">Or a blank card, the way you would write one at the table</span>
        <div className="row row--wrap">
          <label className="tokenmaker__field">
            <span className="faint tiny">Name</span>
            <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} aria-label="Name" />
          </label>
          <label className="tokenmaker__field">
            <span className="faint tiny">Type</span>
            <input value={custom.typeLine} onChange={(e) => setCustom({ ...custom, typeLine: e.target.value })} aria-label="Type line" />
          </label>
          <label className="tokenmaker__field tokenmaker__field--tiny">
            <span className="faint tiny">Power</span>
            <input value={custom.power} onChange={(e) => setCustom({ ...custom, power: e.target.value })} aria-label="Power" inputMode="numeric" />
          </label>
          <label className="tokenmaker__field tokenmaker__field--tiny">
            <span className="faint tiny">Toughness</span>
            <input value={custom.toughness} onChange={(e) => setCustom({ ...custom, toughness: e.target.value })} aria-label="Toughness" inputMode="numeric" />
          </label>
          <button className="btn btn--sm" type="submit" disabled={!custom.name.trim()}>Put it on the table</button>
        </div>
      </form>
    </section>
  )
}
