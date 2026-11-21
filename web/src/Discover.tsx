import { BadgeCheck, Bell, CreditCard, ExternalLink, MapPin, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import type { EventView } from './cards'
import { Chip, mad } from './ui'

const PROMPTS = [
  'What concerts are there in Rabat in December?',
  'Je voudrais 2 billets pour Tiakola à Casablanca',
  'bghit tickets dyal Hajib f Rabat, ch7al ghadi nkhlles?',
  'نبهني إذا نزل ثمن تذاكر حفلة تياكولا عن 260 درهم',
]

/** The first thing a signed-in user sees: a greeting, ways to start, and their status at a glance. */
export function Hero({ onAsk }: { onAsk: (text: string) => void }) {
  const { user } = useAuth()
  const first = user?.name.split(' ')[0] ?? ''
  return (
    <section className="relative overflow-hidden rounded-3xl bg-brand p-7 text-cream sm:p-9">
      <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-gold/25 blur-3xl" />
      <div className="relative">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Tickets in Morocco</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Hi {first}, what are you going out to?</h1>
        <p className="mt-2 max-w-xl text-cream/75">
          Ask in English, Français, العربية or Darija. I find the tickets and show the full cost. You confirm every purchase.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              dir="auto"
              onClick={() => onAsk(p)}
              className="rounded-full border border-cream/25 bg-cream/10 px-4 py-2 text-left text-sm transition hover:border-gold hover:bg-cream/20"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

type SettingsLite = { settings: { autonomy: 'ask' | 'auto' }; card: { brand: string; last4: string } | null }

function Tile({ href, icon, label, value, tone }: { href: string; icon: React.ReactNode; label: string; value: string; tone: 'ok' | 'warn' | 'plain' }) {
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-gold'
  return (
    <a href={href} className="flex items-center gap-3 rounded-2xl border border-brand/10 bg-white p-4 transition hover:border-gold">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl bg-brand/5 ${color}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-ink/50">{label}</span>
        <span className="block truncate font-semibold text-brand">{value}</span>
      </span>
    </a>
  )
}

/** Four quick facts that decide what the user can do right now, each linking to where it is changed. */
export function StatusStrip() {
  const { user } = useAuth()
  const [s, setS] = useState<SettingsLite | null>(null)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    api<SettingsLite>('/settings').then(setS).catch(() => {})
    api<{ rules: { status: string }[] }>('/rules').then((r) => setActive(r.rules.filter((x) => x.status === 'active').length)).catch(() => {})
  }, [])

  const verified = user?.kycStatus === 'verified'
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        href={verified ? '#/settings' : '#/verify'}
        icon={verified ? <BadgeCheck className="size-5" /> : <ShieldAlert className="size-5" />}
        label={verified ? 'Identity (Mon e-ID)' : 'Identity'}
        value={verified ? 'Verified' : 'Not verified yet'}
        tone={verified ? 'ok' : 'warn'}
      />
      <Tile
        href="#/settings"
        icon={<CreditCard className="size-5" />}
        label="Payment card"
        value={s ? (s.card ? `${s.card.brand} •••• ${s.card.last4}` : 'No card yet') : '…'}
        tone={s?.card ? 'ok' : 'warn'}
      />
      <Tile
        href="#/settings"
        icon={<SlidersHorizontal className="size-5" />}
        label="Purchases"
        value={s ? (s.settings.autonomy === 'auto' ? 'Automatic, within limits' : 'Always ask me') : '…'}
        tone="plain"
      />
      <Tile href="#/rules" icon={<Bell className="size-5" />} label="Your rules" value={active === null ? '…' : `${active} active`} tone="plain" />
    </div>
  )
}

const CATEGORY = { concert: 'Concert', festival: 'Festival', football: 'Football', other: 'Show' } as const

function EventTile({ e, onAsk }: { e: EventView; onAsk: (text: string) => void }) {
  const d = new Date(e.startsAt)
  return (
    <div className="flex gap-4 rounded-2xl border border-brand/10 bg-white p-4 transition hover:border-gold hover:shadow-sm">
      <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-brand text-center text-cream">
        <div>
          <div className="text-xl font-bold leading-none">{d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-gold">{d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug text-brand">{e.title}</h3>
          <Chip>{CATEGORY[e.category as keyof typeof CATEGORY] ?? 'Show'}</Chip>
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-ink/55"><MapPin className="size-3 shrink-0" />{e.venue}, {e.city}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="text-sm text-ink/60">from <b className="text-base text-brand">{mad(e.fromPriceMad)}</b></span>
          <span className="flex items-center gap-3 text-sm">
            {e.sellerUrl && (
              <a href={e.sellerUrl} target="_blank" rel="noreferrer" aria-label={`${e.title} on ${e.seller}`} className="text-ink/40 hover:text-brand">
                <ExternalLink className="size-4" />
              </a>
            )}
            <button type="button" onClick={() => onAsk(`Tell me about "${e.title}" in ${e.city} and what 2 tickets would cost in total.`)} className="font-semibold text-brand underline-offset-4 hover:underline">
              Ask Sindibad
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

/** Real upcoming events, filterable by city. "Ask Sindibad" opens the conversation about that event. */
export function EventsGrid({ onAsk }: { onAsk: (text: string) => void }) {
  const [events, setEvents] = useState<EventView[] | null>(null)
  const [city, setCity] = useState('All')

  useEffect(() => {
    api<{ events: EventView[] }>('/events').then((r) => setEvents(r.events)).catch(() => setEvents([]))
  }, [])

  if (!events) return <p className="py-6 text-center text-brand/50">Loading events…</p>
  if (events.length === 0) return null

  const cities = ['All', ...Array.from(new Set(events.map((e) => e.city))).sort()]
  const shown = city === 'All' ? events : events.filter((e) => e.city === city)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-brand">Happening soon in Morocco</h2>
          <p className="text-xs text-ink/50">Listings from {events[0]?.seller}, checked {events[0]?.verifiedAt ? new Date(events[0].verifiedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'recently'}. Prices are "from" prices and can change.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCity(c)}
              aria-pressed={city === c}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${city === c ? 'bg-brand text-cream' : 'bg-white text-brand hover:bg-brand/5'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{shown.map((e) => <EventTile key={e.id} e={e} onAsk={onAsk} />)}</div>
    </section>
  )
}
