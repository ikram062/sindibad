import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

export type User = {
  id: string
  email: string
  name: string
  language: 'darija' | 'fr' | 'ar'
  kycStatus: 'unverified' | 'verified'
  kycVerifiedAt: string | null
}

type Auth = {
  /** undefined while the first /me call is in flight, null when signed out. */
  user: User | null | undefined
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
  /** Used when Mon e-ID verification completes and the server returns the updated user. */
  applyUser: (user: User) => void
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    api<{ user: User | null }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
  }, [])

  const value: Auth = {
    user,
    signIn: async (email, password) => setUser((await api<{ user: User }>('/auth/login', { email, password })).user),
    signUp: async (email, password, name) =>
      setUser((await api<{ user: User }>('/auth/signup', { email, password, name })).user),
    signOut: async () => {
      await api('/auth/logout', {})
      setUser(null)
    },
    applyUser: setUser,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
