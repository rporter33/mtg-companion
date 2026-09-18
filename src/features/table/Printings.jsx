import { useEffect, useState } from 'react'
import { getPrintings } from '../../lib/scryfall.js'
import { artUrl, describePrinting, orderPrintings, treatmentName, treatmentOf, finishFor } from '../../lib/board/art.js'

/**
 * Choosing which printing of a card is the one on your table.
 *
 * This is the part of a paper collection an app usually throws away. Two
 * people can play the same decklist and own completely different objects —
 * a borderless showcase, a retro frame, the one with the art you liked in
 * 2003 — and which copy is in the sleeve is most of why people care about
 * their deck. Scryfall serves every printing of a card with its own
 * painting, so all of that is available without a single hand-maintained
 * list of set codes.
 *
 * The choice is written back to the deck rather than kept as a display
 * setting for this screen, because it is a fact about the deck: those are
 * the cards in the box.
 */
export default function Printings({ card, finish = 'normal', onChoose, onClose }) {
  const [prints, setPrints] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPrints(null)
    setFailed(false)
    getPrintings(card)
      .then((found) => { if (!cancelled) setPrints(orderPrintings(found, card.id)) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [card.id, card.oracle_id])

  return (
    <section className="printings" aria-label={`Printings of ${card.name}`}>
      <div className="row row--wrap">
        <h2 className="pile__title">Which copy of {card.name}</h2>
        <span className="spacer" />
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Done</button>
      </div>

      {failed && <p className="faint tiny">Other printings need a connection. The one you have still plays.</p>}
      {!prints && !failed && <p className="faint tiny">Looking for other printings…</p>}

      {prints && (
        <ul className="printings__list" role="list">
          {prints.map((print) => {
            const art = artUrl(print)
            const treatment = treatmentName(print)
            const mine = print.id === card.id
            return (
              <li key={print.id}>
                <button
                  className={`printings__print${mine ? ' printings__print--mine' : ''}`}
                  onClick={() => onChoose(print, finishFor(print, finish))}
                  aria-current={mine ? 'true' : undefined}
                >
                  <span
                    className="printings__art"
                    style={art ? { backgroundImage: `url("${art}")` } : undefined}
                    aria-hidden="true"
                  >
                    {!art && '◈'}
                  </span>
                  <span className="printings__what">
                    <strong>{print.set_name ?? print.set}</strong>
                    <span className="faint tiny">{describePrinting(print)}</span>
                  </span>
                  <span className="printings__tags">
                    {treatment && <span className="chip tiny">{treatment}</span>}
                    {treatmentOf(print).foilable && <span className="chip tiny">foil</span>}
                    {mine && <span className="chip tiny">yours</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="faint tiny">
        Choosing one changes the copies on this table and the card in the deck, so it is still that printing next game.
      </p>
    </section>
  )
}
