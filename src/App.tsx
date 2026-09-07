import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { StoreProvider, useStore } from './lib/store'
import { VaultProvider, useVault } from './lib/vault'
import { today } from './lib/dates'

import Lock from './pages/Lock'
import { ExitParentMode } from './pages/ModeSelect'
import Dashboard from './pages/Dashboard'
import Attendance from './pages/Attendance'
import SignInOut from './pages/SignInOut'
import SignSheet from './pages/SignSheet'
import Activities from './pages/Activities'
import Charts from './pages/Charts'
import Calendar from './pages/Calendar'
import Children from './pages/Children'
import ChildDetail from './pages/ChildDetail'
import Notes from './pages/Notes'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Finance from './pages/Finance'
import SettingsPage from './pages/Settings'

type Mode = 'parent' | 'teacher'

const MODE_KEY = 'childcare.mode'

/** Parent mode is the whole app for a parent: one screen, nothing else reachable. */
function ParentShell({ onLeave }: { onLeave(): void }) {
  const [asking, setAsking] = useState(false)
  return (
    <div className="parent-shell">
      <SignInOut />
      <button className="btn ghost parent-exit" onClick={() => setAsking(true)}>Teacher</button>
      {asking && (
        <ExitParentMode
          onCancel={() => setAsking(false)}
          onUnlocked={() => { setAsking(false); onLeave() }}
        />
      )}
    </div>
  )
}

/**
 * Drops the door tablet back to parent mode after a spell of no interaction, so
 * an unattended device does not sit on the notes and the finances.
 */
function useIdleReturn(active: boolean, minutes: number, onIdle: () => void) {
  useEffect(() => {
    if (!active || minutes <= 0) return
    let timer = window.setTimeout(onIdle, minutes * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onIdle, minutes * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [active, minutes, onIdle])
}

/**
 * Lets anything inside the teacher app hand the device back to the door without
 * waiting for the idle timer to do it.
 */
const ModeCtx = createContext<{ toParent(): void } | null>(null)

export function useModeSwitch() {
  return useContext(ModeCtx)
}

/** Wraps the teacher app so the idle timer can read settings from the store. */
function TeacherWithIdle({ onIdle }: { onIdle(): void }) {
  const { db } = useStore()
  useIdleReturn(true, db.settings.parentIdleMinutes, onIdle)
  const value = useMemo(() => ({ toParent: onIdle }), [onIdle])
  return (
    <ModeCtx.Provider value={value}>
      <TeacherShell />
    </ModeCtx.Provider>
  )
}

/**
 * Opens today's attendance from the booking, so a day is billed correctly even
 * if nobody touches the tablet. Existing rows are never overwritten, so an
 * absence marked earlier stands.
 */
function AutoCheckIn() {
  const { db, actions } = useStore()
  const doneFor = useRef('')

  useEffect(() => {
    if (!db.settings.autoCheckIn) return
    const date = today()
    if (doneFor.current === date) return
    doneFor.current = date
    actions.fillFromSchedule(date)
  }, [db.settings.autoCheckIn, actions])

  return null
}

/**
 * HashRouter rather than BrowserRouter: GitHub Pages serves static files only,
 * so a deep link like /invoices/x would 404 on refresh under path routing.
 */
function TeacherShell() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="signin" element={<SignInOut />} />
          <Route path="sheet" element={<SignSheet />} />
          <Route path="activities" element={<Activities />} />
          <Route path="activity-report" element={<Charts />} />
          <Route path="charts" element={<Charts />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="children" element={<Children />} />
          <Route path="children/:id" element={<ChildDetail />} />
          <Route path="notes" element={<Notes />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="finance" element={<Finance />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

function Shell() {
  const vault = useVault()
  // Kept for the session only.
  // The door tablet is the common case, so that is what opening the app gives you.
  const [mode, setMode] = useState<Mode>(
    () => (sessionStorage.getItem(MODE_KEY) as Mode) || 'parent',
  )

  const pick = useCallback((next: Mode) => {
    setMode(next)
    try { sessionStorage.setItem(MODE_KEY, next) } catch { /* private mode */ }
  }, [])

  const toParent = useCallback(() => pick('parent'), [pick])

  // Nothing renders until the vault is open — the app has no plaintext to show.
  if (vault.status !== 'unlocked' || !vault.db) return <Lock />

  return (
    <StoreProvider initial={vault.db} persist={vault.persist}>
      <AutoCheckIn />
      {mode === 'parent' && <ParentShell onLeave={() => pick('teacher')} />}
      {mode === 'teacher' && <TeacherWithIdle onIdle={toParent} />}
    </StoreProvider>
  )
}

export default function App() {
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  )
}
