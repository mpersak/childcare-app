import { useMemo, useState } from 'react'
import { useStore, childName, initials } from '../lib/store'
import { useVault } from '../lib/vault'
import { PageHead } from '../components/ui'
import { SignaturePad } from '../components/SignaturePad'
import { scheduleFor } from '../lib/billing'
import { formatDate, today } from '../lib/dates'

type Pending = { childId: string; direction: 'in' | 'out' } | null

/**
 * The screen a parent uses at the door. Big targets, no editing, no money —
 * it only ever moves a child between "out" and "in", with a signature.
 */
export default function SignInOut() {
  const { db, actions } = useStore()
  const vault = useVault()
  const date = today()
  const [pending, setPending] = useState<Pending>(null)
  const [justDone, setJustDone] = useState<string>('')

  const tiles = useMemo(() => {
    return db.children
      .filter(c => c.status === 'active')
      .map(child => {
        const record = db.attendance.find(a => a.childId === child.id && a.date === date)
        const booked = scheduleFor(db.schedules, child.id, date)
        const state: 'out' | 'in' | 'done' | 'away' =
          record && record.status !== 'present' ? 'away'
          : record?.checkOut ? 'done'
          : record?.checkIn ? 'in'
          : 'out'
        return { child, record, booked, state }
      })
      .sort((a, b) =>
        // On site first — those are the ones a parent is coming to collect.
        (a.state === 'in' ? 0 : a.state === 'out' ? 1 : 2) -
        (b.state === 'in' ? 0 : b.state === 'out' ? 1 : 2) ||
        childName(a.child).localeCompare(childName(b.child)))
  }, [db, date])

  const pendingChild = db.children.find(c => c.id === pending?.childId)

  const complete = async (sig: { dataUrl: string; name: string }) => {
    if (!pending) return
    // The image goes to its own encrypted file; the record keeps only a reference.
    const ref = await vault.saveSignature(sig.dataUrl)
    actions.signChild(pending.direction, pending.childId, { ref, name: sig.name })
    setJustDone(`${childName(pendingChild)} signed ${pending.direction === 'in' ? 'in' : 'out'} at ${new Date().toLocaleTimeString(db.settings.locale, { hour: '2-digit', minute: '2-digit' })}.`)
    setPending(null)
    setTimeout(() => setJustDone(''), 5000)
  }

  return (
    <>
      <PageHead title="Sign in and out" subtitle={formatDate(date, db.settings.locale)} />

      {justDone && <div className="banner success">{justDone}</div>}

      {tiles.length === 0 ? (
        <div className="card"><div className="card-body">
          <p className="muted">No active children to sign in.</p>
        </div></div>
      ) : (
        <div className="kiosk-grid">
          {tiles.map(({ child, record, booked, state }) => (
            <div className={`kiosk-tile state-${state}`} key={child.id}>
              <span className="kiosk-avatar" style={{ background: child.colour }}>
                {initials(child)}
              </span>
              <strong className="kiosk-name">{childName(child)}</strong>
              <span className="muted small">
                {state === 'away' ? record?.status
                  : state === 'done' ? `${record?.checkIn} – ${record?.checkOut}`
                  : state === 'in' ? `In since ${record?.checkIn}`
                  : booked.length ? `Booked ${booked[0].start}–${booked[booked.length - 1].end}`
                  : 'No booking today'}
              </span>

              {state === 'out' && (
                <button className="btn primary big"
                        onClick={() => setPending({ childId: child.id, direction: 'in' })}>
                  Sign in
                </button>
              )}
              {state === 'in' && (
                <button className="btn big"
                        onClick={() => setPending({ childId: child.id, direction: 'out' })}>
                  Sign out
                </button>
              )}
              {state === 'done' && <span className="kiosk-done">Signed out</span>}
              {state === 'away' && <span className="kiosk-done">Not in today</span>}

              <span className="kiosk-sigs">
                {record?.signIn && <em title={`Signed in by ${record.signIn.name}`}>✓ in</em>}
                {record?.signOut && <em title={`Signed out by ${record.signOut.name}`}>✓ out</em>}
              </span>
            </div>
          ))}
        </div>
      )}

      {pending && pendingChild && (
        <SignaturePad
          title={`Sign ${pending.direction === 'in' ? 'in' : 'out'} ${childName(pendingChild)}`}
          subtitle="Parent or guardian signature"
          people={pendingChild.guardians.map(g => ({
            id: g.id, name: g.name, relationship: g.relationship,
          }))}
          confirmLabel={pending.direction === 'in' ? 'Confirm sign in' : 'Confirm sign out'}
          onCancel={() => setPending(null)}
          onConfirm={sig => { void complete(sig) }}
        />
      )}
    </>
  )
}
