import { BadgeCheck, CreditCard } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Chip, ErrorLine, fmtDate, fmtDateTime, ghostButton, inputClass, mad, Panel, primaryButton } from '../ui'

type SettingsData = {
  settings: { autonomy: 'ask' | 'auto'; maxPerPurchaseMad: number; maxPerMonthMad: number; autoEnabledAt: string | null }
  card: { brand: string; last4: string } | null
  monthSpendMad: number
}
type Purchase = { id: string; eventTitle: string; city: string; tier: string; quantity: number; totalMad: number; status: string; via: 'manual' | 'auto_rule'; paymentRef: string | null; createdAt: string }

function Mode({ active, disabled, title, text, onPick }: { active: boolean; disabled?: boolean; title: string; text: string; onPick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-pressed={active}
      className={`w-full rounded-xl border p-4 text-left transition disabled:opacity-50 ${active ? 'border-gold bg-gold/10' : 'border-brand/15 bg-white hover:border-gold'}`}
    >
      <div className="font-semibold text-brand">{title}</div>
      <div className="mt-1 text-sm text-ink/60">{text}</div>
    </button>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const verified = user?.kycStatus === 'verified'
  const [data, setData] = useState<SettingsData | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [autonomy, setAutonomy] = useState<'ask' | 'auto'>('ask')
  const [perPurchase, setPerPurchase] = useState('1000')
  const [perMonth, setPerMonth] = useState('3000')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const apply = useCallback((d: SettingsData) => {
    setData(d)
    setAutonomy(d.settings.autonomy)
    setPerPurchase(String(d.settings.maxPerPurchaseMad))
    setPerMonth(String(d.settings.maxPerMonthMad))
  }, [])

  const load = useCallback(() => {
    api<SettingsData>('/settings').then(apply).catch(() => {})
    if (verified) api<{ purchases: Purchase[] }>('/purchases').then((r) => setPurchases(r.purchases)).catch(() => {})
  }, [apply, verified])
  useEffect(load, [load])

  const guard = async (action: () => Promise<void>) => {
    setError('')
    setSaved('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    guard(async () => {
      apply(await api<SettingsData>('/settings', { autonomy, maxPerPurchaseMad: Number(perPurchase), maxPerMonthMad: Number(perMonth), password: password || undefined }, 'PUT'))
      setPassword('')
      setSaved('Saved.')
    })
  }

  const cardAction = (declines?: boolean, remove?: boolean) =>
    guard(async () => apply(remove ? await api<SettingsData>('/settings/card', {}, 'DELETE') : await api<SettingsData>('/settings/card', { declines })))

  if (!data) return <p className="py-10 text-center text-brand/60">Loading…</p>
  const canAuto = verified && Boolean(data.card)

  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-3xl font-semibold text-brand">Settings</h1>
        <p className="text-ink/60">Who you are, how you pay, and how much the assistant may do on its own.</p>
      </div>

      <div className="grid items-stretch gap-5 md:grid-cols-2">
      <Panel>
        <h2 className="font-semibold text-brand">Identity</h2>
        {verified ? (
          <p className="mt-2 flex items-center gap-2 text-ink/70">
            <BadgeCheck className="size-5 text-emerald-600" /> Verified with Mon e-ID{user?.kycVerifiedAt && ` on ${fmtDate(user.kycVerifiedAt)}`} <Chip tone="gold">simulated</Chip>
          </p>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-ink/70">Not verified. Nothing can be bought until you verify with Mon e-ID.</p>
            <a href="#/verify" className={primaryButton}>Verify now</a>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="font-semibold text-brand">Payment card <Chip tone="gold">simulated</Chip></h2>
        {data.card ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink/70"><CreditCard className="size-5 text-gold" /> {data.card.brand} •••• {data.card.last4}</span>
            <button type="button" className={ghostButton} onClick={() => cardAction(false, true)}>Remove</button>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-ink/60">No card. No real card number is ever entered or stored in this prototype.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => cardAction(false)}>Add demo card (Visa •••• 4242)</button>
              <button type="button" className={ghostButton} onClick={() => cardAction(true)}>Add a card that gets declined</button>
            </div>
          </div>
        )}
      </Panel>
      </div>

      <Panel>
        <h2 className="font-semibold text-brand">How purchases happen</h2>
        <form onSubmit={save} className="mt-3 space-y-3">
          <Mode active={autonomy === 'ask'} title="Always ask me (recommended)" text="Every purchase needs your tap, including ones triggered by a rule. The assistant only prepares them." onPick={() => setAutonomy('ask')} />
          <Mode
            active={autonomy === 'auto'}
            disabled={!canAuto}
            title="Let my rules buy by themselves, within my limits"
            text={canAuto ? 'A rule you confirmed may complete the purchase on its own, only inside the limits below. You are notified each time.' : 'Needs a verified identity and a saved card first.'}
            onPick={() => setAutonomy('auto')}
          />

          {autonomy === 'auto' && (
            <div className="space-y-3 rounded-xl bg-brand/5 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-brand">
                  <span className="mb-1 block">Max per purchase (MAD)</span>
                  <input className={inputClass} type="number" min={1} max={20000} value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)} />
                </label>
                <label className="text-sm font-medium text-brand">
                  <span className="mb-1 block">Max per month (MAD)</span>
                  <input className={inputClass} type="number" min={1} max={100000} value={perMonth} onChange={(e) => setPerMonth(e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-ink/50">Spent this month: {mad(data.monthSpendMad)}.</p>
              <label className="block text-sm font-medium text-brand">
                <span className="mb-1 block">Your password (needed to turn this on or raise a limit)</span>
                <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <p className="text-xs text-ink/50">
                Real-world note: many Moroccan cards ask for a 3-D Secure code on every payment, which cannot be automated. A real launch
                needs a tokenised payment through a bank partner.
              </p>
            </div>
          )}

          <ErrorLine error={error} />
          <div className="flex items-center gap-3">
            <button className={primaryButton}>Save</button>
            {saved && <span className="text-sm text-emerald-700" role="status">{saved}</span>}
            {data.settings.autoEnabledAt && autonomy === 'auto' && <span className="text-xs text-ink/50">Automatic since {fmtDateTime(data.settings.autoEnabledAt)}</span>}
          </div>
        </form>
      </Panel>

      {verified && (
        <Panel>
          <h2 className="font-semibold text-brand">Purchases</h2>
          {purchases.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">Nothing bought yet.</p>
          ) : (
            <div className="mt-2 divide-y divide-brand/10">
              {purchases.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="font-semibold text-brand">{p.quantity} × {p.tier} · {p.eventTitle}</div>
                    <div className="text-xs text-ink/50">{fmtDateTime(p.createdAt)} · {p.via === 'auto_rule' ? 'bought by a rule' : 'confirmed by you'}{p.paymentRef && ` · ${p.paymentRef}`}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-brand">{mad(p.totalMad)}</div>
                    <Chip tone={p.status === 'paid' ? 'green' : 'red'}>{p.status}</Chip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
