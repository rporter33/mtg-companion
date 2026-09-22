import { describe, it, expect } from 'vitest'
import { curationStatus, curationNote, themeNote } from '../src/lib/curation.js'
import { releaseLabel } from '../src/lib/release.js'

/**
 * How current a hand-written set entry is, worked out from its own dates and
 * its set's release date. Every call is given the day, so the suite means the
 * same after these dates as before them.
 */

const ENTRY = { curatedAt: '2026-09-16', provisional: true }
const RELEASE = '2026-10-02'
// "16 Sep 2026" or "16 Sept 2026", as the runtime's own British date data
// abbreviates September; tests/release.test.js checks the format itself.
const SEP16 = releaseLabel('2026-09-16')

describe('curationStatus', () => {
  it('is provisional before release, whatever the entry says', () => {
    expect(curationStatus(ENTRY, RELEASE, '2026-10-01')).toMatchObject({ state: 'preview', provisional: true })
    expect(curationStatus({ ...ENTRY, provisional: false }, RELEASE, '2026-10-01')).toMatchObject({ state: 'preview', provisional: true })
  })

  it('is no longer provisional from release day, whatever the entry says', () => {
    expect(curationStatus(ENTRY, RELEASE, RELEASE)).toMatchObject({ state: 'unchecked', provisional: false, writtenOn: '2026-09-16', releasedOn: RELEASE })
  })

  it('counts a check only from release day on', () => {
    expect(curationStatus({ ...ENTRY, checkedAt: RELEASE }, RELEASE, '2026-10-05')).toMatchObject({ state: 'checked', checkedOn: RELEASE })
    // A check dated before release cannot have been against the released cards.
    expect(curationStatus({ ...ENTRY, checkedAt: '2026-09-30' }, RELEASE, '2026-10-05')).toMatchObject({ state: 'unchecked', checkedOn: null })
  })

  it('counts a check only once its day has come', () => {
    // The owner adds checkedAt: '2026-10-09'. Before that day nothing had been
    // checked, and the note does not say otherwise.
    const checked = { ...ENTRY, checkedAt: '2026-10-09' }
    expect(curationStatus(checked, RELEASE, RELEASE)).toMatchObject({ state: 'unchecked', checkedOn: null })
    expect(curationStatus(checked, RELEASE, '2026-10-05')).toMatchObject({ state: 'unchecked', checkedOn: null })
    expect(curationStatus(checked, RELEASE, '2026-10-09')).toMatchObject({ state: 'checked', checkedOn: '2026-10-09' })
    expect(curationStatus(checked, RELEASE, '2027-03-01')).toMatchObject({ state: 'checked', checkedOn: '2026-10-09' })
  })

  it('needs no check for an entry written on or after release day', () => {
    expect(curationStatus({ curatedAt: '2026-10-10' }, RELEASE, '2026-10-20')).toMatchObject({ state: 'written', provisional: false })
    expect(curationStatus({ curatedAt: RELEASE }, RELEASE, RELEASE).state).toBe('written')
  })

  it('falls back on the author’s note when the release date is not known', () => {
    expect(curationStatus(ENTRY, undefined, '2026-10-20')).toMatchObject({ state: 'preview', provisional: true })
    expect(curationStatus({ curatedAt: '2026-09-16' }, 'soon', '2026-10-20')).toMatchObject({ state: 'written', provisional: false })
  })

  it('reads an entry an older build or a slip left malformed without throwing', () => {
    expect(curationStatus(null, RELEASE, '2026-10-20')).toMatchObject({ state: 'unchecked', writtenOn: null })
    expect(curationStatus({ curatedAt: 20260916, checkedAt: 'yes' }, RELEASE, '2026-10-20')).toMatchObject({ state: 'unchecked', writtenOn: null, checkedOn: null })
  })
})

describe('curationNote', () => {
  const on = (entry, day, options) => curationNote(curationStatus(entry, RELEASE, day), options)

  it('says in words, with dates, where the entry stands', () => {
    expect(on(ENTRY, '2026-09-21')).toBe(`Written on ${SEP16} from previews; the set comes out on 2 Oct 2026, and wording sometimes changes before release.`)
    expect(on(ENTRY, '2026-10-02')).toBe(`Written on ${SEP16} from previews, before release on 2 Oct 2026; not yet checked against the released cards.`)
    expect(on({ ...ENTRY, checkedAt: '2026-10-09' }, '2026-10-20')).toBe(`Written on ${SEP16} from previews, before release on 2 Oct 2026; checked against the released cards on 9 Oct 2026.`)
    expect(on({ curatedAt: '2026-10-10' }, '2026-10-20')).toBe('Written on 10 Oct 2026, after release on 2 Oct 2026.')
  })

  it('gives the age after the date it was written, when asked', () => {
    expect(on(ENTRY, '2026-09-21', { ageDays: 5 })).toMatch(new RegExp(`^Written on ${SEP16} \\(5 days ago\\) from previews;`))
    expect(on(ENTRY, '2026-09-17', { ageDays: 1 })).toMatch(/\(1 day ago\)/)
    expect(on(ENTRY, '2026-09-16', { ageDays: 0 })).not.toMatch(/ago/)
  })

  it('leaves out a release date the line has already given, once the set is out', () => {
    const shown = { releaseShown: true }
    expect(on(ENTRY, '2026-10-02', shown)).toBe(`Written on ${SEP16} from previews, before release; not yet checked against the released cards.`)
    expect(on({ ...ENTRY, checkedAt: '2026-10-09' }, '2026-10-20', shown)).toBe(`Written on ${SEP16} from previews, before release; checked against the released cards on 9 Oct 2026.`)
    expect(on({ curatedAt: '2026-10-10' }, '2026-10-20', shown)).toBe('Written on 10 Oct 2026, after release.')
    expect(on({}, '2026-10-20', shown)).toBe('Written by hand; not yet checked against the released cards.')
    // Before release the note is the one to say when the set comes out.
    expect(on(ENTRY, '2026-09-21', shown)).toMatch(/the set comes out on 2 Oct 2026/)
    for (const day of ['2026-10-02', '2026-10-20']) expect(on(ENTRY, day, shown)).not.toMatch(/2 Oct/)
  })

  it('never claims a date it does not have', () => {
    expect(on({}, '2026-10-20')).toBe('Written by hand; not yet checked against the cards released on 2 Oct 2026.')
    expect(curationNote(curationStatus(ENTRY, null, '2026-10-20'))).toBe(`Written on ${SEP16} from previews; wording sometimes changes before release.`)
    expect(curationNote(curationStatus({ curatedAt: '2026-09-16' }, null, '2026-10-20'))).toBe(`Written on ${SEP16}.`)
    expect(curationNote(null)).toBe('')
  })
})

describe('themeNote', () => {
  it('never calls a curated theme official, before release or after', () => {
    for (const day of ['2026-09-21', '2026-10-02', '2027-01-01']) {
      expect(themeNote(curationStatus(ENTRY, RELEASE, day))).toMatch(/app’s own reading.*not official\./)
    }
  })

  it('passes its options to the note, as the season banner does beside "Released 2 Oct 2026"', () => {
    expect(themeNote(curationStatus(ENTRY, RELEASE, '2026-10-02'), { releaseShown: true }))
      .toBe(`Colours and lore here are the app’s own reading, not official. Written on ${SEP16} from previews, before release; not yet checked against the released cards.`)
  })
})
