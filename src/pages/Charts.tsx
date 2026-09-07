import { useMemo, useState } from 'react'
import { useStore, childName } from '../lib/store'
import { ActionButton, Card, Field, PageHead } from '../components/ui'
import { openDraft, trimBody } from '../lib/email'
import { activitiesCSV } from '../lib/exporters'
import { printNode, shareOrDownload } from '../lib/printing'
import {
  CARE_ROWS, CHECK_OFFSETS, careBlocks, sleepBlocks,
} from '../lib/chartdata'
import { addDays, formatDate, startOfWeek, today, weekOptions } from '../lib/dates'

type Which = 'sleep' | 'care'

/**
 * The two charts the service wants back on paper: sleep monitoring and care
 * routines. Laid out to match the printed forms so a page can be filled from
 * what was logged, printed or saved as a PDF, and sent on.
 *
 * The logo is whatever the service supplied, uploaded in Settings — this app
 * does not draw anyone else's mark.
 */
export default function Charts() {
  const { db } = useStore()
  const s = db.settings
  const [which, setWhich] = useState<Which>('sleep')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today()))
  const [childId, setChildId] = useState('all')

  const weekEnd = addDays(weekStart, 4)
  const range = `${formatDate(weekStart, s.locale)} – ${formatDate(weekEnd, s.locale)}`

  const sleeps = useMemo(
    () => sleepBlocks(db, weekStart, weekEnd, childId),
    [db, weekStart, weekEnd, childId],
  )
  const cares = useMemo(
    () => careBlocks(db, weekStart, weekEnd, childId),
    [db, weekStart, weekEnd, childId],
  )

  const count = which === 'sleep' ? sleeps.length : cares.length
  const titleFor = which === 'sleep'
    ? 'Sleep Monitoring Chart'
    : 'Care Routines Chart'

  const emailChart = () => {
    openDraft({
      to: s.activityEmail,
      subject: `${titleFor} — ${s.educatorName || s.businessName} — ${range}`,
      body: trimBody(
        `Kia ora,\n\n${titleFor} for ${range}.\n\n` +
        `${count} ${count === 1 ? 'entry' : 'entries'} recorded. The chart is attached as a PDF.\n\n` +
        `${s.educatorName || s.businessName}\n`,
      ),
    }, s)
  }

  return (
    <>
      <PageHead
        title="Charts"
        subtitle={range}
        actions={
          <>
            <div className="segmented">
              <button className={which === 'sleep' ? 'seg active' : 'seg'}
                      onClick={() => setWhich('sleep')}>Sleep</button>
              <button className={which === 'care' ? 'seg active' : 'seg'}
                      onClick={() => setWhich('care')}>Care routines</button>
            </div>
            <button className="btn" onClick={() => setWeekStart(addDays(weekStart, -7))}
                    aria-label="Previous week">‹</button>
            <select className="input week-select" value={weekStart} aria-label="Week"
                    onChange={e => setWeekStart(e.target.value)}>
              {weekOptions(weekStart).map(w => (
                <option key={w.monday} value={w.monday}>{w.label}</option>
              ))}
            </select>
            <button className="btn" onClick={() => setWeekStart(addDays(weekStart, 7))}
                    aria-label="Next week">›</button>
          </>
        }
      />

      <Card className="no-print">
        <div className="toolbar">
          <Field label="Child">
            <select className="input" value={childId} onChange={e => setChildId(e.target.value)}>
              <option value="all">All children</option>
              {db.children.map(c => <option key={c.id} value={c.id}>{childName(c)}</option>)}
            </select>
          </Field>
          <span className="spacer" />
          <ActionButton icon="🖨" label="Print / save PDF"
                        onClick={() => printNode('.bn-sheet', `${titleFor} ${range}`)} />
          <ActionButton icon="⬇" label="CSV of the log"
                        onClick={() => void shareOrDownload(`activities-${weekStart}.csv`, activitiesCSV(db, weekStart, weekEnd), 'text/csv')} />
          <ActionButton icon="✉" label="Email chart" primary
                        disabled={!s.activityEmail || count === 0} onClick={emailChart} />
        </div>
        {!s.serviceLogo && (
          <p className="muted small">
            Upload the service's logo in Settings and it will print in the top corner.
          </p>
        )}
        {!s.activityEmail && (
          <p className="muted small">Set the activity email address in Settings before emailing.</p>
        )}
        <p className="muted small">
          Bottle feeds and comments are not recorded in the app, so those columns print
          blank for a pen. Save the PDF first, then attach it to the message.
        </p>
      </Card>

      {count === 0 ? (
        <Card><p className="muted">
          Nothing logged for {range}. Log sleeps and nappies under Activities and they will
          fill these in.
        </p></Card>
      ) : which === 'sleep' ? <SleepChart blocks={sleeps} /> : <CareChart blocks={cares} />}
    </>
  )
}

function ChartHead({ title, note }: { title: string; note?: string }) {
  const { db } = useStore()
  const s = db.settings
  return (
    <header className="bn-head">
      <div className="bn-titlerow">
        <h2 className="bn-title">{title}</h2>
        {s.serviceLogo
          ? <img className="bn-logo" src={s.serviceLogo} alt="" />
          : <span className="bn-logo-slot no-print">logo</span>}
      </div>
      <div className="bn-educator">
        <span className="bn-label">Educator:</span>
        <span className="bn-fill">{s.educatorName}</span>
      </div>
      {note && <p className="bn-note">{note}</p>}
    </header>
  )
}

const SLEEP_NOTE =
  'Note: Check each sleeping child every 10-15 minutes for warmth, (warm/cold to touch); ' +
  'breathing (stomach is seen to be rising, back of hand to feel for breath near child’s face); ' +
  'and general well-being (face is not covered by bedding). Room temperature is no lower than ' +
  '18°C. Please start recording the time from when the child enters the room.'

function SleepChart({ blocks }: { blocks: ReturnType<typeof sleepBlocks> }) {
  const { db } = useStore()
  const rowLabels = ['Time in bed:', 'Time asleep:', 'Time awake:'] as const

  return (
    <article className="bn-sheet">
      <ChartHead title="Sleep Monitoring Chart - Home Based" note={SLEEP_NOTE} />

      {blocks.map((b, i) => (
        // Five blocks to a page, as the paper form is laid out.
        <section className={`bn-block ${i > 0 && i % 5 === 0 ? 'page-break' : ''}`} key={b.key}>
          <div className="bn-idrow">
            <span className="bn-label">Child:</span>
            <span className="bn-fill">{b.child}</span>
            <span className="bn-label">Date:</span>
            <span className="bn-fill">{formatDate(b.date, db.settings.locale)}</span>
          </div>

          <table className="bn-table">
            <thead>
              <tr>
                <th className="bn-th" colSpan={2}>Sleep &amp; Rest<br />Time</th>
                <th className="bn-th-soft" colSpan={6}>
                  Time checked<br /><small>(Write in the time checked)</small>
                </th>
                <th className="bn-th-soft">Time</th>
                <th className="bn-th-soft">Room<br />Temperature</th>
                <th className="bn-th-soft">Comments</th>
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((label, r) => (
                <tr key={label}>
                  <td className="bn-rowlabel">{label}</td>
                  <td className="bn-value">
                    {r === 0 ? b.inBed : r === 1 ? b.asleep : b.awake}
                  </td>
                  {CHECK_OFFSETS[r].map(offset => (
                    <td className="bn-check" key={offset}>
                      <small className="bn-offset">{offset}</small>
                      <span className="bn-checktime">{b.checked[offset] ?? ''}</span>
                    </td>
                  ))}
                  {r === 0 && <td className="bn-meridiem" rowSpan={2}>(am)</td>}
                  {r === 2 && <td className="bn-meridiem">(pm)</td>}
                  {r === 0 && <td className="bn-value" rowSpan={3}>{b.roomTemp}</td>}
                  {r === 0 && <td className="bn-blank" rowSpan={3} />}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </article>
  )
}

function CareChart({ blocks }: { blocks: ReturnType<typeof careBlocks> }) {
  const { db } = useStore()

  return (
    <article className="bn-sheet">
      <ChartHead title="Care Routines Chart – Home Based" />

      {blocks.map((b, i) => (
        <section className={`bn-block ${i > 0 && i % 3 === 0 ? 'page-break' : ''}`} key={b.key}>
          <div className="bn-idrow">
            <span className="bn-label">Child:</span>
            <span className="bn-fill">{b.child}</span>
            <span className="bn-label">Date:</span>
            <span className="bn-fill">{formatDate(b.date, db.settings.locale)}</span>
          </div>

          <table className="bn-table care">
            <thead>
              <tr>
                <th className="bn-th">Nappies/<br />Toileting</th>
                <th className="bn-th-soft"><small>Medication</small><br /><small>(if any, write ✓)</small></th>
                <th className="bn-th-soft narrow">W<br /><small>Wet</small></th>
                <th className="bn-th-soft narrow">S<br /><small>Soiled</small></th>
                <th className="bn-th-soft narrow">D<br /><small>Dry</small></th>
                <th className="bn-th-soft" colSpan={2}>Bottle Feeding Record</th>
                <th className="bn-th-soft">Sun Block<br />Application</th>
                <th className="bn-th-soft">Comments</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.slice(0, CARE_ROWS).map((row, r) => (
                <tr key={r}>
                  <td className="bn-rowlabel">
                    Time: <span className="bn-inline">{row.time}</span>
                  </td>
                  <td className="bn-value">{row.medication}</td>
                  <td className="bn-tick">{row.wet ? '✓' : ''}</td>
                  <td className="bn-tick">{row.soiled ? '✓' : ''}</td>
                  <td className="bn-tick">{row.dry ? '✓' : ''}</td>
                  <td className="bn-sub">Time<br />Prepared:</td>
                  <td className="bn-sub">Amount<br />given (mls):</td>
                  <td className="bn-sub">Time<br />given:</td>
                  <td className="bn-value">{row.sunblock}</td>
                  {r === 0 && <td className="bn-blank" rowSpan={CARE_ROWS} />}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <footer className="bn-foot">
        Barnardos Early Learning Home Based – Care Routines Chart
      </footer>
    </article>
  )
}
