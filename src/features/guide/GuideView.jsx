import { useState } from 'react'
import { TRACKS, LESSONS } from '../../data/lessons.js'
import { GLOSSARY_SECTIONS, lookupTerm } from '../../data/glossary.js'
import { getGuideProgress, markLessonComplete, resetLesson } from '../../lib/storage.js'
import TutorialGame from './TutorialGame.jsx'
import SeasonBanner from './SeasonBanner.jsx'
import Term, { TermBody } from '../../components/Term.jsx'
import Sheet from '../../components/Sheet.jsx'
import './guide.css'

export default function GuideView({ onNavigate, onExploreQuery }) {
  const [mode, setMode] = useState('home')
  const [trackId, setTrackId] = useState(null)
  const [lessonId, setLessonId] = useState(null)
  const [progress, setProgress] = useState(() => getGuideProgress())

  const refresh = () => setProgress(getGuideProgress())

  if (mode === 'tutorial') {
    return <TutorialGame onExit={() => { refresh(); setMode('home') }} />
  }

  if (lessonId) {
    return (
      <Lesson
        lesson={LESSONS[lessonId]}
        done={progress.completedLessons.includes(lessonId)}
        onComplete={() => { markLessonComplete(lessonId); refresh() }}
        onReset={() => { resetLesson(lessonId); refresh() }}
        onBack={() => setLessonId(null)}
      />
    )
  }

  if (mode === 'glossary') return <Glossary onBack={() => setMode('home')} />

  if (trackId) {
    const track = TRACKS.find((t) => t.id === trackId)
    return (
      <Track
        track={track}
        progress={progress}
        onOpen={setLessonId}
        onBack={() => setTrackId(null)}
      />
    )
  }

  const tutorialDone = progress.completedLessons.includes('tutorial')
  const inProgress = typeof progress.tutorialState === 'number' && progress.tutorialState > 0

  return (
    <div className="stack">
      <div>
        <h1>Learn Magic</h1>
        <p className="muted">
          Three ways in, depending on how you learn. Nothing here needs a connection.
        </p>
      </div>

      <SeasonBanner onExplore={onExploreQuery} />

      <section className="hero" onClick={() => setMode('tutorial')} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setMode('tutorial') }}>
        <div className="hero__label">Start here</div>
        <h2>Play your first game</h2>
        <p>
          A real game against a scripted opponent, with a coach explaining every step —
          why you play a land before a spell, why attacking is a question, what the stack
          is actually for. You make the plays. It takes about ten minutes.
        </p>
        <div className="row">
          <span className="btn btn--primary">
            {tutorialDone ? 'Play again' : inProgress ? 'Resume' : 'Begin'}
          </span>
          {tutorialDone && <span className="chip chip--ok">completed</span>}
          {inProgress && !tutorialDone && (
            <span className="chip">paused at step {progress.tutorialState + 1}</span>
          )}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>Lessons</h2></div>
        <p className="muted tiny" style={{ marginTop: -4 }}>
          Pick the track that matches where you are starting from.
        </p>
        <div className="track-grid">
          {TRACKS.map((track) => {
            const done = track.lessons.filter((id) => progress.completedLessons.includes(id)).length
            return (
              <button className="panel track" key={track.id} onClick={() => setTrackId(track.id)}>
                <h3>{track.name}</h3>
                <p className="muted tiny">{track.blurb}</p>
                <div className="row">
                  <div className="meter" style={{ flex: 1 }}>
                    <div className="meter__fill" style={{
                      width: `${(done / track.lessons.length) * 100}%`, background: 'var(--accent)',
                    }} />
                  </div>
                  <span className="faint tiny">{done}/{track.lessons.length}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>Look anything up</h2></div>
        <button className="panel track" onClick={() => setMode('glossary')} style={{ width: '100%' }}>
          <h3>Glossary</h3>
          <p className="muted tiny" style={{ margin: 0 }}>
            Every term in plain English. These also appear as dotted underlines everywhere
            else in the app — tap <Term id="stack" /> or <Term id="colorIdentity" /> to see.
          </p>
        </button>
      </section>

      <section className="panel">
        <h3>When you are ready</h3>
        <p className="muted tiny">
          Build a deck and the app checks it against the real format rules as you go, or open
          the life counter for a game with physical cards.
        </p>
        <div className="row">
          <button className="btn btn--sm" onClick={() => onNavigate('decks')}>Build a deck</button>
          <button className="btn btn--sm" onClick={() => onNavigate('play')}>Life counter</button>
        </div>
      </section>
    </div>
  )
}

function Track({ track, progress, onOpen, onBack }) {
  return (
    <div className="stack">
      <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Learn
      </button>
      <div>
        <h1>{track.name}</h1>
        <p className="muted">{track.blurb}</p>
      </div>
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        {track.lessons.map((id, i) => {
          const lesson = LESSONS[id]
          const done = progress.completedLessons.includes(id)
          return (
            <button className={`lesson-row ${done ? 'lesson-row--done' : ''}`} key={id} onClick={() => onOpen(id)}>
              <span className="lesson-row__num">{done ? '✓' : i + 1}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {lesson.title}
                <span className="faint tiny"> · {lesson.minutes} min</span>
              </span>
              <span className="faint">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Lesson({ lesson, done, onComplete, onReset, onBack }) {
  const [answered, setAnswered] = useState(null)
  const chosen = answered != null ? lesson.quiz.options[answered] : null

  return (
    <div className="stack">
      <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Back
      </button>

      <div>
        <h1>{lesson.title}</h1>
        {done && <span className="chip chip--ok">completed</span>}
      </div>

      <div className="prose">
        {lesson.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
      </div>

      {lesson.terms?.length > 0 && (
        <div className="row row--wrap">
          <span className="faint tiny">Terms in this lesson</span>
          {lesson.terms.map((id) => <Term key={id} id={id} as="span" />)}
        </div>
      )}

      <section className="panel stack">
        <h3>Check yourself</h3>
        <p style={{ margin: 0 }}>{lesson.quiz.question}</p>
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          {lesson.quiz.options.map((option, i) => {
            const isChosen = answered === i
            const state = answered == null ? '' : option.correct ? 'quiz-option--correct'
              : isChosen ? 'quiz-option--wrong' : 'quiz-option--muted'
            return (
              <button
                key={i}
                className={`quiz-option ${state}`}
                onClick={() => { if (answered == null) setAnswered(i) }}
                disabled={answered != null}
              >
                <span className="quiz-option__mark">
                  {answered == null ? '' : option.correct ? '✓' : isChosen ? '✕' : ''}
                </span>
                <span>{option.text}</span>
              </button>
            )
          })}
        </div>

        {chosen && (
          <div className={`banner banner--${chosen.correct ? 'info' : 'warn'}`}>
            <strong>{chosen.correct ? 'Right.' : 'Not quite.'}</strong> {chosen.why}
            {!chosen.correct && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                The answer is <strong>{lesson.quiz.options.find((o) => o.correct).text}</strong>
                {' — '}{lesson.quiz.options.find((o) => o.correct).why}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="row">
        {!done && (
          <button className="btn btn--primary" onClick={() => { onComplete(); onBack() }}>
            Mark complete
          </button>
        )}
        {done && <button className="btn btn--ghost btn--sm" onClick={onReset}>Mark unread</button>}
        {answered != null && (
          <button className="btn btn--ghost btn--sm" onClick={() => setAnswered(null)}>Try again</button>
        )}
      </div>
    </div>
  )
}

function Glossary({ onBack }) {
  const [openTerm, setOpenTerm] = useState(null)
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()

  return (
    <div className="stack">
      <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Learn
      </button>
      <h1>Glossary</h1>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter terms"
        aria-label="Filter glossary"
      />

      {GLOSSARY_SECTIONS.map((section) => {
        const keys = section.keys.filter((key) => {
          if (!needle) return true
          const entry = lookupTerm(key)
          return entry.term.toLowerCase().includes(needle)
            || entry.short.toLowerCase().includes(needle)
        })
        if (!keys.length) return null
        return (
          <section key={section.title}>
            <div className="section-title"><h2>{section.title}</h2></div>
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              {keys.map((key) => {
                const entry = lookupTerm(key)
                return (
                  <button className="glossary-row" key={key} onClick={() => setOpenTerm(key)}>
                    <strong>{entry.term}</strong>
                    <span className="muted tiny">{entry.short}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      <Sheet
        open={!!openTerm}
        onClose={() => setOpenTerm(null)}
        title={openTerm ? lookupTerm(openTerm).term : ''}
      >
        {openTerm && <TermBody entry={lookupTerm(openTerm)} />}
      </Sheet>
    </div>
  )
}
