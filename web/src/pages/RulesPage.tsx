import { BellPlus, CheckCircle2, Hourglass, Radar } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useI18n } from '../i18n'
import type { Key } from '../locales/en'
import { queuePrompt } from '../prompts'
import { Chip, ghostButton, Panel, primaryButton } from '../ui'

type Rule = {
  id: string
  kind: 'alert' | 'buy'
  status: 'active' | 'paused' | 'fulfilled' | 'cancelled' | 'expired'
  outcome: 'notified' | 'proposed' | 'purchased' | 'blocked' | null
  outcomeDetail: string | null
  outcomeData: Record<string, string | number> | null
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
// The same wording as the notification the rule produced, so the Rules page and the bell always agree.
const OUTCOME_CODE = { notified: 'RULE_ALERT', blocked: 'RULE_NEEDS_ID', purchased: 'RULE_PURCHASED', proposed: 'RULE_CONFIRM' } as const

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
  const { t, mad, fmtDate, fmtDateTime, errText, notifText } = useI18n()
  const [error, setError] = useState('')
  const act = async (action: 'pause' | 'resume' | 'cancel') => {
    setError('')
    try {
      await api(`/rules/${rule.id}/action`, { action })
      onChange()
    } catch (e) {
      setError(errText(e))
    }
  }
  const target = rule.eventTitle ?? t('rule.targetQuery', { q: rule.query ?? '' })
  const live = rule.status === 'active' || rule.status === 'paused'
  const detail = rule.outcome
    ? notifText(OUTCOME_CODE[rule.outcome], { ...(rule.outcomeData ?? {}), rule: '' }, { title: '', body: rule.outcomeDetail ?? '' }).body
    : ''

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Chip tone={rule.kind === 'buy' ? 'gold' : 'grey'}>{rule.kind === 'buy' ? t('rule.kindBuy') : t('rule.kindAlert')}</Chip>
            <Chip tone={statusTone[rule.status]}>{t(`srule.${rule.status}` as Key)}</Chip>
          </div>
          <p dir="auto" className="mt-2 font-semibold text-brand">{target}</p>
          <p className="text-sm text-ink/60">
            {rule.kind === 'buy' && t('rule.buyPrefix', { qty: rule.quantity, tier: rule.tier ?? t('rule.cheapest') })}
            {rule.maxPriceMad !== null ? t('rule.upTo', { price: mad(rule.maxPriceMad) }) : t('rule.anyPrice')} · {t('rule.until', { date: fmtDate(rule.expiresAt) })}
          </p>
          {rule.sourceText && <p dir="auto" className="mt-1 text-xs italic text-ink/45">“{rule.sourceText}”</p>}
          {rule.outcome && (
            <p className="mt-2 text-sm text-ink/70">
              <b>{t(`outcome.${rule.outcome}` as Key)}</b>
              {rule.firedAt && ` · ${fmtDateTime(rule.firedAt)}`}
              {detail && <span dir="auto" className="block text-ink/50">{detail}</span>}
            </p>
          )}
        </div>
        {live && (
          <div className="flex gap-2">
            {rule.status === 'active' ? (
              <button type="button" className={ghostButton} onClick={() => act('pause')}>{t('rules.pause')}</button>
            ) : (
              <button type="button" className={ghostButton} onClick={() => act('resume')}>{t('rules.resume')}</button>
            )}
            <button type="button" className={ghostButton} onClick={() => act('cancel')}>{t('rules.cancel')}</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Panel>
  )
}

export default function RulesPage() {
  const { t } = useI18n()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const load = useCallback(() => {
    api<{ rules: Rule[] }>('/rules').then((r) => setRules([...r.rules].reverse())).catch(() => setRules([]))
  }, [])
  useEffect(load, [load])

  const count = (f: (r: Rule) => boolean) => (rules ?? []).filter(f).length
  const IDEAS = [
    { title: t('rules.i1.title'), prompt: t('rules.i1.prompt') },
    { title: t('rules.i2.title'), prompt: t('rules.i2.prompt') },
    { title: t('rules.i3.title'), prompt: t('rules.i3.prompt') },
  ]

  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-3xl font-semibold text-brand">{t('rules.title')}</h1>
        <p className="text-ink/60">{t('rules.sub')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<Radar className="size-5" />} label={t('rules.watching')} value={count((r) => r.status === 'active')} hint={t('rules.watchingHint')} />
        <Stat icon={<Hourglass className="size-5" />} label={t('rules.needs')} value={count((r) => r.outcome === 'proposed')} hint={t('rules.needsHint')} />
        <Stat icon={<CheckCircle2 className="size-5" />} label={t('rules.done')} value={count((r) => r.status === 'fulfilled' && r.outcome !== 'proposed')} hint={t('rules.doneHint')} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {rules === null ? (
            <p className="text-brand/60">{t('common.loading')}</p>
          ) : rules.length === 0 ? (
            <Panel className="py-10 text-center">
              <BellPlus className="mx-auto size-10 text-gold" />
              <p className="mt-3 text-lg font-semibold text-brand">{t('rules.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink/60">{t('rules.emptyBody')}</p>
              <a href="#/chat" className={`${primaryButton} mt-4 inline-block`}>{t('rules.emptyCta')}</a>
            </Panel>
          ) : (
            rules.map((r) => <RuleItem key={r.id} rule={r} onChange={load} />)
          )}
        </div>

        <aside className="rounded-2xl bg-brand p-5 text-cream lg:sticky lg:top-2">
          <h2 className="text-lg font-semibold">{t('rules.ideas')}</h2>
          <p className="mt-1 text-sm text-cream/70">{t('rules.ideasSub')}</p>
          <div className="mt-4 space-y-2">
            {IDEAS.map((i) => (
              <button
                key={i.title}
                type="button"
                onClick={() => queuePrompt(i.prompt)}
                className="block w-full rounded-xl border border-cream/20 bg-cream/10 p-3 text-start transition hover:border-gold hover:bg-cream/15"
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
