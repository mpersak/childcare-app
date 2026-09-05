import { useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { StoreProvider } from './lib/store'
import { VaultProvider, useVault } from './lib/vault'

import Lock from './pages/Lock'
import { ModeSelect, ExitParentMode } from './pages/ModeSelect'
import Dashboard from './pages/Dashboard'
import Attendance from './pages/Attendance'
import SignInOut from './pages/SignInOut'
import SignSheet from './pages/SignSheet'
import Calendar from './pages/Calendar'
import Children from './pages/Children'
import ChildDetail from './pages/ChildDetail'
import Notes from './pages/Notes'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Finance from './pages/Finance'
import SettingsPage from './pages/Settings'

type Mode = 'choose' | 'parent' | 'teacher'

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
  // Kept for the session only: closing the tab returns to the chooser.
  const [mode, setMode] = useState<Mode>(
    () => (sessionStorage.getItem(MODE_KEY) as Mode) || 'choose',
  )

  const pick = (next: Mode) => {
    setMode(next)
    try { sessionStorage.setItem(MODE_KEY, next) } catch { /* private mode */ }
  }

  // Nothing renders until the vault is open — the app has no plaintext to show.
  if (vault.status !== 'unlocked' || !vault.db) return <Lock />

  return (
    <StoreProvider initial={vault.db} persist={vault.persist}>
      {mode === 'choose' && <ModeSelect onPick={pick} />}
      {mode === 'parent' && <ParentShell onLeave={() => pick('teacher')} />}
      {mode === 'teacher' && <TeacherShell />}
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
