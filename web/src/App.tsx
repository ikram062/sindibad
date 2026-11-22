import { useEffect, useState } from 'react'
import AppLayout from './AppLayout'
import { AuthScreen } from './AuthScreens'
import { useAuth } from './auth'
import { useI18n } from './i18n'
import Landing from './Landing'
import MonEidScreen from './MonEid'
import ChatPage from './pages/ChatPage'
import ForYouPage from './pages/ForYouPage'
import RulesPage from './pages/RulesPage'
import SettingsPage from './pages/SettingsPage'

const PAGES: Record<string, () => React.ReactElement> = {
  '#/chat': () => <ChatPage />,
  '#/foryou': () => <ForYouPage />,
  '#/rules': () => <RulesPage />,
  '#/settings': () => <SettingsPage />,
}
const APP_ROUTES = [...Object.keys(PAGES), '#/verify']

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    location.hash = to
  }, [to])
  return null
}

/** Signed out -> sign in. Signed in but unverified -> Mon e-ID (skippable, but nothing can be bought). */
function Gate({ route }: { route: string }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const [skipped, setSkipped] = useState(false)

  if (user === undefined) return <div className="grid min-h-full place-items-center text-brand/60">{t('common.loading')}</div>
  if (!user) return <AuthScreen />

  const verified = user.kycStatus === 'verified'
  if (route === '#/verify' && verified) return <Redirect to="#/chat" />
  if (route === '#/verify' || (!verified && !skipped)) {
    return (
      <MonEidScreen
        onSkip={() => {
          setSkipped(true)
          location.hash = '#/chat'
        }}
      />
    )
  }
  return <AppLayout route={route}>{PAGES[route]!()}</AppLayout>
}

// Hash routing, no router library: the landing page, then four app screens.
export default function App() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return APP_ROUTES.includes(hash) ? <Gate route={hash} /> : <Landing />
}
