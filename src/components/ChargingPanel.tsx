import { useStore } from '../lib/store'
import { Card, Field } from './ui'
import { formatMoney } from '../lib/money'

/** How a day turns into money: the basis, late collection, and absence rules. */
export function ChargingPanel() {
  const { db, actions } = useStore()
  const s = db.settings
  const set = (patch: Parameters<typeof actions.updateSettings>[0]) => actions.updateSettings(patch)
  const money = (n: number) => formatMoney(n, s.currency, s.locale)

  const pct = (v: number) => Math.round(v * 100)

  return (
    <>
      <Card title="What gets charged">
        <div className="form-grid">
          <Field label="Bill on" wide
                 hint="The booking is the contract: booked hours are charged whether or not the tablet was used.">
            <select className="input" value={s.billBasis}
                    onChange={e => set({ billBasis: e.target.value as 'schedule' | 'actual' })}>
              <option value="schedule">the booked schedule</option>
              <option value="actual">the recorded times</option>
            </select>
          </Field>

          <Field label="Auto check-in" wide
                 hint="Creates today's attendance from the schedule when the app opens.">
            <label className="check">
              <input type="checkbox" checked={s.autoCheckIn}
                     onChange={e => set({ autoCheckIn: e.target.checked })} />
              Open the day from the booking automatically
            </label>
          </Field>
        </div>
      </Card>

      <Card title="Late collection">
        <p className="muted">
          Charged only past the <em>booked</em> finish time. Picking up early never reduces
          the charge, and arriving late never increases it.
        </p>
        <div className="form-grid">
          <Field label="Free grace" hint="Minutes past the booked finish that cost nothing">
            <input className="input" type="number" min="0" step="1" value={s.lateGraceMinutes}
                   onChange={e => set({ lateGraceMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Then, each block of" hint="Minutes">
            <input className="input" type="number" min="1" step="1" value={s.lateBlockMinutes}
                   onChange={e => set({ lateBlockMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Costs" wide>
            <input className="input" type="number" min="0" step="0.5" value={s.lateBlockFee}
                   onChange={e => set({ lateBlockFee: Number(e.target.value) })} />
          </Field>
        </div>
        <p className="notice">
          {s.lateBlockFee > 0
            ? `Up to ${s.lateGraceMinutes} min late is free. ` +
              `${s.lateGraceMinutes + 1}–${s.lateGraceMinutes + s.lateBlockMinutes} min costs ` +
              `${money(s.lateBlockFee)}, and every further ${s.lateBlockMinutes} min adds ` +
              `${money(s.lateBlockFee)}.`
            : 'Late collection is not charged.'}
        </p>
      </Card>

      <Card title="Days off">
        <div className="form-grid">
          <Field label="Holiday notice needed" hint="Days before the day off">
            <input className="input" type="number" min="0" step="1" value={s.holidayNoticeDays}
                   onChange={e => set({ holidayNoticeDays: Number(e.target.value) })} />
          </Field>
          <Field label="Holiday with notice" hint="Percent of the normal charge">
            <input className="input" type="number" min="0" max="100" step="5"
                   value={pct(s.holidayNoticedRate)}
                   onChange={e => set({ holidayNoticedRate: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Holiday without notice" hint="Percent">
            <input className="input" type="number" min="0" max="100" step="5"
                   value={pct(s.holidayShortNoticeRate)}
                   onChange={e => set({ holidayShortNoticeRate: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Sick day" hint="Percent">
            <input className="input" type="number" min="0" max="100" step="5" value={pct(s.sickRate)}
                   onChange={e => set({ sickRate: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Other absence" hint="Percent">
            <input className="input" type="number" min="0" max="100" step="5" value={pct(s.absentRate)}
                   onChange={e => set({ absentRate: Number(e.target.value) / 100 })} />
          </Field>
        </div>
        <p className="muted small">
          Notice is counted from the day a holiday is marked in the app to the day itself, so
          mark holidays as soon as parents tell you — that timestamp is what earns the discount.
        </p>
      </Card>

      <Card title="Activities">
        <div className="form-grid">
          <Field label="Sleep check interval" hint="Minutes. 0 stops checks being generated.">
            <input className="input" type="number" min="0" step="5" value={s.sleepCheckMinutes}
                   onChange={e => set({ sleepCheckMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Default sleep length" hint="Minutes">
            <input className="input" type="number" min="5" step="5" value={s.sleepBlockMinutes}
                   onChange={e => set({ sleepBlockMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Activity report email" wide hint="Separate from the sign-in sheet address">
            <input className="input" type="email" value={s.activityEmail}
                   onChange={e => set({ activityEmail: e.target.value })} />
          </Field>
        </div>
        <p className="muted small">
          Sleep checks are generated unticked. They record what was actually done, so a
          report shows genuine checks rather than asserting every one happened.
        </p>
      </Card>
    </>
  )
}
