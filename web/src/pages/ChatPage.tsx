import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Mic, Plus, SendHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api'
import { ToolCard, type ToolPartLike } from '../cards'
import { EventsGrid, Hero, StatusStrip } from '../Discover'
import { clearPrompt, peekPrompt } from '../prompts'

/** **bold** is the only markdown the assistant uses. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((chunk, i) => (i % 2 ? <strong key={i}>{chunk}</strong> : <span key={i}>{chunk}</span>))}
    </>
  )
}

const friendly = (error: Error) => {
  try {
    return (JSON.parse(error.message) as { message?: string }).message ?? error.message
  } catch {
    return error.message || 'Something went wrong. Please try again.'
  }
}

// Browser speech-to-text (Chrome / Edge). Free, no key; accuracy for Darija is limited, so the transcript stays editable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionImpl = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

function Conversation({ initial, onReset }: { initial: UIMessage[]; onReset: () => void }) {
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        // Only the new message goes up. The server keeps the history, so it cannot be forged from the browser.
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages[messages.length - 1] } }),
      }),
  )
  const { messages, sendMessage, status, error } = useChat({ messages: initial, transport })
  const [input, setInput] = useState('')
  const [lang, setLang] = useState('fr-FR')
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognition = useRef<any>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    // braces on purpose: scrollIntoView may return a Promise, and an effect must not
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, status])

  // A prompt queued by another screen ("Ask Sindibad" on an event, a rule idea) is sent as soon as the chat opens.
  // Sent from a timer and cleared only when it fires: React runs effects twice in development, and the first run's
  // cleanup would otherwise cancel a send that already consumed the prompt.
  const sendRef = useRef(sendMessage)
  sendRef.current = sendMessage
  useEffect(() => {
    const queued = peekPrompt()
    if (!queued) return
    const timer = setTimeout(() => {
      clearPrompt()
      sendRef.current({ text: queued })
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    sendMessage({ text: t })
    setInput('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(input)
  }

  const toggleMic = () => {
    if (listening) return recognition.current?.stop()
    const rec = new SpeechRecognitionImpl()
    rec.lang = lang
    rec.interimResults = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => setInput(Array.from(e.results as ArrayLike<{ 0: { transcript: string } }>).map((r) => r[0].transcript).join(''))
    rec.onend = () => setListening(false)
    rec.start()
    recognition.current = rec
    setListening(true)
  }

  const empty = messages.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto pb-4">
        {empty ? (
          <div className="space-y-6 pt-1">
            <Hero onAsk={send} />
            <StatusStrip />
            <EventsGrid onAsk={send} />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-3 pt-2">
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
                {m.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return part.text ? (
                      <div
                        key={i}
                        dir="auto"
                        className={`my-1 max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 ${
                          m.role === 'user' ? 'rounded-br-md bg-brand text-cream' : 'rounded-bl-md border border-brand/10 bg-white text-ink'
                        }`}
                      >
                        <Rich text={part.text} />
                      </div>
                    ) : null
                  }
                  if (part.type.startsWith('tool-')) return <ToolCard key={i} part={part as unknown as ToolPartLike} />
                  return null
                })}
              </div>
            ))}
            {status === 'submitted' && (
              <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md bg-brand/5 px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand/50" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{friendly(error)}</p>}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-brand/20 bg-white px-4 py-2.5 shadow-sm">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            dir="auto"
            placeholder="Type or speak your request…"
            className="flex-1 bg-transparent py-1 outline-none placeholder:text-ink/40"
            aria-label="Message"
          />
          {SpeechRecognitionImpl && (
            <>
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language" className="rounded bg-transparent text-xs text-brand/70">
                <option value="fr-FR">FR</option>
                <option value="ar-MA">AR</option>
                <option value="en-US">EN</option>
              </select>
              <button type="button" onClick={toggleMic} aria-label="Speak" className={listening ? 'text-red-600' : 'text-brand/70 hover:text-brand'}>
                <Mic className="size-5" />
              </button>
            </>
          )}
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="text-brand disabled:opacity-40">
            <SendHorizontal className="size-5" />
          </button>
        </form>
        {!empty && (
          <button type="button" onClick={onReset} className="mx-auto mt-2 flex items-center gap-1 text-xs text-ink/50 hover:text-brand">
            <Plus className="size-3" /> New chat
          </button>
        )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [initial, setInitial] = useState<UIMessage[] | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api<{ messages: UIMessage[] }>('/chat')
      .then((r) => setInitial(r.messages))
      .catch(() => setInitial([]))
  }, [version])

  if (!initial) return <p className="py-10 text-center text-brand/60">Loading…</p>
  return (
    <Conversation
      key={version}
      initial={initial}
      onReset={async () => {
        await api('/chat', {}, 'DELETE')
        setInitial(null)
        setVersion((v) => v + 1)
      }}
    />
  )
}
