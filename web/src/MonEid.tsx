import { ShieldCheck, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuth, type User } from './auth'
import { Field, Shell, useAction } from './AuthScreens'
import { useI18n } from './i18n'
import { Chip, ErrorLine, inputClass } from './ui'

type Session = { sessionId: string; deepLink: string; expiresAt: string; simulator: boolean }
type Poll = { status: 'pending' | 'declined' } | { status: 'failed'; reason: string } | { status: 'completed'; user: User }

const inYears = (n: number) => new Date(Date.now() + n * 365 * 86_400_000).toISOString().slice(0, 10)

/**
 * SIMULATED phone. In production this whole panel does not exist: the citizen approves inside the real Mon e-ID
 * app and DGSN tells our server. It only calls the same endpoint that approval would.
 */
function SimulatedPhone({ sessionId, defaultName }: { sessionId: string; defaultName: string }) {
  const { t } = useI18n()
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
        <Chip tone="gold">{t('common.simulated')}</Chip>
      </div>
      {answered ? (
        <p className="py-10 text-center text-sm text-ink/60">{t('kyc.phone.sent')}</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink/70">{t('kyc.phone.asks')}</p>
          <div className="space-y-2 text-start">
            <Field label={t('kyc.phone.cin')}>
              <input className={small} dir="ltr" value={cin} onChange={(e) => setCin(e.target.value)} maxLength={10} />
            </Field>
            <Field label={t('field.name')}>
              <input className={small} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('kyc.phone.born')}>
                <input className={small} type="date" value={dateOfBirth} onChange={(e) => setDob(e.target.value)} />
              </Field>
              <Field label={t('kyc.phone.expires')}>
                <input className={small} type="date" value={expiryDate} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
            </div>
          </div>
          <ErrorLine error={error} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => answer('decline')} className="rounded-xl border border-brand/20 py-2 text-sm font-semibold text-brand">
              {t('kyc.phone.decline')}
            </button>
            <button type="button" disabled={busy} onClick={() => answer('approve')} className="rounded-xl bg-brand py-2 text-sm font-semibold text-cream">
              {t('kyc.phone.approve')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function MonEidScreen({ onSkip }: { onSkip: () => void }) {
  const { user, applyUser } = useAuth()
  const { t, kycFail } = useI18n()
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
          setError(r.status === 'failed' ? kycFail(r.reason) : t('kyc.declined'))
          setSession(null)
        }
      } catch {
        // transient network error: keep polling
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [session, applyUser, setError, kycFail, t])

  return (
    <Shell wide={Boolean(session)}>
      <div className="flex items-center gap-2 text-gold">
        <ShieldCheck className="size-6" />
        <span className="text-sm font-semibold uppercase tracking-wider">{t('kyc.eyebrow')}</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold text-brand">{t('kyc.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('kyc.sub')}</p>

      {!session ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-ink/70">{t('kyc.intro')}</p>
          <label className="flex items-start gap-2 text-sm text-ink/70">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
            <span>{t('kyc.consent')}</span>
          </label>
          <ErrorLine error={error} />
          <button
            type="button"
            onClick={start}
            disabled={busy || !consent}
            className="w-full rounded-xl bg-brand py-3 font-semibold text-cream transition hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? t('kyc.starting') : t('kyc.continue')}
          </button>
          <button type="button" onClick={onSkip} className="w-full text-center text-sm font-medium text-brand underline-offset-4 hover:underline">
            {t('kyc.later')}
          </button>
        </div>
      ) : (
        <div className="mt-6 grid items-center gap-8 md:grid-cols-2">
          <div className="text-center">
            <div className="mx-auto w-fit rounded-2xl border border-brand/10 bg-white p-4">
              <QRCodeSVG value={session.deepLink} size={190} fgColor="#0f4a36" />
            </div>
            <ol className="mt-4 list-decimal space-y-1 ps-5 text-start text-sm text-ink/70">
              <li>{t('kyc.step1')}</li>
              <li>{t('kyc.step2')}</li>
              <li>{t('kyc.step3')}</li>
            </ol>
            <p className="mt-3 text-xs text-ink/50">{t('kyc.waiting')}</p>
          </div>
          {session.simulator && <SimulatedPhone sessionId={session.sessionId} defaultName={user?.name ?? ''} />}
        </div>
      )}

      <p className="mt-6 rounded-xl bg-gold/15 px-4 py-3 text-xs text-ink/70">{t('kyc.proto')}</p>
    </Shell>
  )
}
