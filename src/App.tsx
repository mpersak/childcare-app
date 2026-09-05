import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { StoreProvider } from './lib/store'
import { AuthProvider, RequireAuth } from './lib/auth'

import Dashboard from './pages/Dashboard'
import Attendance from './pages/Attendance'
import Calendar from './pages/Calendar'
import Children from './pages/Children'
import ChildDetail from './pages/ChildDetail'
import Notes from './pages/Notes'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import Finance from './pages/Finance'
import SettingsPage from './pages/Settings'

/**
 * HashRouter rather than BrowserRouter: GitHub Pages serves static files only,
 * so a deep link like /invoices/x would 404 on refresh under path routing.
 */
export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <RequireAuth>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="attendance" element={<Attendance />} />
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
        </RequireAuth>
      </StoreProvider>
    </AuthProvider>
  )
}
