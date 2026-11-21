import { AlertTriangle, CalendarDays, Check, Loader2, MapPin, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { Chip, fmtDate, ghostButton, mad, primaryButton } from './ui'

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
type Line = { label: string; amountMad?: number; note?: string }
type Total = { tier: string; quantity: number; currency: string; totalMad: number; lines: Line[] }
type Reason = { code: string; message: string; fixable: boolean }
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
  if (e.saleState === 'on_sale') return <Chip tone="green">On sale</Chip>
  if (e.saleState === 'sold_out') return <Chip tone="red">Sold out</Chip>
  return <Chip tone="gold">Sale opens {fmtDate(e.saleOpensAt)}</Chip>
}

function EventLine({ e }: { e: EventView }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-brand/10 py-2.5 first:border-t-0 first:pt-0">
      <div>
        <div className="font-semibold text-brand">{e.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/60">
          <span className="flex items-center gap-1"><MapPin className="size-3" />{e.city}, {e.country}</span>
          <span className="flex items-center gap-1"><CalendarDays className="size-3" />{fmtDate(e.startsAt)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-brand">from {mad(e.fromPriceMad)}</div>
        <SaleChip e={e} />
      </div>
    </div>
  )
}

/** Where the event data comes from, and the link to the real seller. */
function SourceLine({ e }: { e: Pick<EventView, 'seller' | 'sellerUrl' | 'verifiedAt'> }) {
  return (
    <div className="mt-2 text-xs text-ink/50">
      Listing from {e.seller}
      {e.verifiedAt && `, checked ${fmtDate(e.verifiedAt)}`}. Prices can change.{' '}
      {e.sellerUrl && (
        <a href={e.sellerUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
          Open the seller's page
        </a>
      )}
    </div>
  )
}

function CostLines({ total }: { total: Total }) {
  return (
    <div className="space-y-1">
      {total.lines.map((l, i) => (
        <div key={i} className={`flex justify-between gap-3 ${l.amountMad === undefined ? 'text-xs text-ink/45' : 'text-ink/80'}`}>
          <span>{l.label}{l.note ? ` · ${l.note}` : ''}</span>
          {l.amountMad !== undefined && <span className="shrink-0">{mad(l.amountMad)}</span>}
        </div>
      ))}
      <div className="flex items-baseline justify-between border-t border-brand/10 pt-2">
        <span className="font-semibold text-brand">Total</span>
        <span className="text-lg font-bold text-brand">{mad(total.totalMad)}</span>
      </div>
    </div>
  )
}

function Reasons({ el }: { el: Eligibility }) {
  if (el.status === 'allowed') {
    return <div className="mt-3 flex items-center gap-1.5 text-emerald-700"><Check className="size-4" /> You can buy this now</div>
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {el.reasons.map((r) => (
        <li key={r.code} className={`flex items-start gap-1.5 ${r.fixable ? 'text-amber-800' : 'text-red-700'}`}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {r.message}{' '}
            {r.code === 'KYC_REQUIRED' && <a href="#/verify" className="font-semibold underline">Verify now</a>}
            {r.code === 'NO_CARD' && <a href="#/settings" className="font-semibold underline">Open Settings</a>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ruleSentence(r: RuleSummary, e?: EventView | null) {
  const target = e ? e.title : `events matching "${r.query}"`
  const cap = r.maxPriceMad === undefined ? '' : ` at ${mad(r.maxPriceMad)} per ticket or less`
  return r.kind === 'alert'
    ? `Tell me when ${target} is on sale${cap}.`
    : `Buy ${r.quantity} × ${r.tier ?? 'cheapest'} for ${target} when it is on sale${cap}.`
}

function ProposalCard({ initial }: { initial: Proposal }) {
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
      setNote({ ok: false, text: e instanceof ApiError ? e.message : 'Something went wrong.', code: e instanceof ApiError ? e.code : undefined })
    } finally {
      setBusy(false)
    }
  }

  const { event, total, eligibility, rule } = p.summary
  const purchase = p.kind === 'purchase'
  const pending = p.status === 'pending'

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-brand">
          <Ticket className="size-4 text-gold" />
          {purchase ? 'Confirm your purchase' : rule?.kind === 'buy' ? 'Confirm this buying rule' : 'Confirm this alert'}
        </div>
        {p.status === 'confirmed' && <Chip tone="green">Confirmed</Chip>}
        {p.status === 'dismissed' && <Chip>Dismissed</Chip>}
        {p.status === 'expired' && <Chip>Expired</Chip>}
      </div>

      {purchase && event && total && (
        <>
          <div className="mb-2 text-ink/70">{event.title} · {event.city} · {fmtDate(event.startsAt)}</div>
          <CostLines total={total} />
          {eligibility && pending && eligibility.status !== 'allowed' && <Reasons el={eligibility} />}
          <p className="mt-3 rounded-lg bg-gold/15 px-3 py-2 text-xs text-ink/70">
            Simulated payment: confirming here does <b>not</b> issue a real ticket.
            {event.sellerUrl && (
              <> Buy the real ticket on <a href={event.sellerUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">{event.seller}</a>.</>
            )}
          </p>
        </>
      )}
      {!purchase && rule && (
        <div className="space-y-1 text-ink/80">
          <p>{ruleSentence(rule, event)}</p>
          <p className="text-xs text-ink/50">Valid until {fmtDate(rule.expiresAt)}.</p>
          {rule.kind === 'buy' && (
            <p className="text-xs text-ink/50">
              When it matches, Sindibad asks you to confirm, or buys by itself only if you allowed that in Settings.
            </p>
          )}
        </div>
      )}

      {note && (
        <p className={`mt-3 text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">
          {note.text}{' '}
          {note.code === 'KYC_REQUIRED' && <a href="#/verify" className="font-semibold underline">Verify now</a>}
          {note.code === 'NO_CARD' && <a href="#/settings" className="font-semibold underline">Open Settings</a>}
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
                purchase ? `Done. Payment reference ${r.paymentRef}.` : 'Rule saved. You can manage it in Rules.',
              )
            }
          >
            {busy ? 'Working…' : purchase && total ? `Confirm · ${mad(total.totalMad)}` : 'Save'}
          </button>
          <button type="button" disabled={busy} className={ghostButton} onClick={() => act(`/proposals/${p.id}/dismiss`, () => 'Dismissed.')}>
            Dismiss
          </button>
        </div>
      )}
    </Card>
  )
}

const WORKING: Record<string, string> = {
  search_events: 'Searching events…',
  get_event: 'Loading event…',
  compute_total: 'Working out the total…',
  check_eligibility: 'Checking if you can buy…',
  draft_purchase: 'Preparing the purchase…',
  draft_rule: 'Preparing the rule…',
  list_rules: 'Loading your rules…',
  manage_rule: 'Updating the rule…',
  get_settings: 'Reading your settings…',
}

export type ToolPartLike = { type: string; state: string; output?: unknown; errorText?: string }

export function ToolCard({ part }: { part: ToolPartLike }) {
  const name = part.type.replace(/^tool-/, '')
  if (part.state === 'output-error') return <Card><span className="text-red-700">{part.errorText ?? 'That step failed.'}</span></Card>
  if (part.state !== 'output-available') {
    return (
      <div className="my-1 flex items-center gap-2 text-xs text-ink/50">
        <Loader2 className="size-3.5 animate-spin" /> {WORKING[name] ?? 'Working…'}
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = part.output as any
  if (out?.ok === false) {
    return (
      <Card>
        <div className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{out.message}</div>
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
          <div className="mt-2 text-xs text-ink/60">{e.venue}</div>
          <div className="mt-2 space-y-1">
            {e.tiers.map((t) => (
              <div key={t.name} className="flex justify-between text-ink/80">
                <span>{t.name}{e.currency !== 'MAD' && ` · ${t.price.toLocaleString('en-US')} ${e.currency}`}</span>
                <span>from {mad(t.priceMad)}</span>
              </div>
            ))}
          </div>
          <SourceLine e={e} />
        </Card>
      )
    }
    case 'compute_total':
      return <Card><div className="mb-2 font-semibold text-brand">{(out.event as EventView).title}</div><CostLines total={out.total as Total} /></Card>
    case 'check_eligibility':
      return (
        <Card>
          <div className="mb-2 font-semibold text-brand">{(out.event as EventView).title}</div>
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
          {out.rules.length === 0 ? <span className="text-ink/60">You have no rules yet.</span> : out.rules.map((r: { id: string; kind: string; status: string; event: string; maxPriceMad: number | null }) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-t border-brand/10 py-2 first:border-t-0 first:pt-0">
              <span className="text-ink/80">{r.kind === 'buy' ? 'Buy' : 'Alert'} · {r.event}{r.maxPriceMad !== null && ` · ≤ ${mad(r.maxPriceMad)}`}</span>
              <Chip tone={r.status === 'active' ? 'green' : 'grey'}>{r.status}</Chip>
            </div>
          ))}
        </Card>
      )
    case 'manage_rule':
      return <Card>Rule is now <b>{out.status}</b>.</Card>
    case 'get_settings':
      return (
        <Card>
          <div>Purchases: <b>{out.autonomy === 'auto' ? 'automatic within limits' : 'always ask me'}</b></div>
          <div className="text-ink/60">Limits: {mad(out.maxPerPurchaseMad)} per purchase · {mad(out.maxPerMonthMad)} per month (spent {mad(out.spentThisMonthMad)})</div>
          <div className="text-ink/60">Card: {out.card ?? 'none'}</div>
        </Card>
      )
    default:
      return null
  }
}

