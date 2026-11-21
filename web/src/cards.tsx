import { AlertTriangle, CalendarDays, Check, Loader2, MapPin, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { useI18n } from './i18n'
import type { Key } from './locales/en'
import { Chip, ghostButton, primaryButton } from './ui'

export type EventView = {
  id: string
  title: string
  category: string
  city: string
  country: string
  venue: string
  startsAt: string
  seller: string
  sellerUrl: string | null
  verifiedAt: string | null
  currency: string
  saleState: 'upcoming' | 'on_sale' | 'sold_out'
  saleOpensAt: string
  tiers: { name: string; price: number; priceMad: number }[]
  fromPriceMad: number
}
/** Structured cost lines (the client writes the label). The last variant is older stored data with a plain label. */
type Line =
  | { kind: 'tickets'; quantity: number; tier: string; unit: number; currency: string; amountMad: number }
  | { kind: 'rate'; currency: string; madPerUnit: number; recordedAt: string }
  | { kind: 'spread'; percent: number; amountMad: number }
  | { kind: 'fee'; amountMad: number }
  | { kind?: undefined; label: string; amountMad?: number; note?: string }
type Total = { tier: string; quantity: number; currency: string; totalMad: number; lines: Line[] }
type Reason = { code: string; message: string; fixable: boolean; params?: Record<string, string | number> }
type Eligibility = { status: 'allowed' | 'needs_action' | 'blocked'; reasons: Reason[]; allowanceRemainingMad: number | null }
type RuleSummary = { kind: 'alert' | 'buy'; eventId?: string; query?: string; tier?: string; maxPriceMad?: number; quantity: number; expiresAt: string }
type Proposal = {
  id: string
  kind: 'purchase' | 'rule'
  status: 'pending' | 'confirmed' | 'dismissed' | 'expired'
  expiresAt: string
  summary: { event?: EventView | null; total?: Total; eligibility?: Eligibility; rule?: RuleSummary }
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="my-2 w-full max-w-md rounded-2xl border border-brand/10 bg-white p-4 text-sm shadow-sm">{children}</div>
)

function SaleChip({ e }: { e: Pick<EventView, 'saleState' | 'saleOpensAt'> }) {
  const { t, fmtDate } = useI18n()
  if (e.saleState === 'on_sale') return <Chip tone="green">{t('card.onSale')}</Chip>
  if (e.saleState === 'sold_out') return <Chip tone="red">{t('card.soldOut')}</Chip>
  return <Chip tone="gold">{t('card.saleOpens', { date: fmtDate(e.saleOpensAt) })}</Chip>
}

function EventLine({ e }: { e: EventView }) {
  const { t, mad, fmtDate, city } = useI18n()
  return (
    <div className="flex items-start justify-between gap-3 border-t border-brand/10 py-2.5 first:border-t-0 first:pt-0">
      <div>
        <div dir="auto" className="font-semibold text-brand">{e.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/60">
          <span className="flex items-center gap-1"><MapPin className="size-3" />{city(e.city)}, {e.country}</span>
          <span className="flex items-center gap-1"><CalendarDays className="size-3" />{fmtDate(e.startsAt)}</span>
        </div>
      </div>
      <div className="shrink-0 text-end">
        <div className="font-semibold text-brand">{t('events.from')} {mad(e.fromPriceMad)}</div>
        <SaleChip e={e} />
      </div>
    </div>
  )
}

/** Where the event data comes from, and the link to the real seller. */
function SourceLine({ e }: { e: Pick<EventView, 'seller' | 'sellerUrl' | 'verifiedAt'> }) {
  const { t, fmtDate } = useI18n()
  return (
    <div className="mt-2 text-xs text-ink/50">
      {t('card.source', { seller: e.seller, date: e.verifiedAt ? fmtDate(e.verifiedAt) : t('events.recently') })}{' '}
      {e.sellerUrl && (
        <a href={e.sellerUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
          {t('card.openSeller')}
        </a>
      )}
    </div>
  )
}

function CostLines({ total }: { total: Total }) {
  const { t, mad, locale, fmtDateTime } = useI18n()

  const render = (l: Line): { label: string; value?: string; muted?: boolean } => {
    switch (l.kind) {
      case 'tickets': {
        const unit = l.currency === 'MAD' ? mad(l.unit) : `${l.unit.toLocaleString(locale)} ${l.currency}`
        return { label: t('cost.tickets', { qty: l.quantity, tier: l.tier, unit }), value: mad(l.amountMad) }
      }
      case 'rate':
        return { label: `${t('cost.rate', { currency: l.currency, rate: l.madPerUnit })} · ${t('cost.recorded', { date: fmtDateTime(l.recordedAt) })}`, muted: true }
      case 'spread':
        return { label: t('cost.spread', { pct: l.percent }), value: mad(l.amountMad) }
      case 'fee':
        return { label: t('cost.fee'), value: mad(l.amountMad) }
      default:
        return { label: l.label, value: l.amountMad === undefined ? undefined : mad(l.amountMad), muted: l.amountMad === undefined }
    }
  }

  return (
    <div className="space-y-1">
      {total.lines.map((line, i) => {
        const r = render(line)
        return (
          <div key={i} className={`flex justify-between gap-3 ${r.muted ? 'text-xs text-ink/45' : 'text-ink/80'}`}>
            <span>{r.label}</span>
            {r.value && <span className="shrink-0">{r.value}</span>}
          </div>
        )
      })}
      <div className="flex items-baseline justify-between border-t border-brand/10 pt-2">
        <span className="font-semibold text-brand">{t('cost.total')}</span>
        <span className="text-lg font-bold text-brand">{mad(total.totalMad)}</span>
      </div>
    </div>
  )
}

function Reasons({ el }: { el: Eligibility }) {
  const { t, reasonText } = useI18n()
  if (el.status === 'allowed') {
    return <div className="mt-3 flex items-center gap-1.5 text-emerald-700"><Check className="size-4" /> {t('card.canBuy')}</div>
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {el.reasons.map((r) => (
        <li key={r.code} className={`flex items-start gap-1.5 ${r.fixable ? 'text-amber-800' : 'text-red-700'}`}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {reasonText(r)}{' '}
            {r.code === 'KYC_REQUIRED' && <a href="#/verify" className="font-semibold underline">{t('card.verifyNow')}</a>}
            {r.code === 'NO_CARD' && <a href="#/settings" className="font-semibold underline">{t('card.openSettings')}</a>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ProposalCard({ initial }: { initial: Proposal }) {
  const { t, mad, fmtDate, errText, city } = useI18n()
  const [p, setP] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string; code?: string } | null>(null)

  // Show the truth after a reload: the proposal may already be confirmed, dismissed or expired.
  useEffect(() => {
    api<Proposal>(`/proposals/${initial.id}`).then(setP).catch(() => {})
  }, [initial.id])

  const act = async (path: string, done: (r: any) => string) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await api<any>(path, {})
      setP((x) => ({ ...x, status: path.endsWith('dismiss') ? 'dismissed' : 'confirmed' }))
      setNote({ ok: true, text: done(r) })
    } catch (e) {
      setNote({ ok: false, text: errText(e), code: e instanceof ApiError ? e.code : undefined })
    } finally {
      setBusy(false)
    }
  }

  const { event, total, eligibility, rule } = p.summary
  const purchase = p.kind === 'purchase'
  const pending = p.status === 'pending'

  const ruleSentence = (r: RuleSummary) => {
    const target = event ? event.title : t('rule.targetQuery', { q: r.query ?? '' })
    const cap = r.maxPriceMad === undefined ? '' : t('rule.cap', { price: mad(r.maxPriceMad) })
    return r.kind === 'alert'
      ? t('rule.alert', { target, cap })
      : t('rule.buy', { qty: r.quantity, tier: r.tier ?? t('rule.cheapest'), target, cap })
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-brand">
          <Ticket className="size-4 text-gold" />
          {purchase ? t('card.confirmPurchase') : rule?.kind === 'buy' ? t('card.confirmBuyRule') : t('card.confirmAlert')}
        </div>
        {p.status === 'confirmed' && <Chip tone="green">{t('card.confirmed')}</Chip>}
        {p.status === 'dismissed' && <Chip>{t('card.dismissed')}</Chip>}
        {p.status === 'expired' && <Chip>{t('card.expired')}</Chip>}
      </div>

      {purchase && event && total && (
        <>
          <div dir="auto" className="mb-2 text-ink/70">{event.title} · {city(event.city)} · {fmtDate(event.startsAt)}</div>
          <CostLines total={total} />
          {eligibility && pending && eligibility.status !== 'allowed' && <Reasons el={eligibility} />}
          <p className="mt-3 rounded-lg bg-gold/15 px-3 py-2 text-xs text-ink/70">
            {t('card.simulated')}
            {event.sellerUrl && (
              <>
                {' '}
                <a href={event.sellerUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
                  {t('card.simBuy', { seller: event.seller })}
                </a>
              </>
            )}
          </p>
        </>
      )}
      {!purchase && rule && (
        <div className="space-y-1 text-ink/80">
          <p dir="auto">{ruleSentence(rule)}</p>
          <p className="text-xs text-ink/50">{t('card.validUntil', { date: fmtDate(rule.expiresAt) })}</p>
          {rule.kind === 'buy' && <p className="text-xs text-ink/50">{t('card.buyNote')}</p>}
        </div>
      )}

      {note && (
        <p className={`mt-3 text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">
          {note.text}{' '}
          {note.code === 'KYC_REQUIRED' && <a href="#/verify" className="font-semibold underline">{t('card.verifyNow')}</a>}
          {note.code === 'NO_CARD' && <a href="#/settings" className="font-semibold underline">{t('card.openSettings')}</a>}
        </p>
      )}

      {pending && !note?.ok && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            className={primaryButton}
            onClick={() =>
              act(purchase ? `/purchases/proposals/${p.id}/confirm` : `/rules/proposals/${p.id}/confirm`, (r) =>
                purchase ? t('card.done', { ref: r.paymentRef }) : t('card.ruleSaved'),
              )
            }
          >
            {busy ? t('card.working') : purchase && total ? t('card.confirmBtn', { total: mad(total.totalMad) }) : t('card.save')}
          </button>
          <button type="button" disabled={busy} className={ghostButton} onClick={() => act(`/proposals/${p.id}/dismiss`, () => t('card.dismissedMsg'))}>
            {t('card.dismiss')}
          </button>
        </div>
      )}
    </Card>
  )
}

const WORKING = ['search_events', 'get_event', 'compute_total', 'check_eligibility', 'draft_purchase', 'draft_rule', 'list_rules', 'manage_rule', 'get_settings']

export type ToolPartLike = { type: string; state: string; output?: unknown; errorText?: string }

export function ToolCard({ part }: { part: ToolPartLike }) {
  const { t, mad, errText, reasonText } = useI18n()
  const name = part.type.replace(/^tool-/, '')
  if (part.state === 'output-error') return <Card><span className="text-red-700">{part.errorText ?? t('card.stepFailed')}</span></Card>
  if (part.state !== 'output-available') {
    return (
      <div className="my-1 flex items-center gap-2 text-xs text-ink/50">
        <Loader2 className="size-3.5 animate-spin" /> {t(WORKING.includes(name) ? (`work.${name}` as Key) : 'work.default')}
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = part.output as any
  if (out?.ok === false) {
    // The server explains in English for the assistant; the user sees it in their own language.
    const text = out.reasons?.length ? reasonText(out.reasons[0]) : errText(new ApiError(0, out.code ?? 'ERROR', out.message ?? ''))
    return (
      <Card>
        <div className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{text}</div>
      </Card>
    )
  }

  switch (name) {
    case 'search_events':
      // An empty search is just the agent trying other keywords; its text explains if nothing was found.
      if (out.count === 0) return null
      return (
        <Card>
          {(out.events as EventView[]).map((e) => <EventLine key={e.id} e={e} />)}
          <SourceLine e={(out.events as EventView[])[0]!} />
        </Card>
      )
    case 'get_event': {
      const e = out.event as EventView
      return (
        <Card>
          <EventLine e={e} />
          <div dir="auto" className="mt-2 text-xs text-ink/60">{e.venue}</div>
          <div className="mt-2 space-y-1">
            {e.tiers.map((tier) => (
              <div key={tier.name} className="flex justify-between text-ink/80">
                <span>{tier.name}{e.currency !== 'MAD' && ` · ${tier.price.toLocaleString('en-US')} ${e.currency}`}</span>
                <span>{t('events.from')} {mad(tier.priceMad)}</span>
              </div>
            ))}
          </div>
          <SourceLine e={e} />
        </Card>
      )
    }
    case 'compute_total':
      return <Card><div dir="auto" className="mb-2 font-semibold text-brand">{(out.event as EventView).title}</div><CostLines total={out.total as Total} /></Card>
    case 'check_eligibility':
      return (
        <Card>
          <div dir="auto" className="mb-2 font-semibold text-brand">{(out.event as EventView).title}</div>
          <CostLines total={out.total as Total} />
          <Reasons el={out.eligibility as Eligibility} />
        </Card>
      )
    case 'draft_purchase':
    case 'draft_rule':
      return <ProposalCard initial={out.proposal as Proposal} />
    case 'list_rules':
      return (
        <Card>
          {out.rules.length === 0 ? <span className="text-ink/60">{t('card.noRules')}</span> : out.rules.map((r: { id: string; kind: string; status: string; event: string; maxPriceMad: number | null }) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-t border-brand/10 py-2 first:border-t-0 first:pt-0">
              <span dir="auto" className="text-ink/80">{r.kind === 'buy' ? t('rule.kindBuy') : t('rule.kindAlert')} · {r.event}{r.maxPriceMad !== null && ` · ≤ ${mad(r.maxPriceMad)}`}</span>
              <Chip tone={r.status === 'active' ? 'green' : 'grey'}>{t(`srule.${r.status}` as Key)}</Chip>
            </div>
          ))}
        </Card>
      )
    case 'manage_rule':
      return <Card>{t('card.ruleNow', { status: t(`srule.${out.status}` as Key) })}</Card>
    case 'get_settings':
      return (
        <Card>
          <div>{t('card.setPurchases', { mode: out.autonomy === 'auto' ? t('status.auto') : t('status.ask') })}</div>
          <div className="text-ink/60">{t('card.setLimits', { per: mad(out.maxPerPurchaseMad), month: mad(out.maxPerMonthMad), spent: mad(out.spentThisMonthMad) })}</div>
          <div className="text-ink/60">{t('card.setCard', { card: out.card ?? t('card.noneCard') })}</div>
        </Card>
      )
    default:
      return null
  }
}
