import type { ReactNode } from 'react'

export const inputClass =
  'w-full rounded-xl border border-brand/20 bg-white px-4 py-3 outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30 disabled:opacity-50'
export const primaryButton =
  'rounded-xl bg-brand px-5 py-2.5 font-semibold text-cream transition hover:bg-brand-soft disabled:opacity-50'
export const ghostButton =
  'rounded-xl border border-brand/20 bg-white px-4 py-2 text-sm font-semibold text-brand transition hover:border-gold disabled:opacity-50'

export const mad = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} MAD`
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const tones = {
  green: 'bg-emerald-100 text-emerald-800',
  gold: 'bg-gold/20 text-brand',
  red: 'bg-red-100 text-red-800',
  grey: 'bg-brand/5 text-ink/60',
}
export function Chip({ tone = 'grey', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-brand/10 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

export function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="min-h-5 text-sm text-red-700">
      {error}
    </p>
  )
}
