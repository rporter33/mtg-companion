import { useEffect, useState } from 'react'
import { TUTORIAL } from '../../data/tutorial.js'
import { tutorialCard } from '../../data/tutorial-cards.js'
import CardFace from '../../components/CardFace.jsx'
import CardZoom from '../../components/CardZoom.jsx'
import Term from '../../components/Term.jsx'
import { saveTutorialState, getGuideProgress, markLessonComplete } from '../../lib/storage.js'
import './guide.css'

const PHASE_LABEL = {
  main1: 'Main phase', main2: 'Second main phase', combat: 'Combat', draw: 'Draw step',
}

/**
 * Inspecting a card in the tutorial needs its own affordance, because tapping a
 * card here plays it. A visible button beats a long-press: a beginner will never
 * discover a hidden gesture, and long-press collides with the OS context menu.
 */
function InspectButton({ onClick, name }) {
  return (
    <button
      type="button"
      className="inspect"
      onClick={(event) => { event.stopPropagation(); onClick() }}
      aria-label={`Look closely at ${name}`}
      title={`Look closely at ${name}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m20 20-4.2-4.2" />
      </svg>
    </button>
  )
}

export default function TutorialGame({ onExit }) {
  const [inspecting, setInspecting] = useState(null)
  const [index, setIndex] = useState(() => {
    const saved = getGuideProgress().tutorialState
    return typeof saved === 'number' && saved < TUTORIAL.length ? saved : 0
  })
  const [nudge, setNudge] = useState(false)

  const beat = TUTORIAL[index]
  const atEnd = index >= TUTORIAL.length - 1

  useEffect(() => { saveTutorialState(index) }, [index])
  useEffect(() => { setNudge(false) }, [index])

  const advance = () => {
    if (atEnd) {
      markLessonComplete('tutorial')
      saveTutorialState(null)
      onExit()
      return
    }
    setIndex(index + 1)
  }

  /** A click on the right card advances; a click on the wrong one nudges. */
  const handleCardClick = (cardId, zone) => {
    if (beat.action.type !== 'click') return
    if (beat.action.cardId === cardId && beat.action.zone === zone) advance()
    else setNudge(true)
  }

  return (
    <div className="tutorial">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={onExit}>← Leave</button>
        <span className="spacer" />
        <span className="faint tiny">{index + 1} of {TUTORIAL.length}</span>
      </div>

      <div className="tutorial__progress" role="progressbar"
        aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={TUTORIAL.length}>
        <div style={{ width: `${((index + 1) / TUTORIAL.length) * 100}%` }} />
      </div>

      <Board
        beat={beat}
        onCardClick={handleCardClick}
        onInspect={setInspecting}
        action={beat.action}
      />

      <div className="coach">
        <div className="coach__title">
          {beat.title}
          {beat.turn > 0 && (
            <span className="faint tiny">
              {' '}· Turn {beat.turn}
              {beat.phase && ` · ${PHASE_LABEL[beat.phase] ?? beat.phase}`}
              {beat.active === 'foe' && ' · their turn'}
            </span>
          )}
        </div>
        <p className="coach__text">{beat.coach}</p>
        {beat.term && (
          <p className="tiny" style={{ margin: 0 }}>
            <Term id={beat.term}>More about this</Term>
          </p>
        )}

        {beat.action.type === 'continue' ? (
          <button className="btn btn--primary" onClick={advance}>{beat.action.label}</button>
        ) : (
          <div className={`coach__prompt ${nudge ? 'coach__prompt--nudge' : ''}`}>
            <strong>{beat.action.label}</strong>
            <span className="faint tiny">
              {nudge ? `Not that one — ${beat.action.hint.toLowerCase()}` : beat.action.hint}
            </span>
          </div>
        )}
      </div>

      <Hand
        cards={beat.you.hand}
        highlight={beat.action.type === 'click' && beat.action.zone === 'hand' ? beat.action.cardId : null}
        onCardClick={(id) => handleCardClick(id, 'hand')}
        onInspect={setInspecting}
      />

      <CardZoom
        card={inspecting ? tutorialCard(inspecting) : null}
        open={!!inspecting}
        onClose={() => setInspecting(null)}
      />
    </div>
  )
}

function Board({ beat, onCardClick, onInspect, action }) {
  const wanted = action.type === 'click' ? action : null

  return (
    <div className="board-view">
      <PlayerStrip
        label="Opponent" life={beat.foe.life} handCount={beat.foe.hand}
        graveyard={beat.foe.graveyard} active={beat.active === 'foe'} opponent
      />
      <Zone permanents={beat.foe.board} side="foe" onInspect={onInspect} />

      <div className="board-view__divider" aria-hidden="true" />

      <Zone
        permanents={beat.you.board} side="you"
        highlight={wanted?.zone === 'board' ? wanted.cardId : null}
        onCardClick={(id) => onCardClick(id, 'board')}
        onInspect={onInspect}
      />
      <PlayerStrip
        label="You" life={beat.you.life} handCount={beat.you.hand.length}
        graveyard={beat.you.graveyard} active={beat.active === 'you'}
      />
    </div>
  )
}

function PlayerStrip({ label, life, handCount, graveyard, active, opponent }) {
  return (
    <div className={`strip ${active ? 'strip--active' : ''}`}>
      <span className="strip__label">{label}</span>
      <span className="spacer" />
      <Term id="graveyard" as="span">
        <span className="chip tiny">{graveyard.length} in graveyard</span>
      </Term>
      <Term id="hand" as="span">
        <span className="chip tiny">{handCount} in hand</span>
      </Term>
      <span className={`strip__life ${life <= 5 ? 'strip__life--low' : ''}`}>{life}</span>
    </div>
  )
}

function Zone({ permanents, side, highlight, onCardClick, onInspect }) {
  const lands = permanents.filter((p) => p.id === 'forest' || p.id === 'mountain')
  const others = permanents.filter((p) => !(p.id === 'forest' || p.id === 'mountain'))

  if (!permanents.length) {
    return <div className={`zone zone--${side} zone--empty`}>Nothing on the battlefield</div>
  }

  return (
    <div className={`zone zone--${side}`}>
      {others.map((p, i) => (
        <Permanent key={`${p.id}-${i}`} perm={p} highlight={highlight === p.id}
          onClick={onCardClick} onInspect={onInspect} />
      ))}
      {lands.length > 0 && (
        <div className="zone__lands">
          {lands.map((p, i) => (
            <Permanent key={`land-${i}`} perm={p} small highlight={false} onInspect={onInspect} />
          ))}
        </div>
      )}
    </div>
  )
}

function Permanent({ perm: p, small, highlight, onClick, onInspect }) {
  const card = tutorialCard(p.id)
  if (!card) return null
  const clickable = !!onClick

  return (
    <div
      className={[
        'permanent',
        small ? 'permanent--land' : '',
        p.tapped ? 'permanent--tapped' : '',
        p.sick ? 'permanent--sick' : '',
        p.attacking ? 'permanent--attacking' : '',
        p.blocking ? 'permanent--blocking' : '',
        highlight ? 'permanent--wanted' : '',
      ].filter(Boolean).join(' ')}
    >
      <CardFace card={card} size={small ? 'sm' : 'md'} onClick={clickable ? () => onClick(p.id) : undefined} />
      {onInspect && !small && <InspectButton name={card.name} onClick={() => onInspect(p.id)} />}
      {p.buff && <span className="permanent__buff">{p.buff}</span>}
      {p.sick && <span className="permanent__tag" title="Summoning sick — cannot attack yet">zzz</span>}
      {p.attacking && <span className="permanent__tag permanent__tag--attack">attacking</span>}
      {p.blocking && <span className="permanent__tag">blocking</span>}
    </div>
  )
}

function Hand({ cards, highlight, onCardClick, onInspect }) {
  if (!cards.length) return null
  return (
    <div className="hand">
      <div className="hand__label faint tiny">Your hand</div>
      <div className="hand__cards">
        {cards.map((id, i) => {
          const card = tutorialCard(id)
          if (!card) return null
          const wanted = highlight === id
          return (
            <div key={`${id}-${i}`} className={`hand__card ${wanted ? 'hand__card--wanted' : ''}`}>
              <CardFace card={card} size="md" onClick={() => onCardClick(id)} />
              {onInspect && <InspectButton name={card.name} onClick={() => onInspect(id)} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
