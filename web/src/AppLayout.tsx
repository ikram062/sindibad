import { Bell, LogOut } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { useAuth } from './auth'
import { fmtDateTime, ghostButton } from './ui'

type Note = { id: string; title: string; body: string; proposalId: string | null; readAt: string | null; createdAt: string }

function Notifications() {
  const [notes, setNotes] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const load = useCallback(() => {
    api<{ notifications: Note[]; unread: number }>('/notifications')
      .then((r) => {
        setNotes(r.notifications)
        setUnread(r.unread)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [load])

  const toggle = () => {
    setOpen((o) => !o)
    if (!open && unread > 0) api('/notifications/read-all', {}).then(() => setUnread(0)).catch(() => {})
  }

  const confirm = async (n: Note) => {
    try {
      const r = await api<{ paymentRef: string }>(`/purchases/proposals/${n.proposalId}/confirm`, {})
      setResults((x) => ({ ...x, [n.id]: { ok: true, text: `Bought. Payment reference ${r.paymentRef}.` } }))
    } catch (e) {
      setResults((x) => ({ ...x, [n.id]: { ok: false, text: e instanceof ApiError ? e.message : 'Could not complete.' } }))
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={toggle} aria-label="Notifications" className="relative text-brand/70 hover:text-brand">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-gold text-[10px] font-bold text-brand">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-brand/10 bg-white p-2 shadow-xl">
          {notes.length === 0 && <p className="p-3 text-sm text-ink/50">Nothing yet. Rules you create will notify you here.</p>}
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl p-3 text-sm hover:bg-brand/5">
              <div className="font-semibold text-brand">{n.title}</div>
              <div className="text-ink/70">{n.body}</div>
              <div className="mt-1 text-xs text-ink/40">{fmtDateTime(n.createdAt)}</div>
              {n.proposalId && !results[n.id]?.ok && (
                <button type="button" onClick={() => confirm(n)} className={`${ghostButton} mt-2`}>
                  Review &amp; confirm
                </button>
              )}
              {results[n.id] && <div className={`mt-2 text-xs ${results[n.id]!.ok ? 'text-emerald-700' : 'text-red-700'}`}>{results[n.id]!.text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const NAV = [
  { href: '#/chat', label: 'Chat' },
  { href: '#/rules', label: 'Rules' },
  { href: '#/settings', label: 'Settings' },
]

export default function AppLayout({ route, children }: { route: string; children: ReactNode }) {
  const { user, signOut } = useAuth()
  const verified = user?.kycStatus === 'verified'

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-4">
      <header className="flex items-center justify-between gap-3 py-3">
        <a href="#/" aria-label="Home">
          <img src="/logo.png" alt="Sindibad" width={636} height={245} className="w-24" />
        </a>
        <nav className="flex gap-1 rounded-full bg-brand/5 p-1 text-sm font-semibold">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              aria-current={route === n.href ? 'page' : undefined}
              className={`rounded-full px-4 py-1.5 transition ${route === n.href ? 'bg-brand text-cream' : 'text-brand hover:bg-white'}`}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Notifications />
          <span className="hidden text-sm text-brand sm:block">{user?.name}</span>
          <button type="button" onClick={signOut} aria-label="Sign out" className="text-brand/60 hover:text-brand">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {!verified && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-gold/15 px-4 py-3 text-sm text-brand">
          <span>Verify your identity with Mon e-ID to buy tickets. You can still explore.</span>
          <a href="#/verify" className="shrink-0 rounded-full bg-brand px-4 py-1.5 font-semibold text-cream">
            Verify now
          </a>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</main>
    </div>
  )
}
