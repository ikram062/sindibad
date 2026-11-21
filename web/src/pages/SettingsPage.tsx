import { BadgeCheck, CreditCard } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import { Chip, ErrorLine, ghostButton, inputClass, Panel, primaryButton } from '../ui'

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
      className={`w-full rounded-xl border p-4 text-start transition disabled:opacity-50 ${active ? 'border-gold bg-gold/10' : 'border-brand/15 bg-white hover:border-gold'}`}
    >
      <div className="font-semibold text-brand">{title}</div>
      <div className="mt-1 text-sm text-ink/60">{text}</div>
    </button>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { t, mad, fmtDate, fmtDateTime, errText } = useI18n()
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
      setError(errText(e))
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    guard(async () => {
      apply(await api<SettingsData>('/settings', { autonomy, maxPerPurchaseMad: Number(perPurchase), maxPerMonthMad: Number(perMonth), password: password || undefined }, 'PUT'))
      setPassword('')
      setSaved(t('set.saved'))
    })
  }

  const cardAction = (declines?: boolean, remove?: boolean) =>
    guard(async () => apply(remove ? await api<SettingsData>('/settings/card', {}, 'DELETE') : await api<SettingsData>('/settings/card', { declines })))

  if (!data) return <p className="py-10 text-center text-brand/60">{t('common.loading')}</p>
  const canAuto = verified && Boolean(data.card)

  return (
    <div className="space-y-5 py-6">
      <div>
        <h1 className="text-3xl font-semibold text-brand">{t('set.title')}</h1>
        <p className="text-ink/60">{t('set.sub')}</p>
      </div>

      <div className="grid items-stretch gap-5 md:grid-cols-2">
        <Panel>
          <h2 className="font-semibold text-brand">{t('set.identity')}</h2>
          {verified ? (
            <p className="mt-2 flex items-center gap-2 text-ink/70">
              <BadgeCheck className="size-5 text-emerald-600" />
              {user?.kycVerifiedAt ? t('set.verifiedOn', { date: fmtDate(user.kycVerifiedAt) }) : t('set.verified')}
              <Chip tone="gold">{t('common.simulated')}</Chip>
            </p>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-ink/70">{t('set.notVerified')}</p>
              <a href="#/verify" className={primaryButton}>{t('set.verifyNow')}</a>
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="font-semibold text-brand">{t('set.card')} <Chip tone="gold">{t('common.simulated')}</Chip></h2>
          {data.card ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ink/70"><CreditCard className="size-5 text-gold" /> <span dir="ltr">{data.card.brand} •••• {data.card.last4}</span></span>
              <button type="button" className={ghostButton} onClick={() => cardAction(false, true)}>{t('set.remove')}</button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-ink/60">{t('set.noCard')}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} onClick={() => cardAction(false)}>{t('set.addDemo')}</button>
                <button type="button" className={ghostButton} onClick={() => cardAction(true)}>{t('set.addDecline')}</button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <h2 className="font-semibold text-brand">{t('set.how')}</h2>
        <form onSubmit={save} className="mt-3 space-y-3">
          <Mode active={autonomy === 'ask'} title={t('set.askTitle')} text={t('set.askText')} onPick={() => setAutonomy('ask')} />
          <Mode
            active={autonomy === 'auto'}
            disabled={!canAuto}
            title={t('set.autoTitle')}
            text={canAuto ? t('set.autoText') : t('set.autoNeeds')}
            onPick={() => setAutonomy('auto')}
          />

          {autonomy === 'auto' && (
            <div className="space-y-3 rounded-xl bg-brand/5 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-brand">
                  <span className="mb-1 block">{t('set.maxPurchase')}</span>
                  <input className={inputClass} type="number" dir="ltr" min={1} max={20000} value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)} />
                </label>
                <label className="text-sm font-medium text-brand">
                  <span className="mb-1 block">{t('set.maxMonth')}</span>
                  <input className={inputClass} type="number" dir="ltr" min={1} max={100000} value={perMonth} onChange={(e) => setPerMonth(e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-ink/50">{t('set.spent', { amount: mad(data.monthSpendMad) })}</p>
              <label className="block text-sm font-medium text-brand">
                <span className="mb-1 block">{t('set.password')}</span>
                <input className={inputClass} type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <p className="text-xs text-ink/50">{t('set.threeDS')}</p>
            </div>
          )}

          <ErrorLine error={error} />
          <div className="flex items-center gap-3">
            <button className={primaryButton}>{t('set.save')}</button>
            {saved && <span className="text-sm text-emerald-700" role="status">{saved}</span>}
            {data.settings.autoEnabledAt && autonomy === 'auto' && <span className="text-xs text-ink/50">{t('set.autoSince', { date: fmtDateTime(data.settings.autoEnabledAt) })}</span>}
          </div>
        </form>
      </Panel>

      {verified && (
        <Panel>
          <h2 className="font-semibold text-brand">{t('set.purchases')}</h2>
          {purchases.length === 0 ? (
            <p className="mt-2 text-sm text-ink/60">{t('set.nothing')}</p>
          ) : (
            <div className="mt-2 divide-y divide-brand/10">
              {purchases.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div dir="auto" className="font-semibold text-brand">{p.quantity} × {p.tier} · {p.eventTitle}</div>
                    <div className="text-xs text-ink/50">{fmtDateTime(p.createdAt)} · {p.via === 'auto_rule' ? t('set.viaRule') : t('set.viaYou')}{p.paymentRef && ` · ${p.paymentRef}`}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-semibold text-brand">{mad(p.totalMad)}</div>
                    <Chip tone={p.status === 'paid' ? 'green' : 'red'}>{p.status === 'paid' ? t('pay.paid') : t('pay.failed')}</Chip>
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
