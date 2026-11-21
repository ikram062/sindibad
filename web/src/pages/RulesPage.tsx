import { BellPlus, CheckCircle2, Hourglass, Radar } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { queuePrompt } from '../prompts'
import { Chip, fmtDate, fmtDateTime, ghostButton, mad, Panel, primaryButton } from '../ui'

type Rule = {
  id: string
  kind: 'alert' | 'buy'
  status: 'active' | 'paused' | 'fulfilled' | 'cancelled' | 'expired'
  outcome: 'notified' | 'proposed' | 'purchased' | 'blocked' | null
  outcomeDetail: string | null
  eventTitle: string | null
  query: string | null
  tier: string | null
  maxPriceMad: number | null
  quantity: number
  expiresAt: string
  firedAt: string | null
  sourceText: string | null
}

const statusTone = { active: 'green', paused: 'gold', fulfilled: 'grey', cancelled: 'grey', expired: 'grey' } as const
const outcomeText = { notified: 'You were notified', proposed: 'Waiting for your confirmation', purchased: 'Bought automatically', blocked: 'Could not complete' }

const IDEAS = [
  { title: 'Watch a price', prompt: 'Tell me if Tiakola tickets drop under 260 MAD' },
  { title: 'Buy when it is cheap', prompt: 'Buy 2 tickets for Hajib in Rabat if they cost under 125 MAD each' },
  { title: 'In Darija', prompt: '3lemni ila nqes taman dyal Stormy 3la 450 dh' },
]

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-brand/10 bg-white p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/5 text-gold">{icon}</span>
      <div>
        <div className="text-2xl font-bold leading-none text-brand">{value}</div>
        <div className="mt-1 text-sm font-medium text-brand">{label}</div>
        <div className="text-xs text-ink/45">{hint}</div>
      </div>
    </div>
  )
}

function RuleItem({ rule, onChange }: { rule: Rule; onChange: () => void }) {
  const [error, setError] = useState('')
  const act = async (action: 'pause' | 'resume' | 'cancel') => {
    setError('')
    try {
      await api(`/rules/${rule.id}/action`, { action })
      onChange()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the rule.')
    }
  }
  const target = rule.eventTitle ?? `events matching "${rule.query}"`
  const live = rule.status === 'active' || rule.status === 'paused'

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Chip tone={rule.kind === 'buy' ? 'gold' : 'grey'}>{rule.kind === 'buy' ? 'Buy' : 'Alert'}</Chip>
            <Chip tone={statusTone[rule.status]}>{rule.status}</Chip>
          </div>
          <p className="mt-2 font-semibold text-brand">{target}</p>
          <p className="text-sm text-ink/60">
            {rule.kind === 'buy' && `${rule.quantity} × ${rule.tier ?? 'cheapest'} · `}
            {rule.maxPriceMad !== null ? `up to ${mad(rule.maxPriceMad)} per ticket` : 'any price'} · until {fmtDate(rule.expiresAt)}
          </p>
          {rule.sourceText && <p dir="auto" className="mt-1 text-xs italic text-ink/45">"{rule.sourceText}"</p>}
          {rule.outcome && (
            <p className="mt-2 text-sm text-ink/70">
              <b>{outcomeText[rule.outcome]}</b>
              {rule.firedAt && ` · ${fmtDateTime(rule.firedAt)}`}
              {rule.outcomeDetail && <span className="block text-ink/50">{rule.outcomeDetail}</span>}
            </p>
          )}
        </div>
        {live && (
          <div className="flex gap-2">
            {rule.status === 'active' ? (
              <button type="button" className={ghostButton} onClick={() => act('pause')}>Pause</button>
            ) : (
              <button type="button" className={ghostButton} onClick={() => act('resume')}>Resume</button>
            )}
            <button type="button" className={ghostButton} onClick={() => act('cancel')}>Cancel</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Panel>
  )
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const load = useCallback(() => {
    api<{ rules: Rule[] }>('/rules').then((r) => setRules([...r.rules].reverse())).catch(() => setRules([]))
  }, [])
  useEffect(load, [load])

  const count = (f: (r: Rule) => boolean) => (rules ?? []).filter(f).length

  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-3xl font-semibold text-brand">Your rules</h1>
        <p className="text-ink/60">Standing instructions you gave in the chat. Each one expires and fires once. Pause or cancel any time.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<Radar className="size-5" />} label="Watching" value={count((r) => r.status === 'active')} hint="active rules" />
        <Stat icon={<Hourglass className="size-5" />} label="Needs you" value={count((r) => r.outcome === 'proposed')} hint="waiting for your confirmation" />
        <Stat icon={<CheckCircle2 className="size-5" />} label="Done" value={count((r) => r.status === 'fulfilled' && r.outcome !== 'proposed')} hint="fired already" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {rules === null ? (
            <p className="text-brand/60">Loading…</p>
          ) : rules.length === 0 ? (
            <Panel className="py-10 text-center">
              <BellPlus className="mx-auto size-10 text-gold" />
              <p className="mt-3 text-lg font-semibold text-brand">No rules yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink/60">A rule watches an event for you and tells you, or buys, when the price is right. Try one of the ideas.</p>
              <a href="#/chat" className={`${primaryButton} mt-4 inline-block`}>Create one in the chat</a>
            </Panel>
          ) : (
            rules.map((r) => <RuleItem key={r.id} rule={r} onChange={load} />)
          )}
        </div>

        <aside className="rounded-2xl bg-brand p-5 text-cream lg:sticky lg:top-2">
          <h2 className="text-lg font-semibold">Ideas to try</h2>
          <p className="mt-1 text-sm text-cream/70">Tap one and the assistant drafts the rule. You confirm it before it starts.</p>
          <div className="mt-4 space-y-2">
            {IDEAS.map((i) => (
              <button
                key={i.title}
                type="button"
                onClick={() => queuePrompt(i.prompt)}
                className="block w-full rounded-xl border border-cream/20 bg-cream/10 p-3 text-left transition hover:border-gold hover:bg-cream/15"
              >
                <span className="block text-xs font-semibold uppercase tracking-wide text-gold">{i.title}</span>
                <span dir="auto" className="mt-0.5 block text-sm">{i.prompt}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
