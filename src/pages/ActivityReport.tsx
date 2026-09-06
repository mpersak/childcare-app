import { useMemo, useState } from 'react'
import { useStore, childName } from '../lib/store'
import { Card, Field, PageHead } from '../components/ui'
import { openDraft, trimBody } from '../lib/email'
import { download, activitiesCSV } from '../lib/exporters'
import { addDays, formatDate, startOfWeek, timeToMinutes, today } from '../lib/dates'

/** Nappies and sleeps over a period, for printing or sending on. */
export default function ActivityReport() {
  const { db } = useStore()
  const s = db.settings
  const [from, setFrom] = useState(() => startOfWeek(today()))
  const [to, setTo] = useState(() => addDays(startOfWeek(today()), 6))
  const [childId, setChildId] = useState('all')

  const rows = useMemo(() => {
    return db.activities
      .filter(a => a.date >= from && a.date <= to)
      .filter(a => childId === 'all' || a.childId === childId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  }, [db.activities, from, to, childId])

  const byChild = useMemo(() => {
    const map = new Map<string, { nappies: number; sleepMinutes: number; checksDone: number; checksTotal: number }>()
    for (const a of rows) {
      const cur = map.get(a.childId) ?? { nappies: 0, sleepMinutes: 0, checksDone: 0, checksTotal: 0 }
      if (a.kind === 'nappy') cur.nappies++
      else {
        const f = timeToMinutes(a.time), t = timeToMinutes(a.endTime ?? '')
        if (f !== null && t !== null && t > f) cur.sleepMinutes += t - f
        cur.checksTotal += a.checks?.length ?? 0
        cur.checksDone += a.checks?.filter(c => c.done).length ?? 0
      }
      map.set(a.childId, cur)
    }
    return [...map.entries()]
  }, [rows])

  const range = `${formatDate(from, s.locale)} – ${formatDate(to, s.locale)}`

  const emailReport = () => {
    const lines = byChild.map(([id, v]) =>
      `${childName(db.children.find(c => c.id === id))}: ${v.nappies} nappies, ` +
      `${Math.floor(v.sleepMinutes / 60)}h ${v.sleepMinutes % 60}m sleep` +
      (v.checksTotal ? `, ${v.checksDone}/${v.checksTotal} sleep checks recorded` : ''))

    openDraft({
      to: s.activityEmail,
      subject: `Activity report — ${range}`,
      body: trimBody(
        `Kia ora,\n\nActivity summary for ${range}.\n\n${lines.join('\n')}\n\n` +
        `The full log is attached.\n\n${s.educatorName || s.businessName}\n`,
      ),
    }, s)
  }

  return (
    <>
      <PageHead title="Activity report" subtitle={range} />

      <Card className="no-print">
        <div className="toolbar">
          <Field label="From">
            <input className="input tight" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input tight" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </Field>
          <Field label="Child">
            <select className="input" value={childId} onChange={e => setChildId(e.target.value)}>
              <option value="all">All children</option>
              {db.children.map(c => <option key={c.id} value={c.id}>{childName(c)}</option>)}
            </select>
          </Field>
          <span className="spacer" />
          <button className="btn" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn" disabled={rows.length === 0}
                  onClick={() => download(`activities-${from}.csv`, activitiesCSV(db, from, to), 'text/csv')}>
            CSV
          </button>
          <button className="btn primary" disabled={!s.activityEmail || rows.length === 0}
                  onClick={emailReport}>
            Email report
          </button>
        </div>
        {!s.activityEmail && (
          <p className="muted small">Set the activity report email address in Settings before emailing.</p>
        )}
      </Card>

      <Card title="Summary">
        {byChild.length === 0 ? <p className="muted">Nothing logged in this period.</p> : (
          <table className="table">
            <thead>
              <tr><th>Child</th><th className="num">Nappies</th><th className="num">Sleep</th>
                  <th className="num">Sleep checks recorded</th></tr>
            </thead>
            <tbody>
              {byChild.map(([id, v]) => (
                <tr key={id}>
                  <td>{childName(db.children.find(c => c.id === id))}</td>
                  <td className="num">{v.nappies}</td>
                  <td className="num">{Math.floor(v.sleepMinutes / 60)}h {v.sleepMinutes % 60}m</td>
                  <td className="num">
                    {v.checksTotal ? `${v.checksDone} / ${v.checksTotal}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Full log (${rows.length})`}>
        {rows.length === 0 ? <p className="muted">Nothing to show.</p> : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Time</th><th>Child</th><th>What</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id}>
                    <td>{formatDate(a.date, s.locale)}</td>
                    <td>{a.time}{a.endTime ? `–${a.endTime}` : ''}</td>
                    <td>{childName(db.children.find(c => c.id === a.childId))}</td>
                    <td>{a.kind === 'nappy' ? 'Nappy' : 'Sleep'}</td>
                    <td>
                      {a.kind === 'nappy'
                        ? a.nappy
                        : a.checks?.length
                          ? `${a.checks.filter(c => c.done).length}/${a.checks.length} checks recorded`
                          : 'no checks generated'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
