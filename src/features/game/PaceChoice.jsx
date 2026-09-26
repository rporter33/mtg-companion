import { useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_PRESET, PRESETS, PRESET_NAMES, PRESET_TAGLINES, PRESET_CHIPS, PRESET_LINES,
  STOPS, STOPS_NAMES, STOPS_WORDS, SPEEDS, SPEED_NAMES, EXPLAIN_NAMES, PAYING_LINE, STACK_LINE, fixedLine, speedLine,
} from '../../lib/engine/pace.js'

/**
 * "How do you want to play?" — the pace presets at the engine's table
 * (docs/MOXGATE_STUDY.md, "Pace is chosen once, as a posture"; TARGET.md §5;
 * lib/engine/pace.js). Three presets as radios, each saying what it does, and
 * under Advanced the settings each one actually sets, which may be changed one
 * at a time: the preset is a bundle, and the settings are the truth.
 *
 * Asked once, the first time a person sits at the engine's table (`first`),
 * as a panel on the table rather than a dialog in front of it: the seat is
 * already taken and the engine deals behind it, with the owner's choice —
 * `DEFAULT_PRESET`, Fast since 2026-09-26 — in force until another is picked
 * (HANDOFF.md §3 item 24), and the words name whichever that is. The same
 * choice lives on in the table's own settings, where it can be changed at any
 * time, a change taking effect at once.
 *
 * `room` is what the relay says the table is doing (`useEngineRoom`'s `pace`):
 * null until it has said, `{ older: true }` from a relay older than the choice,
 * and otherwise `{ room }`, the room's report. Where the table cannot do what
 * is chosen, the panel says so in words beside the choice rather than letting
 * the choice look as though it took.
 *
 * Where it is narrow — a phone, or the column beside the table where the first
 * question sits on a wide screen — each preset shows its name and tagline, and
 * what it does and its chip open with Advanced (game.css); a screen reader
 * hears them either way, as each radio's description. `waiting` says a stop is
 * waiting on the person, whose prompt then holds the one primary button, so
 * "Play …" steps back to a plain one. `onShown` is told once the first
 * question is on screen, with its element, for the table to bring it into view.
 *
 * Nothing here moves: the chosen preset is marked by its border and its radio,
 * and the Advanced part opens without an animation, so there is no motion to
 * reduce.
 */
export default function PaceChoice({ pace, room = null, first = false, taught = false, waiting = false, onChoose, onDone = null, onTeachAgain = null, onShown = null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef(null)
  const said = room?.room ?? null
  const notes = []
  if (room?.older) notes.push('This relay is older than this choice: the game stops only where you can play, and the engine’s turn goes at the relay’s own pace, whatever is chosen here.')
  if (said?.fixed && said.stops !== pace.stops) notes.push(fixedLine(said.stops))
  if (said && !said.paced) notes.push('This table plays the engine’s turn in one go, so the speed sets nothing here.')
  // Once, as it first appears: the table decides what that means for the scroll.
  useEffect(() => {
    if (first && ref.current) onShown?.(ref.current)
    // Told once a mount, not again at every change of the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const radios = (name, legend, options, current, labelOf, lineOf, onPick) => (
    <fieldset className="pacechoice__setting">
      <legend className="pacechoice__legend">{legend}</legend>
      {options.map((o) => (
        <label key={String(o)} className={`pacechoice__option${current === o ? ' pacechoice__option--on' : ''}`}>
          <input type="radio" name={`${id}-${name}`} checked={current === o} onChange={() => onPick(o)}
            aria-labelledby={`${id}-${name}-${o}`} aria-describedby={lineOf ? `${id}-${name}-${o}-line` : undefined} />
          <span id={`${id}-${name}-${o}`} className="pacechoice__optionname">{labelOf(o)}</span>
          {lineOf && <span id={`${id}-${name}-${o}-line`} className="pacechoice__optionline faint tiny">{lineOf(o)}</span>}
        </label>
      ))}
    </fieldset>
  )

  return (
    <section ref={ref} className={`pacechoice${first ? ' pacechoice--first' : ''}${open ? ' pacechoice--open' : ''}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="pacechoice__title">{first ? 'How do you want to play?' : 'How you play'}</h2>
      <p className="faint tiny m0">
        {first
          ? `Asked once. ${PRESET_NAMES[DEFAULT_PRESET]} is chosen until you pick another, and any of this can be changed later from the table’s More button (…), under “How you play”.`
          : 'A change takes effect at once; where the game stops, from the next window.'}
      </p>
      <fieldset className="pacechoice__presets">
        <legend className="sr-only">Presets</legend>
        {PRESETS.map((p) => (
          <label key={p} className={`pacechoice__preset${pace.preset === p ? ' pacechoice__preset--on' : ''}`}>
            {/* Named by the preset and its tagline, and described by what it does, so a screen
                reader moving between the three hears a name, and the rest once it stops on one. */}
            <input type="radio" name={`${id}-preset`} value={p} checked={pace.preset === p} onChange={() => onChoose({ preset: p })}
              aria-labelledby={`${id}-${p}-name ${id}-${p}-tag`} aria-describedby={`${id}-${p}-line ${id}-${p}-chip`} />
            <span id={`${id}-${p}-name`} className="pacechoice__name">{PRESET_NAMES[p]}</span>
            <span id={`${id}-${p}-tag`} className="pacechoice__tag">{PRESET_TAGLINES[p]}</span>
            <span id={`${id}-${p}-line`} className="pacechoice__line faint tiny">{PRESET_LINES[p]}</span>
            <span id={`${id}-${p}-chip`} className="chip tiny pacechoice__chip">{PRESET_CHIPS[p]}</span>
          </label>
        ))}
      </fieldset>
      {!pace.preset && (
        <p className="tiny m0 pacechoice__own">
          Your own mix: the game stops {STOPS_WORDS[pace.stops]}, {SPEED_NAMES[pace.speed]}, and steps {pace.explain ? 'explained the first three times' : 'not explained'}.
        </p>
      )}
      {notes.map((n) => <p key={n} className="tiny m0 pacechoice__note" role="status">{n}</p>)}
      <button
        type="button"
        className="btn btn--ghost btn--sm pacechoice__more"
        aria-expanded={open}
        aria-controls={`${id}-advanced`}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? '▴' : '▾'}</span> Advanced
      </button>
      <div id={`${id}-advanced`} className="pacechoice__advanced" hidden={!open}>
        <p className="faint tiny m0">What the chosen preset sets. Change any of them, and the choice becomes your own mix.</p>
        {radios('stops', 'Where the game stops for you', STOPS, pace.stops, (s) => STOPS_NAMES[s],
          (s) => (s === 'playable' ? 'Every window with nothing you can play in it is passed for you, and the log says how many.' : 'Every priority window, both turns, waits for your pass.'),
          (s) => onChoose({ stops: s }))}
        {radios('speed', 'How long each of the engine’s plays stands', SPEEDS, pace.speed, (s) => SPEED_NAMES[s],
          (s) => speedLine(s, said && said.paced && said.speed === s ? said.ms : null),
          (s) => onChoose({ speed: s }))}
        {radios('explain', 'What each step is for', [false, true], pace.explain, (on) => EXPLAIN_NAMES[on ? 'on' : 'off'],
          (on) => (on ? 'At a stop, the step says what it is for, from the turn’s own reference with its rule numbers, the first three times you stop in it.' : 'The steps are not explained at a stop; the turn panel beside the log always has them.'),
          (on) => onChoose({ explain: on }))}
        {pace.explain && taught && onTeachAgain && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onTeachAgain}>Explain every step again</button>
        )}
        <p className="faint tiny m0">{STACK_LINE}</p>
        <p className="faint tiny m0">{PAYING_LINE}</p>
        <p className="faint tiny m0">The presets, Relaxed at twice the table’s own pace, and the three times are this app’s own choices.</p>
      </div>
      {first && onDone && (
        <div className="row row--wrap">
          <button type="button" className={`btn ${waiting ? 'btn--ghost' : 'btn--primary'} btn--sm`} onClick={onDone}>
            {pace.preset ? `Play ${PRESET_NAMES[pace.preset]} →` : 'Play my own mix →'}
          </button>
        </div>
      )}
    </section>
  )
}
