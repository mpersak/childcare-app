import React, { createContext, useContext, useMemo, useState } from 'react'

/**
 * Placeholder auth so login can be added without touching the rest of the app.
 *
 * Right now every session is treated as the signed-in owner — the app is a
 * single-operator, browser-local tool and there is nothing on a server to protect.
 *
 * To add real login later:
 *   1. Point `signIn` at your identity provider (Entra ID / Auth0 / Supabase ...).
 *   2. Flip AUTH_REQUIRED to true. `RequireAuth` will then gate every route.
 *   3. Swap `src/lib/repo.ts` for an API client that sends the session token,
 *      so data moves off the device at the same time.
 *
 * Do not treat this as a security control until step 1 is actually done.
 */

export const AUTH_REQUIRED = false

export interface AuthUser {
  id: string
  name: string
  role: 'owner' | 'staff'
}

const LOCAL_OWNER: AuthUser = { id: 'local-owner', name: 'Owner', role: 'owner' }

interface AuthState {
  user: AuthUser | null
  signIn(email: string, password: string): Promise<void>
  signOut(): void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(AUTH_REQUIRED ? null : LOCAL_OWNER)

  const value = useMemo<AuthState>(() => ({
    user,
    async signIn(_email: string, _password: string) {
      // Replace with a real credential exchange. Never compare passwords in the browser.
      throw new Error('Login is not wired up yet.')
    },
    signOut() {
      setUser(AUTH_REQUIRED ? null : LOCAL_OWNER)
    },
  }), [user])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (AUTH_REQUIRED && !user) {
    return (
      <div className="empty-screen">
        <h2>Sign in required</h2>
        <p>Login has not been configured yet. See <code>src/lib/auth.tsx</code>.</p>
      </div>
    )
  }
  return <>{children}</>
}
