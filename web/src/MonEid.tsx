import { ShieldCheck, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuth, type User } from './auth'
import { Field, Shell, useAction } from './AuthScreens'
import { Chip, ErrorLine, inputClass } from './ui'

type Session = { sessionId: string; deepLink: string; expiresAt: string; simulator: boolean }
type Poll = { status: 'pending' | 'declined' } | { status: 'failed'; reason: string } | { status: 'completed'; user: User }

const inYears = (n: number) => new Date(Date.now() + n * 365 * 86_400_000).toISOString().slice(0, 10)

/**
 * SIMULATED phone. In production this whole panel does not exist: the citizen approves inside the real Mon e-ID
 * app and DGSN tells our server. It only calls the same endpoint that approval would.
 */
function SimulatedPhone({ sessionId, defaultName }: { sessionId: string; defaultName: string }) {
  const [cin, setCin] = useState(() => 'AB' + Math.floor(100000 + Math.random() * 900000))
  const [fullName, setFullName] = useState(defaultName)
  const [dateOfBirth, setDob] = useState('1999-05-20')
  const [expiryDate, setExpiry] = useState(inYears(5))
  const [answered, setAnswered] = useState(false)
  const { busy, error, run } = useAction()

  const answer = (path: 'approve' | 'decline') =>
    run(async () => {
      await api(`/kyc/mon-eid/sessions/${sessionId}/${path}`, path === 'approve' ? { cin, fullName, dateOfBirth, expiryDate } : {})
      setAnswered(true)
    })

  const small = `${inputClass} !py-2 !text-sm`
  return (
    <div className="mx-auto w-full max-w-[290px] rounded-[2rem] border-4 border-ink/80 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center gap-2 text-brand">
        <Smartphone className="size-5" />
        <span className="font-semibold">Mon e-ID</span>
        <Chip tone="gold">simulated</Chip>
      </div>
      {answered ? (
        <p className="py-10 text-center text-sm text-ink/60">Answer sent. Check the website…</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink/70">
            <b className="text-brand">Sindibad</b> asks to see: your name, CIN number, date of birth and CIN expiry date.
          </p>
          <div className="space-y-2 text-left">
            <Field label="CIN number (read from your card)">
              <input className={small} value={cin} onChange={(e) => setCin(e.target.value)} maxLength={10} />
            </Field>
            <Field label="Full name">
              <input className={small} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Born">
                <input className={small} type="date" value={dateOfBirth} onChange={(e) => setDob(e.target.value)} />
              </Field>
              <Field label="Expires">
                <input className={small} type="date" value={expiryDate} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
            </div>
          </div>
          <ErrorLine error={error} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => answer('decline')} className="rounded-xl border border-brand/20 py-2 text-sm font-semibold text-brand">
              Decline
            </button>
            <button type="button" disabled={busy} onClick={() => answer('approve')} className="rounded-xl bg-brand py-2 text-sm font-semibold text-cream">
              Approve
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function MonEidScreen({ onSkip }: { onSkip: () => void }) {
  const { user, applyUser } = useAuth()
  const [consent, setConsent] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const { busy, error, setError, run } = useAction()

  const start = () =>
    run(async () => {
      setSession(await api<Session>('/kyc/mon-eid/start', { consent }))
    })

  // The website waits for the phone's answer.
  useEffect(() => {
    if (!session) return
    const timer = setInterval(async () => {
      try {
        const r = await api<Poll>(`/kyc/mon-eid/sessions/${session.sessionId}`)
        if (r.status === 'completed') applyUser(r.user)
        else if (r.status === 'failed' || r.status === 'declined') {
          setError(r.status === 'failed' ? r.reason : 'You declined the request on your phone.')
          setSession(null)
        }
      } catch {
        // transient network error: keep polling
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [session, applyUser, setError])

  return (
    <Shell wide={Boolean(session)}>
      <div className="flex items-center gap-2 text-gold">
        <ShieldCheck className="size-6" />
        <span className="text-sm font-semibold uppercase tracking-wider">Identity check</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold text-brand">Verify your identity with Mon e-ID</h1>
      <p className="mt-1 text-sm text-ink/60">Required before you can buy anything. You can still explore without it.</p>

      {!session ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-ink/70">
            Mon e-ID is the national electronic ID app from the DGSN. You approve sharing a few details from your CIN on your
            phone; you never type your ID number into our website.
          </p>
          <label className="flex items-start gap-2 text-sm text-ink/70">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
            <span>
              I agree that Sindibad processes my ID details to verify my identity. We keep only a one-way fingerprint of your CIN,
              never the number itself. Your birth and expiry dates are checked and then discarded.
            </span>
          </label>
          <ErrorLine error={error} />
          <button
            type="button"
            onClick={start}
            disabled={busy || !consent}
            className="w-full rounded-xl bg-brand py-3 font-semibold text-cream transition hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? 'Starting…' : 'Continue with Mon e-ID'}
          </button>
          <button type="button" onClick={onSkip} className="w-full text-center text-sm font-medium text-brand underline-offset-4 hover:underline">
            Do this later
          </button>
        </div>
      ) : (
        <div className="mt-6 grid items-center gap-8 md:grid-cols-2">
          <div className="text-center">
            <div className="mx-auto w-fit rounded-2xl border border-brand/10 bg-white p-4">
              <QRCodeSVG value={session.deepLink} size={190} fgColor="#0f4a36" />
            </div>
            <ol className="mt-4 space-y-1 text-left text-sm text-ink/70">
              <li>1. Open the Mon e-ID app on your phone.</li>
              <li>2. Scan this code.</li>
              <li>3. Review and approve sharing your details.</li>
            </ol>
            <p className="mt-3 text-xs text-ink/50">Waiting for your approval… this page updates by itself.</p>
          </div>
          {session.simulator && <SimulatedPhone sessionId={session.sessionId} defaultName={user?.name ?? ''} />}
        </div>
      )}

      <p className="mt-6 rounded-xl bg-gold/15 px-4 py-3 text-xs text-ink/70">
        Prototype: this is a <b>simulation</b>. It is not connected to DGSN or the real Mon e-ID. The phone on the right stands in
        for the app, and the check only validates the CIN format, expiry date and age.
      </p>
    </Shell>
  )
}
