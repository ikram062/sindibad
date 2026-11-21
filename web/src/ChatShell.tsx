import { BadgeCheck, LogOut, Mic, SendHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from './auth'

type Health = { ok: boolean; db: boolean; agentKeyConfigured?: boolean; error?: string }

function useHealth() {
  const [health, setHealth] = useState<Health | 'loading'>('loading')
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, db: false, error: 'API unreachable' }))
  }, [])
  return health
}

function StatusBadge({ health }: { health: Health | 'loading' }) {
  const state = health === 'loading' ? 'checking' : health.ok ? 'connected' : 'offline'
  const color = { checking: 'bg-gold', connected: 'bg-emerald-500', offline: 'bg-red-500' }[state]
  return (
    <span className="flex items-center gap-2 text-xs text-ink/60">
      <span className={`size-2 rounded-full ${color}`} />
      {state === 'connected' ? 'API + database connected' : state === 'offline' ? 'Backend offline' : 'Checking…'}
    </span>
  )
}

export default function ChatShell({ onVerify }: { onVerify: () => void }) {
  const health = useHealth()
  const { user, signOut } = useAuth()
  const verified = user?.kycStatus === 'verified'

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-4">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold text-brand">Sindibad</h1>
          <span className="text-lg text-gold" dir="rtl">سندباد</span>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge health={health} />
          <span className="flex items-center gap-1.5 text-sm text-brand">
            {verified && <BadgeCheck className="size-4 text-emerald-600" aria-label="CIN verified" />}
            {user?.name}
          </span>
          <button type="button" onClick={signOut} aria-label="Sign out" className="text-brand/60 hover:text-brand">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {!verified && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gold/15 px-4 py-3 text-sm text-brand">
          <span>Verify your CIN to buy tickets. You can still explore.</span>
          <button type="button" onClick={onVerify} className="shrink-0 rounded-full bg-brand px-4 py-1.5 font-semibold text-cream">
            Verify now
          </button>
        </div>
      )}

      {/* Conversation area: agent messages and cards will render here. */}
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-xl font-medium text-brand">Learn. Get alerted. Act on time.</p>
        <p className="max-w-md text-sm text-ink/60">
          Ask in Darija, French or Arabic. The assistant explains; you decide every step.
        </p>
      </main>

      <footer className="pb-6">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex items-center gap-2 rounded-full border border-brand/20 bg-white px-4 py-2 shadow-sm"
        >
          <input
            disabled
            placeholder="Agent coming in the next step…"
            className="flex-1 bg-transparent py-1 outline-none placeholder:text-ink/40"
          />
          <button type="button" disabled aria-label="Voice" className="text-brand/60">
            <Mic className="size-5" />
          </button>
          <button type="submit" disabled aria-label="Send" className="text-brand/60">
            <SendHorizontal className="size-5" />
          </button>
        </form>
      </footer>
    </div>
  )
}
