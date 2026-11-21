import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { ArrowRight, Bell, Check, ShieldCheck, Ticket } from 'lucide-react'
import { useEffect, useRef } from 'react'
import DotGrid from './components/react-bits/DotGrid'
import Magnet from './components/react-bits/Magnet'
import ShinyText from './components/react-bits/ShinyText'
import SplitText from './components/react-bits/SplitText'
import SpotlightCard from './components/react-bits/SpotlightCard'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const DOT_MASK = {
  maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
  WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 78%)',
}

// Lenis gives the smooth scroll; ScrollTrigger is driven from the same GSAP ticker so they stay in sync.
let lenis: Lenis | undefined
function useSmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return
    lenis = new Lenis()
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (t: number) => lenis?.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      lenis?.destroy()
      lenis = undefined
    }
  }, [])
}

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (lenis) lenis.scrollTo(el, { offset: -20 })
  else el.scrollIntoView({ behavior: 'smooth' })
}

/** Illustrative conversation: the whole product in one card. Numbers are examples, not live prices. */
function ChatDemo() {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (reducedMotion()) return
      const q = gsap.utils.selector(root)
      const total = { v: 0 }
      const tl = gsap.timeline({ delay: 1.2, defaults: { ease: 'power3.out' } })
      tl.from(q('.m-user'), { y: 24, opacity: 0, duration: 0.6 })
        .from(q('.m-typing'), { opacity: 0, y: 10, duration: 0.3 }, '+=0.3')
        .to(q('.m-typing'), { opacity: 0, height: 0, margin: 0, padding: 0, duration: 0.3 }, '+=1.1')
        .from(q('.m-bot'), { y: 24, opacity: 0, duration: 0.6 })
        .from(q('.m-card'), { y: 30, opacity: 0, scale: 0.97, duration: 0.7 }, '-=0.2')
        .from(q('.m-line'), { x: -16, opacity: 0, stagger: 0.18, duration: 0.45 }, '-=0.3')
        .to(
          total,
          {
            v: 897,
            duration: 1,
            ease: 'power2.out',
            onUpdate: () => {
              const el = q('.m-total')[0]
              if (el) el.textContent = `${Math.round(total.v)} MAD`
            },
          },
          '<',
        )
        .from(q('.m-confirm'), { y: 14, opacity: 0, duration: 0.5 })
        .to(q('.m-confirm'), { boxShadow: '0 0 0 10px rgba(217,164,65,0)', duration: 1.2, repeat: 3, ease: 'power1.out' })
    },
    { scope: root },
  )

  return (
    <div
      ref={root}
      className="w-full max-w-md rounded-3xl border border-brand/10 bg-white/90 p-5 shadow-[0_30px_80px_-30px_rgba(15,74,54,0.35)] backdrop-blur"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-bold text-gold">S</span>
          <span className="font-semibold text-brand">Sindibad</span>
        </div>
        <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-medium text-brand">
          Example conversation
        </span>
      </div>

      <div className="m-user ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] text-cream">
        bghit tickets l concert f Seoul, ch7al ghadi nkhlles?
      </div>

      <div className="m-typing mt-3 flex w-fit gap-1 rounded-2xl rounded-bl-md bg-brand/5 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-brand/50"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>

      <div className="m-bot mt-3 max-w-[90%] rounded-2xl rounded-bl-md bg-brand/5 px-4 py-2.5 text-[15px] text-ink">
        Voici l’événement. Le coût réel, tout compris, avant que vous confirmiez :
      </div>

      <div className="m-card mt-3 rounded-2xl border border-brand/10 bg-cream/70 p-4 text-sm">
        <div className="mb-3 flex items-center gap-2 font-semibold text-brand">
          <Ticket className="size-4 text-gold" /> K-pop concert · Seoul
        </div>
        <Line label="Ticket · 132,000 KRW" value="884 MAD" />
        <Line label="Rate 1 KRW = 0.0067 MAD · 14:02" value="" muted />
        <Line label="Conversion spread (1.5%)" value="13 MAD" />
        <Line label="Sindibad fee" value="0 MAD" />
        <div className="m-line flex items-center gap-1.5 py-1.5 text-emerald-700">
          <Check className="size-4" /> Card allowance: enough left this year
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-brand/10 pt-3">
          <span className="font-semibold text-brand">Total</span>
          <span className="m-total text-xl font-bold text-brand">897 MAD</span>
        </div>
        <button
          type="button"
          className="m-confirm mt-4 w-full rounded-xl bg-gold py-2.5 font-semibold text-brand shadow-[0_0_0_0_rgba(217,164,65,0.5)]"
        >
          Review &amp; confirm
        </button>
      </div>
    </div>
  )
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`m-line flex justify-between py-1 ${muted ? 'text-xs text-ink/45' : 'text-ink/80'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Hero() {
  const hero = useRef<HTMLElement>(null)
  const chat = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (reducedMotion()) return
      gsap.from('.h-fade', { y: 24, opacity: 0, duration: 0.8, stagger: 0.12, delay: 0.5, ease: 'power3.out' })
      gsap.from('.h-logo', { y: -20, opacity: 0, duration: 0.9, ease: 'power3.out' })
      gsap.to(chat.current, {
        y: -60,
        ease: 'none',
        scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: true },
      })
    },
    { scope: hero },
  )

  return (
    <section ref={hero} className="relative isolate overflow-hidden">
      <DotGrid
        // Inline styles: the component's own "relative h-full" classes would otherwise beat "absolute inset-0".
        style={{ position: 'absolute', inset: 0, zIndex: -10, ...DOT_MASK }}
        baseColor="#9cc4b0"
        activeColor="#d9a441"
        gap={30}
        dotSize={4}
        paused={reducedMotion()}
      />
      <div className="pointer-events-none absolute -right-40 -top-40 -z-10 size-[560px] rounded-full bg-gold/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-52 -left-40 -z-10 size-[520px] rounded-full bg-brand-soft/15 blur-3xl" />

      <header className="absolute inset-x-0 top-0 z-10 mx-auto flex max-w-6xl items-center justify-end gap-6 px-6 py-6 text-sm font-medium text-brand">
        <button type="button" onClick={() => scrollToId('how')} className="hover:text-gold">How it works</button>
        <button type="button" onClick={() => scrollToId('why')} className="hover:text-gold">Why Sindibad</button>
        <a href="#/chat" className="rounded-full border border-brand/20 bg-white/70 px-4 py-1.5 hover:border-gold">
          Open chat
        </a>
      </header>

      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 pb-20 pt-28 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <img src="/logo.png" alt="Sindibad" width={636} height={245} className="h-logo mb-8 w-64 md:w-80" />
          <div className="h-fade mb-4 text-sm font-semibold uppercase tracking-[0.18em]">
            <ShinyText text="Tickets for Moroccans, anywhere" color="#0f4a36" shineColor="#d9a441" speed={3} />
          </div>
          <SplitText
            tag="h1"
            text="Every show, one chat away."
            splitType="words"
            trigger="load"
            delay={80}
            textAlign="left"
            className="text-5xl font-semibold leading-[1.05] text-brand md:text-7xl"
          />
          <p className="h-fade mt-6 max-w-xl text-pretty text-lg text-ink/70">
            Ask in Darija, French or Arabic. Sindibad finds the tickets, shows the real cost in dirhams, and prepares the
            purchase. You confirm every step.
          </p>
          <div className="h-fade mt-8 flex flex-wrap items-center gap-4">
            <Magnet padding={60} magnetStrength={3}>
              <button
                type="button"
                onClick={() => scrollToId('how')}
                className="flex items-center gap-2 rounded-full bg-brand px-7 py-3.5 font-semibold text-cream shadow-lg shadow-brand/25 transition hover:bg-brand-soft"
              >
                See how it works <ArrowRight className="size-4" />
              </button>
            </Magnet>
            <a href="#/chat" className="px-3 py-3.5 font-semibold text-brand underline-offset-4 hover:underline">
              Try the assistant
            </a>
          </div>
        </div>

        <div ref={chat} className="flex justify-center lg:justify-end">
          <ChatDemo />
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { n: '01', title: 'Ask', text: 'Type or say it in Darija, French or Arabic. No forms, no menus.' },
  {
    n: '02',
    title: 'See the real cost',
    text: 'Price, currency conversion, fees and your card allowance, line by line, with the time the rate was recorded.',
  },
  { n: '03', title: 'You confirm', text: 'The assistant only prepares the purchase. Nothing happens until you tap confirm.' },
]

const FEATURES = [
  { icon: ShieldCheck, title: 'Know before you pay', text: 'Country, seller rules and your card allowance are checked first. If it is a no, you see why.' },
  { icon: Ticket, title: 'Official sellers only', text: 'No resale marketplace and no bots. Tickets are bought in your name at the official price.' },
  { icon: Bell, title: 'Never miss a sale', text: 'Tell it what you want once. It tells you when sales open or prices drop.' },
]

function Sections() {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (reducedMotion()) return
      gsap.from('.step', {
        y: 50, opacity: 0, stagger: 0.15, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: '#how', start: 'top 75%' },
      })
      gsap.from('.feat', {
        y: 50, opacity: 0, stagger: 0.15, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: '#why', start: 'top 75%' },
      })
    },
    { scope: root },
  )

  return (
    <div ref={root}>
      <section id="how" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-2xl text-4xl font-semibold text-brand md:text-5xl">From a question to a ticket in three steps.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="step border-t-2 border-gold pt-5">
              <div className="text-sm font-semibold text-gold">{s.n}</div>
              <h3 className="mt-2 text-2xl font-semibold text-brand">{s.title}</h3>
              <p className="mt-2 text-ink/70">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="why" className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="max-w-2xl text-4xl font-semibold text-brand md:text-5xl">Built for people buying from Morocco.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <SpotlightCard key={title} theme="light" spotlightColor="#d9a441" className="feat p-7">
              <Icon className="size-7 text-gold" />
              <h3 className="mt-4 text-xl font-semibold text-brand">{title}</h3>
              <p className="mt-2 text-ink/70">{text}</p>
            </SpotlightCard>
          ))}
        </div>
      </section>

      <footer className="border-t border-brand/10 px-6 py-8 text-center text-sm text-ink/50">
        <span className="font-semibold text-brand">Sindibad</span> <span dir="rtl">سندباد</span> · HPS ImpactPay Africa
        hackathon prototype. Figures shown are illustrative.
      </footer>
    </div>
  )
}

export default function Landing() {
  useSmoothScroll()
  return (
    <>
      <Hero />
      <Sections />
    </>
  )
}
