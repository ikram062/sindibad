import { Bell, LogOut } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { LanguageSwitcher, useI18n } from './i18n'
import { ghostButton } from './ui'

type Note = {
  id: string
  title: string
  body: string
  code: string | null
  params: Record<string, string | number> | null
  proposalId: string | null
  readAt: string | null
  createdAt: string
}

function Notifications() {
  const { t, errText, fmtDateTime, notifText } = useI18n()
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
      setResults((x) => ({ ...x, [n.id]: { ok: true, text: t('notif.bought', { ref: r.paymentRef }) } }))
    } catch (e) {
      setResults((x) => ({ ...x, [n.id]: { ok: false, text: errText(e) } }))
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={toggle} aria-label={t('notif.aria')} className="relative text-brand/70 hover:text-brand">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -end-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-gold text-[10px] font-bold text-brand">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-brand/10 bg-white p-2 shadow-xl">
          {notes.length === 0 && <p className="p-3 text-sm text-ink/50">{t('notif.empty')}</p>}
          {notes.map((n) => {
            const text = notifText(n.code, n.params, { title: n.title, body: n.body })
            return (
              <div key={n.id} className="rounded-xl p-3 text-sm hover:bg-brand/5">
                <div className="font-semibold text-brand">{text.title}</div>
                <div className="text-ink/70">{text.body}</div>
                <div className="mt-1 text-xs text-ink/40">{fmtDateTime(n.createdAt)}</div>
                {n.proposalId && !results[n.id]?.ok && (
                  <button type="button" onClick={() => confirm(n)} className={`${ghostButton} mt-2`}>
                    {t('notif.confirm')}
                  </button>
                )}
                {results[n.id] && <div className={`mt-2 text-xs ${results[n.id]!.ok ? 'text-emerald-700' : 'text-red-700'}`}>{results[n.id]!.text}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AppLayout({ route, children }: { route: string; children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { t } = useI18n()
  const verified = user?.kycStatus === 'verified'
  const NAV = [
    { href: '#/chat', label: t('nav.chat') },
    { href: '#/foryou', label: t('nav.foryou') },
    { href: '#/rules', label: t('nav.rules') },
    { href: '#/settings', label: t('nav.settings') },
  ]

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
        <a href="#/" aria-label={t('common.home')}>
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
          <LanguageSwitcher />
          <Notifications />
          <span className="hidden text-sm text-brand sm:block">{user?.name}</span>
          <button type="button" onClick={signOut} aria-label={t('common.signout')} className="text-brand/60 hover:text-brand">
            <LogOut className="size-5 rtl:-scale-x-100" />
          </button>
        </div>
      </header>

      {!verified && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-gold/15 px-4 py-3 text-sm text-brand">
          <span>{t('banner.verify')}</span>
          <a href="#/verify" className="shrink-0 rounded-full bg-brand px-4 py-1.5 font-semibold text-cream">
            {t('banner.verifyBtn')}
          </a>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</main>
    </div>
  )
}
