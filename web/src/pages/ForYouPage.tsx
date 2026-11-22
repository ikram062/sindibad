import { BellRing, Check, MapPin, ShoppingCart, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { ProposalCard, type EventView, type Proposal } from '../cards'
import { useI18n } from '../i18n'
import type { Key } from '../locales/en'
import { Chip, ErrorLine, ghostButton, inputClass, Panel, primaryButton } from '../ui'

type Prefs = { cities: string[]; categories: string[]; maxPriceMad: number | null; keywords: string }
type Match = 'CITY' | 'CATEGORY' | 'BUDGET' | 'KEYWORD'
type Item = { event: EventView; reasons: Match[]; activeRules: ('alert' | 'buy')[] }
type Reco = { hasPreferences: boolean; items: Item[] }

const EMPTY: Prefs = { cities: [], categories: [], maxPriceMad: null, keywords: '' }
const CATEGORIES = ['concert', 'festival', 'football', 'other'] as const
const DAYS = [7, 14, 30, 60]

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition ${on ? 'border-brand bg-brand text-cream' : 'border-brand/20 bg-white text-brand hover:border-gold'}`}
    >
      {children}
    </button>
  )
}

/** One recommended event, with the same actions as the chat: buy now, be alerted, or have Sindibad buy for you. */
function RecoCard({ item, onChange }: { item: Item; onChange: () => void }) {
  const { t, mad, city, locale, errText } = useI18n()
  const e = item.event
  const onSale = e.saleState === 'on_sale'
  const d = new Date(e.startsAt)

  const [mode, setMode] = useState<null | 'alert' | 'buy'>(null)
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [ruleQty, setRuleQty] = useState(1)
  const [days, setDays] = useState(30)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<{ text: string; code?: string } | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (x) {
      setError({ text: errText(x), code: x instanceof ApiError ? x.code : undefined })
    } finally {
      setBusy(false)
    }
  }

  const buyNow = () =>
    run(async () => {
      const r = await api<{ proposal: Proposal }>('/purchases/draft', { eventId: e.id, quantity: qty })
      setProposal(r.proposal)
      setMode(null)
      setDone(false)
    })

  const createRule = (kind: 'alert' | 'buy') => (ev: FormEvent) => {
    ev.preventDefault()
    run(async () => {
      await api('/rules', {
        kind,
        eventId: e.id,
        maxPriceMad: price === '' ? undefined : Number(price),
        quantity: kind === 'buy' ? ruleQty : 1,
        expiresInDays: days,
      })
      setMode(null)
      setDone(true)
      setPrice('')
      onChange()
    })
  }

  const open = (m: 'alert' | 'buy') => {
    setMode(mode === m ? null : m)
    setError(null)
    setDone(false)
    setProposal(null)
  }

  const small = `${inputClass} !py-2 !text-sm`
  const buyDisabled = busy

  return (
    <div className="rounded-2xl border border-brand/10 bg-white p-4 transition hover:border-gold/70">
      <div className="flex gap-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-brand text-center text-cream">
          <div>
            <div className="text-xl font-bold leading-none">{d.toLocaleDateString(locale, { day: 'numeric', timeZone: 'UTC' })}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-gold">{d.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 dir="auto" className="font-semibold leading-snug text-brand">{e.title}</h3>
            <span className="text-sm text-ink/60">{t('events.from')} <b className="text-base text-brand">{mad(e.fromPriceMad)}</b></span>
          </div>
          <p dir="auto" className="mt-1 flex items-center gap-1 text-xs text-ink/55"><MapPin className="size-3 shrink-0" />{e.venue}, {city(e.city)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.reasons.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                <Check className="size-3" /> {t(`fy.reason.${r}` as Key)}
              </span>
            ))}
            {!onSale && <Chip tone="gold">{t('card.saleOpens', { date: new Date(e.saleOpensAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })}</Chip>}
            {item.activeRules.includes('alert') && <Chip tone="green">{t('fy.alertOn')}</Chip>}
            {item.activeRules.includes('buy') && <Chip tone="gold">{t('fy.buyOn')}</Chip>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-brand/10 pt-3">
        {onSale && (
          <span className="flex items-center gap-1">
            <select value={qty} onChange={(ev) => setQty(Number(ev.target.value))} aria-label={t('fy.qty')} className="rounded-lg border border-brand/20 bg-white px-1.5 py-2 text-sm">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}×</option>)}
            </select>
            <button type="button" disabled={buyDisabled} onClick={buyNow} className={`${primaryButton} !py-2 text-sm`}>
              <ShoppingCart className="me-1.5 inline size-4" />{t('fy.buyNow')}
            </button>
          </span>
        )}
        <button type="button" onClick={() => open('alert')} aria-pressed={mode === 'alert'} className={ghostButton}>
          <BellRing className="me-1.5 inline size-4" />{t('fy.alertMe')}
        </button>
        <button type="button" onClick={() => open('buy')} aria-pressed={mode === 'buy'} className={ghostButton}>{t('fy.buyForMe')}</button>
      </div>

      {mode && (
        <form onSubmit={createRule(mode)} className="mt-3 space-y-3 rounded-xl bg-brand/5 p-3">
          <p className="text-sm font-semibold text-brand">{mode === 'alert' ? t('fy.alertTitle') : t('fy.buyTitle')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-brand">
              <span className="mb-1 block">{t('fy.price')}</span>
              <input
                className={small}
                type="number"
                dir="ltr"
                min={1}
                step="any"
                // An alert on an event that is already on sale only makes sense below today's price.
                max={mode === 'alert' && onSale ? Math.max(1, Math.ceil(e.fromPriceMad) - 1) : undefined}
                required={mode === 'buy' || onSale}
                value={price}
                onChange={(ev) => setPrice(ev.target.value)}
              />
            </label>
            {mode === 'buy' && (
              <label className="block text-sm font-medium text-brand">
                <span className="mb-1 block">{t('fy.qty')}</span>
                <select className={small} value={ruleQty} onChange={(ev) => setRuleQty(Number(ev.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <label className="block text-sm font-medium text-brand">
              <span className="mb-1 block">{t('fy.expiry')}</span>
              <select className={small} value={days} onChange={(ev) => setDays(Number(ev.target.value))}>
                {DAYS.map((n) => <option key={n} value={n}>{t('fy.days', { n })}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-ink/55">
            {mode === 'alert' ? (onSale ? t('fy.priceHintNow', { price: mad(e.fromPriceMad) }) : t('fy.priceHintOpen')) : t('card.buyNote')}
          </p>
          <div className="flex gap-2">
            <button disabled={busy} className={`${primaryButton} !py-2 text-sm`}>{mode === 'alert' ? t('fy.startAlert') : t('fy.createBuy')}</button>
            <button type="button" className={ghostButton} onClick={() => setMode(null)}>{t('fy.close')}</button>
          </div>
        </form>
      )}

      {error && (
        <div className="mt-3">
          <ErrorLine error={error.text} />
          {error.code === 'KYC_REQUIRED' && <a href="#/verify" className="text-sm font-semibold text-brand underline">{t('card.verifyNow')}</a>}
        </div>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {t('fy.created')} <a href="#/rules" className="font-semibold underline">{t('fy.openRules')}</a>
        </p>
      )}
      {proposal && <ProposalCard key={proposal.id} initial={proposal} />}
    </div>
  )
}

/** The preferences form, in a modal dialog. The native <dialog> gives Escape, focus trapping and a backdrop for free. */
function PreferencesDialog({
  open,
  onClose,
  form,
  setForm,
  allCities,
  saving,
  onSave,
  error,
}: {
  open: boolean
  onClose: () => void
  form: Prefs
  setForm: (f: Prefs | ((f: Prefs) => Prefs)) => void
  allCities: string[]
  saving: boolean
  onSave: (ev: FormEvent) => void
  error: string
}) {
  const { t, city } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const toggle = (key: 'cities' | 'categories', value: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }))

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the dimmed backdrop lands on the dialog element itself, never on its content.
      onClick={(ev) => ev.target === ev.currentTarget && onClose()}
      aria-labelledby="prefs-title"
      className="m-auto w-[min(94vw,32rem)] rounded-3xl border border-brand/10 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSave} className="max-h-[88vh] space-y-5 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="prefs-title" className="text-xl font-semibold text-brand">{t('fy.prefs.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('fy.close')} className="rounded-full p-1 text-brand/60 hover:bg-brand/5 hover:text-brand">
            <X className="size-5" />
          </button>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-brand">{t('fy.cities')}</div>
          <div className="flex flex-wrap gap-1.5">
            {allCities.map((c) => <Toggle key={c} on={form.cities.includes(c)} onClick={() => toggle('cities', c)}>{city(c)}</Toggle>)}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-brand">{t('fy.categories')}</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => <Toggle key={c} on={form.categories.includes(c)} onClick={() => toggle('categories', c)}>{t(`cat.${c}` as Key)}</Toggle>)}
          </div>
        </div>

        <label className="block text-sm font-medium text-brand">
          <span className="mb-1.5 block">{t('fy.budget')}</span>
          <input
            className={inputClass}
            type="number"
            dir="ltr"
            min={0}
            step="any"
            value={form.maxPriceMad ?? ''}
            onChange={(ev) => setForm((f) => ({ ...f, maxPriceMad: ev.target.value === '' ? null : Number(ev.target.value) }))}
          />
          <span className="mt-1 block text-xs font-normal text-ink/50">{t('fy.budgetHint')}</span>
        </label>

        <label className="block text-sm font-medium text-brand">
          <span className="mb-1.5 block">{t('fy.keywords')}</span>
          <input className={inputClass} dir="auto" maxLength={100} value={form.keywords} onChange={(ev) => setForm((f) => ({ ...f, keywords: ev.target.value }))} />
          <span className="mt-1 block text-xs font-normal text-ink/50">{t('fy.keywordsHint')}</span>
        </label>

        <ErrorLine error={error} />
        <div className="flex gap-2">
          <button disabled={saving} className={primaryButton}>{saving ? t('common.wait') : t('fy.save')}</button>
          <button type="button" onClick={onClose} className={ghostButton}>{t('fy.close')}</button>
        </div>
      </form>
    </dialog>
  )
}

export default function ForYouPage() {
  const { t, city, mad, errText } = useI18n()
  const [form, setForm] = useState<Prefs>(EMPTY)
  const [saved, setSaved] = useState<Prefs>(EMPTY)
  const [allCities, setAllCities] = useState<string[]>([])
  const [reco, setReco] = useState<Reco | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const loadReco = useCallback(() => {
    api<Reco>('/recommendations').then(setReco).catch(() => setReco({ hasPreferences: false, items: [] }))
  }, [])

  useEffect(() => {
    api<{ prefs: Prefs }>('/preferences').then((r) => { setForm(r.prefs); setSaved(r.prefs) }).catch(() => {})
    api<{ events: EventView[] }>('/events').then((r) => setAllCities([...new Set(r.events.map((x) => x.city))].sort())).catch(() => {})
    loadReco()
  }, [loadReco])

  const openDialog = () => {
    setForm(saved) // start from what is saved, so a cancelled edit leaves no trace
    setError('')
    setJustSaved(false)
    setDialogOpen(true)
  }

  const save = async (ev: FormEvent) => {
    ev.preventDefault()
    setSaving(true)
    setError('')
    try {
      const r = await api<{ prefs: Prefs }>('/preferences', form, 'PUT')
      setSaved(r.prefs)
      setForm(r.prefs)
      setDialogOpen(false)
      setJustSaved(true)
      loadReco()
    } catch (e) {
      setError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  // What the user chose, as chips next to the button, so the list never looks unexplained.
  const chips = [
    ...saved.cities.map((c) => city(c)),
    ...saved.categories.map((c) => t(`cat.${c}` as Key)),
    ...(saved.maxPriceMad !== null ? [t('fy.budgetUpTo', { price: mad(saved.maxPriceMad) })] : []),
    ...(saved.keywords ? [`“${saved.keywords}”`] : []),
  ]

  return (
    <div className="space-y-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-brand">{t('fy.title')}</h1>
          <p className="max-w-2xl text-ink/60">{t('fy.sub')}</p>
        </div>
        <button type="button" onClick={openDialog} className={primaryButton}>
          <SlidersHorizontal className="me-2 inline size-4" />
          {t('fy.prefs.title')}
        </button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => <span key={c} dir="auto" className="rounded-full bg-brand/5 px-3 py-1 text-sm font-medium text-brand">{c}</span>)}
          {justSaved && <span role="status" className="ms-2 text-sm text-emerald-700">{t('fy.saved')}</span>}
        </div>
      )}

      <section className="space-y-3">
        {reco === null ? (
          <p className="text-brand/60">{t('common.loading')}</p>
        ) : (
          <>
            {!reco.hasPreferences && <p className="rounded-2xl bg-gold/15 px-4 py-3 text-sm text-ink/70">{t('fy.noPrefs')}</p>}
            {reco.hasPreferences && reco.items.length > 0 && <p className="text-sm font-medium text-brand/70">{t('fy.count', { n: reco.items.length })}</p>}
            {reco.items.length === 0 && <Panel><p className="text-ink/70">{t('fy.none')}</p></Panel>}
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {reco.items.map((it) => <RecoCard key={it.event.id} item={it} onChange={loadReco} />)}
            </div>
          </>
        )}
      </section>

      <PreferencesDialog open={dialogOpen} onClose={() => setDialogOpen(false)} form={form} setForm={setForm} allCities={allCities} saving={saving} onSave={save} error={error} />
    </div>
  )
}
