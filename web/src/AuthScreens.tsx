import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from './auth'
import { LanguageSwitcher, useI18n } from './i18n'
import { ErrorLine, inputClass } from './ui'

const primary =
  'w-full rounded-xl bg-brand py-3 font-semibold text-cream transition hover:bg-brand-soft disabled:opacity-60'

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t } = useI18n()
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div
        className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-3xl border border-brand/10 bg-white/90 p-8 shadow-[0_30px_80px_-30px_rgba(15,74,54,0.35)]`}
      >
        <LanguageSwitcher className="absolute end-5 top-5" />
        <a href="#/" aria-label={t('common.home')}>
          <img src="/logo.png" alt="Sindibad" width={636} height={245} className="mb-6 w-40" />
        </a>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-brand">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

/** Runs an async action, keeping `busy` and a message (in the current language) for the form. */
export function useAction() {
  const { errText } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

export function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const { t } = useI18n()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  const signingUp = mode === 'signup'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => (signingUp ? signUp(email, password, name) : signIn(email, password)))
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-brand">{signingUp ? t('auth.createTitle') : t('auth.welcome')}</h1>
      <p className="mt-1 text-sm text-ink/60">{signingUp ? t('auth.createSub') : t('auth.signinSub')}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {signingUp && (
          <Field label={t('field.name')}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
          </Field>
        )}
        <Field label={t('field.email')}>
          <input className={inputClass} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label={t('field.password')}>
          <input
            className={inputClass}
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 8 : 1}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
          />
        </Field>
        <ErrorLine error={error} />
        <button className={primary} disabled={busy}>
          {busy ? t('common.wait') : signingUp ? t('auth.createBtn') : t('auth.signinBtn')}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(signingUp ? 'signin' : 'signup')}
        className="mt-5 w-full text-center text-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        {signingUp ? t('auth.toSignin') : t('auth.toSignup')}
      </button>
    </Shell>
  )
}
