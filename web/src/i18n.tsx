import { Globe } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { ar } from './locales/ar'
import { en, type Dict, type Key } from './locales/en'
import { fr } from './locales/fr'

export type Lang = 'en' | 'fr' | 'ar'
type Vars = Record<string, string | number>

const DICTS: Record<Lang, Dict> = { en, fr, ar }
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
]
// Latin digits in Arabic too (the Moroccan convention): "-u-nu-latn".
const LOCALE: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR', ar: 'ar-MA-u-nu-latn' }
const STORAGE = 'sindibad.lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE)
    if (saved === 'en' || saved === 'fr' || saved === 'ar') return saved
  } catch {
    // storage blocked: fall through to the browser language
  }
  const browser = navigator.language.slice(0, 2)
  return browser === 'fr' || browser === 'ar' ? browser : 'en'
}

type Reason = { code: string; message: string; params?: Record<string, string | number> }

type I18n = {
  lang: Lang
  setLang: (l: Lang) => void
  dir: 'ltr' | 'rtl'
  /** BCP 47 tag for Intl, e.g. fr-FR. */
  locale: string
  t: (key: Key, vars?: Vars) => string
  /** Money in dirhams, e.g. "1,315.44 MAD" or "1,315.44 درهم". */
  mad: (n: number) => string
  /** A city name in the current language (falls back to the name as stored). */
  city: (name: string) => string
  fmtDate: (iso: string) => string
  fmtDateTime: (iso: string) => string
  /** Text for an API error: translated by its code when we know it, the server's message otherwise. */
  errText: (e: unknown) => string
  /** A server notification or rule outcome, written in the current language from its code + parameters. */
  notifText: (code: string | null | undefined, params: Record<string, string | number> | null | undefined, fallback: { title: string; body: string }) => { title: string; body: string }
  /** Why a purchase is not possible, from the eligibility reason. */
  reasonText: (r: Reason) => string
  kycFail: (code: string) => string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  // The whole page flips direction with the language (Arabic is right-to-left).
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE, l)
    } catch {
      // the choice just will not survive a reload
    }
  }, [])

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang]
    const has = (key: string) => key in dict
    const t = (key: Key, vars?: Vars) => {
      const text = dict[key] ?? en[key]
      return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : text
    }
    const num = (n: number) => n.toLocaleString(LOCALE[lang], { maximumFractionDigits: 2 })
    const mad = (n: number) => `${num(n)} ${lang === 'ar' ? 'درهم' : 'MAD'}`
    const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' })
    const fmtDateTime = (iso: string) =>
      new Date(iso).toLocaleString(LOCALE[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

    const errText = (e: unknown) => {
      if (e instanceof ApiError && has(`err.${e.code}`)) return t(`err.${e.code}` as Key)
      if (e instanceof Error && has(`err.${e.message}`)) return t(`err.${e.message}` as Key)
      if (e instanceof ApiError && e.message) return e.message
      return t('err.generic')
    }

    /** Parameters arrive as numbers/ids; money and enum values are turned into display text here. */
    const display = (p: Record<string, string | number>): Vars => {
      const out: Vars = { ...p }
      for (const k of ['price', 'total']) if (typeof p[k] === 'number') out[k] = mad(p[k])
      if (typeof p.why === 'string' && has(`why.${p.why}`)) out.why = t(`why.${p.why}` as Key, { message: String(p.message ?? '') })
      return out
    }

    const notifText: I18n['notifText'] = (code, params, fallback) => {
      if (!code || !has(`notif.${code}.title`)) return fallback
      const vars = display(params ?? {})
      const rule = params?.rule ? ` ${t('notif.yourRule', { rule: String(params.rule) })}` : ''
      return { title: t(`notif.${code}.title` as Key, vars), body: `${t(`notif.${code}.body` as Key, vars)}${rule}` }
    }

    const reasonText = (r: Reason) => {
      if (!has(`reason.${r.code}`)) return r.message
      const vars: Vars = {}
      if (typeof r.params?.remaining === 'number') vars.remaining = mad(r.params.remaining)
      if (typeof r.params?.opensAt === 'string') vars.date = fmtDateTime(r.params.opensAt)
      return t(`reason.${r.code}` as Key, vars)
    }

    const city = (name: string) => (has(`city.${name}`) ? t(`city.${name}` as Key) : name);

    const kycFail = (code: string) => t(has(`kyc.fail.${code}`) ? (`kyc.fail.${code}` as Key) : 'kyc.fail.FAILED')

    return { lang, setLang, dir, locale: LOCALE[lang], t, mad, city, fmtDate, fmtDateTime, errText, notifText, reasonText, kycFail }
  }, [lang, dir, setLang])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

/** The little language dropdown. A native select keeps it accessible and works with the keyboard and on phones. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <label className={`inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-white/80 px-3 py-1.5 text-sm font-medium text-brand ${className}`}>
      <Globe className="size-4 text-gold" aria-hidden />
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label={t('lang.label')}
        className="cursor-pointer bg-transparent outline-none"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
