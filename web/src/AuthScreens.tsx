import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from './api'
import { useAuth } from './auth'

const input =
  'w-full rounded-xl border border-brand/20 bg-white px-4 py-3 outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30'
const primary =
  'w-full rounded-xl bg-brand py-3 font-semibold text-cream transition hover:bg-brand-soft disabled:opacity-60'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-brand/10 bg-white/90 p-8 shadow-[0_30px_80px_-30px_rgba(15,74,54,0.35)]">
        <a href="#/" aria-label="Back to home">
          <img src="/logo.png" alt="Sindibad" width={636} height={245} className="mb-6 w-40" />
        </a>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-brand">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

/** Runs an async action, keeping `busy` and the server's error message for the form. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

const ErrorLine = ({ error }: { error: string }) => (
  <p role="alert" className="min-h-5 text-sm text-red-700">
    {error}
  </p>
)

export function AuthScreen() {
  const { signIn, signUp } = useAuth()
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
      <h1 className="text-2xl font-semibold text-brand">{signingUp ? 'Create your account' : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-ink/60">
        {signingUp ? 'You will verify your CIN next, so you can buy tickets.' : 'Sign in to continue.'}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {signingUp && (
          <Field label="Full name">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <Field label="Password">
          <input
            className={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 8 : 1}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
          />
        </Field>
        <ErrorLine error={error} />
        <button className={primary} disabled={busy}>
          {busy ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(signingUp ? 'signin' : 'signup')}
        className="mt-5 w-full text-center text-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        {signingUp ? 'I already have an account' : 'Create an account'}
      </button>
    </Shell>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

export function KycScreen({ onSkip }: { onSkip: () => void }) {
  const { user, verifyCin } = useAuth()
  const [cin, setCin] = useState('')
  const [fullName, setFullName] = useState(user?.name ?? '')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [consent, setConsent] = useState(false)
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => verifyCin({ cin, fullName, dateOfBirth, expiryDate, consent }))
  }

  return (
    <Shell>
      <div className="flex items-center gap-2 text-gold">
        <ShieldCheck className="size-6" />
        <span className="text-sm font-semibold uppercase tracking-wider">Identity check</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold text-brand">Verify your CIN</h1>
      <p className="mt-1 text-sm text-ink/60">Required before you can buy anything. You can still explore without it.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="CIN number">
          <input
            className={`${input} uppercase`}
            value={cin}
            onChange={(e) => setCin(e.target.value)}
            placeholder="AB123456"
            required
            maxLength={10}
            pattern="[A-Za-z]{1,2}[0-9]{5,6}"
            title="One or two letters followed by five or six digits, for example AB123456"
            autoComplete="off"
          />
        </Field>
        <Field label="Full name, as on your CIN">
          <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoComplete="name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of birth">
            <input className={input} type="date" value={dateOfBirth} max={today()} onChange={(e) => setDateOfBirth(e.target.value)} required autoComplete="bday" />
          </Field>
          <Field label="CIN expiry date">
            <input className={input} type="date" value={expiryDate} min={today()} onChange={(e) => setExpiryDate(e.target.value)} required />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink/70">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-1 accent-[var(--color-brand)]" />
          <span>
            I agree that Sindibad processes my ID details to verify my identity. We keep only a one-way fingerprint of your
            CIN, never the number itself. Your birth and expiry dates are checked and then discarded.
          </span>
        </label>
        <ErrorLine error={error} />
        <button className={primary} disabled={busy || !consent}>
          {busy ? 'Verifying…' : 'Verify my CIN'}
        </button>
      </form>

      <button type="button" onClick={onSkip} className="mt-4 w-full text-center text-sm font-medium text-brand underline-offset-4 hover:underline">
        Do this later
      </button>
      <p className="mt-5 rounded-xl bg-gold/15 px-4 py-3 text-xs text-ink/70">
        Prototype: this check is simulated (format, expiry and age only). A real launch would use an identity-verification
        partner with an ID photo and selfie.
      </p>
    </Shell>
  )
}
