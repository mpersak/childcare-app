import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, childName } from '../lib/store'
import { Card, EmptyState, PageHead, Stat } from '../components/ui'
import { HorizontalBars, MonthlyRevenueChart } from '../components/charts'
import { paidRatio, summarise } from '../lib/finance'
import { amountDue, isOverdue } from '../lib/invoicing'
import { formatMoney } from '../lib/money'
import { formatDate, formatHours, today } from '../lib/dates'
import { attendanceCSV, download, invoicesCSV } from '../lib/exporters'

export default function Finance() {
  const { db } = useStore()
  const { currency, locale } = db.settings
  const [months, setMonths] = useState(12)

  const fin = useMemo(() => summarise(db, today(), months), [db, months])
  const collection = useMemo(() => paidRatio(db), [db])

  const trend = fin.lastMonth > 0
    ? ((fin.monthToDate - fin.lastMonth) / fin.lastMonth) * 100
    : null

  const chasing = useMemo(
    () => db.invoices
      .filter(i => i.status !== 'void' && i.status !== 'draft' && amountDue(i) > 0.005)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 8),
    [db.invoices],
  )

  if (db.invoices.length === 0 && db.attendance.length === 0) {
    return (
      <>
        <PageHead title="Finance" />
        <Card>
          <EmptyState title="No financial history yet">
            Record attendance, then generate invoices — this page fills in from there.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHead
        title="Finance"
        subtitle={`Revenue is shown excluding ${db.settings.taxEnabled ? db.settings.taxName : 'tax'}`}
        actions={
          <>
            <select className="input" value={months} onChange={e => setMonths(Number(e.target.value))}>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
            </select>
            <button className="btn" onClick={() => download('invoices.csv', invoicesCSV(db), 'text/csv')}>
              Invoices CSV
            </button>
            <button className="btn" onClick={() => download('attendance.csv', attendanceCSV(db), 'text/csv')}>
              Attendance CSV
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <Stat
          label="This month invoiced"
          value={formatMoney(fin.monthToDate, currency, locale)}
          sub={trend === null
            ? `Last month ${formatMoney(fin.lastMonth, currency, locale)}`
            : `${trend >= 0 ? '+' : ''}${trend.toFixed(0)}% vs last month`}
          tone={trend === null ? 'neutral' : trend >= 0 ? 'good' : 'warn'}
        />
        <Stat label="Year to date" value={formatMoney(fin.yearToDate, currency, locale)}
              sub={`Average ${formatMoney(fin.averageHourlyYield, currency, locale)} per hour`} />
        <Stat label="Received this month" value={formatMoney(fin.collectedThisMonth, currency, locale)}
              sub={`${(collection * 100).toFixed(0)}% of issued invoices collected`} tone="info" />
        <Stat label="Owed to you" value={formatMoney(fin.outstanding, currency, locale)}
              sub={fin.overdue > 0 ? `${formatMoney(fin.overdue, currency, locale)} overdue` : 'Nothing overdue'}
              tone={fin.overdue > 0 ? 'bad' : 'good'} />
        <Stat label="Not yet invoiced" value={formatMoney(fin.unbilled, currency, locale)}
              sub={`${formatHours(fin.unbilledHours)} of recorded care`}
              tone={fin.unbilled > 0 ? 'warn' : 'neutral'} />
        <Stat label="Sitting in draft" value={formatMoney(fin.draftValue, currency, locale)}
              sub="Created but not sent" />
      </div>

      <Card title="Invoiced and received by month">
        <MonthlyRevenueChart points={fin.months} currency={currency} locale={locale} />
        <details className="table-toggle">
          <summary>Show as a table</summary>
          <div className="table-scroll">
  <table className="table">
              <thead>
                <tr><th>Month</th><th className="num">Invoiced</th><th className="num">Received</th><th className="num">Hours</th></tr>
              </thead>
              <tbody>
                {[...fin.months].reverse().map(m => (
                  <tr key={m.key}>
                    <td>{m.key}</td>
                    <td className="num">{formatMoney(m.revenue, currency, locale)}</td>
                    <td className="num">{formatMoney(m.collected, currency, locale)}</td>
                    <td className="num">{m.hours ? formatHours(m.hours) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="split">
        <Card title="Owing, by age">
          <HorizontalBars
            currency={currency} locale={locale}
            emptyText="Nothing is outstanding."
            data={[
              { label: 'Not yet due', value: fin.aging.current, className: 'ramp-1' },
              { label: '1–30 days', value: fin.aging.d1to30, className: 'ramp-2' },
              { label: '31–60 days', value: fin.aging.d31to60, className: 'ramp-3' },
              { label: 'Over 60 days', value: fin.aging.d60plus, className: 'ramp-4' },
            ]}
          />
          {chasing.length > 0 && (
            <div className="table-scroll">
  <table className="table compact">
                <thead>
                  <tr><th>Invoice</th><th>Child</th><th>Due</th><th className="num">Owing</th></tr>
                </thead>
                <tbody>
                  {chasing.map(inv => (
                    <tr key={inv.id} className={isOverdue(inv) ? 'row-bad' : undefined}>
                      <td><Link to={`/invoices/${inv.id}`}>{inv.number}</Link></td>
                      <td>{childName(db.children.find(c => c.id === inv.childId))}</td>
                      <td className="muted">{formatDate(inv.dueDate, locale)}</td>
                      <td className="num">{formatMoney(amountDue(inv), currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Revenue by child, last ${months} months`}>
          <HorizontalBars
            currency={currency} locale={locale}
            emptyText="No invoiced revenue yet."
            data={fin.perChild.slice(0, 10).map(p => ({
              label: childName(db.children.find(c => c.id === p.childId)),
              value: p.revenue,
              note: p.outstanding > 0 ? `${formatMoney(p.outstanding, currency, locale)} owing` : undefined,
            }))}
          />
        </Card>
      </div>
    </>
  )
}
