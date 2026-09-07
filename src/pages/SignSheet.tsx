import { useEffect, useMemo, useState } from 'react'
import { useStore, childName } from '../lib/store'
import { useVault } from '../lib/vault'
import { ActionButton, Card, Field, PageHead } from '../components/ui'
import { scheduleFor } from '../lib/billing'
import { openDraft, trimBody } from '../lib/email'
import { toCSV } from '../lib/exporters'
import { printNode, shareOrDownload } from '../lib/printing'
import {
  addDays, formatDate, fromISODate, startOfWeek, today, weekOptions,
  WEEKDAYS_SHORT, WORKING_DAYS_PER_WEEK,
} from '../lib/dates'

interface SheetRow {
  date: string
  no: number
  childId: string
  name: string
  bookedFrom: string
  bookedTo: string
  arrived: string
  collected: string
  status: string
  signInRef?: string
  signOutRef?: string
}

/**
 * The weekly sign-in sheet in the format the service expects back:
 * one numbered row per child per day, booked times against actual times.
 */
export default function SignSheet() {
  const { db, actions } = useStore()
  const vault = useVault()
  const s = db.settings
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today()))
  const [blank, setBlank] = useState(false)
  const [sigs, setSigs] = useState<Record<string, string>>({})
  const [refreshed, setRefreshed] = useState('')

  const days = useMemo(
    () => Array.from({ length: WORKING_DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekEnd = days[days.length - 1]

  const rows = useMemo<SheetRow[]>(() => {
    const out: SheetRow[] = []
    for (const date of days) {
      let no = 0
      const forDay = db.children
        .filter(c => c.status === 'active')
        .map(child => ({
          child,
          blocks: scheduleFor(db.schedules, child.id, date),
          rec: db.attendance.find(a => a.childId === child.id && a.date === date),
        }))
        // A child who was booked, or who turned up anyway. Listing only the
        // booked ones would leave a signed-in drop-in off the sheet entirely.
        .filter(x => x.blocks.length > 0 || x.rec)
        .sort((a, b) =>
          (a.blocks[0]?.start ?? a.rec?.checkIn ?? '99:99')
            .localeCompare(b.blocks[0]?.start ?? b.rec?.checkIn ?? '99:99'))

      for (const { child, blocks, rec } of forDay) {
        no++
        out.push({
          date,
          no,
          childId: child.id,
          name: childName(child),
          // The times recorded on the day, so editing a booking later cannot
          // rewrite a sheet that has already been sent. Older records have no
          // snapshot, so those fall back to the schedule as it stands.
          bookedFrom: rec?.bookedFrom ?? blocks[0]?.start ?? '',
          bookedTo: rec?.bookedTo ?? blocks[blocks.length - 1]?.end ?? '',
          // The recorded times, whether they came from a signature or a hand
          // edit — both are real. Left blank while they still hold what auto
          // check-in copied from the booking, which is not an arrival.
          arrived: blank || rec?.status !== 'present' || rec.timesFromBooking
            ? '' : rec.checkIn ?? '',
          collected: blank || rec?.status !== 'present' || rec.timesFromBooking
            ? '' : rec.checkOut ?? '',
          status: rec && rec.status !== 'present' ? rec.status : '',
          signInRef: blank ? undefined : rec?.signIn?.ref,
          signOutRef: blank ? undefined : rec?.signOut?.ref,
        })
      }
    }
    return out
  }, [db, days, blank])

  // Signature images live in their own encrypted files; fetch the week's set.
  useEffect(() => {
    let cancelled = false
    const refs = [...new Set(rows.flatMap(r => [r.signInRef, r.signOutRef]).filter(Boolean) as string[])]
    void Promise.all(refs.map(async ref => [ref, await vault.loadSignature(ref)] as const))
      .then(pairs => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const [ref, url] of pairs) if (url) next[ref] = url
        setSigs(next)
      })
    return () => { cancelled = true }
  }, [rows, vault])

  const range = `${formatDate(weekStart, s.locale)} – ${formatDate(weekEnd, s.locale)}`

  const emailSheet = () => {
    const lines = rows.map(r =>
      `${WEEKDAYS_SHORT[fromISODate(r.date).getDay()]} ${r.date.slice(8)} · ${r.name} · ` +
      `booked ${r.bookedFrom}-${r.bookedTo}` +
      (r.status ? ` · ${r.status}` : ` · in ${r.arrived || '—'} out ${r.collected || '—'}`))

    openDraft({
      to: s.coordinatorEmail,
      subject: `Daily Sign In Sheet — ${s.educatorName || s.businessName} — ${range}`,
      body: trimBody(
        `Kia ora,\n\nSign in sheet for ${range}.\n\n${lines.join('\n')}\n\n` +
        `The signed sheet is attached as a PDF.\n\n${s.educatorName || s.businessName}\n`,
      ),
    }, s)
  }

  const exportCsv = () => {
    void shareOrDownload(
      `sign-in-sheet-${weekStart}.csv`,
      toCSV([
        ['Date', 'No', 'Name', 'Mkd', 'Booked From', 'Time Arrived', 'Booked To', 'Time Collected', 'Status'],
        ...rows.map(r => [
          r.date, r.no, r.name, '', r.bookedFrom, r.arrived, r.bookedTo, r.collected, r.status,
        ]),
      ]),
      'text/csv',
    )
  }

  const missingEmail = !s.coordinatorEmail

  return (
    <>
      <PageHead
        title="Sign in sheet"
        subtitle={range}
        actions={
          <>
            <button className="btn" onClick={() => setWeekStart(addDays(weekStart, -7))}
                    aria-label="Previous week">‹</button>
            <select className="input week-select" value={weekStart}
                    aria-label="Week"
                    onChange={e => setWeekStart(e.target.value)}>
              {weekOptions(weekStart).map(w => (
                <option key={w.monday} value={w.monday}>{w.label}</option>
              ))}
            </select>
            <button className="btn" onClick={() => setWeekStart(addDays(weekStart, 7))}
                    aria-label="Next week">›</button>
            <button className="btn" onClick={() => setWeekStart(startOfWeek(today()))}>This week</button>
          </>
        }
      />

      <Card className="no-print">
        <div className="toolbar">
          <label className="check">
            <input type="checkbox" checked={blank} onChange={e => setBlank(e.target.checked)} />
            Blank sheet for hand signing
          </label>
          <ActionButton
            icon="↻" label="Refresh from schedule"
            title="Re-read the booked times for this week from the current schedule"
            onClick={() => {
              actions.resyncBookings(weekStart, weekEnd)
              setRefreshed(`Booked times re-read from the schedule for ${range}.`)
              setTimeout(() => setRefreshed(''), 6000)
            }}
          />
          <span className="spacer" />
          <ActionButton icon="🖨" label="Print / save PDF"
                        onClick={() => printNode('.sheet', `Sign in sheet ${range}`)} />
          <ActionButton icon="⬇" label="CSV" onClick={exportCsv} />
          <ActionButton icon="✉" label="Email to coordinator" primary disabled={missingEmail} onClick={emailSheet} />
        </div>
        {refreshed && <p className="notice">{refreshed}</p>}
        {missingEmail && (
          <p className="muted small">
            Set the coordinator's email address in Settings before emailing.
          </p>
        )}
        <p className="muted small">
          Save the PDF first, then attach it in the message that opens — a web page cannot
          attach files to an email on your behalf.
        </p>
      </Card>

      <article className="sheet">
        <header className="sheet-head">
          <span className="sheet-educator">{s.educatorName || s.businessName}</span>
          <span className="sheet-title">
            <strong>Daily Sign In Sheet</strong>
            <em>{s.orgName}</em>
            <em>{s.orgRegion}</em>
          </span>
          <span className="sheet-range">{range}</span>
        </header>

        <table className="sheet-table">
          <thead>
            <tr>
              <th>Date</th><th>No</th><th>Name</th><th>Mkd</th>
              <th>Booked<br />From</th><th>Time<br />Arrived</th><th>Signature</th>
              <th>Booked<br />To</th><th>Time<br />Collected</th><th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="muted">Nobody is booked this week.</td></tr>
            ) : rows.map(r => (
              <tr key={`${r.date}-${r.childId}`}>
                <td>{WEEKDAYS_SHORT[fromISODate(r.date).getDay()]} {r.date.slice(8)} {
                  fromISODate(r.date).toLocaleDateString(s.locale, { month: 'short' })
                }</td>
                <td>{r.no}</td>
                <td>
                  {r.name}
                  {r.status && <em className="sheet-status">{r.status}</em>}
                </td>
                <td />
                <td>{r.bookedFrom || <em className="sheet-status">drop-in</em>}</td>
                <td>{r.arrived}</td>
                <td className="sheet-sig">
                  {r.status
                    ? <span className="sheet-strike" />
                    : r.signInRef && sigs[r.signInRef]
                      ? <img src={sigs[r.signInRef]} alt="" />
                      : null}
                </td>
                <td>{r.bookedTo || ''}</td>
                <td>{r.collected}</td>
                <td className="sheet-sig">
                  {r.status
                    ? <span className="sheet-strike" />
                    : r.signOutRef && sigs[r.signOutRef]
                      ? <img src={sigs[r.signOutRef]} alt="" />
                      : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="sheet-foot">Checked by ______________________</footer>
      </article>
    </>
  )
}

/** Settings block for the sheet header and the coordinator address. */
export function SheetSettings() {
  const { db, actions } = useStore()
  const s = db.settings
  const set = (patch: Parameters<typeof actions.updateSettings>[0]) => actions.updateSettings(patch)

  return (
    <Card title="Sign in sheet and email">
      <div className="form-grid">
        <Field label="Educator name" hint="Printed at the top left of the sheet">
          <input className="input" value={s.educatorName}
                 onChange={e => set({ educatorName: e.target.value })} />
        </Field>
        <Field label="Coordinator email" hint="Where the weekly sheet is sent">
          <input className="input" type="email" value={s.coordinatorEmail}
                 onChange={e => set({ coordinatorEmail: e.target.value })} />
        </Field>
        <Field label="Service name">
          <input className="input" value={s.orgName}
                 onChange={e => set({ orgName: e.target.value })} />
        </Field>
        <Field label="Region">
          <input className="input" value={s.orgRegion}
                 onChange={e => set({ orgRegion: e.target.value })} />
        </Field>
        <Field label="Service logo" wide
               hint="The artwork the service gave you. Printed on the sleep and care charts.">
          <div className="row gap wrap">
            {s.serviceLogo && <img className="logo-preview" src={s.serviceLogo} alt="" />}
            <input
              type="file" accept="image/png,image/jpeg,image/svg+xml"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void loadLogo(file).then(url => set({ serviceLogo: url }))
                e.target.value = ''
              }}
            />
            {s.serviceLogo && (
              <button className="btn small" onClick={() => set({ serviceLogo: '' })}>Remove</button>
            )}
          </div>
        </Field>
        <Field label="Email opens in" wide>
          <select className="input" value={s.emailClient}
                  onChange={e => set({ emailClient: e.target.value as 'gmail' | 'default' })}>
            <option value="gmail">Gmail</option>
            <option value="default">The device's default mail app</option>
          </select>
        </Field>
      </div>
      <p className="muted small">
        Messages open pre-addressed with the body filled in. Attachments have to be added by
        hand — no web page can attach a file to an email for you.
      </p>
    </Card>
  )
}

/**
 * Reads a logo file and scales it down before storing.
 *
 * It lives inside the encrypted document that syncs on every change, so a
 * full-resolution upload would be re-uploaded with every edit. 320px wide is
 * more than a printed chart corner needs.
 */
async function loadLogo(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })

  // SVG has no pixels to resize and is already small.
  if (file.type === 'image/svg+xml') return raw

  return new Promise<string>(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 320
      const scale = Math.min(1, MAX / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(raw); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    // If it will not decode, keep the original rather than losing the upload.
    img.onerror = () => resolve(raw)
    img.src = raw
  })
}
