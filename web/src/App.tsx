import { useEffect, useState } from 'react'
import { AuthScreen, KycScreen } from './AuthScreens'
import { useAuth } from './auth'
import ChatShell from './ChatShell'
import Landing from './Landing'

/** Signed out -> sign in. Signed in but unverified -> CIN check (skippable, but nothing can be bought). */
function ChatGate() {
  const { user } = useAuth()
  const [skipped, setSkipped] = useState(false)
  const [verifying, setVerifying] = useState(false)

  if (user === undefined) return <div className="grid min-h-full place-items-center text-brand/60">Loading…</div>
  if (!user) return <AuthScreen />
  if (user.kycStatus !== 'verified' && (!skipped || verifying)) {
    return (
      <KycScreen
        onSkip={() => {
          setSkipped(true)
          setVerifying(false)
        }}
      />
    )
  }
  return <ChatShell onVerify={() => setVerifying(true)} />
}

// Two screens, no router needed: "#/chat" opens the assistant, anything else is the landing page.
export default function App() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return hash === '#/chat' ? <ChatGate /> : <Landing />
}
